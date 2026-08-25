// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Route-level integration tests for the orders module, exercising the
 * real Hono app with a scripted fake Supabase client (network is
 * unavailable in CI). Pins the critical behaviors:
 *   - POST computes totals server-side from catalog prices
 *   - POST retries the order number on a 23505 unique violation
 *   - client-supplied prices on blind items are rejected (strict schema)
 *   - bulk line-item inserts use a uniform column set (PostgREST rule)
 *   - /send returns 502 when the email service fails and performs NO
 *     database write afterwards (order left untouched)
 *   - /payments/:paymentId/receipt guards (404 foreign payment, 400 no
 *     email) and stamps receipt_sent_at ONLY after a successful send
 *   - the warranty certificate is emailed automatically when a payment
 *     clears the balance, exactly once, and a failed warranty send never
 *     turns the recorded payment into a failed request
 *   - /warranty (manual resend) guards: 409 while money is owed, 400 no
 *     email, 502 on provider rejection, resend allowed once stamped
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { inflateSync } from 'node:zlib';

/** Rows returned by table, keyed for the fake client. */
interface FakeDb {
  responses: Record<string, unknown[]>;
  /** Queue of insert results for the orders table (per attempt) */
  orderInsertResults: Array<{ data?: unknown; error?: { code: string; message: string } }>;
  calls: string[];
  /** Captured insert payloads keyed by table name */
  insertPayloads: Record<string, unknown[]>;
  /** Captured update payloads keyed by table name */
  updatePayloads: Record<string, unknown[]>;
}

const db: FakeDb = { responses: {}, orderInsertResults: [], calls: [], insertPayloads: {}, updatePayloads: {} };

/**
 * Minimal thenable query builder that mimics the supabase-js chain.
 * Every chained method returns `this`; awaiting resolves a scripted
 * response for the table/op pair.
 */
function makeBuilder(table: string) {
  const state = { table, op: 'select', head: false };
  const builder: Record<string, unknown> = {};
  const chain = (name: string) =>
    ((...args: unknown[]) => {
      if (['insert', 'update', 'delete'].includes(name)) state.op = name;
      if (name === 'insert') {
        (db.insertPayloads[state.table] ??= []).push(args[0]);
      }
      if (name === 'update') {
        (db.updatePayloads[state.table] ??= []).push(args[0]);
      }
      return builder;
    }) as unknown;
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'is', 'lt', 'gte', 'lte', 'or', 'ilike', 'order', 'limit']) {
    builder[m] = chain(m);
  }
  const resolve = () => {
    db.calls.push(`${state.table}.${state.op}`);
    if (state.table === 'orders' && state.op === 'insert') {
      const next = db.orderInsertResults.shift() ?? { data: null, error: { code: 'XX', message: 'exhausted' } };
      return { data: next.data ?? null, error: next.error ?? null, count: null };
    }
    const key = `${state.table}.${state.op}`;
    const rows = db.responses[key] ?? [];
    return { data: rows, error: null, count: rows.length };
  };
  builder.single = async () => {
    const r = resolve();
    return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error };
  };
  builder.maybeSingle = builder.single;
  // select with head:true count support
  (builder.select as unknown) = (_cols?: string, opts?: { count?: string; head?: boolean }) => {
    if (opts?.head) state.head = true;
    return builder;
  };
  (builder as { then: unknown }).then = (onFulfilled: (v: unknown) => unknown) => {
    const r = resolve();
    return Promise.resolve(
      onFulfilled({
        data: r.data,
        error: r.error,
        count: state.head ? ((db.responses[`${state.table}.count`]?.[0] as number) ?? 0) : null,
      })
    );
  };
  return builder;
}

vi.mock('../lib/supabase', () => ({
  createSupabaseAdmin: () => ({ from: (table: string) => makeBuilder(table) }),
}));

import ordersApp from './orders';
// The lock fixtures below fingerprint their rows with the SAME functions
// the Worker uses, so a test row and the payload that edits it agree by
// construction rather than by a hand-copied string.
import { pricingFingerprint } from '../lib/priceLock';
import { lockInputFromRow } from '../lib/priceLockStore';

/** Standard env bindings for app.request. */
const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
  RESEND_API_KEY: 'not-a-real-key',
  APP_URL: 'http://localhost:5173',
  ENVIRONMENT: 'test',
};

const MATERIAL = { id: '11111111-1111-4111-8111-111111111111', name: 'Blackout White', price_per_sqm: 55 };
const CASSETTE = { id: '22222222-2222-4222-8222-222222222222', name: 'Standard', price: 20, price_basis: 'per_m', active: true };
const CONTROL = { id: '33333333-3333-4333-8333-333333333333', name: 'Chain', price: 0, price_basis: 'per_panel', active: true };
// Priced at 0, mirroring the production seed, so every pre-existing money
// assertion in this file still holds. The priced case is exercised below.
const BOTTOM_RAIL = { id: '55555555-5555-4555-8555-555555555555', name: 'Regular', price: 0, price_basis: 'per_m', active: true };
// Curtains catalogs. Both carry non-identity values so a test that
// accidentally priced with the fallbacks would show a different number.
const PLEAT = { id: '66666666-6666-4666-8666-666666666666', name: 'Pinch', multiplier: 2.5 };
const INSTALL = { id: '77777777-7777-4777-8777-777777777777', name: 'Rod', price: 45, price_basis: 'per_unit', active: true };

/** The two blind types the fixtures below are scoped to. */
const TYPE_ROLLER = { id: '88888888-8888-4888-8888-888888888881', name: 'Roller' };
const TYPE_CURTAINS = { id: '88888888-8888-4888-8888-888888888882', name: 'Curtains' };

/**
 * Scoping rows reproducing migration 35's backfill for these fixtures:
 * Roller takes a cassette, a rail and a control; Curtains takes a control
 * and an installation option and nothing else. Which slots a type uses is
 * DATA now, so without these every blind item would be unconstrained.
 */
function scopingRows(): Record<string, unknown[]> {
  return {
    'blind_types.select': [TYPE_ROLLER, TYPE_CURTAINS],
    'cassette_option_blind_types.select': [
      { cassette_option_id: CASSETTE.id, blind_type_id: TYPE_ROLLER.id },
    ],
    'bottom_rail_option_blind_types.select': [
      { bottom_rail_option_id: BOTTOM_RAIL.id, blind_type_id: TYPE_ROLLER.id },
    ],
    'control_option_blind_types.select': [
      { control_option_id: CONTROL.id, blind_type_id: TYPE_ROLLER.id },
      { control_option_id: CONTROL.id, blind_type_id: TYPE_CURTAINS.id },
    ],
    'installation_option_blind_types.select': [
      { installation_option_id: INSTALL.id, blind_type_id: TYPE_CURTAINS.id },
    ],
  };
}

/** Valid create payload used across tests. */
function payload() {
  return {
    customer_id: '44444444-4444-4444-8444-444444444444',
    order_date: '2026-07-03',
    expiry_date: '2026-07-17',
    discount_type: 'percent',
    discount_value: 10,
    line_items: [
      {
        item_type: 'blind',
        room_name: 'Living Room',
        blinds_type: 'Roller',
        panels: [70, 70],
        height_cm: 200,
        material_id: MATERIAL.id,
        cassette_id: CASSETTE.id,
        bottom_rail_id: BOTTOM_RAIL.id,
        control_id: CONTROL.id,
        quantity: 2,
      },
      { item_type: 'preset', description: 'Installation', quantity: 1, unit_price: 25 },
    ],
  };
}

beforeEach(() => {
  db.calls = [];
  db.orderInsertResults = [];
  db.insertPayloads = {};
  db.updatePayloads = {};
  db.responses = {
    'materials.select': [MATERIAL],
    'cassette_options.select': [CASSETTE],
    'bottom_rail_options.select': [BOTTOM_RAIL],
    'control_options.select': [CONTROL],
    'installation_options.select': [INSTALL],
    'company_settings.select': [{ default_expiry_days: 14 }],
    'orders.count': [0],
    'line_items.insert': [{}],
    'orders.select': [],
    ...scopingRows(),
  };
});

describe('POST /api/orders', () => {
  it('computes totals server-side (subtotal 389 → total 395.61)', async () => {
    db.orderInsertResults = [{ data: { id: 'e1', subtotal: 0 } }];
    const res = await ordersApp.request('/', {
      method: 'POST',
      body: JSON.stringify(payload()),
      headers: { 'Content-Type': 'application/json' },
    }, ENV);
    expect(res.status).toBe(201);
    // material 154 + cassette 28 + control 0 = 182/blind ×2 = 364 + 25 = 389
    const orderRow = db.insertPayloads['orders']?.[0] as Record<string, number>;
    expect(orderRow.subtotal).toBe(389);
    expect(orderRow.discount_amount).toBe(38.9);
    expect(orderRow.taxable_amount).toBe(350.1);
    expect(orderRow.tax_amount).toBe(45.51);
    expect(orderRow.total).toBe(395.61);
    expect(db.calls).toContain('line_items.insert');
  });

  it('retries the order number on a 23505 unique violation', async () => {
    db.orderInsertResults = [
      { error: { code: '23505', message: 'duplicate key value violates unique constraint' } },
      { data: { id: 'e2' } },
    ];
    const res = await ordersApp.request('/', {
      method: 'POST',
      body: JSON.stringify(payload()),
      headers: { 'Content-Type': 'application/json' },
    }, ENV);
    expect(res.status).toBe(201);
    const inserts = db.calls.filter((c) => c === 'orders.insert');
    expect(inserts.length).toBe(2);
  });

  it('fails after a non-unique-violation insert error', async () => {
    db.orderInsertResults = [{ error: { code: '23503', message: 'fk violation' } }];
    const res = await ordersApp.request('/', {
      method: 'POST',
      body: JSON.stringify(payload()),
      headers: { 'Content-Type': 'application/json' },
    }, ENV);
    expect(res.status).toBe(500);
  });

  it('rejects client-supplied prices on blind items (strict schema)', async () => {
    const bad = payload();
    (bad.line_items[0] as Record<string, unknown>).unit_price = 0.01;
    const res = await ordersApp.request('/', {
      method: 'POST',
      body: JSON.stringify(bad),
      headers: { 'Content-Type': 'application/json' },
    }, ENV);
    expect(res.status).toBe(400);
    expect(db.calls).not.toContain('orders.insert');
  });

  it('rejects a price smuggled inside attributes', async () => {
    // The payload schema accepts `attributes` loosely (z.record), so this
    // is caught by the SECOND gate: the blind type's own strict schema,
    // re-parsed in resolveLineItems. Without it a client could write an
    // arbitrary money field into the jsonb column.
    const bad = payload();
    (bad.line_items[0] as Record<string, unknown>).attributes = { unit_price: 1 };
    const res = await ordersApp.request('/', {
      method: 'POST',
      body: JSON.stringify(bad),
      headers: { 'Content-Type': 'application/json' },
    }, ENV);
    expect(res.status).toBe(400);
    expect(db.calls).not.toContain('orders.insert');
    // Proves WHICH gate fired: the payload schema now accepts `attributes`
    // as a loose record, so this message can only come from the per-type
    // re-parse. Without this assertion the test would still pass if the
    // second gate were deleted and the first happened to reject.
    expect(((await res.json()) as { error: string }).error).toContain('does not accept those options');
  });

  it('rejects an attribute key the blind type has not declared', async () => {
    // Roller declares no attributes, so a Shutter-shaped field is not
    // merely ignored — it is refused, which is what keeps the stored blob
    // in step with the type that owns it.
    const bad = payload();
    (bad.line_items[0] as Record<string, unknown>).attributes = { louvre_mm: 63 };
    const res = await ordersApp.request('/', {
      method: 'POST',
      body: JSON.stringify(bad),
      headers: { 'Content-Type': 'application/json' },
    }, ENV);
    expect(res.status).toBe(400);
    expect(db.calls).not.toContain('orders.insert');
    expect(((await res.json()) as { error: string }).error).toContain('Roller does not accept those options');
  });

  it('defaults attributes to {} on every row when the client omits them', async () => {
    db.orderInsertResults = [{ data: { id: 'e4' } }];
    const res = await ordersApp.request('/', {
      method: 'POST',
      body: JSON.stringify(payload()), // blind + preset, neither sends attributes
      headers: { 'Content-Type': 'application/json' },
    }, ENV);
    expect(res.status).toBe(201);
    const rows = db.insertPayloads['line_items']?.[0] as Record<string, unknown>[];
    for (const r of rows) expect(r.attributes).toEqual({});
  });

  it('gives every line-item row an identical column set (PostgREST bulk-insert rule)', async () => {
    // PostgREST unifies keys across bulk-inserted rows and NULL-fills
    // gaps, which violates not-null defaults — regression for the bug
    // found by the live E2E (missing `description` on blind rows).
    db.orderInsertResults = [{ data: { id: 'e3' } }];
    const res = await ordersApp.request('/', {
      method: 'POST',
      body: JSON.stringify(payload()), // blind + preset together
      headers: { 'Content-Type': 'application/json' },
    }, ENV);
    expect(res.status).toBe(201);
    const rows = db.insertPayloads['line_items']?.[0] as Record<string, unknown>[];
    expect(Array.isArray(rows) && rows.length === 2).toBe(true);
    const keySets = rows.map((r) => Object.keys(r).sort().join(','));
    expect(keySets[0]).toBe(keySets[1]);
    // and the not-null-default columns are explicitly present
    for (const r of rows) {
      expect(r).toHaveProperty('description');
      expect(r).toHaveProperty('room_name');
      expect(r).toHaveProperty('panels');
    }
  });

  it('rejects expiry before order date', async () => {
    const bad = { ...payload(), expiry_date: '2026-07-01' };
    const res = await ordersApp.request('/', {
      method: 'POST',
      body: JSON.stringify(bad),
      headers: { 'Content-Type': 'application/json' },
    }, ENV);
    expect(res.status).toBe(400);
  });

  it('snapshots the bottom rail name and price onto the line item', async () => {
    db.orderInsertResults = [{ data: { id: 'e1', subtotal: 0 } }];
    const res = await ordersApp.request('/', {
      method: 'POST',
      body: JSON.stringify(payload()),
      headers: { 'Content-Type': 'application/json' },
    }, ENV);
    expect(res.status).toBe(201);
    const rows = db.insertPayloads['line_items']?.[0] as Record<string, unknown>[];
    const blind = rows.find((r) => r.item_type === 'blind')!;
    expect(blind.bottom_rail_id).toBe(BOTTOM_RAIL.id);
    expect(blind.bottom_rail_name).toBe('Regular');
    expect(blind.bottom_rail_price_per_m).toBe(0);
    // Preset rows must carry the SAME column set with null values — a
    // missing key here lets PostgREST NULL-fill and break the insert.
    const preset = rows.find((r) => r.item_type === 'preset')!;
    expect(preset).toHaveProperty('bottom_rail_id', null);
    expect(preset).toHaveProperty('bottom_rail_name', null);
    expect(preset).toHaveProperty('bottom_rail_price_per_m', null);
  });

  it('adds the bottom rail to the unit price at its catalog rate', async () => {
    // 140cm of width at $15/m = $21 per blind, ×2 blinds = $42 over the
    // 389 baseline asserted above.
    db.responses['bottom_rail_options.select'] = [{ ...BOTTOM_RAIL, price: 15 }];
    db.orderInsertResults = [{ data: { id: 'e1', subtotal: 0 } }];
    const res = await ordersApp.request('/', {
      method: 'POST',
      body: JSON.stringify(payload()),
      headers: { 'Content-Type': 'application/json' },
    }, ENV);
    expect(res.status).toBe(201);
    const orderRow = db.insertPayloads['orders']?.[0] as Record<string, number>;
    expect(orderRow.subtotal).toBe(431);
  });

  it('rejects a client-supplied bottom rail price with 400 and inserts nothing', async () => {
    const bad = payload();
    (bad.line_items[0] as Record<string, unknown>).bottom_rail_price_per_m = 0;
    const res = await ordersApp.request('/', {
      method: 'POST',
      body: JSON.stringify(bad),
      headers: { 'Content-Type': 'application/json' },
    }, ENV);
    expect(res.status).toBe(400);
    expect(db.calls).not.toContain('line_items.insert');
  });

  it('rejects a blind with no bottom rail chosen', async () => {
    const bad = payload();
    delete (bad.line_items[0] as Record<string, unknown>).bottom_rail_id;
    const res = await ordersApp.request('/', {
      method: 'POST',
      body: JSON.stringify(bad),
      headers: { 'Content-Type': 'application/json' },
    }, ENV);
    expect(res.status).toBe(400);
    expect(db.calls).not.toContain('line_items.insert');
  });

  it('fails clearly when the chosen bottom rail was deleted mid-edit', async () => {
    db.responses['bottom_rail_options.select'] = [];
    db.orderInsertResults = [{ data: { id: 'e1', subtotal: 0 } }];
    const res = await ordersApp.request('/', {
      method: 'POST',
      body: JSON.stringify(payload()),
      headers: { 'Content-Type': 'application/json' },
    }, ENV);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: 'Selected bottom rail option no longer exists.',
    });
  });

  it('excludes hidden items from the totals but still stores them', async () => {
    db.orderInsertResults = [{ data: { id: 'e1', subtotal: 0 } }];
    const body = payload();
    body.discount_type = 'fixed';
    body.discount_value = 0;
    // The preset row (25) is hidden; only the two blinds (364) count.
    (body.line_items[1] as Record<string, unknown>).hidden = true;
    const res = await ordersApp.request('/', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }, ENV);
    expect(res.status).toBe(201);
    const orderRow = db.insertPayloads['orders']?.[0] as Record<string, number>;
    expect(orderRow.subtotal).toBe(364);
    // The hidden row is still inserted, still priced, and carries a uid.
    const rows = db.insertPayloads['line_items']?.[0] as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows[1].hidden).toBe(true);
    expect(rows[1].line_total).toBe(25);
    expect(typeof rows[1].uid).toBe('string');
    // Uniform column set (PostgREST bulk-insert rule).
    expect(Object.keys(rows[0]).sort()).toEqual(Object.keys(rows[1]).sort());
  });

  it('keeps a client-supplied uid so visibility can be diffed later', async () => {
    db.orderInsertResults = [{ data: { id: 'e1', subtotal: 0 } }];
    const body = payload();
    const uid = '99999999-9999-4999-8999-999999999999';
    (body.line_items[0] as Record<string, unknown>).uid = uid;
    const res = await ordersApp.request('/', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }, ENV);
    expect(res.status).toBe(201);
    const rows = db.insertPayloads['line_items']?.[0] as Record<string, unknown>[];
    expect(rows[0].uid).toBe(uid);
  });
});

describe('POST /api/orders/:id/send', () => {
  it('returns 502 on email failure and never writes to the DB after', async () => {
    const order = {
      id: 'e9',
      status: 'draft',
      order_number: 'F0307-126',
      order_date: new Date().toISOString().slice(0, 10),
      // Relative, not hardcoded: the send route 400s on a lapsed
      // expiry_date, so a fixed date turns this test into a time bomb
      // (it did fail once the calendar passed the original 2026-07-17).
      expiry_date: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
      subtotal: 100, discount_amount: 0, taxable_amount: 100, tax_amount: 13, total: 113,
      public_token: null,
      terms_snapshot: null,
      line_items: [],
      payments: [],
      customer: { first_name: 'A', last_name: 'B', email: 'a@example.com',
        phone: '', shipping_address_line1: '', shipping_address_line2: '', shipping_city: '',
        shipping_province: '', shipping_postal_code: '', billing_same_as_shipping: true,
        billing_address_line1: '', billing_address_line2: '', billing_city: '',
        billing_province: '', billing_postal_code: '' },
    };
    db.responses['orders.select'] = [order];
    db.responses['company_settings.select'] = [
      { company_name: 'Blinds Nisa', logo_url: null, email: 'x@y.z', phone: '', address: '', hst_number: '', terms_and_conditions: 'T&C', default_expiry_days: 14 },
    ];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes('api.resend.com')) {
        return new Response(JSON.stringify({ message: 'API key is invalid' }), { status: 401 });
      }
      return realFetch(url as never, init as never);
    }) as typeof fetch;

    try {
      const res = await ordersApp.request('/e9/send', { method: 'POST' }, ENV);
      expect(res.status).toBe(502);
      expect(db.calls.filter((c) => c === 'orders.update')).toHaveLength(0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('POST /api/orders/:id/mark-sent', () => {
  /**
   * Status-only draft → sent. The whole point of this route is that it
   * NEVER emails, so every case asserts Resend was not called: the
   * "Estimate Ready" email belongs to /send alone.
   */
  const markSentOrder = (over: Record<string, unknown> = {}) => ({
    id: 'e7',
    status: 'draft',
    // Relative, not hardcoded — same time-bomb lesson as the /send test.
    expiry_date: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
    ...over,
  });

  /** Runs `fn` with Resend intercepted; resolves to the calls it made. */
  async function withResendSpy(fn: () => Promise<void>): Promise<number> {
    let hits = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes('api.resend.com')) {
        hits += 1;
        return new Response(JSON.stringify({ id: 'email_1' }), { status: 200 });
      }
      return realFetch(url as never, init as never);
    }) as typeof fetch;
    try {
      await fn();
    } finally {
      globalThis.fetch = realFetch;
    }
    return hits;
  }

  it('moves a draft order to sent WITHOUT emailing the customer', async () => {
    db.responses['orders.select'] = [markSentOrder()];
    const hits = await withResendSpy(async () => {
      const res = await ordersApp.request('/e7/mark-sent', { method: 'POST' }, ENV);
      expect(res.status).toBe(200);
    });
    expect(hits).toBe(0); // no "Estimate Ready" email
    expect(db.calls).toContain('orders.update');
    const logs = db.insertPayloads['order_logs'] as Array<{ message: string }>;
    expect(logs?.[0]?.message).toBe('Marked as sent (no email).');
  });

  it('409 once the order is confirmed', async () => {
    db.responses['orders.select'] = [markSentOrder({ status: 'awaiting_payment' })];
    const hits = await withResendSpy(async () => {
      const res = await ordersApp.request('/e7/mark-sent', { method: 'POST' }, ENV);
      expect(res.status).toBe(409);
    });
    expect(hits).toBe(0);
    expect(db.calls).not.toContain('orders.update');
  });

  it('400 when the estimate validity date has lapsed', async () => {
    db.responses['orders.select'] = [markSentOrder({ expiry_date: '2020-01-01' })];
    const hits = await withResendSpy(async () => {
      const res = await ordersApp.request('/e7/mark-sent', { method: 'POST' }, ENV);
      expect(res.status).toBe(400);
    });
    expect(hits).toBe(0);
    expect(db.calls).not.toContain('orders.update');
  });

  it('404 for a missing order', async () => {
    db.responses['orders.select'] = [];
    const res = await ordersApp.request('/nope/mark-sent', { method: 'POST' }, ENV);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/orders/:id/revert', () => {
  it('reverts to an earlier stage and writes the update', async () => {
    db.responses['orders.select'] = [{ id: 'e1', status: 'in_progress' }];
    const res = await ordersApp.request('/e1/revert', {
      method: 'POST',
      body: JSON.stringify({ to: 'sent' }),
      headers: { 'Content-Type': 'application/json' },
    }, ENV);
    expect(res.status).toBe(200);
    expect(db.calls).toContain('orders.update');
  });

  it('409 when the target is not an earlier stage', async () => {
    db.responses['orders.select'] = [{ id: 'e1', status: 'sent' }];
    const res = await ordersApp.request('/e1/revert', {
      method: 'POST',
      body: JSON.stringify({ to: 'ready' }),
      headers: { 'Content-Type': 'application/json' },
    }, ENV);
    expect(res.status).toBe(409);
  });
});

describe('POST /api/orders/:id/status', () => {
  /**
   * The manual override: any stage from any stage. Every case asserts on
   * the captured `orders.update` payload, because the whole point of the
   * route is that stage timestamps end up agreeing with the new status.
   */
  const setStatus = (id: string, to: string) =>
    ordersApp.request(
      `/${id}/status`,
      { method: 'POST', body: JSON.stringify({ to }), headers: { 'Content-Type': 'application/json' } },
      ENV
    );

  /** The single orders.update payload the route wrote. */
  const orderUpdate = () =>
    (db.updatePayloads['orders'] as Array<Record<string, unknown>>)[0];

  it('jumping draft → installed stamps every passed stage', async () => {
    db.responses['orders.select'] = [
      { id: 's1', status: 'draft', sent_at: null, confirmed_at: null, installed_at: null },
    ];
    const res = await setStatus('s1', 'installed');
    expect(res.status).toBe(200);
    const up = orderUpdate();
    expect(up.status).toBe('installed');
    expect(up.sent_at).toEqual(expect.any(String));
    expect(up.confirmed_at).toEqual(expect.any(String));
    expect(up.installed_at).toEqual(expect.any(String));
  });

  it('jumping installed → draft clears the stamps and drops the appointment', async () => {
    db.responses['orders.select'] = [
      {
        id: 's2',
        status: 'installed',
        sent_at: '2026-08-01T00:00:00.000Z',
        confirmed_at: '2026-08-02T00:00:00.000Z',
        installed_at: '2026-08-03T00:00:00.000Z',
      },
    ];
    const res = await setStatus('s2', 'draft');
    expect(res.status).toBe(200);
    const up = orderUpdate();
    expect(up.status).toBe('draft');
    expect(up.sent_at).toBeNull();
    expect(up.confirmed_at).toBeNull();
    expect(up.installed_at).toBeNull();
    expect(db.calls).toContain('appointments.delete');
  });

  it('moves an expired estimate forward to awaiting_payment', async () => {
    db.responses['orders.select'] = [
      { id: 's3', status: 'expired', sent_at: '2026-07-01T00:00:00.000Z', confirmed_at: null, installed_at: null },
    ];
    const res = await setStatus('s3', 'awaiting_payment');
    expect(res.status).toBe(200);
    const up = orderUpdate();
    expect(up.status).toBe('awaiting_payment');
    // An existing stamp is never overwritten.
    expect(up.sent_at).toBe('2026-07-01T00:00:00.000Z');
    expect(up.confirmed_at).toEqual(expect.any(String));
    expect(up.installed_at).toBeNull();
    // Target is below `ready`, so any installation visit must go.
    expect(db.calls).toContain('appointments.delete');
  });

  it('keeps the installation appointment when the target is ready or later', async () => {
    db.responses['orders.select'] = [
      { id: 's4', status: 'installed', sent_at: null, confirmed_at: null, installed_at: '2026-08-03T00:00:00.000Z' },
    ];
    const res = await setStatus('s4', 'ready');
    expect(res.status).toBe(200);
    expect(orderUpdate().installed_at).toBeNull();
    expect(db.calls).not.toContain('appointments.delete');
  });

  it('logs the manual change with both stages', async () => {
    db.responses['orders.select'] = [
      { id: 's5', status: 'sent', sent_at: null, confirmed_at: null, installed_at: null },
    ];
    await setStatus('s5', 'ready');
    const logs = db.insertPayloads['order_logs'] as Array<{ message: string }>;
    expect(logs?.[0]?.message).toBe('Status manually changed from sent to ready.');
  });

  it('409 when the order is already in the target status, with no write', async () => {
    db.responses['orders.select'] = [
      { id: 's6', status: 'ready', sent_at: null, confirmed_at: null, installed_at: null },
    ];
    const res = await setStatus('s6', 'ready');
    expect(res.status).toBe(409);
    expect(db.calls).not.toContain('orders.update');
  });

  it('400 for a status outside the six lifecycle stages', async () => {
    db.responses['orders.select'] = [
      { id: 's7', status: 'draft', sent_at: null, confirmed_at: null, installed_at: null },
    ];
    const res = await setStatus('s7', 'expired');
    expect(res.status).toBe(400);
    expect(db.calls).not.toContain('orders.update');
  });

  it('404 for a missing order', async () => {
    db.responses['orders.select'] = [];
    const res = await setStatus('nope', 'ready');
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/orders/:id', () => {
  it('deletes an existing order', async () => {
    db.responses['orders.select'] = [{ id: 'e1' }];
    const res = await ordersApp.request('/e1', { method: 'DELETE' }, ENV);
    expect(res.status).toBe(200);
    expect(db.calls).toContain('orders.delete');
  });

  it('404 for a missing order', async () => {
    db.responses['orders.select'] = [];
    const res = await ordersApp.request('/nope', { method: 'DELETE' }, ENV);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/orders/:id/cut-done', () => {
  /** Helper: POST the toggle body to the cut-done route. */
  const toggle = (path: string, done: boolean) =>
    ordersApp.request(
      path,
      { method: 'POST', body: JSON.stringify({ done }), headers: { 'Content-Type': 'application/json' } },
      ENV
    );

  it('stamps cut_done_at when toggled on (confirmed, not yet cut)', async () => {
    db.responses['orders.select'] = [{ id: 'e1', status: 'in_progress', cut_done_at: null, payments: [] }];
    const res = await toggle('/e1/cut-done', true);
    expect(res.status).toBe(200);
    expect(db.calls).toContain('orders.update'); // stamp written
  });

  it('clears cut_done_at when toggled off (reversible)', async () => {
    db.responses['orders.select'] = [
      { id: 'e1', status: 'ready', cut_done_at: '2026-07-13T10:00:00.000Z', payments: [] },
    ];
    const res = await toggle('/e1/cut-done', false);
    expect(res.status).toBe(200);
    expect(db.calls).toContain('orders.update'); // cleared back to null
  });

  it('no-ops when already in the requested state (keeps the original date)', async () => {
    db.responses['orders.select'] = [
      { id: 'e1', status: 'ready', cut_done_at: '2026-07-13T10:00:00.000Z', payments: [] },
    ];
    const res = await toggle('/e1/cut-done', true); // already done → no write
    expect(res.status).toBe(200);
    expect(db.calls).not.toContain('orders.update');
  });

  it('409 when the order is not yet confirmed', async () => {
    db.responses['orders.select'] = [{ id: 'e1', status: 'sent', cut_done_at: null }];
    const res = await toggle('/e1/cut-done', true);
    expect(res.status).toBe(409);
  });

  it('400 on a malformed body', async () => {
    db.responses['orders.select'] = [{ id: 'e1', status: 'in_progress', cut_done_at: null }];
    const res = await ordersApp.request('/e1/cut-done', { method: 'POST' }, ENV); // no body
    expect(res.status).toBe(400);
  });

  it('404 for a missing order', async () => {
    db.responses['orders.select'] = [];
    const res = await toggle('/nope/cut-done', true);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/orders/:id/payments/:paymentId/receipt', () => {
  /**
   * Confirmed order with one recorded payment, ready to receipt. The
   * public_token is already set so the happy path needs no token mint
   * (that behavior is pinned by the send-invoice implementation).
   */
  const receiptOrder = () => ({
    id: 'e5',
    status: 'in_progress',
    order_number: 'F0307-126',
    order_date: '2026-07-03',
    expiry_date: '2026-07-17',
    subtotal: 100, discount_amount: 0, taxable_amount: 100, tax_amount: 13, total: 113,
    public_token: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    terms_snapshot: 'T&C',
    line_items: [],
    payments: [{ id: 'p1', order_id: 'e5', amount: 50, paid_on: '2026-07-10', note: '' }],
    customer: { first_name: 'A', last_name: 'B', email: 'a@example.com',
      phone: '', shipping_address_line1: '', shipping_address_line2: '', shipping_city: '',
      shipping_province: '', shipping_postal_code: '', billing_same_as_shipping: true,
      billing_address_line1: '', billing_address_line2: '', billing_city: '',
      billing_province: '', billing_postal_code: '' },
  });

  const COMPANY = {
    company_name: 'Blinds Nisa', logo_url: null, email: 'x@y.z', phone: '', address: '',
    hst_number: '', terms_and_conditions: 'T&C', default_expiry_days: 14,
  };

  /** POSTs the receipt route with an optional JSON body. */
  const post = (path: string, body?: unknown) =>
    ordersApp.request(
      path,
      body === undefined
        ? { method: 'POST' }
        : { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } },
      ENV
    );

  /**
   * Intercepts Resend for the duration of `run`, capturing request
   * bodies; `status`/`reply` script the API's answer (same fetch-level
   * mock the /send failure test uses — sendEmail is exercised for real).
   */
  async function withResend(
    status: number,
    reply: unknown,
    run: () => Promise<void>
  ): Promise<string[]> {
    const sent: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes('api.resend.com')) {
        sent.push(String(init?.body ?? ''));
        return new Response(JSON.stringify(reply), { status });
      }
      return realFetch(url as never, init as never);
    }) as typeof fetch;
    try {
      await run();
    } finally {
      globalThis.fetch = realFetch;
    }
    return sent;
  }

  it('sends the receipt, stamps receipt_sent_at, and logs the activity', async () => {
    db.responses['orders.select'] = [receiptOrder()];
    db.responses['company_settings.select'] = [COMPANY];

    const sent = await withResend(200, { id: 'email_1' }, async () => {
      const res = await post('/e5/payments/p1/receipt', { message: 'Thanks!' });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { amount_paid: number } };
      expect(body.data.amount_paid).toBe(50);
      // Success effects: stamp written, activity row inserted.
      expect(db.calls).toContain('payments.update');
      const logs = db.insertPayloads['order_logs'] as Array<{ message: string }>;
      expect(logs?.[0]?.message).toBe('Receipt for $50.00 emailed to a@example.com.');
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('F0307-126');
    // The token already existed, so no order row write happened.
    expect(db.calls).not.toContain('orders.update');
  });

  it('404 when the payment does not belong to the order', async () => {
    db.responses['orders.select'] = [receiptOrder()];
    db.responses['company_settings.select'] = [COMPANY];
    const sent = await withResend(200, { id: 'email_1' }, async () => {
      const res = await post('/e5/payments/not-mine/receipt');
      expect(res.status).toBe(404);
      expect(((await res.json()) as { error: string }).error).toBe('Payment not found on this order.');
      expect(db.calls).not.toContain('payments.update');
    });
    expect(sent).toHaveLength(0); // nothing emailed
  });

  it('400 when the customer has no email address', async () => {
    const order = receiptOrder();
    order.customer.email = '';
    db.responses['orders.select'] = [order];
    db.responses['company_settings.select'] = [COMPANY];
    const sent = await withResend(200, { id: 'email_1' }, async () => {
      const res = await post('/e5/payments/p1/receipt');
      expect(res.status).toBe(400);
    });
    expect(sent).toHaveLength(0);
  });

  it('502 on email failure with no receipt_sent_at stamp or log written', async () => {
    db.responses['orders.select'] = [receiptOrder()];
    db.responses['company_settings.select'] = [COMPANY];
    await withResend(401, { message: 'API key is invalid' }, async () => {
      const res = await post('/e5/payments/p1/receipt');
      expect(res.status).toBe(502);
      expect(((await res.json()) as { error: string }).error).toBe('API key is invalid');
      // Failed send → payment row untouched, nothing logged.
      expect(db.calls).not.toContain('payments.update');
      expect(db.insertPayloads['order_logs']).toBeUndefined();
    });
  });
});

describe('POST /api/orders/:id/cancel-request/resolve', () => {
  /**
   * Order with an OPEN cancellation request, in the only window where
   * one can be granted: awaiting_payment with an empty ledger.
   */
  const requestedOrder = (over: Record<string, unknown> = {}) => ({
    id: 'e6',
    status: 'awaiting_payment',
    order_number: 'F0307-127',
    order_date: '2026-07-03',
    expiry_date: '2026-07-17',
    subtotal: 100, discount_amount: 0, taxable_amount: 100, tax_amount: 13, total: 113,
    public_token: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    terms_snapshot: 'T&C',
    confirmed_at: '2026-07-20T10:00:00.000Z',
    cancel_requested_at: '2026-07-21T09:00:00.000Z',
    cancel_request_note: 'Changed my mind',
    line_items: [],
    payments: [],
    customer: { id: 'c1', first_name: 'A', last_name: 'B', email: 'a@example.com',
      shipping_address_line1: '', shipping_address_line2: '', shipping_city: '',
      shipping_province: '', shipping_postal_code: '', billing_same_as_shipping: true,
      billing_address_line1: '', billing_address_line2: '', billing_city: '',
      billing_province: '', billing_postal_code: '' },
    ...over,
  });

  const COMPANY2 = {
    company_name: 'Blinds Nisa', logo_url: null, email: 'x@y.z', phone: '', address: '',
    hst_number: '', terms_and_conditions: 'T&C', default_expiry_days: 14,
  };

  const post = (path: string, body: unknown) =>
    ordersApp.request(
      path,
      { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } },
      ENV
    );

  /** Same Resend interception used by the receipt suite. */
  async function withResend(
    status: number,
    reply: unknown,
    run: () => Promise<void>
  ): Promise<string[]> {
    const sent: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes('api.resend.com')) {
        sent.push(String(init?.body ?? ''));
        return new Response(JSON.stringify(reply), { status });
      }
      return realFetch(url as never, init as never);
    }) as typeof fetch;
    try {
      await run();
    } finally {
      globalThis.fetch = realFetch;
    }
    return sent;
  }

  it('accepting reverses the confirmation and emails nobody', async () => {
    db.responses['orders.select'] = [requestedOrder()];
    db.responses['company_settings.select'] = [COMPANY2];
    const sent = await withResend(200, { id: 'email_1' }, async () => {
      const res = await post('/e6/cancel-request/resolve', { accept: true });
      expect(res.status).toBe(200);
      expect(db.calls).toContain('orders.update');
      const logs = db.insertPayloads['order_logs'] as Array<{ message: string }>;
      expect(logs?.[0]?.message).toBe('Cancellation request accepted — confirmation reversed.');
    });
    // Accepting is self-explanatory on the customer's page — no email.
    expect(sent).toHaveLength(0);
  });

  it('refuses to accept once a payment exists', async () => {
    db.responses['orders.select'] = [requestedOrder({ payments: [{ id: 'p1', amount: 25 }] })];
    db.responses['company_settings.select'] = [COMPANY2];
    const res = await post('/e6/cancel-request/resolve', { accept: true });
    expect(res.status).toBe(409);
    expect(db.calls).not.toContain('orders.update');
  });

  it('refuses to accept an order that has left awaiting_payment', async () => {
    db.responses['orders.select'] = [requestedOrder({ status: 'ready' })];
    db.responses['company_settings.select'] = [COMPANY2];
    const res = await post('/e6/cancel-request/resolve', { accept: true });
    expect(res.status).toBe(409);
    expect(db.calls).not.toContain('orders.update');
  });

  it('denying emails the customer, then clears the request', async () => {
    db.responses['orders.select'] = [requestedOrder()];
    db.responses['company_settings.select'] = [COMPANY2];
    const sent = await withResend(200, { id: 'email_1' }, async () => {
      const res = await post('/e6/cancel-request/resolve', {
        accept: false,
        message: 'Already in production.',
      });
      expect(res.status).toBe(200);
      expect(db.calls).toContain('orders.update');
      const logs = db.insertPayloads['order_logs'] as Array<{ message: string }>;
      expect(logs?.[0]?.message).toBe(
        'Cancellation request denied — customer notified at a@example.com.'
      );
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('F0307-127');
    expect(sent[0]).toContain('Already in production.');
  });

  it('502 on a failed denial email leaves the request open for a retry', async () => {
    db.responses['orders.select'] = [requestedOrder()];
    db.responses['company_settings.select'] = [COMPANY2];
    await withResend(401, { message: 'API key is invalid' }, async () => {
      const res = await post('/e6/cancel-request/resolve', { accept: false });
      expect(res.status).toBe(502);
      // Email-then-persist: nothing cleared, nothing logged.
      expect(db.calls).not.toContain('orders.update');
      expect(db.insertPayloads['order_logs']).toBeUndefined();
    });
  });

  it('denies without a send when the customer has no email on file', async () => {
    const order = requestedOrder();
    order.customer.email = '';
    db.responses['orders.select'] = [order];
    db.responses['company_settings.select'] = [COMPANY2];
    const sent = await withResend(200, { id: 'email_1' }, async () => {
      const res = await post('/e6/cancel-request/resolve', { accept: false });
      // A missing address must never trap staff in an unresolvable request.
      expect(res.status).toBe(200);
      expect(db.calls).toContain('orders.update');
      const logs = db.insertPayloads['order_logs'] as Array<{ message: string }>;
      expect(logs?.[0]?.message).toBe(
        'Cancellation request denied — customer has no email address on file.'
      );
    });
    expect(sent).toHaveLength(0);
  });

  it('409 when there is no open request', async () => {
    db.responses['orders.select'] = [requestedOrder({ cancel_requested_at: null })];
    db.responses['company_settings.select'] = [COMPANY2];
    const res = await post('/e6/cancel-request/resolve', { accept: true });
    expect(res.status).toBe(409);
    expect(db.calls).not.toContain('orders.update');
  });

  it('404 for a missing order', async () => {
    db.responses['orders.select'] = [];
    db.responses['company_settings.select'] = [COMPANY2];
    const res = await post('/nope/cancel-request/resolve', { accept: true });
    expect(res.status).toBe(404);
  });

  it('400 on an unknown body field (strict schema)', async () => {
    db.responses['orders.select'] = [requestedOrder()];
    db.responses['company_settings.select'] = [COMPANY2];
    const res = await post('/e6/cancel-request/resolve', { accept: true, status: 'installed' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/orders/:id/public-token', () => {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const post = (path: string) => ordersApp.request(path, { method: 'POST' }, ENV);

  it('mints a token when the order has none, and logs it once', async () => {
    db.responses['orders.select'] = [{ id: 'o1', public_token: null }];
    const res = await post('/o1/public-token');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { public_token: string } };
    expect(body.data.public_token).toMatch(UUID_RE);
    expect(db.insertPayloads['order_logs']).toHaveLength(1);
  });

  it('returns the existing token unchanged and logs nothing', async () => {
    const existing = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    db.responses['orders.select'] = [{ id: 'o1', public_token: existing }];
    const res = await post('/o1/public-token');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { public_token: string } };
    expect(body.data.public_token).toBe(existing);
    expect(db.insertPayloads['order_logs']).toBeUndefined();
    expect(db.calls).not.toContain('orders.update');
  });

  it('404s an unknown order', async () => {
    db.responses['orders.select'] = [];
    const res = await post('/nope/public-token');
    expect(res.status).toBe(404);
  });
});

/**
 * Intercepts Resend for the duration of `run`, capturing every request
 * body sent. `status`/`reply` script the API's answer, so `sendEmail` is
 * exercised for real rather than stubbed.
 */
async function withResend(
  status: number,
  reply: unknown,
  run: () => Promise<void>
): Promise<string[]> {
  const sent: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).includes('api.resend.com')) {
      sent.push(String(init?.body ?? ''));
      return new Response(JSON.stringify(reply), { status });
    }
    return realFetch(url as never, init as never);
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = realFetch;
  }
  return sent;
}

/** Company settings row shared by the warranty suites. */
const WARRANTY_COMPANY = {
  company_name: 'Blinds Nisa', logo_url: null, email: 'x@y.z', phone: '', address: '',
  hst_number: '', terms_and_conditions: 'T&C', default_expiry_days: 14,
};

/** Customer with everything the certificate prints. */
const WARRANTY_CUSTOMER = {
  first_name: 'A', last_name: 'B', email: 'a@example.com',
  phone: '', shipping_address_line1: '', shipping_address_line2: '', shipping_city: '',
  shipping_province: '', shipping_postal_code: '', billing_same_as_shipping: true,
  billing_address_line1: '', billing_address_line2: '', billing_city: '',
  billing_province: '', billing_postal_code: '',
};

/** Messages written to the activity trail during a test. */
const logMessages = () =>
  ((db.insertPayloads['order_logs'] ?? []) as Array<{ message: string }>).map((l) => l.message);

describe('POST /api/orders/:id/payments — 50% production trigger', () => {
  /**
   * A confirmed but unpaid order (total 113 → 50% deposit 56.50). The
   * `payments` array is the ledger state the fake DB reports back AFTER
   * the payment insert, which is what `recordOrderPayment` re-reads to
   * decide whether the deposit has been reached — so each test sets it to
   * the post-payment total it is exercising. `orders.update` firing is the
   * observable signal that the order advanced to in_progress; a suite with
   * no other update path, so its presence/absence is unambiguous.
   */
  const awaitingOrder = (over: Record<string, unknown> = {}) => ({
    id: 'ap1',
    status: 'awaiting_payment',
    order_number: 'F0307-200',
    order_date: '2026-07-03',
    total: 113,
    warranty_sent_at: null,
    warranty_starts_on: null,
    line_items: [
      { item_type: 'blind', room_name: 'Den', blinds_type: 'Roller', control_name: 'Chain', quantity: 1 },
    ],
    payments: [],
    customer: { ...WARRANTY_CUSTOMER },
    ...over,
  });

  const post = (path: string, body: unknown) =>
    ordersApp.request(
      path,
      { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } },
      ENV
    );

  beforeEach(() => {
    db.responses['company_settings.select'] = [WARRANTY_COMPANY];
    db.responses['payments.insert'] = [{ id: 'p9' }];
  });

  it('advances to in_progress once the ledger reaches the 50% deposit', async () => {
    // 60 paid ≥ 56.50 deposit → production begins.
    db.responses['orders.select'] = [
      awaitingOrder({ payments: [{ id: 'p9', order_id: 'ap1', amount: 60, paid_on: '2026-07-10', note: '' }] }),
    ];
    const res = await post('/ap1/payments', { amount: 60 });
    expect(res.status).toBe(201);
    expect(db.calls).toContain('orders.update');
  });

  it('advances when a later payment tops the ledger up over the deposit', async () => {
    // 30 already on file + 30 now = 60 ≥ 56.50 → production begins even
    // though neither payment alone reached the deposit.
    db.responses['orders.select'] = [
      awaitingOrder({
        payments: [
          { id: 'p1', order_id: 'ap1', amount: 30, paid_on: '2026-07-09', note: '' },
          { id: 'p9', order_id: 'ap1', amount: 30, paid_on: '2026-07-10', note: '' },
        ],
      }),
    ];
    const res = await post('/ap1/payments', { amount: 30 });
    expect(res.status).toBe(201);
    expect(db.calls).toContain('orders.update');
  });

  it('records a sub-deposit payment without advancing to in_progress', async () => {
    // 40 paid < 56.50 deposit → recorded, but stays awaiting_payment.
    db.responses['orders.select'] = [
      awaitingOrder({ payments: [{ id: 'p9', order_id: 'ap1', amount: 40, paid_on: '2026-07-10', note: '' }] }),
    ];
    const res = await post('/ap1/payments', { amount: 40 });
    expect(res.status).toBe(201);
    expect(db.calls).toContain('payments.insert');
    expect(db.calls).not.toContain('orders.update');
  });
});

describe('warranty issue on paid-in-full', () => {
  /**
   * A confirmed order whose ledger ALREADY settles the total — the state
   * the fake DB reports back after the payment insert, which is what the
   * warranty issuer reads. Overrides let each test vary the stamp, the
   * customer's email, or the amount still owed.
   */
  const paidOrder = (over: Record<string, unknown> = {}) => ({
    id: 'w1',
    status: 'in_progress',
    order_number: 'F0307-126',
    order_date: '2026-07-03',
    expiry_date: '2026-07-17',
    subtotal: 100, discount_amount: 0, taxable_amount: 100, tax_amount: 13, total: 113,
    public_token: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    warranty_sent_at: null,
    warranty_starts_on: null,
    line_items: [
      {
        item_type: 'blind', room_name: 'Living Room', blinds_type: 'Roller',
        control_name: 'Motorized (Bluetooth)', quantity: 2,
      },
    ],
    payments: [{ id: 'p1', order_id: 'w1', amount: 113, paid_on: '2026-07-10', note: '' }],
    customer: { ...WARRANTY_CUSTOMER },
    ...over,
  });

  const post = (path: string, body: unknown) =>
    ordersApp.request(
      path,
      { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } },
      ENV
    );

  beforeEach(() => {
    db.responses['company_settings.select'] = [WARRANTY_COMPANY];
    db.responses['payments.insert'] = [{ id: 'p9' }];
  });

  it('emails the certificate when a payment clears the balance', async () => {
    db.responses['orders.select'] = [paidOrder()];
    const sent = await withResend(200, { id: 'email_1' }, async () => {
      const res = await post('/w1/payments', { amount: 113 });
      expect(res.status).toBe(201);
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('F0307-126-warranty.pdf');
    expect(logMessages()).toContain('Warranty certificate emailed to a@example.com.');
  });

  it('does not email while money is still owed', async () => {
    db.responses['orders.select'] = [
      paidOrder({
        payments: [{ id: 'p1', order_id: 'w1', amount: 50, paid_on: '2026-07-10', note: '' }],
      }),
    ];
    const sent = await withResend(200, { id: 'email_1' }, async () => {
      const res = await post('/w1/payments', { amount: 50 });
      expect(res.status).toBe(201);
    });
    expect(sent).toHaveLength(0);
  });

  it('does not email twice — the stamp is the idempotency guard', async () => {
    db.responses['orders.select'] = [paidOrder({ warranty_sent_at: '2026-07-10T12:00:00.000Z' })];
    const sent = await withResend(200, { id: 'email_1' }, async () => {
      const res = await post('/w1/payments', { amount: 113 });
      expect(res.status).toBe(201);
    });
    expect(sent).toHaveLength(0);
  });

  it('still records the payment (201) when the warranty email fails', async () => {
    db.responses['orders.select'] = [paidOrder()];
    await withResend(401, { message: 'API key is invalid' }, async () => {
      const res = await post('/w1/payments', { amount: 113 });
      expect(res.status).toBe(201);
    });
    expect(logMessages()).toContain('Warranty email failed: API key is invalid');
  });

  it('skips the send, with a reason logged, when the customer has no email', async () => {
    db.responses['orders.select'] = [
      paidOrder({ customer: { ...WARRANTY_CUSTOMER, email: '' } }),
    ];
    const sent = await withResend(200, { id: 'email_1' }, async () => {
      const res = await post('/w1/payments', { amount: 113 });
      expect(res.status).toBe(201);
    });
    expect(sent).toHaveLength(0);
    expect(logMessages()).toContain('Warranty not emailed — no email address on file.');
  });
});

describe('POST /api/orders/:id/warranty', () => {
  const order = (over: Record<string, unknown> = {}) => ({
    id: 'w2',
    status: 'in_progress',
    order_number: 'F0307-127',
    order_date: '2026-07-03',
    total: 113,
    public_token: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    warranty_sent_at: null,
    warranty_starts_on: '2026-07-10',
    line_items: [
      { item_type: 'blind', room_name: 'Den', blinds_type: 'Zebra', control_name: 'Chain', quantity: 1 },
    ],
    payments: [{ id: 'p1', order_id: 'w2', amount: 113, paid_on: '2026-07-10', note: '' }],
    customer: { ...WARRANTY_CUSTOMER },
    ...over,
  });

  const post = (path: string) => ordersApp.request(path, { method: 'POST' }, ENV);

  beforeEach(() => {
    db.responses['company_settings.select'] = [WARRANTY_COMPANY];
  });

  it('409s while the order still owes money, without emailing', async () => {
    db.responses['orders.select'] = [
      order({ payments: [{ id: 'p1', order_id: 'w2', amount: 50, paid_on: '2026-07-10', note: '' }] }),
    ];
    const sent = await withResend(200, { id: 'email_1' }, async () => {
      const res = await post('/w2/warranty');
      expect(res.status).toBe(409);
    });
    expect(sent).toHaveLength(0);
  });

  it('resends for an order that already has a stamp', async () => {
    db.responses['orders.select'] = [order({ warranty_sent_at: '2026-07-10T12:00:00.000Z' })];
    const sent = await withResend(200, { id: 'email_1' }, async () => {
      const res = await post('/w2/warranty');
      expect(res.status).toBe(200);
    });
    expect(sent).toHaveLength(1);
  });

  it('400s when the customer has no email address', async () => {
    db.responses['orders.select'] = [order({ customer: { ...WARRANTY_CUSTOMER, email: '' } })];
    const sent = await withResend(200, { id: 'email_1' }, async () => {
      const res = await post('/w2/warranty');
      expect(res.status).toBe(400);
    });
    expect(sent).toHaveLength(0);
  });

  it('502s when the email provider rejects the send', async () => {
    db.responses['orders.select'] = [order()];
    await withResend(401, { message: 'API key is invalid' }, async () => {
      const res = await post('/w2/warranty');
      expect(res.status).toBe(502);
      expect(((await res.json()) as { error: string }).error).toBe('API key is invalid');
    });
  });
});

describe('Curtains line items', () => {
  /**
   * A create payload whose single item is a curtain. `payload()` returns
   * an inferred type whose line-item shape has non-null hardware ids, so
   * the assignment needs the cast — the request body is JSON either way,
   * and the schema under test is what validates it.
   */
  function curtainPayload(overrides: Record<string, unknown> = {}) {
    const p = payload() as unknown as { line_items: Record<string, unknown>[] };
    p.line_items = [
      {
        item_type: 'blind',
        room_name: 'Lounge',
        blinds_type: 'Curtains',
        panels: [300],
        height_cm: 250,
        material_id: MATERIAL.id,
        cassette_id: null,
        bottom_rail_id: null,
        control_id: CONTROL.id,
        color: '',
        note: '',
        installation_id: INSTALL.id,
        attributes: { pleat_type_id: PLEAT.id },
        quantity: 1,
        ...overrides,
      },
    ];
    return p;
  }

  /** POSTs a payload to the create route with a successful order insert. */
  function create(body: unknown) {
    db.orderInsertResults = [{ data: { id: 'c1', subtotal: 0 } }];
    return ordersApp.request(
      '/',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      ENV
    );
  }

  beforeEach(() => {
    db.responses['pleat_types.select'] = [PLEAT];
  });

  it('snapshots the pleat into attributes and the installation onto its columns', async () => {
    const res = await create(curtainPayload());
    expect(res.status).toBe(201);
    const rows = db.insertPayloads['line_items']?.[0] as Record<string, unknown>[];
    // The pleat multiplier is still an attribute; the installation charge
    // is a real slot since migration 35 and lands in its own columns.
    expect(rows[0].attributes).toEqual({
      pleat_type_id: PLEAT.id,
      pleat_name: 'Pinch',
      pleat_multiplier: 2.5,
    });
    expect(rows[0].installation_id).toBe(INSTALL.id);
    expect(rows[0].installation_name).toBe('Rod');
    expect(rows[0].installation_price_per_item).toBe(45);
    // MATERIAL is $55 per running metre here: 3.0 × 2.5 × 55 = 412.50,
    // + 1 panel × 0.5 m × 55 = 27.50 hem allowance, control $0,
    // installation $45.
    expect(rows[0].unit_price).toBe(485);
    expect(rows[0].cassette_id).toBeNull();
    expect(rows[0].cassette_name).toBeNull();
    expect(rows[0].cassette_price_per_m).toBeNull();
    expect(rows[0].bottom_rail_id).toBeNull();
  });

  it('rejects a client-supplied pleat multiplier', async () => {
    const res = await create(
      curtainPayload({ attributes: { pleat_type_id: PLEAT.id, pleat_multiplier: 99 } })
    );
    expect(res.status).toBe(400);
    expect(db.insertPayloads['line_items']).toBeUndefined();
  });

  it('rejects a client-supplied installation price', async () => {
    const res = await create(curtainPayload({ attributes: { installation_price: 0 } }));
    expect(res.status).toBe(400);
  });

  it('rejects a cassette id on a type that has no cassette', async () => {
    const res = await create(curtainPayload({ cassette_id: CASSETTE.id }));
    expect(res.status).toBe(400);
  });

  it('rejects a bottom rail id on a type that has no bottom rail', async () => {
    const res = await create(curtainPayload({ bottom_rail_id: BOTTOM_RAIL.id }));
    expect(res.status).toBe(400);
  });

  it('prices a curtain with no pleat chosen as flat fabric', async () => {
    const res = await create(curtainPayload({ attributes: {} }));
    expect(res.status).toBe(201);
    const rows = db.insertPayloads['line_items']?.[0] as Record<string, unknown>[];
    // 3.0 × 1 × 55 = 165, + 27.50 hem allowance, + the $45 installation
    // that Curtains still carries — the pleat is what is missing here.
    expect(rows[0].unit_price).toBe(237.5);
    expect(rows[0].attributes).toEqual({});
  });

  it('prices a curtain with no installation scoped as fabric alone', async () => {
    // Unscope every installation option: the slot disappears for Curtains
    // and the rod/track charge leaves the price with it.
    db.responses['installation_option_blind_types.select'] = [];
    const res = await create(curtainPayload({ attributes: {}, installation_id: null }));
    expect(res.status).toBe(201);
    const rows = db.insertPayloads['line_items']?.[0] as Record<string, unknown>[];
    expect(rows[0].unit_price).toBe(192.5);
    expect(rows[0].installation_id).toBeNull();
    expect(rows[0].installation_price_per_item).toBeNull();
  });

  it('rejects an installation id on a type with none scoped', async () => {
    const p = payload() as unknown as { line_items: Record<string, unknown>[] };
    p.line_items[0].installation_id = INSTALL.id;
    const res = await create(p);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: 'Item 1: Roller does not take an installation option.',
    });
  });

  it('saves a blind with no control when none is scoped to its type', async () => {
    // Unscope every control: the slot disappears, the id must be absent,
    // and the control simply prices at 0.
    db.responses['control_option_blind_types.select'] = [];
    const p = payload() as unknown as { line_items: Record<string, unknown>[] };
    p.line_items[0].control_id = null;
    const res = await create(p);
    expect(res.status).toBe(201);
    const rows = db.insertPayloads['line_items']?.[0] as Record<string, unknown>[];
    expect(rows[0].control_id).toBeNull();
    expect(rows[0].control_name).toBeNull();
    expect(rows[0].control_price_per_item).toBeNull();
  });

  it('requires a control while one is still scoped to the type', async () => {
    const p = payload() as unknown as { line_items: Record<string, unknown>[] };
    p.line_items[0].control_id = null;
    const res = await create(p);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: 'Item 1: a control option is required.',
    });
  });

  it('accepts anything for an unknown legacy blind type', async () => {
    // Free text from before the blind-type dropdown existed resolves to no
    // scoping row, so no slot is demanded and none is refused.
    const p = payload() as unknown as { line_items: Record<string, unknown>[] };
    p.line_items[0].blinds_type = 'Venetian (legacy)';
    p.line_items[0].cassette_id = null;
    p.line_items[0].bottom_rail_id = null;
    const res = await create(p);
    expect(res.status).toBe(201);
  });

  it('fails when the chosen pleat type has been deleted', async () => {
    db.responses['pleat_types.select'] = [];
    const res = await create(curtainPayload());
    expect(res.status).toBe(400);
  });

  it('still requires a cassette on a type that uses one', async () => {
    const p = payload() as unknown as { line_items: Record<string, unknown>[] };
    p.line_items[0].cassette_id = null;
    const res = await create(p);
    expect(res.status).toBe(400);
  });
});

/**
 * Line-item adjustment schemas: the three named money fields a client may
 * send, and the cross-field rules that no single field can express.
 */
describe('line item adjustment schemas', () => {
  /** A minimal valid custom item — the baseline each case mutates. */
  function customItem(extra: Record<string, unknown> = {}) {
    return {
      item_type: 'custom',
      title: 'Extra work',
      description: '',
      quantity: 1,
      unit_price: 40,
      ...extra,
    };
  }

  /** POSTs an order whose line items are exactly `items`. */
  function postItems(items: unknown[]) {
    db.orderInsertResults = [{ data: { id: 'c1', subtotal: 0 } }];
    const body = payload() as unknown as { line_items: unknown[] };
    body.line_items = items;
    return ordersApp.request(
      '/',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      ENV
    );
  }

  it('rejects an override on a custom item', async () => {
    const res = await postItems([customItem({ unit_price_override: 10 })]);
    expect(res.status).toBe(400);
  });

  it('rejects more than ten add-ons', async () => {
    const addons = Array.from({ length: 11 }, (_, i) => ({ label: `a${i}`, price: 1 }));
    const res = await postItems([customItem({ addons })]);
    expect(res.status).toBe(400);
  });

  it('rejects a negative add-on price', async () => {
    const res = await postItems([customItem({ addons: [{ label: 'a', price: -1 }] })]);
    expect(res.status).toBe(400);
  });

  it('rejects an add-on with an undeclared key', async () => {
    const res = await postItems([
      customItem({ addons: [{ label: 'a', price: 1, taxable: true }] }),
    ]);
    expect(res.status).toBe(400);
  });

  it('rejects an add-on with a blank label', async () => {
    const res = await postItems([customItem({ addons: [{ label: '', price: 1 }] })]);
    expect(res.status).toBe(400);
  });

  it('rejects a flat item with neither title nor description', async () => {
    const res = await postItems([customItem({ title: '', description: '' })]);
    expect(res.status).toBe(400);
  });

  it('rejects a flat item whose title and description are only whitespace', async () => {
    const res = await postItems([customItem({ title: '   ', description: '\n' })]);
    expect(res.status).toBe(400);
  });

  it('rejects a preset item with neither preset_id nor unit_price', async () => {
    const res = await postItems([
      { item_type: 'preset', title: 'Install', description: '', quantity: 1 },
    ]);
    expect(res.status).toBe(400);
  });

  it('accepts a flat item titled but not described', async () => {
    const res = await postItems([customItem({ title: 'Extra work', description: '' })]);
    expect(res.status).toBe(201);
  });

  it('accepts a flat item described but not titled', async () => {
    const res = await postItems([customItem({ title: '', description: 'Extra work' })]);
    expect(res.status).toBe(201);
  });

  it('still rejects an undeclared key on a flat item', async () => {
    const res = await postItems([customItem({ cost: 5 })]);
    expect(res.status).toBe(400);
  });
});

/**
 * Preset items are priced by the Worker from `preset_line_items`, exactly
 * like a material — the change that gives an overridden preset something
 * to reset TO. Rows saved before `preset_id` existed keep the older
 * client-priced behaviour.
 */
describe('preset pricing', () => {
  const PRESET = { id: '88888888-8888-4888-8888-888888888888', name: 'Installation', unit_price: 75 };

  /** POSTs an order whose line items are exactly `items`. */
  function postItems(items: unknown[]) {
    db.orderInsertResults = [{ data: { id: 'c1', subtotal: 0 } }];
    const body = payload() as unknown as { line_items: unknown[] };
    body.line_items = items;
    return ordersApp.request(
      '/',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      ENV
    );
  }

  /** The rows handed to the line_items bulk insert. */
  function insertedRows() {
    return (db.insertPayloads['line_items']?.[0] ?? []) as Record<string, unknown>[];
  }

  beforeEach(() => {
    db.responses['preset_line_items.select'] = [PRESET];
  });

  it('prices a preset item from the catalog and ignores any sent price', async () => {
    const res = await postItems([
      {
        item_type: 'preset',
        preset_id: PRESET.id,
        title: 'Installation',
        description: '',
        quantity: 2,
        unit_price: 5,
      },
    ]);
    expect(res.status).toBe(201);
    expect(insertedRows()[0].unit_price).toBe(75);
    expect(insertedRows()[0].line_total).toBe(150);
    expect(insertedRows()[0].preset_id).toBe(PRESET.id);
  });

  it('rejects a preset whose catalog row is gone', async () => {
    db.responses['preset_line_items.select'] = [];
    const res = await postItems([
      {
        item_type: 'preset',
        preset_id: PRESET.id,
        title: 'Installation',
        description: '',
        quantity: 1,
      },
    ]);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'Selected preset item no longer exists.' });
  });

  it('keeps honouring the sent price for a legacy preset with no preset_id', async () => {
    const res = await postItems([
      { item_type: 'preset', title: 'Installation', description: '', quantity: 2, unit_price: 60 },
    ]);
    expect(res.status).toBe(201);
    expect(insertedRows()[0].unit_price).toBe(60);
    expect(insertedRows()[0].preset_id).toBeNull();
  });
});

/**
 * Overrides and add-ons as they land on the row: `unit_price` is always
 * the price CHARGED, `base_unit_price` is non-null only while overridden,
 * and add-on prices are added once per line rather than per unit.
 */
describe('price overrides and add-ons', () => {
  const PRESET = { id: '88888888-8888-4888-8888-888888888888', name: 'Installation', unit_price: 75 };

  function postItems(items: unknown[]) {
    db.orderInsertResults = [{ data: { id: 'c1', subtotal: 0 } }];
    const body = payload() as unknown as { line_items: unknown[] };
    body.line_items = items;
    return ordersApp.request(
      '/',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      ENV
    );
  }

  function insertedRows() {
    return (db.insertPayloads['line_items']?.[0] ?? []) as Record<string, unknown>[];
  }

  beforeEach(() => {
    db.responses['preset_line_items.select'] = [PRESET];
  });

  it('charges the override and records the calculated price as the original', async () => {
    const res = await postItems([
      {
        item_type: 'preset',
        preset_id: PRESET.id,
        title: 'Installation',
        description: '',
        quantity: 2,
        unit_price_override: 50,
      },
    ]);
    expect(res.status).toBe(201);
    expect(insertedRows()[0].unit_price).toBe(50);
    expect(insertedRows()[0].base_unit_price).toBe(75);
    expect(insertedRows()[0].line_total).toBe(100);
  });

  it('ignores an override on a legacy preset with no catalog provenance', async () => {
    const res = await postItems([
      {
        item_type: 'preset',
        title: 'Installation',
        description: '',
        quantity: 1,
        unit_price: 60,
        unit_price_override: 10,
      },
    ]);
    expect(res.status).toBe(201);
    expect(insertedRows()[0].unit_price).toBe(60);
    expect(insertedRows()[0].base_unit_price).toBeNull();
  });

  it('overrides a blind price and keeps the formula figure as the original', async () => {
    const blind = { ...payload().line_items[0], unit_price_override: 100 };
    const res = await postItems([blind]);
    expect(res.status).toBe(201);
    // material 154 + cassette 28 + control 0 = 182 calculated, 100 charged.
    expect(insertedRows()[0].unit_price).toBe(100);
    expect(insertedRows()[0].base_unit_price).toBe(182);
    expect(insertedRows()[0].line_total).toBe(200); // 100 x qty 2
  });

  it('adds add-on prices once to the line total and snapshots them', async () => {
    const res = await postItems([
      {
        item_type: 'custom',
        title: 'Extra work',
        description: '',
        quantity: 3,
        unit_price: 100,
        addons: [{ label: 'Rush fee', price: 50 }],
      },
    ]);
    expect(res.status).toBe(201);
    expect(insertedRows()[0].line_total).toBe(350); // 100 x 3 + 50, not 100 x 3 + 150
    expect(insertedRows()[0].addons).toEqual([{ label: 'Rush fee', price: 50 }]);
  });

  it('carries show_original_price onto the row', async () => {
    const res = await postItems([
      {
        item_type: 'custom',
        title: 'Extra work',
        description: '',
        quantity: 1,
        unit_price: 10,
        show_original_price: false,
      },
    ]);
    expect(res.status).toBe(201);
    expect(insertedRows()[0].show_original_price).toBe(false);
  });

  it('gives blind and flat rows an identical column set', async () => {
    // The PostgREST bulk-insert rule: a key missing from one row is
    // NULL-filled across the batch and violates a not-null default.
    const res = await postItems([
      payload().line_items[0],
      { item_type: 'custom', title: 'Extra work', description: '', quantity: 1, unit_price: 40 },
    ]);
    expect(res.status).toBe(201);
    const rows = insertedRows();
    expect(rows.length).toBe(2);
    expect(Object.keys(rows[0]).sort()).toEqual(Object.keys(rows[1]).sort());
  });
});

describe('PUT /api/orders/:id — visibility gate', () => {
  const UID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const UID_B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';

  /** Seeds the pre-update read with one visible and one hidden item. */
  function seedExisting(status: string) {
    db.responses['orders.select'] = [
      {
        id: 'o1',
        status,
        expiry_date: '2026-07-17',
        line_items: [
          { position: 0, uid: UID_A, hidden: false, unit_price: 182, base_unit_price: null, addons: [] },
          { position: 1, uid: UID_B, hidden: true, unit_price: 25, base_unit_price: null, addons: [] },
        ],
      },
    ];
  }

  /** The saved payload, each item carrying the uid it came back with. */
  function editPayload() {
    const body = payload();
    (body.line_items[0] as Record<string, unknown>).uid = UID_A;
    (body.line_items[0] as Record<string, unknown>).hidden = false;
    (body.line_items[1] as Record<string, unknown>).uid = UID_B;
    (body.line_items[1] as Record<string, unknown>).hidden = true;
    return body;
  }

  async function put(body: unknown) {
    return ordersApp.request('/o1', {
      method: 'PUT',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }, ENV);
  }

  it('rejects showing a hidden item on a confirmed order', async () => {
    seedExisting('awaiting_payment');
    const body = editPayload();
    (body.line_items[1] as Record<string, unknown>).hidden = false;
    const res = await put(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: 'Visibility can only be changed before the order is confirmed.',
    });
  });

  it('rejects adding a hidden item to a confirmed order', async () => {
    seedExisting('awaiting_payment');
    const body = editPayload();
    body.line_items.push({
      item_type: 'custom',
      title: 'Extra',
      description: '',
      quantity: 1,
      unit_price: 10,
      hidden: true,
    } as never);
    const res = await put(body);
    expect(res.status).toBe(400);
  });

  it('allows an unchanged visibility set on a confirmed order', async () => {
    seedExisting('awaiting_payment');
    const res = await put(editPayload());
    expect(res.status).toBe(200);
  });

  it('allows deleting a hidden item from a confirmed order', async () => {
    seedExisting('awaiting_payment');
    const body = editPayload();
    body.line_items = [body.line_items[0]];
    const res = await put(body);
    expect(res.status).toBe(200);
  });

  it('allows flipping visibility while the order is still sent', async () => {
    seedExisting('sent');
    const body = editPayload();
    (body.line_items[1] as Record<string, unknown>).hidden = false;
    const res = await put(body);
    expect(res.status).toBe(200);
  });
});

describe('PUT /api/orders/:id — expiry revive', () => {
  /** An ISO date `days` from today (negative = in the past). */
  function isoFromToday(days: number) {
    return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  }

  /** Seeds the pre-update read for order `o1` at the given status/expiry. */
  function seedOrder(status: string, expiry_date: string) {
    db.responses['orders.select'] = [{ id: 'o1', status, expiry_date, line_items: [] }];
  }

  async function put(body: unknown) {
    return ordersApp.request('/o1', {
      method: 'PUT',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }, ENV);
  }

  it('revives an expired order to draft when the new expiry is today or later', async () => {
    seedOrder('expired', isoFromToday(-30));
    const body = { ...payload(), order_date: isoFromToday(0), expiry_date: isoFromToday(14) };
    const res = await put(body);
    expect(res.status).toBe(200);
    expect(db.updatePayloads.orders?.[0]).toMatchObject({ status: 'draft' });
  });

  it('leaves an expired order expired when the new expiry is still in the past', async () => {
    seedOrder('expired', isoFromToday(-30));
    // A past window that is still valid (expiry not before order date), so
    // the only reason it does not revive is that it remains lapsed.
    const body = { ...payload(), order_date: '2020-01-01', expiry_date: '2020-02-01' };
    const res = await put(body);
    expect(res.status).toBe(200);
    expect(db.updatePayloads.orders?.[0]).not.toHaveProperty('status');
  });

  it('never rewrites the status of a non-expired order', async () => {
    seedOrder('sent', isoFromToday(-30));
    const body = { ...payload(), order_date: isoFromToday(0), expiry_date: isoFromToday(14) };
    const res = await put(body);
    expect(res.status).toBe(200);
    expect(db.updatePayloads.orders?.[0]).not.toHaveProperty('status');
  });
});

describe('GET /api/orders/:id/pdf', () => {
  /** An order carrying one visible and one hidden blind. */
  function seedOrder() {
    const item = (room: string, hidden: boolean) => ({
      item_type: 'blind',
      position: hidden ? 1 : 0,
      room_name: room,
      blinds_type: 'Roller',
      panels: [140],
      height_cm: 200,
      material_name: 'Blackout White',
      cassette_name: 'Standard',
      bottom_rail_name: 'Regular',
      control_name: 'Chain',
      color: 'White',
      title: '',
      description: '',
      note: '',
      attributes: {},
      quantity: 1,
      unit_price: 100,
      line_total: 100,
      base_unit_price: null,
      show_original_price: true,
      addons: [],
      hidden,
    });
    db.responses['orders.select'] = [
      {
        id: 'o1',
        order_number: 'T0703-1',
        order_date: '2026-07-03',
        expiry_date: '2026-07-17',
        status: 'sent',
        subtotal: 100,
        discount_amount: 0,
        taxable_amount: 100,
        tax_amount: 13,
        total: 113,
        public_token: '00000000-0000-4000-8000-000000000000',
        terms_snapshot: 'Terms here',
        customer: { first_name: 'Ada', last_name: 'Lovelace' },
        payments: [],
        line_items: [item('Living Room', false), item('Cellar', true)],
      },
    ];
    db.responses['company_settings.select'] = [
      { company_name: 'Blinds Nisa', logo_url: null, email: 'a@b.c', phone: '', address: '', hst_number: '' },
    ];
  }

  /**
   * The text pdf-lib actually drew.
   *
   * Content streams are Flate-compressed, so searching the raw response
   * bytes finds nothing and would make any "not printed" assertion pass
   * vacuously. Every stream is inflated and concatenated instead; the
   * ones that are not deflate (there are none today) are skipped.
   */
  function drawnText(bytes: Uint8Array): string {
    const buf = Buffer.from(bytes);
    let out = '';
    let from = 0;
    for (;;) {
      const end = buf.indexOf('endstream', from);
      if (end === -1) break;
      const keyword = buf.lastIndexOf('stream', end - 1);
      if (keyword === -1) break;
      // The keyword is followed by an EOL that is NOT part of the data,
      // and the data is followed by one before `endstream`.
      let start = keyword + 'stream'.length;
      if (buf[start] === 0x0d) start += 1;
      if (buf[start] === 0x0a) start += 1;
      let stop = end;
      if (buf[stop - 1] === 0x0a) stop -= 1;
      if (buf[stop - 1] === 0x0d) stop -= 1;
      try {
        out += inflateSync(buf.subarray(start, stop)).toString('latin1');
      } catch {
        // Not a deflate stream — nothing to read here.
      }
      from = end + 'endstream'.length;
    }
    // pdf-lib writes every string as a hex literal (`<48656C6C6F> Tj`),
    // so the drawn words are only readable once those are decoded.
    return out.replace(/<([0-9A-Fa-f]+)>/g, (_m, hex: string) =>
      Buffer.from(hex, 'hex').toString('latin1')
    );
  }

  it('draws visible line items and omits hidden ones', async () => {
    seedOrder();
    const res = await ordersApp.request('/o1/pdf', {}, ENV);
    expect(res.status).toBe(200);
    const text = drawnText(new Uint8Array(await res.arrayBuffer()));
    // The positive assertion is what makes the negative one meaningful:
    // both titles are drawn the same way, so if one is findable in the
    // page content and the other is not, the filter is why.
    expect(text).toContain('Living Room');
    expect(text).not.toContain('Cellar');
  });
});

describe('POST /api/orders/:id/duplicate', () => {
  /** Seeds the source-order read the duplicate route performs. */
  function seedSource() {
    db.responses['orders.select'] = [
      {
        id: 'src',
        order_number: 'T0703-1',
        customer_id: '44444444-4444-4444-8444-444444444444',
        discount_type: 'percent',
        discount_value: 10,
        status: 'installed',
        payments: [{ amount: 500 }],
        line_items: [
          {
            item_type: 'blind',
            position: 0,
            uid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
            room_name: 'Living Room',
            blinds_type: 'Roller',
            panels: [70, 70],
            height_cm: 200,
            material_id: MATERIAL.id,
            cassette_id: CASSETTE.id,
            bottom_rail_id: BOTTOM_RAIL.id,
            control_id: CONTROL.id,
            installation_id: null,
            color: 'White',
            note: '',
            attributes: {},
            quantity: 2,
            hidden: false,
            unit_price: 182,
            base_unit_price: null,
            show_original_price: true,
            addons: [],
          },
        ],
      },
    ];
  }

  it('creates a draft copy priced from the current catalog', async () => {
    seedSource();
    db.orderInsertResults = [{ data: { id: 'new1', order_number: 'T0703-2' } }];
    const res = await ordersApp.request('/src/duplicate', { method: 'POST' }, ENV);
    expect(res.status).toBe(201);
    const orderRow = db.insertPayloads['orders']?.[0] as Record<string, unknown>;
    // Status is left to the column default ('draft') and never sent, so
    // a duplicate of an installed order cannot inherit its stage.
    expect(orderRow.status).toBeUndefined();
    expect(orderRow.customer_id).toBe('44444444-4444-4444-8444-444444444444');
    expect(orderRow.discount_value).toBe(10);
    // 154 material + 28 cassette per blind × 2 = 364, priced by the
    // Worker from the catalog rather than copied from the source row.
    expect(orderRow.subtotal).toBe(364);
    const rows = db.insertPayloads['line_items']?.[0] as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].room_name).toBe('Living Room');
    // Fresh identity — the source order's uid must not be reused.
    expect(rows[0].uid).not.toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
    // Nothing from the source order's own history travels.
    expect(db.insertPayloads['payments']).toBeUndefined();
  });

  it('404s for an unknown order', async () => {
    db.responses['orders.select'] = [];
    const res = await ordersApp.request('/nope/duplicate', { method: 'POST' }, ENV);
    expect(res.status).toBe(404);
  });

  it('400s with a readable message when a catalog row is gone', async () => {
    seedSource();
    db.responses['materials.select'] = [];
    const res = await ordersApp.request('/src/duplicate', { method: 'POST' }, ENV);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: 'Selected material no longer exists.',
    });
  });
});

describe('per-item price lock (migration 39)', () => {
  const UID_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
  const UID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';

  /**
   * The blind of `payload()` as it sits in the database after being
   * confirmed: priced at 182/unit from a 55/m2 material, frozen there,
   * and fingerprinted from the inputs that produced it.
   */
  function lockedBlindRow(overrides: Record<string, unknown> = {}) {
    const row = {
      id: 'li1',
      uid: UID_A,
      position: 0,
      hidden: false,
      item_type: 'blind',
      blinds_type: 'Roller',
      panels: [70, 70],
      height_cm: 200,
      material_id: MATERIAL.id,
      material_name: MATERIAL.name,
      material_price_per_sqm: 55,
      cassette_id: CASSETTE.id,
      cassette_name: CASSETTE.name,
      cassette_price_per_m: 20,
      cassette_price_basis: 'per_m',
      bottom_rail_id: BOTTOM_RAIL.id,
      bottom_rail_name: BOTTOM_RAIL.name,
      bottom_rail_price_per_m: 0,
      bottom_rail_price_basis: 'per_m',
      control_id: CONTROL.id,
      control_name: CONTROL.name,
      control_price_per_item: 0,
      control_price_basis: 'per_panel',
      installation_id: null,
      installation_name: null,
      installation_price_per_item: null,
      installation_price_basis: null,
      attributes: {},
      quantity: 2,
      unit_price: 182,
      base_unit_price: null,
      addons: [],
      preset_id: null,
      ...overrides,
    };
    return {
      ...row,
      locked_base_price: 182,
      locked_inputs_fingerprint: pricingFingerprint(lockInputFromRow(row)),
    };
  }

  /** The preset of `payload()`, frozen at its typed 25. */
  function lockedPresetRow() {
    const row = {
      id: 'li2',
      uid: UID_B,
      position: 1,
      hidden: false,
      item_type: 'preset',
      preset_id: null,
      description: 'Installation',
      attributes: {},
      quantity: 1,
      unit_price: 25,
      base_unit_price: null,
      addons: [],
    };
    return {
      ...row,
      locked_base_price: 25,
      locked_inputs_fingerprint: pricingFingerprint(lockInputFromRow(row)),
    };
  }

  /** Seeds the pre-update read of order `o1` at the given status. */
  function seedExisting(status: string, rows: Record<string, unknown>[]) {
    db.responses['orders.select'] = [
      { id: 'o1', status, expiry_date: '2026-07-17', line_items: rows },
    ];
  }

  /** `payload()` with each item carrying the uid it came back with. */
  function editPayload() {
    const body = payload();
    (body.line_items[0] as Record<string, unknown>).uid = UID_A;
    (body.line_items[1] as Record<string, unknown>).uid = UID_B;
    return body;
  }

  async function put(body: unknown) {
    return ordersApp.request('/o1', {
      method: 'PUT',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }, ENV);
  }

  /** The rows the save inserted, in position order. */
  function savedRows(): Record<string, number | string | null>[] {
    return (db.insertPayloads['line_items']?.[0] ?? []) as Record<string, number | string | null>[];
  }

  it('keeps the confirmed price when the catalog price has since changed', async () => {
    seedExisting('awaiting_payment', [lockedBlindRow(), lockedPresetRow()]);
    // The material doubled in Settings after confirmation. A live-priced
    // save would charge 154 -> 308 on the material leg.
    db.responses['materials.select'] = [{ ...MATERIAL, price_per_sqm: 110 }];
    const res = await put(editPayload());
    expect(res.status).toBe(200);
    const [blind] = savedRows();
    expect(blind.unit_price).toBe(182);
    expect(blind.line_total).toBe(364);
    // The rate that EXPLAINS the frozen price travels with it.
    expect(blind.material_price_per_sqm).toBe(55);
    expect(blind.locked_base_price).toBe(182);
    // Totals follow the frozen prices: 364 + 25 = 389, less 10%.
    const orderRow = db.updatePayloads['orders']?.[0] as Record<string, number>;
    expect(orderRow.subtotal).toBe(389);
    expect(orderRow.total).toBe(395.61);
  });

  it('re-prices and re-locks only the item whose inputs were edited', async () => {
    seedExisting('awaiting_payment', [lockedBlindRow(), lockedPresetRow()]);
    db.responses['materials.select'] = [{ ...MATERIAL, price_per_sqm: 110 }];
    const body = editPayload();
    // A taller blind: the fingerprint no longer matches, so this item is
    // priced from today's catalog - 1.4 x 2.2 x 110 = 338.8, + 28 cassette.
    (body.line_items[0] as Record<string, unknown>).height_cm = 220;
    const res = await put(body);
    expect(res.status).toBe(200);
    const [blind, preset] = savedRows();
    expect(blind.unit_price).toBe(366.8);
    expect(blind.material_price_per_sqm).toBe(110);
    expect(blind.locked_base_price).toBe(366.8);
    // Its neighbour was not touched, so its price did not move.
    expect(preset.unit_price).toBe(25);
    expect(preset.locked_base_price).toBe(25);
  });

  it('still applies quantity, add-ons and the override on top of a frozen price', async () => {
    seedExisting('awaiting_payment', [lockedBlindRow(), lockedPresetRow()]);
    const body = editPayload();
    (body.line_items[0] as Record<string, unknown>).quantity = 3;
    (body.line_items[0] as Record<string, unknown>).addons = [{ label: 'Rush', price: 40 }];
    (body.line_items[0] as Record<string, unknown>).unit_price_override = 150;
    const res = await put(body);
    expect(res.status).toBe(200);
    const [blind] = savedRows();
    expect(blind.unit_price).toBe(150);
    // The struck-through "was" figure is the FROZEN price, not a re-calc.
    expect(blind.base_unit_price).toBe(182);
    expect(blind.line_total).toBe(490);
    expect(blind.locked_base_price).toBe(182);
  });

  it('saves a locked item whose catalog option has since been deleted', async () => {
    seedExisting('awaiting_payment', [lockedBlindRow(), lockedPresetRow()]);
    db.responses['materials.select'] = [];
    const res = await put(editPayload());
    expect(res.status).toBe(200);
    expect(savedRows()[0].unit_price).toBe(182);
  });

  it('prices an item added after confirmation from the current catalog, then locks it', async () => {
    seedExisting('awaiting_payment', [lockedBlindRow(), lockedPresetRow()]);
    const body = editPayload();
    body.line_items.push({
      item_type: 'custom',
      title: 'Extra',
      description: 'Trim',
      quantity: 1,
      unit_price: 30,
    } as never);
    const res = await put(body);
    expect(res.status).toBe(200);
    const added = savedRows()[2];
    expect(added.unit_price).toBe(30);
    expect(added.locked_base_price).toBe(30);
    expect(added.locked_inputs_fingerprint).toEqual(expect.any(String));
  });

  it('holds the quoted price on a SENT estimate, before any confirmation', async () => {
    seedExisting('sent', [lockedBlindRow(), lockedPresetRow()]);
    db.responses['materials.select'] = [{ ...MATERIAL, price_per_sqm: 110 }];
    const res = await put(editPayload());
    expect(res.status).toBe(200);
    expect(savedRows()[0].unit_price).toBe(182);
  });

  it('leaves a DRAFT order live-priced', async () => {
    seedExisting('draft', [lockedBlindRow(), lockedPresetRow()]);
    db.responses['materials.select'] = [{ ...MATERIAL, price_per_sqm: 110 }];
    const res = await put(editPayload());
    expect(res.status).toBe(200);
    const [blind] = savedRows();
    // 1.4 x 2.0 x 110 = 308 + 28 cassette.
    expect(blind.unit_price).toBe(336);
    expect(blind.locked_base_price).toBeNull();
    expect(blind.locked_inputs_fingerprint).toBeNull();
  });

  it('returns a revived estimate to live pricing in the same save', async () => {
    // Expired + a new expiry today-or-later means the order goes back to
    // `draft`: a fresh quote, priced from today's catalog.
    const future = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    seedExisting('expired', [lockedBlindRow(), lockedPresetRow()]);
    db.responses['materials.select'] = [{ ...MATERIAL, price_per_sqm: 110 }];
    const body = editPayload();
    body.expiry_date = future;
    body.order_date = new Date().toISOString().slice(0, 10);
    const res = await put(body);
    expect(res.status).toBe(200);
    const [blind] = savedRows();
    expect(blind.unit_price).toBe(336);
    expect(blind.locked_base_price).toBeNull();
  });

  it('freezes every item when the order is confirmed', async () => {
    db.responses['orders.select'] = [{ id: 'o1', status: 'sent' }];
    db.responses['line_items.select'] = [
      {
        id: 'li1',
        item_type: 'blind',
        blinds_type: 'Roller',
        panels: [70, 70],
        height_cm: 200,
        material_id: MATERIAL.id,
        cassette_id: CASSETTE.id,
        bottom_rail_id: BOTTOM_RAIL.id,
        control_id: CONTROL.id,
        installation_id: null,
        attributes: {},
        unit_price: 182,
        base_unit_price: null,
      },
      // Overridden: the CALCULATED figure is what freezes, or the
      // override would be applied twice on the next save.
      { id: 'li2', item_type: 'custom', preset_id: null, attributes: {}, unit_price: 20, base_unit_price: 25 },
    ];
    const res = await ordersApp.request('/o1/confirm', { method: 'POST' }, ENV);
    expect(res.status).toBe(200);
    const writes = (db.updatePayloads['line_items'] ?? []) as Record<string, unknown>[];
    expect(writes.map((w) => w.locked_base_price)).toEqual([182, 25]);
    expect(writes.every((w) => typeof w.locked_inputs_fingerprint === 'string')).toBe(true);
  });

  it('keeps a catalog-priced preset at its confirmed figure', async () => {
    const PRESET_ID = '99999999-9999-4999-8999-999999999999';
    const row = {
      id: 'li3',
      uid: UID_B,
      position: 0,
      hidden: false,
      item_type: 'preset',
      preset_id: PRESET_ID,
      description: 'Installation',
      attributes: {},
      quantity: 1,
      // A preset with provenance is priced from its catalog row, so the
      // typed figure is NOT one of its inputs — the fingerprint must
      // ignore it on both sides or the lock would never hold.
      unit_price: 75,
      base_unit_price: null,
      addons: [],
    };
    seedExisting('awaiting_payment', [
      { ...row, locked_base_price: 75, locked_inputs_fingerprint: pricingFingerprint(lockInputFromRow(row)) },
    ]);
    // The catalog preset has doubled since the order was confirmed.
    db.responses['preset_line_items.select'] = [
      { id: PRESET_ID, name: 'Installation', unit_price: 150 },
    ];
    const body = payload() as unknown as { line_items: unknown[] };
    body.line_items = [
      {
        item_type: 'preset',
        preset_id: PRESET_ID,
        title: '',
        description: 'Installation',
        quantity: 1,
        uid: UID_B,
      },
    ];
    const res = await put(body);
    expect(res.status).toBe(200);
    expect(savedRows()[0].unit_price).toBe(75);
  });

  it('keeps the locks when a confirmation is reversed', async () => {
    // Back to `sent`, where the customer still holds the estimate that
    // quoted these prices — reversing the confirmation is not a re-quote.
    db.responses['orders.select'] = [{ id: 'o1', status: 'awaiting_payment' }];
    const res = await ordersApp.request('/o1/unconfirm', { method: 'POST' }, ENV);
    expect(res.status).toBe(200);
    const writes = (db.updatePayloads['line_items'] ?? []) as Record<string, unknown>[];
    expect(writes).not.toContainEqual({
      locked_base_price: null,
      locked_inputs_fingerprint: null,
    });
  });

  /** A draft order ready to be sent, with one unlocked blind on it. */
  function seedSendable() {
    db.responses['orders.select'] = [
      {
        id: 'o1',
        status: 'draft',
        order_number: 'F0307-900',
        order_date: new Date().toISOString().slice(0, 10),
        expiry_date: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
        subtotal: 182, discount_amount: 0, taxable_amount: 182, tax_amount: 23.66, total: 205.66,
        public_token: null,
        terms_snapshot: null,
        line_items: [],
        payments: [],
        customer: {
          first_name: 'A', last_name: 'B', email: 'a@example.com', phone: '',
          shipping_address_line1: '', shipping_address_line2: '', shipping_city: '',
          shipping_province: '', shipping_postal_code: '', billing_same_as_shipping: true,
          billing_address_line1: '', billing_address_line2: '', billing_city: '',
          billing_province: '', billing_postal_code: '',
        },
      },
    ];
    db.responses['company_settings.select'] = [
      { company_name: 'Blinds Nisa', logo_url: null, email: 'x@y.z', phone: '', address: '', hst_number: '', terms_and_conditions: 'T&C', default_expiry_days: 14 },
    ];
    // The unlocked row `freezeOrderPrices` reads (it filters on
    // `locked_base_price is null`, which the fake client ignores).
    db.responses['line_items.select'] = [
      {
        id: 'li1',
        item_type: 'blind',
        blinds_type: 'Roller',
        panels: [70, 70],
        height_cm: 200,
        material_id: MATERIAL.id,
        cassette_id: CASSETTE.id,
        bottom_rail_id: BOTTOM_RAIL.id,
        control_id: CONTROL.id,
        installation_id: null,
        attributes: {},
        unit_price: 182,
        base_unit_price: null,
      },
    ];
  }

  /** Runs `fn` with Resend intercepted so no mail is attempted. */
  async function withResendStubbed(fn: () => Promise<void>) {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes('api.resend.com')) {
        return new Response(JSON.stringify({ id: 'email_1' }), { status: 200 });
      }
      return realFetch(url as never, init as never);
    }) as typeof fetch;
    try {
      await fn();
    } finally {
      globalThis.fetch = realFetch;
    }
  }

  it('freezes the prices when the estimate is emailed', async () => {
    seedSendable();
    await withResendStubbed(async () => {
      const res = await ordersApp.request('/o1/send', { method: 'POST' }, ENV);
      expect(res.status).toBe(200);
    });
    const writes = (db.updatePayloads['line_items'] ?? []) as Record<string, unknown>[];
    expect(writes.map((w) => w.locked_base_price)).toEqual([182]);
    const logs = (db.insertPayloads['order_logs'] ?? []) as Array<{ message: string }>;
    expect(logs.map((l) => l.message)).toContain('Item prices locked at send.');
  });

  it('freezes the prices when the estimate is marked sent without an email', async () => {
    seedSendable();
    await withResendStubbed(async () => {
      const res = await ordersApp.request('/o1/mark-sent', { method: 'POST' }, ENV);
      expect(res.status).toBe(200);
    });
    const writes = (db.updatePayloads['line_items'] ?? []) as Record<string, unknown>[];
    expect(writes.map((w) => w.locked_base_price)).toEqual([182]);
  });

  it('releases the locks only on a revert all the way to draft', async () => {
    db.responses['orders.select'] = [{ id: 'o1', status: 'ready' }];
    const toSent = await ordersApp.request(
      '/o1/status',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: 'sent' }) },
      ENV
    );
    expect(toSent.status).toBe(200);
    expect((db.updatePayloads['line_items'] ?? []) as unknown[]).not.toContainEqual({
      locked_base_price: null,
      locked_inputs_fingerprint: null,
    });

    db.updatePayloads = {};
    db.responses['orders.select'] = [{ id: 'o1', status: 'ready' }];
    const toDraft = await ordersApp.request(
      '/o1/status',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: 'draft' }) },
      ENV
    );
    expect(toDraft.status).toBe(200);
    expect((db.updatePayloads['line_items'] ?? []) as unknown[]).toContainEqual({
      locked_base_price: null,
      locked_inputs_fingerprint: null,
    });
  });
});
