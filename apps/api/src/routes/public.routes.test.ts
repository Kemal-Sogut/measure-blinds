// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Route-level integration tests for the public customer flow with a
 * scripted fake Supabase client. Pins:
 *   - unknown/malformed tokens → 404 before any DB access pattern leak
 *   - defensive expiry (sent + past expiry reads as expired, 410 on confirm)
 *   - confirm succeeds exactly once (second attempt → 409), moving the
 *     order sent → awaiting_payment
 *   - the in-memory rate limiter returns 429 once `PUBLIC_RATE_LIMIT` is spent
 *   - internal notification emails are attempted, against a stubbed
 *     Resend (see `sentEmails` below — the suite performs NO network I/O)
 *   - edit requests: filed only on a live `sent` estimate, capped at five
 *     OPEN per order, message trimmed/truncated rather than rejected, and
 *     deliberately silent (no email — staff see them on the order page)
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

interface FakeDb {
  order: Record<string, unknown> | null;
  appointment: Record<string, unknown> | null;
  updated: boolean;
  calls: string[];
  /** Payload of the most recent orders UPDATE that passed its guards. */
  lastUpdate: Record<string, unknown> | null;
  /**
   * The company_settings singleton every SELECT on that table returns.
   * Seeded per test so the maintenance gate (which reads exactly this
   * row before any route runs) can be flipped without a second fake.
   */
  company: Record<string, unknown>;
  /**
   * `order_edit_requests` rows for the seeded order. Real array, not a
   * single row: the edit-request route COUNTS the open ones to enforce
   * its per-order cap, so a fake that returned one row could not
   * exercise the cap at all.
   */
  editRequests: Array<Record<string, unknown>>;
  /** Payloads of every `notifications` INSERT (the staff Alerts feed). */
  notifications: Array<Record<string, unknown>>;
  /** `order_revisions` rows (migration 50); filtered by the route's `eq`s. */
  revisions: Array<Record<string, unknown>>;
  /** When true every `order_revisions` read fails with a database error. */
  revisionsFail: boolean;
  /** Messages of every `order_logs` INSERT (the customer action trail). */
  logs: string[];
}

/** Default company_settings row: shop open, brand fields populated. */
function openCompany(): Record<string, unknown> {
  return {
    company_name: 'Blinds Nisa',
    logo_url: null,
    email: 'biz@example.com',
    phone: '',
    address: '',
    hst_number: 'HST1',
    etransfer_email: 'pay@example.com',
    etransfer_instructions: '50% deposit please.',
    maintenance_mode: false,
    maintenance_message: '',
  };
}

const db: FakeDb = {
  order: null,
  appointment: null,
  updated: false,
  calls: [],
  lastUpdate: null,
  company: openCompany(),
  editRequests: [],
  notifications: [],
  revisions: [],
  revisionsFail: false,
  logs: [],
};

/**
 * Fake supabase. Reads return the seeded row; UPDATEs apply their real
 * payload, but only when every chained filter still matches the current
 * row — the routes lean on those filters as concurrency guards
 * (`.eq('status', …)`, `.is('cancel_requested_at', null)`), so a fake
 * that ignored them would let guarded routes pass untested.
 *
 * Filters are enforced on UPDATE, and on reads of the multi-row tables
 * (`order_edit_requests`, `order_revisions`); other SELECTs keep
 * returning the seeded row so token/id lookups stay trivial.
 */
function makeBuilder(table: string) {
  const state = {
    table,
    op: 'select',
    payload: null as Record<string, unknown> | null,
    guards: [] as Array<(row: Record<string, unknown>) => boolean>,
    counting: false,
    single: false,
  };
  const builder: Record<string, unknown> = {};
  const chain = (name: string) =>
    ((...args: unknown[]) => {
      if (['insert', 'update', 'delete'].includes(name)) {
        state.op = name;
        if (name === 'update' || name === 'insert') {
          state.payload = args[0] as Record<string, unknown>;
        }
      }
      // `.select('id', { count: 'exact', head: true })` — the cap check
      // reads the COUNT, never the rows, so the fake has to carry it.
      if (name === 'select' && (args[1] as { count?: string } | undefined)?.count) {
        state.counting = true;
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
      return { data: db.company };
    }
    if (state.table === 'appointments') return { data: db.appointment };
    if (state.table === 'order_logs' && state.op === 'insert') {
      db.logs.push(String(state.payload?.message ?? ''));
      return { data: null };
    }
    if (state.table === 'order_revisions') {
      if (db.revisionsFail) return { data: null, error: { message: 'revisions unreadable' } };
      // Newest first, as every route read orders them.
      const rows = db.revisions
        .filter((r) => state.guards.every((g) => g(r)))
        .sort((a, b) => Number(b.rev_no) - Number(a.rev_no));
      return { data: state.single ? (rows[0] ?? null) : rows };
    }
    if (state.table === 'notifications' && state.op === 'insert') {
      db.notifications.push(state.payload ?? {});
      return { data: null };
    }
    if (state.table === 'order_edit_requests') {
      if (state.op === 'insert') {
        const row = {
          id: `req-${db.editRequests.length + 1}`,
          created_at: '2026-08-26T10:00:00.000Z',
          resolved_at: null,
          ...(state.payload ?? {}),
        };
        db.editRequests.push(row);
        return { data: row };
      }
      // Guards are the route's own filters (order_id, resolved_at is
      // null); applying them is what makes the cap count the OPEN rows
      // rather than every row ever filed.
      const rows = db.editRequests.filter((r) => state.guards.every((g) => g(r)));
      return state.counting ? { data: null, count: rows.length } : { data: rows };
    }
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
  builder.single = async () => {
    state.single = true;
    return { error: null, ...resolve() };
  };
  builder.maybeSingle = builder.single;
  (builder as { then: unknown }).then = (onF: (v: unknown) => unknown) =>
    Promise.resolve(onF({ error: null, ...resolve() }));
  return builder;
}

vi.mock('../lib/supabase', () => ({
  createSupabaseAdmin: () => ({ from: (t: string) => makeBuilder(t) }),
}));

import publicApp, { PUBLIC_RATE_LIMIT } from './public';
import { buildPublicQuote } from '../lib/publicQuote';

const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
  RESEND_API_KEY: 'placeholder',
  APP_URL: 'http://localhost:5173',
  ENVIRONMENT: 'test',
};

const TOKEN = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

/* ------------------------------------------------------------------ */
/* Resend stub                                                         */
/* ------------------------------------------------------------------ */

/**
 * Emails the routes attempted, newest last. Reset before every test.
 */
const sentEmails: Array<{ to: string; subject: string; html: string }> = [];

/**
 * Resend is stubbed for the WHOLE suite, not per-test.
 *
 * Five public routes send an internal notification (confirm,
 * cancel-request, cancel-withdraw, appointment confirm, appointment
 * request) and `sendEmail` in `lib/email.ts` calls `fetch` directly.
 * Without this stub each of those tests made a REAL HTTPS request to
 * api.resend.com, waited for the 401 that a placeholder key earns, and
 * only then continued — 2-4 seconds apiece, occasionally past vitest's
 * 5s default timeout, which is what made this file fail at random on an
 * unchanged tree. It also meant `pnpm --filter api test` performed live
 * network I/O against a third party on every run.
 *
 * All three call sites wrap the send in try/catch and log, so a 200 here
 * exercises exactly the same route behaviour a 401 did — no assertion in
 * this file changes meaning because of the stub.
 *
 * Any fetch to another host THROWS rather than falling through to the
 * network, so the next unmocked outbound call fails loudly in CI instead
 * of quietly reaching the internet.
 */
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const href = input instanceof Request ? input.url : String(input);
  if (!href.startsWith('https://api.resend.com/')) {
    throw new Error(`Unmocked outbound fetch in tests: ${href}`);
  }
  const body = JSON.parse(String(init?.body ?? '{}')) as { to?: string[]; subject?: string; html?: string };
  sentEmails.push({ to: body.to?.[0] ?? '', subject: body.subject ?? '', html: body.html ?? '' });
  return new Response(JSON.stringify({ id: 'stub-email-id' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}) as typeof globalThis.fetch;

afterAll(() => {
  globalThis.fetch = realFetch;
});

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
  db.company = openCompany();
  db.editRequests = [];
  db.notifications = [];
  db.revisions = [];
  db.revisionsFail = false;
  db.logs = [];
  sentEmails.length = 0;
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

  it('serves the estimate title, or null when none is set', async () => {
    db.order = { ...sentOrder(), title: 'Option A' };
    let body = (await (await req(`/estimate/${TOKEN}`)).json()) as { data: Record<string, unknown> };
    expect(body.data.title).toBe('Option A');
    db.order = sentOrder();
    body = (await (await req(`/estimate/${TOKEN}`)).json()) as { data: Record<string, unknown> };
    expect(body.data.title).toBeNull();
  });

  it('never forwards the raw attribute blob, only formatted lines', async () => {
    // This endpoint is UNAUTHENTICATED — the capability token is the only
    // gate — so anything spread into the payload is public the moment it
    // exists. The blob is formatted server-side through the blind type's
    // own describeAttributes, which decides what a customer may see; the
    // raw object must never cross the boundary, or a future internal-only
    // field would be published automatically and retroactively for orders
    // already sent.
    db.order = {
      ...sentOrder(),
      line_items: [
        {
          item_type: 'blind',
          room_name: 'Living Room',
          blinds_type: 'Roller',
          panels: [140],
          height_cm: 200,
          material_name: 'Blackout White',
          cassette_name: 'Standard',
          bottom_rail_name: 'Regular',
          control_name: 'Chain',
          color: 'White',
          description: '',
          note: '',
          attributes: { internal_cost_code: 'SUPPLIER-SECRET-123' },
          quantity: 1,
          unit_price: 100,
          line_total: 100,
        },
      ],
    };
    const res = await req(`/estimate/${TOKEN}`);
    const raw = await res.text();

    // The strongest form of the assertion: the value never appears in the
    // response bytes at all, by any route.
    expect(raw).not.toContain('internal_cost_code');
    expect(raw).not.toContain('SUPPLIER-SECRET-123');

    const body = JSON.parse(raw) as { data: { line_items: Record<string, unknown>[] } };
    const li = body.data.line_items[0];
    expect(li).not.toHaveProperty('attributes');
    expect(Array.isArray(li.attribute_lines)).toBe(true);
  });

  it('omits hidden line items from the payload', async () => {
    // A hidden item is not part of what the customer is being charged —
    // it never reaches the total — so printing it on their page would
    // show a line that nothing adds up to.
    const item = (room: string, hidden: boolean) => ({
      item_type: 'blind',
      room_name: room,
      blinds_type: 'Roller',
      panels: [140],
      height_cm: 200,
      material_name: 'Blackout White',
      cassette_name: 'Standard',
      bottom_rail_name: 'Regular',
      control_name: 'Chain',
      color: 'White',
      description: '',
      note: '',
      attributes: {},
      quantity: 1,
      unit_price: 100,
      line_total: 100,
      hidden,
    });
    db.order = {
      ...sentOrder(),
      line_items: [item('Living Room', false), item('Cellar', true)],
    };
    const res = await req(`/estimate/${TOKEN}`);
    const raw = await res.text();
    expect(raw).not.toContain('Cellar');
    const body = JSON.parse(raw) as { data: { line_items: Record<string, unknown>[] } };
    expect(body.data.line_items).toHaveLength(1);
    expect(body.data.line_items[0].room_name).toBe('Living Room');
  });

  it('sends per-option money but never the rates or bases behind it', async () => {
    // The page prints what each hardware choice cost the customer. It may
    // not derive that itself (no catalog, and AI_GUIDELINES rule 1), so
    // the Worker computes it — while the shop's rate columns and price
    // bases stay server-side, since this endpoint is unauthenticated.
    db.order = {
      ...sentOrder(),
      line_items: [
        {
          item_type: 'blind',
          room_name: 'Living Room',
          blinds_type: 'Roller',
          panels: [70, 70],
          height_cm: 200,
          material_name: 'Blackout White',
          cassette_name: 'Standard',
          cassette_id: 'cas-1',
          cassette_price_per_m: 10,
          cassette_price_basis: 'per_m',
          control_name: 'Chain',
          control_id: 'ctl-1',
          control_price_per_item: 12,
          control_price_basis: 'per_panel',
          color: 'White',
          description: '',
          note: '',
          attributes: {},
          quantity: 2,
          unit_price: 100,
          line_total: 200,
        },
      ],
    };
    const res = await req(`/estimate/${TOKEN}`);
    const raw = await res.text();
    expect(raw).not.toContain('price_basis');
    expect(raw).not.toContain('cassette_price_per_m');

    const body = JSON.parse(raw) as { data: { line_items: Record<string, unknown>[] } };
    // per_m: 140/100 × 10 = 14.00 × 2 blinds; per_panel: 2 × 12 = 24.00 × 2.
    expect(body.data.line_items[0].option_prices).toEqual({ cassette: 28, control: 48 });
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

    // The 409 short-circuits before the notification, so staff hear about
    // the confirmation once, not once per customer click.
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].subject).toContain('confirmed');
  });

  it('raises exactly one order_confirmed alert linked to the order', async () => {
    await req(`/estimate/${TOKEN}/confirm`, 'POST');
    await req(`/estimate/${TOKEN}/confirm`, 'POST'); // 409 — must not alert again
    expect(db.notifications).toEqual([
      {
        kind: 'order_confirmed',
        order_id: 'e1',
        order_number: 'F0307-126',
        customer_name: 'A B',
        amount: null,
        email_thread_id: null,
        subject: '',
      },
    ]);
  });

  it('raises no alert when the confirm is refused', async () => {
    db.order = { ...sentOrder(), expiry_date: '2020-01-01' };
    await req(`/estimate/${TOKEN}/confirm`, 'POST');
    expect(db.notifications).toHaveLength(0);
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

describe('GET /public/estimate/:token — edit requests', () => {
  it('reads the customer their own requests, oldest first', async () => {
    db.order = {
      ...sentOrder(),
      order_edit_requests: [
        { id: 'r2', message: 'second', created_at: '2026-08-02T10:00:00.000Z', resolved_at: null },
        { id: 'r1', message: 'first', created_at: '2026-08-01T10:00:00.000Z', resolved_at: '2026-08-03T10:00:00.000Z' },
      ],
    };
    const res = await req(`/estimate/${TOKEN}`);
    const body = (await res.json()) as {
      data: { edit_requests: Array<{ id: string; resolved_at: string | null }> };
    };
    expect(body.data.edit_requests.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(body.data.edit_requests[0].resolved_at).toBe('2026-08-03T10:00:00.000Z');
  });

  it('serves an empty list when the order has none', async () => {
    const res = await req(`/estimate/${TOKEN}`);
    const body = (await res.json()) as { data: { edit_requests: unknown[] } };
    expect(body.data.edit_requests).toEqual([]);
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

  it('serves the 50% deposit, rounded to the cent, from the total', async () => {
    // 113 / 2 = 56.5 exactly; an odd-cent total must not leak a third
    // decimal into the figure quoted to the customer.
    db.order = awaitingOrder({ payments: [] });
    let res = await req(`/estimate/${TOKEN}`);
    let body = (await res.json()) as { data: { deposit_due: number } };
    expect(body.data.deposit_due).toBe(56.5);

    db.order = awaitingOrder({ total: '113.55', payments: [] });
    res = await req(`/estimate/${TOKEN}`);
    body = (await res.json()) as { data: { deposit_due: number } };
    expect(body.data.deposit_due).toBe(56.78);
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
    // Staff are notified exactly once.
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe('biz@example.com');
    expect(sentEmails[0].subject).toContain('Cancellation requested');
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
    // The point of the guard: a second request must not re-notify staff.
    expect(sentEmails).toHaveLength(0);
  });

  it('truncates an overlong note to 500 characters', async () => {
    db.order = awaitingOrder();
    const res = await postJson(`/estimate/${TOKEN}/cancel-request`, { note: 'x'.repeat(900) });
    expect(res.status).toBe(200);
    expect((db.lastUpdate?.cancel_request_note as string).length).toBe(500);
  });

  it('404 for a malformed token before any order lookup', async () => {
    const res = await postJson('/estimate/not-a-uuid/cancel-request', {});
    expect(res.status).toBe(404);
    // The maintenance gate reads the settings singleton on every public
    // request; what must NOT happen is an orders lookup, which is what
    // would let a caller probe token existence with junk.
    expect(db.calls).toEqual(['company_settings.select']);
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

describe('POST /public/estimate/:token/edit-request', () => {
  it('files the message and logs the event', async () => {
    const res = await postJson(`/estimate/${TOKEN}/edit-request`, {
      message: 'Can the kitchen blind be cordless?',
    });
    expect(res.status).toBe(200);
    expect(db.editRequests).toHaveLength(1);
    expect(db.editRequests[0]).toMatchObject({
      order_id: 'e1',
      message: 'Can the kitchen blind be cordless?',
    });
    expect(db.calls).toContain('order_logs.insert');
  });

  it('returns the created request so the page can render it', async () => {
    const res = await postJson(`/estimate/${TOKEN}/edit-request`, { message: 'Drop the bay window' });
    const body = (await res.json()) as {
      data: { id: string; message: string; resolved_at: string | null };
    };
    expect(body.data.message).toBe('Drop the bay window');
    expect(body.data.resolved_at).toBeNull();
  });

  it('trims the message and rejects a whitespace-only one', async () => {
    const res = await postJson(`/estimate/${TOKEN}/edit-request`, { message: '   \n  ' });
    expect(res.status).toBe(400);
    expect(db.editRequests).toHaveLength(0);
  });

  it('rejects a missing message', async () => {
    const res = await postJson(`/estimate/${TOKEN}/edit-request`, {});
    expect(res.status).toBe(400);
    expect(db.editRequests).toHaveLength(0);
  });

  it('truncates an over-long message rather than rejecting it', async () => {
    const res = await postJson(`/estimate/${TOKEN}/edit-request`, { message: 'x'.repeat(1500) });
    expect(res.status).toBe(200);
    expect((db.editRequests[0].message as string).length).toBe(1000);
  });

  it('refuses once the order has been confirmed', async () => {
    db.order = { ...sentOrder(), status: 'awaiting_payment' };
    const res = await postJson(`/estimate/${TOKEN}/edit-request`, { message: 'too late' });
    expect(res.status).toBe(409);
    expect(db.editRequests).toHaveLength(0);
  });

  it('refuses on an expired estimate', async () => {
    db.order = { ...sentOrder(), expiry_date: '2020-01-01' };
    const res = await postJson(`/estimate/${TOKEN}/edit-request`, { message: 'anyone there?' });
    expect(res.status).toBe(409);
    expect(db.editRequests).toHaveLength(0);
  });

  it('caps open requests per order at five', async () => {
    for (let i = 0; i < 5; i++) {
      const ok = await postJson(`/estimate/${TOKEN}/edit-request`, { message: `change ${i}` });
      expect(ok.status).toBe(200);
    }
    const res = await postJson(`/estimate/${TOKEN}/edit-request`, { message: 'one too many' });
    expect(res.status).toBe(409);
    expect(db.editRequests).toHaveLength(5);
  });

  it('counts only OPEN requests against the cap', async () => {
    db.editRequests = Array.from({ length: 5 }, (_, i) => ({
      id: `old-${i}`,
      order_id: 'e1',
      message: `handled ${i}`,
      created_at: '2026-08-01T10:00:00.000Z',
      resolved_at: '2026-08-02T10:00:00.000Z',
    }));
    const res = await postJson(`/estimate/${TOKEN}/edit-request`, { message: 'a new one' });
    expect(res.status).toBe(200);
  });

  it('rejects a malformed token before touching the DB', async () => {
    const res = await postJson('/estimate/not-a-uuid/edit-request', { message: 'hello' });
    expect(res.status).toBe(404);
    expect(db.calls).not.toContain('order_edit_requests.insert');
  });

  it('raises an edit_request alert linked to the order', async () => {
    await postJson(`/estimate/${TOKEN}/edit-request`, { message: 'Cordless please' });
    expect(db.notifications).toEqual([
      {
        kind: 'edit_request',
        order_id: 'e1',
        order_number: 'F0307-126',
        customer_name: 'A B',
        amount: null,
        email_thread_id: null,
        subject: '',
      },
    ]);
  });

  it('raises no alert when the request is refused', async () => {
    db.order = { ...sentOrder(), status: 'awaiting_payment' };
    await postJson(`/estimate/${TOKEN}/edit-request`, { message: 'too late' });
    expect(db.notifications).toHaveLength(0);
  });

  it('sends no email — the order page is where staff see the request', async () => {
    await postJson(`/estimate/${TOKEN}/edit-request`, { message: 'no email please' });
    expect(sentEmails).toHaveLength(0);
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

describe('POST /public/estimate/:token/view', () => {
  it('stamps customer_viewed_at and logs on the first open', async () => {
    const res = await req(`/estimate/${TOKEN}/view`, 'POST');
    expect(res.status).toBe(200);
    expect(db.calls).toContain('order_logs.insert');
    expect(db.lastUpdate).toHaveProperty('customer_viewed_at');
  });

  it('is a no-op on a second open', async () => {
    db.order = { ...sentOrder(), customer_viewed_at: '2026-08-01T10:00:00.000Z' };
    const res = await req(`/estimate/${TOKEN}/view`, 'POST');
    expect(res.status).toBe(200);
    expect(db.calls).not.toContain('order_logs.insert');
  });

  it('is a no-op for a draft order', async () => {
    db.order = { ...sentOrder(), status: 'draft' };
    const res = await req(`/estimate/${TOKEN}/view`, 'POST');
    expect(res.status).toBe(200);
    expect(db.calls).not.toContain('order_logs.insert');
  });

  it('404s a malformed token without touching an order', async () => {
    const res = await req('/estimate/not-a-uuid/view', 'POST');
    expect(res.status).toBe(404);
    // Only the maintenance gate's settings read — no orders access, so a
    // junk token still reveals nothing about which tokens exist.
    expect(db.calls).toEqual(['company_settings.select']);
  });

  it('404s an unknown token', async () => {
    db.order = null;
    const res = await req(`/estimate/${TOKEN}/view`, 'POST');
    expect(res.status).toBe(404);
  });
});

describe('customer action logs', () => {
  it('logs the confirm as a customer action', async () => {
    const res = await req(`/estimate/${TOKEN}/confirm`, 'POST');
    expect(res.status).toBe(200);
    expect(db.calls).toContain('order_logs.insert');
  });

  it('logs a cancellation request as a customer action', async () => {
    db.order = awaitingOrder();
    const res = await req(`/estimate/${TOKEN}/cancel-request`, 'POST');
    expect(res.status).toBe(200);
    expect(db.calls).toContain('order_logs.insert');
  });

  it('logs a cancellation withdrawal as a customer action', async () => {
    db.order = awaitingOrder({ cancel_requested_at: '2026-08-01T10:00:00.000Z' });
    const res = await req(`/estimate/${TOKEN}/cancel-withdraw`, 'POST');
    expect(res.status).toBe(200);
    expect(db.calls).toContain('order_logs.insert');
  });
});

/* ------------------------------------------------------------------ */
/* Estimate revisions (migration 50)                                   */
/* ------------------------------------------------------------------ */

/** A visible blind line as stored, with staff-only columns present. */
function blindLine(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uid: 'u1',
    item_type: 'blind',
    room_name: 'Bedroom',
    blinds_type: 'Roller',
    panels: [100],
    height_cm: 150,
    material_name: 'Linen',
    cassette_name: null,
    bottom_rail_name: null,
    control_name: null,
    installation_name: null,
    color: '',
    title: '',
    description: '',
    note: '',
    addons: [],
    attributes: {},
    quantity: 1,
    unit_price: 100,
    line_total: 100,
    hidden: false,
    show_original_price: false,
    base_unit_price: 100,
    locked_base_price: 100,
    locked_inputs_fingerprint: 'fp',
    ...over,
  };
}

/** A sent order carrying one blind line at the given height and total. */
function orderWith(height: number, total: number, over: Record<string, unknown> = {}) {
  return { ...sentOrder(), total, line_items: [blindLine({ height_cm: height })], ...over };
}

/**
 * A stored revision of order `e1`, snapshotting `order`. The fake returns
 * EVERY column regardless of the select list — `source` included — so a
 * route that spread the row would leak it here even though the real
 * select excludes it.
 */
function revision(revNo: number, order: Record<string, unknown>): Record<string, unknown> {
  const snapshot = buildPublicQuote(order);
  return {
    id: `r${revNo}`,
    order_id: 'e1',
    rev_no: revNo,
    sent_at: `2026-10-2${revNo}T10:00:00.000Z`,
    source_kind: 'email',
    total: snapshot.total,
    snapshot,
    source: {
      order: { title: null, discount_type: 'fixed', discount_value: 0 },
      line_items: order.line_items,
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Payload = { data: Record<string, any>; error?: string };

describe('estimate revisions on the public page', () => {
  it('serves the latest snapshot, not live edits, while sent', async () => {
    db.revisions = [revision(1, orderWith(150, 113))];
    db.order = orderWith(160, 200);
    const body = (await (await req(`/estimate/${TOKEN}`)).json()) as Payload;
    expect(body.data.line_items[0].height_cm).toBe(150);
    expect(body.data.total).toBe(113);
    expect(body.data.revision).toEqual({ rev_no: 1, sent_at: '2026-10-21T10:00:00.000Z' });
  });

  it('serves the snapshot on an expired estimate too', async () => {
    db.revisions = [revision(1, orderWith(150, 113))];
    db.order = orderWith(160, 200, { expiry_date: '2000-01-01' });
    const body = (await (await req(`/estimate/${TOKEN}`)).json()) as Payload;
    expect(body.data.status).toBe('expired');
    expect(body.data.line_items[0].height_cm).toBe(150);
  });

  it('falls back to live data when the order has no revision', async () => {
    db.order = orderWith(160, 200);
    const body = (await (await req(`/estimate/${TOKEN}`)).json()) as Payload;
    expect(body.data.line_items[0].height_cm).toBe(160);
    expect(body.data.revision).toBeNull();
    expect(body.data.revisions).toEqual([]);
    expect(body.data.changes_since_previous).toEqual([]);
  });

  it('serves live data once confirmed', async () => {
    db.revisions = [revision(1, orderWith(150, 113))];
    db.order = {
      ...orderWith(160, 200),
      status: 'awaiting_payment',
      confirmed_at: '2026-10-22T10:00:00.000Z',
    };
    const body = (await (await req(`/estimate/${TOKEN}`)).json()) as Payload;
    expect(body.data.line_items[0].height_cm).toBe(160);
    expect(body.data.total).toBe(200);
  });

  it('computes balance and deposit_due from the served total', async () => {
    db.revisions = [revision(1, orderWith(150, 113))];
    db.order = orderWith(160, 200, { payments: [{ amount: 50, paid_on: '2026-10-22' }] });
    const body = (await (await req(`/estimate/${TOKEN}`)).json()) as Payload;
    expect(body.data.balance).toBe(63);
    expect(body.data.deposit_due).toBe(56.5);
  });

  it('lists changes_since_previous for Rev 2', async () => {
    db.revisions = [revision(1, orderWith(150, 113)), revision(2, orderWith(160, 113))];
    db.order = orderWith(160, 113);
    const body = (await (await req(`/estimate/${TOKEN}`)).json()) as Payload;
    expect(body.data.revision.rev_no).toBe(2);
    expect(body.data.revisions).toEqual([
      { rev_no: 2, sent_at: '2026-10-22T10:00:00.000Z' },
      { rev_no: 1, sent_at: '2026-10-21T10:00:00.000Z' },
    ]);
    expect(body.data.changes_since_previous).toEqual(['Bedroom — Roller: Height 150 cm → 160 cm']);
  });

  it('answers 500 rather than falling back to live data when revisions are unreadable', async () => {
    db.revisionsFail = true;
    db.order = orderWith(160, 200);
    const res = await req(`/estimate/${TOKEN}`);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('160');
  });

  it('serves an old revision read-only and 404s an unknown one', async () => {
    db.revisions = [revision(1, orderWith(150, 113)), revision(2, orderWith(160, 113))];
    db.order = orderWith(160, 113);
    const res = await req(`/estimate/${TOKEN}/revisions/1`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Payload;
    expect(body.data.rev_no).toBe(1);
    expect(body.data.read_only).toBe(true);
    expect(body.data.line_items[0].height_cm).toBe(150);
    expect(body.data.total).toBe(113);

    expect((await req(`/estimate/${TOKEN}/revisions/9`)).status).toBe(404);
    expect((await req(`/estimate/${TOKEN}/revisions/0`)).status).toBe(404);
    expect((await req(`/estimate/${TOKEN}/revisions/abc`)).status).toBe(404);
    expect((await req('/estimate/not-a-uuid/revisions/1')).status).toBe(404);
  });

  it('confirm stores accepted_revision_id = latest revision', async () => {
    db.revisions = [revision(1, orderWith(150, 113)), revision(2, orderWith(160, 113))];
    db.order = orderWith(160, 113);
    const res = await req(`/estimate/${TOKEN}/confirm`, 'POST');
    expect(res.status).toBe(200);
    expect(db.lastUpdate?.accepted_revision_id).toBe('r2');
    expect(db.logs).not.toContain('Customer confirmed Rev 2; later unsent changes are not part of it.');
  });

  it('confirm with unsent staff edits still succeeds and logs "Customer confirmed Rev 2; later unsent changes are not part of it."', async () => {
    db.revisions = [revision(1, orderWith(150, 113)), revision(2, orderWith(160, 113))];
    db.order = orderWith(170, 130);
    const res = await req(`/estimate/${TOKEN}/confirm`, 'POST');
    expect(res.status).toBe(200);
    expect(db.lastUpdate?.accepted_revision_id).toBe('r2');
    expect(db.logs).toContain('Customer confirmed Rev 2; later unsent changes are not part of it.');
  });

  it('a diverged confirm reports the ACCEPTED total to the customer and to staff, with a review note', async () => {
    db.revisions = [revision(1, orderWith(150, 113)), revision(2, orderWith(160, 113))];
    db.order = orderWith(170, 130);
    const res = await req(`/estimate/${TOKEN}/confirm`, 'POST');
    expect(res.status).toBe(200);
    expect(((await res.json()) as Payload).data.total).toBe(113);
    const notice = sentEmails.find((e) => e.to === 'biz@example.com');
    expect(notice?.html).toContain('$113.00');
    expect(notice?.html).not.toContain('$130.00');
    expect(notice?.html).toContain(
      'The current saved estimate differs from what the customer accepted — review before taking the deposit.'
    );
  });

  it('an in-sync confirm sends the plain notice with the order total', async () => {
    db.revisions = [revision(1, orderWith(160, 113))];
    db.order = orderWith(160, 113);
    const res = await req(`/estimate/${TOKEN}/confirm`, 'POST');
    expect(((await res.json()) as Payload).data.total).toBe(113);
    const notice = sentEmails.find((e) => e.to === 'biz@example.com');
    expect(notice?.html).toContain('$113.00');
    expect(notice?.html).not.toContain('differs from what the customer accepted');
  });

  it('confirm with the rev_no the page showed succeeds', async () => {
    db.revisions = [revision(1, orderWith(150, 113)), revision(2, orderWith(160, 113))];
    db.order = orderWith(160, 113);
    const res = await postJson(`/estimate/${TOKEN}/confirm`, { rev_no: 2 });
    expect(res.status).toBe(200);
    expect(db.lastUpdate?.accepted_revision_id).toBe('r2');
  });

  it('confirm with a stale rev_no is 409 and writes nothing', async () => {
    db.revisions = [revision(1, orderWith(150, 113)), revision(2, orderWith(160, 113))];
    db.order = orderWith(160, 113);
    const res = await postJson(`/estimate/${TOKEN}/confirm`, { rev_no: 1 });
    expect(res.status).toBe(409);
    expect(((await res.json()) as Payload).error).toBe(
      'This estimate was just updated. Please review the latest version before confirming.'
    );
    expect(db.updated).toBe(false);
    expect(db.logs).toEqual([]);
    expect(db.notifications).toEqual([]);
  });

  it('confirm without a rev_no, or with a malformed one, still confirms (older pages)', async () => {
    db.revisions = [revision(1, orderWith(160, 113))];
    db.order = orderWith(160, 113);
    expect((await req(`/estimate/${TOKEN}/confirm`, 'POST')).status).toBe(200);
    for (const body of [{}, { rev_no: 'two' }, { rev_no: 0 }, { rev_no: 1.5 }, 'not json']) {
      db.order = orderWith(160, 113);
      const res =
        typeof body === 'string'
          ? await publicApp.request(
            `/estimate/${TOKEN}/confirm`,
            {
              method: 'POST',
              headers: { 'CF-Connecting-IP': `10.0.0.${++ipSeq}`, 'Content-Type': 'application/json' },
              body,
            },
            ENV
          )
          : await postJson(`/estimate/${TOKEN}/confirm`, body);
      expect(res.status).toBe(200);
    }
  });

  it('once confirmed, a live quote that left the latest revision carries no version chip or change lines', async () => {
    db.revisions = [revision(1, orderWith(150, 113)), revision(2, orderWith(160, 113))];
    db.order = { ...orderWith(170, 130), status: 'awaiting_payment', confirmed_at: '2026-10-23T10:00:00.000Z' };
    const body = (await (await req(`/estimate/${TOKEN}`)).json()) as Payload;
    expect(body.data.line_items[0].height_cm).toBe(170);
    expect(body.data.revision).toBeNull();
    expect(body.data.changes_since_previous).toEqual([]);
    expect(body.data.revisions).toHaveLength(2);
  });

  it('once confirmed, a live quote still equal to the latest revision keeps its version fields', async () => {
    db.revisions = [revision(1, orderWith(150, 113)), revision(2, orderWith(160, 113))];
    db.order = { ...orderWith(160, 113), status: 'awaiting_payment', confirmed_at: '2026-10-23T10:00:00.000Z' };
    const body = (await (await req(`/estimate/${TOKEN}`)).json()) as Payload;
    expect(body.data.revision).toEqual({ rev_no: 2, sent_at: '2026-10-22T10:00:00.000Z' });
    expect(body.data.changes_since_previous).toEqual(['Bedroom — Roller: Height 150 cm → 160 cm']);
  });

  it('confirm on an order with no revision records a null accepted revision', async () => {
    const res = await req(`/estimate/${TOKEN}/confirm`, 'POST');
    expect(res.status).toBe(200);
    expect(db.lastUpdate?.accepted_revision_id).toBeNull();
  });

  it('confirm answers 500 and writes nothing when revisions are unreadable', async () => {
    db.revisionsFail = true;
    const res = await req(`/estimate/${TOKEN}/confirm`, 'POST');
    expect(res.status).toBe(500);
    expect(db.updated).toBe(false);
  });

  it('never exposes uid or the staff source copy in any public payload', async () => {
    db.revisions = [revision(1, orderWith(150, 113)), revision(2, orderWith(160, 113))];
    db.order = orderWith(160, 113);
    const bodies = [
      await (await req(`/estimate/${TOKEN}`)).text(),
      await (await req(`/estimate/${TOKEN}/revisions/1`)).text(),
      await (await req(`/estimate/${TOKEN}/confirm`, 'POST')).text(),
    ];
    for (const text of bodies) {
      expect(text).not.toContain('"uid"');
      expect(text).not.toContain('"source"');
      expect(text).not.toContain('source_kind');
      expect(text).not.toContain('locked_base_price');
      expect(text).not.toContain('"r1"');
      expect(text).not.toContain('"r2"');
    }
  });

  it('never forwards an unknown key stored in a snapshot', async () => {
    const rev = revision(1, orderWith(150, 113));
    const snapshot = rev.snapshot as Record<string, unknown> & { line_items: Record<string, unknown>[] };
    rev.snapshot = {
      ...snapshot,
      internal_margin: 42,
      line_items: snapshot.line_items.map((l) => ({ ...l, supplier_cost: 7 })),
    };
    db.order = orderWith(150, 113);
    // Rev 1 as the latest (the main page serves it), then as an earlier
    // version once Rev 2 exists.
    db.revisions = [rev];
    const bodies = [await (await req(`/estimate/${TOKEN}`)).text()];
    db.revisions = [rev, revision(2, orderWith(160, 113))];
    bodies.push(await (await req(`/estimate/${TOKEN}/revisions/1`)).text());
    for (const text of bodies) {
      expect(text).toContain('"height_cm":150');
      expect(text).not.toContain('internal_margin');
      expect(text).not.toContain('supplier_cost');
    }
  });
});

describe('rate limiting', () => {
  it('returns 429 once the per-minute budget is spent from one IP', async () => {
    const ip = '203.0.113.7';
    const statuses: number[] = [];
    for (let i = 0; i <= PUBLIC_RATE_LIMIT; i++) {
      const res = await req(`/estimate/${TOKEN}`, 'GET', ip);
      statuses.push(res.status);
    }
    expect(statuses.slice(0, PUBLIC_RATE_LIMIT).every((s) => s === 200)).toBe(true);
    expect(statuses[PUBLIC_RATE_LIMIT]).toBe(429);
  });
});

describe('maintenance mode gate', () => {
  it('refuses every public route with 503 while maintenance_mode is on', async () => {
    db.company.maintenance_mode = true;
    const routes: Array<[string, string]> = [
      ['GET', `/estimate/${TOKEN}`],
      ['POST', `/estimate/${TOKEN}/view`],
      ['POST', `/estimate/${TOKEN}/confirm`],
      ['POST', `/estimate/${TOKEN}/cancel-request`],
      ['POST', `/estimate/${TOKEN}/cancel-withdraw`],
      ['GET', `/appointment/${TOKEN}`],
      ['POST', `/appointment/${TOKEN}/confirm`],
      ['POST', `/appointment/${TOKEN}/request`],
    ];
    for (const [method, path] of routes) {
      const res = await req(path, method);
      expect(res.status, path).toBe(503);
      expect(((await res.json()) as { maintenance?: boolean }).maintenance, path).toBe(true);
    }
  });

  it('serves the configured message, falling back to a default line', async () => {
    db.company.maintenance_mode = true;
    db.company.maintenance_message = 'Back at 3pm — sorry!';
    const withMsg = (await (await req(`/estimate/${TOKEN}`)).json()) as { message: string };
    expect(withMsg.message).toBe('Back at 3pm — sorry!');

    db.company.maintenance_message = '';
    const fallback = (await (await req(`/estimate/${TOKEN}`)).json()) as { message: string };
    expect(fallback.message.length).toBeGreaterThan(0);
  });

  it('changes no order state while closed', async () => {
    db.company.maintenance_mode = true;
    await req(`/estimate/${TOKEN}/confirm`, 'POST');
    expect(db.updated).toBe(false);
    expect(db.calls).not.toContain('orders.update');
  });

  it('leaves every route working when the flag is off', async () => {
    const res = await req(`/estimate/${TOKEN}`);
    expect(res.status).toBe(200);
  });
});
