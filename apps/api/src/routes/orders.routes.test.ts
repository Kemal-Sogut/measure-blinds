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

/** Standard env bindings for app.request. */
const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
  RESEND_API_KEY: 'not-a-real-key',
  APP_URL: 'http://localhost:5173',
  ENVIRONMENT: 'test',
};

const MATERIAL = { id: '11111111-1111-4111-8111-111111111111', name: 'Blackout White', price_per_sqm: 55 };
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
        material_id: MATERIAL.id,
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
    'materials.select': [MATERIAL],
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
