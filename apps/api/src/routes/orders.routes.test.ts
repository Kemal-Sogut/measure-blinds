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
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Rows returned by table, keyed for the fake client. */
interface FakeDb {
  responses: Record<string, unknown[]>;
  /** Queue of insert results for the orders table (per attempt) */
  orderInsertResults: Array<{ data?: unknown; error?: { code: string; message: string } }>;
  calls: string[];
  /** Captured insert payloads keyed by table name */
  insertPayloads: Record<string, unknown[]>;
}

const db: FakeDb = { responses: {}, orderInsertResults: [], calls: [], insertPayloads: {} };

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
      return builder;
    }) as unknown;
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'is', 'lt', 'or', 'ilike', 'order', 'limit']) {
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

/** Standard env bindings for app.request. */
const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
  RESEND_API_KEY: 'not-a-real-key',
  APP_URL: 'http://localhost:5173',
  ENVIRONMENT: 'test',
};

const FABRIC = { id: '11111111-1111-4111-8111-111111111111', name: 'Blackout White', price_per_sqm: 55 };
const CASSETTE = { id: '22222222-2222-4222-8222-222222222222', name: 'Standard', price_per_m: 20 };
const CONTROL = { id: '33333333-3333-4333-8333-333333333333', name: 'Chain', price_per_item: 0 };

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
        fabric_id: FABRIC.id,
        cassette_id: CASSETTE.id,
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
  db.responses = {
    'fabrics.select': [FABRIC],
    'cassette_options.select': [CASSETTE],
    'control_options.select': [CONTROL],
    'company_settings.select': [{ default_expiry_days: 14 }],
    'orders.count': [0],
    'line_items.insert': [{}],
    'orders.select': [],
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
    // fabric 154 + cassette 28 + control 0 = 182/blind ×2 = 364 + 25 = 389
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
});

describe('POST /api/orders/:id/send', () => {
  it('returns 502 on email failure and never writes to the DB after', async () => {
    const order = {
      id: 'e9',
      status: 'draft',
      order_number: 'F0307-126',
      order_date: '2026-07-03',
      expiry_date: '2026-07-17',
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

describe('POST /api/orders/:id/install/propose', () => {
  const readyOrder = {
    id: 'r1',
    status: 'ready',
    order_number: 'F0307-127',
    public_token: '11111111-2222-4333-8444-555555555555',
    line_items: [],
    payments: [],
    customer: { first_name: 'A', last_name: 'B', email: 'a@example.com' },
  };
  const COMPANY = [{ company_name: 'Blinds Nisa', terms_and_conditions: '' }];

  it('rejects a malformed time (400) before touching the DB', async () => {
    const res = await ordersApp.request('/r1/install/propose', {
      method: 'POST',
      body: JSON.stringify({ install_date: '2026-08-07', install_time: '9am' }),
      headers: { 'Content-Type': 'application/json' },
    }, ENV);
    expect(res.status).toBe(400);
  });

  it('409 when the order is not ready', async () => {
    db.responses['orders.select'] = [{ ...readyOrder, status: 'in_progress' }];
    db.responses['company_settings.select'] = COMPANY;
    const res = await ordersApp.request('/r1/install/propose', {
      method: 'POST',
      body: JSON.stringify({ install_date: '2026-08-07', install_time: '09:00' }),
      headers: { 'Content-Type': 'application/json' },
    }, ENV);
    expect(res.status).toBe(409);
  });

  it('emails the customer then stores the proposal on a ready order', async () => {
    db.responses['orders.select'] = [readyOrder];
    db.responses['company_settings.select'] = COMPANY;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes('api.resend.com')) return new Response('{}', { status: 200 });
      return realFetch(url as never, init as never);
    }) as typeof fetch;
    try {
      const res = await ordersApp.request('/r1/install/propose', {
        method: 'POST',
        body: JSON.stringify({ install_date: '2026-08-07', install_time: '09:00' }),
        headers: { 'Content-Type': 'application/json' },
      }, ENV);
      expect(res.status).toBe(200);
      expect(db.calls).toContain('orders.update');
    } finally {
      globalThis.fetch = realFetch;
    }
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
