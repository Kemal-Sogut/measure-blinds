// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Route-level integration tests for the public customer flow with a
 * scripted fake Supabase client. Pins:
 *   - unknown/malformed tokens → 404 before any DB access pattern leak
 *   - defensive expiry (sent + past expiry reads as expired, 410 on confirm)
 *   - confirm succeeds exactly once (second attempt → 409), moving the
 *     order sent → awaiting_payment
 *   - the in-memory rate limiter returns 429 after the budget is spent
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

interface FakeDb {
  order: Record<string, unknown> | null;
  appointment: Record<string, unknown> | null;
  updated: boolean;
  calls: string[];
  /** Payload of the most recent orders UPDATE that passed its guards. */
  lastUpdate: Record<string, unknown> | null;
}
const db: FakeDb = {
  order: null,
  appointment: null,
  updated: false,
  calls: [],
  lastUpdate: null,
};

/**
 * Fake supabase. Reads return the seeded row; UPDATEs apply their real
 * payload, but only when every chained filter still matches the current
 * row — the routes lean on those filters as concurrency guards
 * (`.eq('status', …)`, `.is('cancel_requested_at', null)`), so a fake
 * that ignored them would let guarded routes pass untested.
 *
 * Filters are enforced on UPDATE only; SELECTs keep returning the seeded
 * row so token/id lookups stay trivial.
 */
function makeBuilder(table: string) {
  const state = {
    table,
    op: 'select',
    payload: null as Record<string, unknown> | null,
    guards: [] as Array<(row: Record<string, unknown>) => boolean>,
  };
  const builder: Record<string, unknown> = {};
  const chain = (name: string) =>
    ((...args: unknown[]) => {
      if (['insert', 'update', 'delete'].includes(name)) {
        state.op = name;
        if (name === 'update') state.payload = args[0] as Record<string, unknown>;
      }
      if (name === 'eq') {
        const [col, val] = args as [string, unknown];
        state.guards.push((r) => r[col] === val);
      }
      if (name === 'is') {
        const [col, val] = args as [string, unknown];
        state.guards.push((r) => (r[col] ?? null) === val);
      }
      if (name === 'not') {
        const [col, op, val] = args as [string, string, unknown];
        if (op === 'is') state.guards.push((r) => (r[col] ?? null) !== val);
      }
      return builder;
    }) as unknown;
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'is', 'not', 'lt', 'or', 'order', 'limit']) {
    builder[m] = chain(m);
  }
  const resolve = () => {
    db.calls.push(`${state.table}.${state.op}`);
    if (state.table === 'company_settings') {
      return { data: { company_name: 'Blinds Nisa', logo_url: null, email: 'biz@example.com', phone: '', address: '', hst_number: 'HST1', etransfer_email: 'pay@example.com', etransfer_instructions: '50% deposit please.' } };
    }
    if (state.table === 'appointments') return { data: db.appointment };
    if (state.table !== 'orders') return { data: null };
    if (state.op === 'update') {
      if (!db.order) return { data: null };
      // Every chained filter must still hold — this is what makes the
      // routes' racing guards actually testable.
      if (!state.guards.every((g) => g(db.order as Record<string, unknown>))) {
        return { data: null };
      }
      db.lastUpdate = state.payload;
      db.order = { ...db.order, ...(state.payload ?? {}) };
      db.updated = true;
      return { data: db.order };
    }
    return { data: db.order };
  };
  builder.single = async () => ({ ...resolve(), error: null });
  builder.maybeSingle = builder.single;
  (builder as { then: unknown }).then = (onF: (v: unknown) => unknown) =>
    Promise.resolve(onF({ ...resolve(), error: null }));
  return builder;
}

vi.mock('../lib/supabase', () => ({
  createSupabaseAdmin: () => ({ from: (t: string) => makeBuilder(t) }),
}));

import publicApp from './public';

const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
  RESEND_API_KEY: 'placeholder',
  APP_URL: 'http://localhost:5173',
  ENVIRONMENT: 'test',
};

const TOKEN = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

/** Requests carry a unique IP by default so the limiter doesn't interfere. */
let ipSeq = 0;
function req(path: string, method = 'GET', ip?: string) {
  return publicApp.request(
    path,
    { method, headers: { 'CF-Connecting-IP': ip ?? `10.0.0.${++ipSeq}` } },
    ENV
  );
}

/** A future-dated sent order with customer + items. */
function sentOrder(): Record<string, unknown> {
  return {
    id: 'e1',
    status: 'sent',
    order_number: 'F0307-126',
    order_date: '2026-07-03',
    expiry_date: '2099-01-01',
    subtotal: 100, discount_amount: 0, taxable_amount: 100,
    tax_rate: 0.13, tax_amount: 13, total: 113,
    terms_snapshot: 'Terms here',
    confirmed_at: null,
    cancel_requested_at: null,
    cancel_request_note: '',
    public_token: TOKEN,
    line_items: [],
    payments: [],
    customer: { first_name: 'A', last_name: 'B', shipping_address_line1: '', shipping_address_line2: '', shipping_city: '', shipping_province: '', shipping_postal_code: '' },
  };
}

/** A confirmed order awaiting payment — the cancellation-request window. */
function awaitingOrder(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...sentOrder(),
    status: 'awaiting_payment',
    confirmed_at: '2026-07-20T10:00:00.000Z',
    ...over,
  };
}

/** A proposed installation visit from the appointments table. */
function proposedAppointment(): Record<string, unknown> {
  return {
    id: 'a1',
    kind: 'installation',
    status: 'proposed',
    appointment_date: '2026-08-07',
    appointment_time: '09:00:00',
    order: { order_number: 'F0307-126' },
    customer: { first_name: 'A', last_name: 'B' },
  };
}

beforeEach(() => {
  db.order = sentOrder();
  db.appointment = null;
  db.updated = false;
  db.calls = [];
  db.lastUpdate = null;
});

/** POSTs a JSON body (the cancellation routes accept an optional note). */
function postJson(path: string, body: unknown) {
  return publicApp.request(
    path,
    {
      method: 'POST',
      headers: { 'CF-Connecting-IP': `10.0.0.${++ipSeq}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    ENV
  );
}

describe('GET /public/estimate/:token', () => {
  it('rejects malformed tokens with 404', async () => {
    const res = await req('/estimate/not-a-uuid');
    expect(res.status).toBe(404);
  });

  it('returns the sanitized estimate for a valid token', async () => {
    const res = await req(`/estimate/${TOKEN}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data.status).toBe('sent');
    expect(body.data.total).toBe(113);
    expect(body.data.terms).toBe('Terms here');
    expect(body.data).not.toHaveProperty('id');
    expect(body.data).not.toHaveProperty('public_token');
  });

  it('404 for unknown token', async () => {
    db.order = null;
    const res = await req(`/estimate/${TOKEN}`);
    expect(res.status).toBe(404);
  });

  it('defensively expires a stale sent order on read', async () => {
    db.order = { ...sentOrder(), expiry_date: '2020-01-01' };
    const res = await req(`/estimate/${TOKEN}`);
    const body = (await res.json()) as { data: { status: string } };
    expect(body.data.status).toBe('expired');
    expect(db.calls).toContain('orders.update');
  });
});

describe('POST /public/estimate/:token/confirm', () => {
  it('confirms a sent order exactly once → awaiting_payment, then 409', async () => {
    const first = await req(`/estimate/${TOKEN}/confirm`, 'POST');
    expect(first.status).toBe(200);
    expect((db.order as { status: string }).status).toBe('awaiting_payment');

    const second = await req(`/estimate/${TOKEN}/confirm`, 'POST');
    expect(second.status).toBe(409);
  });

  it('410 for an expired order', async () => {
    db.order = { ...sentOrder(), expiry_date: '2020-01-01' };
    const res = await req(`/estimate/${TOKEN}/confirm`, 'POST');
    expect(res.status).toBe(410);
  });

  it('409 for a draft order (no token should exist, but belt & braces)', async () => {
    db.order = { ...sentOrder(), status: 'draft' };
    const res = await req(`/estimate/${TOKEN}/confirm`, 'POST');
    expect(res.status).toBe(409);
  });
});

describe('GET /public/estimate/:token — order summary payload', () => {
  it('computes amount_paid and balance server-side from the ledger', async () => {
    db.order = awaitingOrder({
      payments: [
        { amount: 50, paid_on: '2026-07-05' },
        { amount: '13.00', paid_on: '2026-07-18' },
      ],
    });
    const res = await req(`/estimate/${TOKEN}`);
    const body = (await res.json()) as { data: { amount_paid: number; balance: number } };
    expect(body.data.amount_paid).toBe(63);
    expect(body.data.balance).toBe(50);
  });

  it('returns the receipt history as amount + date, oldest-first', async () => {
    db.order = awaitingOrder({
      payments: [
        { amount: '13.00', paid_on: '2026-07-18' },
        { amount: 50, paid_on: '2026-07-05' },
      ],
    });
    const res = await req(`/estimate/${TOKEN}`);
    const body = (await res.json()) as { data: { payments: unknown[] } };
    expect(body.data.payments).toEqual([
      { amount: 50, paid_on: '2026-07-05' },
      { amount: 13, paid_on: '2026-07-18' },
    ]);
  });

  it('withholds the staff-only payment columns from the receipt history', async () => {
    db.order = awaitingOrder({
      payments: [
        {
          id: 'pay-1',
          amount: 50,
          paid_on: '2026-07-05',
          note: 'cheque #12',
          receipt_sent_at: '2026-07-06T10:00:00.000Z',
        },
      ],
    });
    const res = await req(`/estimate/${TOKEN}`);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data.payments).toEqual([{ amount: 50, paid_on: '2026-07-05' }]);
    const serialized = JSON.stringify(body.data);
    expect(serialized).not.toContain('cheque');
    expect(serialized).not.toContain('pay-1');
    expect(serialized).not.toContain('receipt_sent_at');
  });

  it('returns an empty receipt history when nothing has been paid', async () => {
    db.order = awaitingOrder({ payments: [] });
    const res = await req(`/estimate/${TOKEN}`);
    const body = (await res.json()) as { data: { payments: unknown[]; amount_paid: number } };
    expect(body.data.payments).toEqual([]);
    expect(body.data.amount_paid).toBe(0);
  });

  it('exposes the e-Transfer details and the cancellation flag', async () => {
    db.order = awaitingOrder({ cancel_requested_at: '2026-07-21T09:00:00.000Z' });
    const res = await req(`/estimate/${TOKEN}`);
    const body = (await res.json()) as {
      data: { cancel_requested_at: string | null; company: Record<string, unknown> };
    };
    expect(body.data.cancel_requested_at).toBe('2026-07-21T09:00:00.000Z');
    expect(body.data.company.etransfer_email).toBe('pay@example.com');
    expect(body.data.company.etransfer_instructions).toBe('50% deposit please.');
  });
});

describe('POST /public/estimate/:token/cancel-request', () => {
  it('raises the flag without touching the order status', async () => {
    db.order = awaitingOrder();
    const res = await postJson(`/estimate/${TOKEN}/cancel-request`, { note: 'Changed my mind' });
    expect(res.status).toBe(200);
    const row = db.order as { status: string; cancel_requested_at: string | null; cancel_request_note: string };
    expect(row.cancel_requested_at).toBeTruthy();
    expect(row.cancel_request_note).toBe('Changed my mind');
    // The customer can ask, but can never move the order themselves.
    expect(row.status).toBe('awaiting_payment');
  });

  it('409 before confirmation (nothing to cancel yet)', async () => {
    db.order = sentOrder();
    const res = await postJson(`/estimate/${TOKEN}/cancel-request`, {});
    expect(res.status).toBe(409);
    expect((db.order as { cancel_requested_at: string | null }).cancel_requested_at).toBeNull();
  });

  it('409 once a payment has been recorded', async () => {
    db.order = awaitingOrder({ payments: [{ amount: 25 }] });
    const res = await postJson(`/estimate/${TOKEN}/cancel-request`, {});
    expect(res.status).toBe(409);
    expect((db.order as { cancel_requested_at: string | null }).cancel_requested_at).toBeNull();
  });

  it('409 when a request is already open (no duplicate notifications)', async () => {
    db.order = awaitingOrder({ cancel_requested_at: '2026-07-21T09:00:00.000Z' });
    const res = await postJson(`/estimate/${TOKEN}/cancel-request`, {});
    expect(res.status).toBe(409);
  });

  it('truncates an overlong note to 500 characters', async () => {
    db.order = awaitingOrder();
    const res = await postJson(`/estimate/${TOKEN}/cancel-request`, { note: 'x'.repeat(900) });
    expect(res.status).toBe(200);
    expect((db.lastUpdate?.cancel_request_note as string).length).toBe(500);
  });

  it('404 for a malformed token before any DB access', async () => {
    const res = await postJson('/estimate/not-a-uuid/cancel-request', {});
    expect(res.status).toBe(404);
    expect(db.calls).toHaveLength(0);
  });
});

describe('POST /public/estimate/:token/cancel-withdraw', () => {
  it('clears an open request', async () => {
    db.order = awaitingOrder({ cancel_requested_at: '2026-07-21T09:00:00.000Z', cancel_request_note: 'oops' });
    const res = await postJson(`/estimate/${TOKEN}/cancel-withdraw`, {});
    expect(res.status).toBe(200);
    const row = db.order as { cancel_requested_at: string | null; cancel_request_note: string };
    expect(row.cancel_requested_at).toBeNull();
    expect(row.cancel_request_note).toBe('');
  });

  it('409 when there is no request to withdraw', async () => {
    db.order = awaitingOrder();
    const res = await postJson(`/estimate/${TOKEN}/cancel-withdraw`, {});
    expect(res.status).toBe(409);
  });
});

describe('GET /public/appointment/:token', () => {
  it('returns the sanitized appointment for a valid token', async () => {
    db.appointment = proposedAppointment();
    const res = await req(`/appointment/${TOKEN}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { kind: string; status: string; order_number: string | null };
    };
    expect(body.data.kind).toBe('installation');
    expect(body.data.status).toBe('proposed');
    expect(body.data.order_number).toBe('F0307-126');
  });

  it('404 for unknown token', async () => {
    db.appointment = null;
    const res = await req(`/appointment/${TOKEN}`);
    expect(res.status).toBe(404);
  });
});

describe('POST /public/appointment/:token/confirm', () => {
  it('confirms a proposed visit time', async () => {
    db.appointment = proposedAppointment();
    const res = await req(`/appointment/${TOKEN}/confirm`, 'POST');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { status: string } };
    expect(body.data.status).toBe('confirmed');
  });

  it('409 when there is no active proposal', async () => {
    db.appointment = { ...proposedAppointment(), status: 'confirmed' };
    const res = await req(`/appointment/${TOKEN}/confirm`, 'POST');
    expect(res.status).toBe(409);
  });
});

describe('POST /public/appointment/:token/request', () => {
  it('records a change request with the customer note', async () => {
    db.appointment = { ...proposedAppointment(), kind: 'estimate', order: null };
    const res = await req(`/appointment/${TOKEN}/request`, 'POST');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { status: string } };
    expect(body.data.status).toBe('change_requested');
  });
});

describe('rate limiting', () => {
  it('returns 429 after 5 requests in a minute from one IP', async () => {
    const ip = '203.0.113.7';
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await req(`/estimate/${TOKEN}`, 'GET', ip);
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(statuses[5]).toBe(429);
  });
});
