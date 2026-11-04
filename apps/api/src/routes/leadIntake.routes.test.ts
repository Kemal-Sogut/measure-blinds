// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Route tests for the public website lead intake (`POST /intake/lead`),
 * run against a scripted fake Supabase client and a stubbed `fetch`
 * (Resend and Turnstile).
 *
 * What these pin:
 *   - a valid submission with an unknown email creates a customer, then a
 *     lead linked to it (`customer_match: 'created'`), then an alert row, then
 *     the shop email with Reply-To set to the visitor
 *   - a known email links the existing customer and fills only its blanks
 *   - the response is the same constant `201 {ok:true}` in every success
 *     case, bots included, and a bot writes nothing
 *   - Turnstile is enforced only when `TURNSTILE_SECRET` is set
 *   - a failed customer or lead write is a 500, and a failed email is NOT
 *     (persist-then-alert)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FORM_PAYLOAD } from '../lib/leadFixture';

/** One recorded supabase-js call chain. */
interface Op {
  table: string;
  calls: Array<[string, unknown[]]>;
}

/** Fake database state the scripted client reads and records into. */
const db = {
  ops: [] as Op[],
  existing: [] as Array<Record<string, unknown>>,
  companyEmail: 'shop@example.com',
  failCustomerInsert: false,
  failLeadInsert: false,
};

/** Resolves a finished chain to what PostgREST would return for it. */
function resolve(op: Op): { data: unknown; error: { message: string } | null } {
  const has = (name: string) => op.calls.some(([n]) => n === name);
  if (op.table === 'customers' && has('ilike')) return { data: db.existing, error: null };
  if (op.table === 'customers' && has('insert')) {
    return db.failCustomerInsert ? { data: null, error: { message: 'boom' } } : { data: { id: 'new-cust' }, error: null };
  }
  if (op.table === 'leads' && has('insert')) {
    return db.failLeadInsert ? { data: null, error: { message: 'boom' } } : { data: { id: 'lead-1' }, error: null };
  }
  if (op.table === 'company_settings') return { data: { email: db.companyEmail }, error: null };
  return { data: null, error: null };
}

/** Thenable builder: every method records itself and returns the builder. */
function builder(table: string) {
  const op: Op = { table, calls: [] };
  db.ops.push(op);
  const b: Record<string, unknown> = {};
  for (const name of ['select', 'ilike', 'is', 'order', 'limit', 'insert', 'update', 'eq']) {
    b[name] = (...args: unknown[]) => {
      op.calls.push([name, args]);
      return b;
    };
  }
  b.single = () => Promise.resolve(resolve(op));
  (b as { then: unknown }).then = (onF: (v: unknown) => unknown) => Promise.resolve(onF(resolve(op)));
  return b;
}

vi.mock('../lib/supabase', () => ({
  createSupabaseAdmin: () => ({ from: (t: string) => builder(t) }),
}));

import intakeApp from './leadIntake';

const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
  RESEND_API_KEY: 'not-a-real-key',
  APP_URL: 'https://app.example',
  ENVIRONMENT: 'test',
};

const fetchMock = vi.fn();

/** Posts a body to the route, with a unique IP per call so the rate limiter stays out of the way. */
let ipSeq = 0;
function post(body: unknown, env: Record<string, unknown> = ENV) {
  ipSeq += 1;
  return intakeApp.request(
    '/lead',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.0.0.${ipSeq}` },
      body: JSON.stringify(body),
    },
    env
  );
}

/** The recorded payload of the first `insert` on `table`. */
function inserted(table: string): Record<string, unknown> | undefined {
  const op = db.ops.find((o) => o.table === table && o.calls.some(([n]) => n === 'insert'));
  return op?.calls.find(([n]) => n === 'insert')?.[1][0] as Record<string, unknown> | undefined;
}

beforeEach(() => {
  db.ops = [];
  db.existing = [];
  db.companyEmail = 'shop@example.com';
  db.failCustomerInsert = false;
  db.failLeadInsert = false;
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'email-1', success: true }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('POST /intake/lead', () => {
  it('creates a customer, then the linked lead, alert and shop email', async () => {
    const res = await post(FORM_PAYLOAD);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });

    expect(inserted('customers')).toMatchObject({
      first_name: 'Jane',
      email: 'jane.doe@example.com',
      phone: '(613) 555-0123',
      shipping_city: 'Ottawa',
    });
    expect(inserted('leads')).toMatchObject({
      customer_id: 'new-cust',
      customer_match: 'created',
      coverings: ['zebra', 'roller'],
      message: 'Bay window in the living room.',
      postal_code: 'K1A 0B1',
    });
    expect(inserted('notifications')).toMatchObject({ kind: 'lead_received', lead_id: 'lead-1', customer_name: 'Jane Doe' });

    const tables = db.ops.map((o) => o.table);
    expect(tables.indexOf('customers')).toBeLessThan(tables.indexOf('leads'));

    const resend = fetchMock.mock.calls.find(([url]) => String(url).includes('resend.com'));
    const sent = JSON.parse(resend![1].body as string);
    expect(sent.to).toEqual(['shop@example.com']);
    expect(sent.reply_to).toBe('jane.doe@example.com');
    expect(db.ops.some((o) => o.table === 'leads' && o.calls.some(([n]) => n === 'update'))).toBe(true);
  });

  it('matches an existing customer by email and fills only blank fields', async () => {
    db.existing = [{ id: 'old-cust', first_name: 'Janet', last_name: 'Doe', phone: '', shipping_address_line1: '9 Oak' }];
    const res = await post(FORM_PAYLOAD);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });

    const lookup = db.ops.find((o) => o.table === 'customers' && o.calls.some(([n]) => n === 'ilike'))!;
    expect(lookup.calls).toContainEqual(['ilike', ['email', 'jane.doe@example.com']]);
    expect(lookup.calls).toContainEqual(['is', ['deleted_at', null]]);

    expect(inserted('customers')).toBeUndefined();
    const update = db.ops.find((o) => o.table === 'customers' && o.calls.some(([n]) => n === 'update'))!;
    expect(update.calls.find(([n]) => n === 'update')![1][0]).toEqual({ phone: '(613) 555-0123' });
    expect(inserted('leads')).toMatchObject({ customer_id: 'old-cust', customer_match: 'matched' });
  });

  it('stores a space-less postal code in K1A 0B1 form', async () => {
    await post({ ...FORM_PAYLOAD, postal_code: 'k1a0b1' });
    expect(inserted('leads')).toMatchObject({ postal_code: 'K1A 0B1' });
    expect(inserted('customers')).toMatchObject({ shipping_postal_code: 'K1A 0B1' });
  });

  it('escapes ILIKE wildcards in the email', async () => {
    await post({ ...FORM_PAYLOAD, email: 'jane_doe@example.com' });
    const lookup = db.ops.find((o) => o.table === 'customers' && o.calls.some(([n]) => n === 'ilike'))!;
    expect(lookup.calls).toContainEqual(['ilike', ['email', 'jane\\_doe@example.com']]);
  });

  it.each([
    ['honeypot', { website: 'http://spam.example' }],
    ['too fast', { fill_ms: 800 }],
  ])('answers a bot (%s) with the same 201 and stores nothing', async (_l, patch) => {
    const res = await post({ ...FORM_PAYLOAD, ...patch });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    expect(db.ops).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid payload with the field that failed', async () => {
    const res = await post({ ...FORM_PAYLOAD, postal_code: '90210' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ field: 'postal_code' });
    expect(db.ops).toHaveLength(0);
  });

  it('rejects a body that is not JSON', async () => {
    const res = await intakeApp.request('/lead', { method: 'POST', body: 'name=x' }, ENV);
    expect(res.status).toBe(400);
  });

  it('skips Turnstile while no secret is set, and enforces it once one is', async () => {
    expect((await post(FORM_PAYLOAD)).status).toBe(201);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('turnstile'))).toBe(false);

    db.ops = [];
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('turnstile')
        ? new Response(JSON.stringify({ success: false }))
        : new Response('{}', { status: 200 })
    );
    const res = await post({ ...FORM_PAYLOAD, turnstile_token: 'bad' }, { ...ENV, TURNSTILE_SECRET: 'sec' });
    expect(res.status).toBe(403);
    expect(db.ops).toHaveLength(0);
  });

  it('accepts a valid Turnstile token when a secret is set', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
    const res = await post({ ...FORM_PAYLOAD, turnstile_token: 'good' }, { ...ENV, TURNSTILE_SECRET: 'sec' });
    expect(res.status).toBe(201);
  });

  it('is a 500 when the customer cannot be created, and no lead is written', async () => {
    db.failCustomerInsert = true;
    expect((await post(FORM_PAYLOAD)).status).toBe(500);
    expect(inserted('leads')).toBeUndefined();
  });

  it('is a 500 when the lead cannot be stored', async () => {
    db.failLeadInsert = true;
    expect((await post(FORM_PAYLOAD)).status).toBe(500);
  });

  it('still succeeds when the shop email fails (persist-then-alert)', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ message: 'quota' }), { status: 429 }));
    const res = await post(FORM_PAYLOAD);
    expect(res.status).toBe(201);
    expect(db.ops.some((o) => o.table === 'leads' && o.calls.some(([n]) => n === 'update'))).toBe(false);
  });

  it('rate-limits one IP after five submissions a minute', async () => {
    const send = () =>
      intakeApp.request(
        '/lead',
        { method: 'POST', headers: { 'CF-Connecting-IP': '10.9.9.9' }, body: JSON.stringify(FORM_PAYLOAD) },
        ENV
      );
    for (let i = 0; i < 5; i += 1) expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(429);
  });
});
