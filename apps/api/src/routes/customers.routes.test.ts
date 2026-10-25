// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Route-level tests for the customers module against a scripted fake
 * Supabase client.
 *
 * Two subjects live here. The first is the CREATE contract, which
 * changed on 2026-08-01: first and last name became optional so a
 * customer can be entered from a phone number alone. What those pin:
 *   - a customer with only an email, only a phone, or only one name is
 *     accepted (the previous schema 400'd all three)
 *   - a create with no identifying field at all is still refused, and
 *     with a sentence the form can show verbatim — the refinement has an
 *     empty issue path, so this also covers `firstZodIssue`'s carve-out
 *   - `.strict()` still rejects unknown fields (client-supplied columns
 *     must never be silently accepted)
 *   - the UPDATE schema stays unrefined, so an address-only PATCH is not
 *     forced to restate an identifier it is not touching
 *
 * The second is the multi-estimate send (`POST /:id/send-estimates`),
 * which emails ONE customer link covering several estimates and flips
 * each selected draft to `sent`. What those pin:
 *   - exactly one email per request, and the whole selection written
 *   - the status write happens BEFORE the price freeze, sequentially per
 *     row (a row left `draft` with frozen items would be re-priced by the
 *     next save; `sent` holds the lock, so that half-write is the safe one)
 *   - an already-sent row is named in the email but never written
 *   - `liveCount` is what the customer link will show after the send, not
 *     how many estimates were ticked
 *   - email-then-persist (AI_GUIDELINES §2): a failed send is a 502 with
 *     not one database write
 *   - a selection the server refuses 400s with a sentence that NAMES the
 *     offending estimate's order number, so the consultant can see which
 *     ticked row to untick
 *   - the body is `.strict()`, so a client-supplied money field 400s
 *     (AI_GUIDELINES §1) — as do duplicate, missing, excess and malformed
 *     ids and an over-long message
 *   - a row the database refused is reported under `failed` on a 200: the
 *     customer already holds the email, so the consultant is told which
 *     rows did not get marked rather than that nothing happened
 *
 * Resend is never reached: `../lib/email` is mocked so that `sendEmail`
 * is an inspectable `vi.fn()`, while every TEMPLATE function stays real —
 * the HTML assertions below therefore test the shipped template, not the
 * shape of a stub.
 *
 * Auth is not exercised: `requireAuth` is applied in `index.ts`, so
 * requests made directly against this sub-app are already past it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Rows returned per `<table>.<op>` key, plus a record of insert payloads. */
interface FakeDb {
  responses: Record<string, unknown[]>;
  insertPayloads: Record<string, unknown[]>;
  /** UPDATE payloads per table — proves a route did (or did not) write. */
  updatePayloads: Record<string, unknown[]>;
  /** Every filter/order call a route made, as `[table, method, args]`. */
  filters: Array<[string, string, unknown[]]>;
  /** Every resolved query as `<table>.<op>`, in order — proves sequencing. */
  calls: string[];
  /**
   * Failures returned instead of rows, keyed `<table>.<op>` as in
   * `orders.routes.test.ts`. The value is a QUEUE because the send loop
   * writes the same key once per row and a partial failure has to hit ONE
   * of them: each matching query consumes one entry, `null` lets that
   * query succeed, and an exhausted queue stops failing. So
   * `[null, { message: '…' }]` on `orders.update` fails the second status
   * write of a send and nothing else.
   *
   * `throws: true` makes that query REJECT instead of returning an error
   * row — supabase-js does that on a transport failure, and a route that
   * only inspects the returned `error` would lose the rest of its work.
   */
  opErrors: Record<string, Array<{ message: string; throws?: boolean } | null>>;
}
const db: FakeDb = {
  responses: {},
  insertPayloads: {},
  updatePayloads: {},
  filters: [],
  calls: [],
  opErrors: {},
};

/**
 * Minimal thenable builder mimicking the supabase-js chain: every
 * chained method returns `this`, and awaiting resolves the scripted rows
 * for the table/op pair.
 *
 * Filter arguments are not APPLIED — one scripted response serves every
 * query against a table — but they ARE recorded in `db.filters`, which is
 * how a test proves which rows a route asked for (that a soft-deleted
 * customer was excluded, that an untouched estimate was never frozen).
 * `is` is recorded alongside the value filters precisely so the
 * `deleted_at is null` guard is assertable: without it a 404 test could
 * only prove that an empty row set 404s, never that the route asked the
 * database to exclude soft-deleted customers in the first place. A
 * `select(..., { head: true })` resolves `count` from the
 * `<table>.count` key instead of row data, as `countActiveEstimates` needs.
 */
function makeBuilder(table: string) {
  const state = { table, op: 'select', head: false };
  const builder: Record<string, unknown> = {};
  const chain = (name: string) =>
    ((...args: unknown[]) => {
      if (['insert', 'update', 'delete'].includes(name)) state.op = name;
      if (name === 'insert') (db.insertPayloads[state.table] ??= []).push(args[0]);
      if (name === 'update') (db.updatePayloads[state.table] ??= []).push(args[0]);
      if (['eq', 'in', 'is', 'gte', 'order'].includes(name)) db.filters.push([state.table, name, args]);
      return builder;
    }) as unknown;
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'is', 'gte', 'or', 'order', 'limit']) {
    builder[m] = chain(m);
  }
  (builder.select as unknown) = (_columns?: string, opts?: { count?: string; head?: boolean }) => {
    if (opts?.head) state.head = true;
    return builder;
  };
  const resolve = () => {
    const key = `${state.table}.${state.op}`;
    db.calls.push(key);
    const failure = db.opErrors[key]?.shift();
    if (failure?.throws) throw new Error(failure.message);
    if (failure) return { data: null, error: failure };
    return { data: db.responses[key] ?? [], error: null };
  };
  builder.single = async () => {
    const r = resolve();
    return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
  };
  builder.maybeSingle = builder.single;
  (builder as { then: unknown }).then = (onFulfilled: (v: unknown) => unknown) => {
    const r = resolve();
    const count = state.head ? ((db.responses[`${state.table}.count`]?.[0] as number) ?? 0) : null;
    return Promise.resolve(onFulfilled({ ...r, count }));
  };
  return builder;
}

vi.mock('../lib/supabase', () => ({
  createSupabaseAdmin: () => ({ from: (table: string) => makeBuilder(table) }),
}));

/** The mocked transport. Hoisted so the `vi.mock` factory can close over it. */
const { sendEmailMock } = vi.hoisted(() => ({ sendEmailMock: vi.fn() }));

vi.mock('../lib/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/email')>()),
  sendEmail: sendEmailMock,
}));

import customersApp from './customers';

const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
  RESEND_API_KEY: 'not-a-real-key',
  APP_URL: 'http://localhost:5173',
  ENVIRONMENT: 'test',
};

const CUSTOMER = { id: 'c1', first_name: '', last_name: '', email: '', phone: '' };

beforeEach(() => {
  db.insertPayloads = {};
  db.updatePayloads = {};
  db.filters = [];
  db.calls = [];
  db.opErrors = {};
  sendEmailMock.mockReset();
  db.responses = {
    'customers.insert': [CUSTOMER],
    'customers.update': [CUSTOMER],
    'customers.select': [CUSTOMER],
  };
});

/** Sends a JSON body to the customers sub-app. */
const send = (path: string, method: string, body: unknown) =>
  customersApp.request(
    path,
    { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } },
    ENV
  );

describe('POST /api/customers validation', () => {
  it('accepts a customer with an email and no names', async () => {
    const res = await send('/', 'POST', { first_name: '', last_name: '', email: 'a@b.com' });
    expect(res.status).toBe(201);
  });

  it('accepts a customer with a phone and no names', async () => {
    const res = await send('/', 'POST', { first_name: '', last_name: '', phone: '4165550100' });
    expect(res.status).toBe(201);
  });

  it('accepts a first name alone', async () => {
    const res = await send('/', 'POST', { first_name: 'Ada' });
    expect(res.status).toBe(201);
  });

  it('accepts a last name alone', async () => {
    const res = await send('/', 'POST', { last_name: 'Lovelace' });
    expect(res.status).toBe(201);
  });

  it('rejects a create with no identifying field at all', async () => {
    const res = await send('/', 'POST', { first_name: '', last_name: '', email: '', phone: '' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Enter a name, email or phone number.');
  });

  it('rejects a create whose only fields are whitespace', async () => {
    const res = await send('/', 'POST', { first_name: '  ', last_name: ' ' });
    expect(res.status).toBe(400);
  });

  it('still rejects client-supplied unknown fields', async () => {
    const res = await send('/', 'POST', { first_name: 'Ada', nickname: 'A' });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/customers/:id validation', () => {
  it('accepts an address-only update with no identifying field', async () => {
    const res = await send('/c1', 'PUT', { shipping_city: 'Toronto' });
    expect(res.status).toBe(200);
  });

  it('accepts blanking both names on an existing customer', async () => {
    const res = await send('/c1', 'PUT', { first_name: '', last_name: '' });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/customers/:id/public-link', () => {
  it('returns the existing token without writing', async () => {
    db.responses['customers.select'] = [{ id: 'c1', public_token: 'tok-1' }];
    const res = await customersApp.request('/c1/public-link', { method: 'POST' }, ENV);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { public_token: string } }).data.public_token).toBe('tok-1');
    expect(db.updatePayloads['customers']).toBeUndefined();
  });

  it('404s for an unknown customer', async () => {
    db.responses['customers.select'] = [];
    const res = await customersApp.request('/nope/public-link', { method: 'POST' }, ENV);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/customers/:id/sendable-estimates', () => {
  const today = new Date().toISOString().slice(0, 10);
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'o1',
    order_number: 'M2010-126',
    title: 'Living room',
    status: 'draft',
    order_date: '2026-10-01',
    expiry_date: '2026-12-01',
    total: '1234.50',
    line_items: [{ id: 'li1' }],
    ...over,
  });
  const get = () => customersApp.request('/c1/sendable-estimates', { method: 'GET' }, ENV);
  type Body = { data: Array<Record<string, unknown>> };

  it('looks the customer up by id, excluding soft-deleted rows', async () => {
    db.responses['orders.select'] = [row()];
    expect((await get()).status).toBe(200);
    expect(db.filters).toContainEqual(['customers', 'eq', ['id', 'c1']]);
    expect(db.filters).toContainEqual(['customers', 'is', ['deleted_at', null]]);
  });

  it('asks for this customer, draft+sent, expiry from today, newest-created first', async () => {
    db.responses['orders.select'] = [row()];
    const res = await get();
    expect(res.status).toBe(200);
    expect(db.filters).toContainEqual(['orders', 'eq', ['customer_id', 'c1']]);
    expect(db.filters).toContainEqual(['orders', 'in', ['status', ['draft', 'sent']]]);
    expect(db.filters).toContainEqual(['orders', 'gte', ['expiry_date', today]]);
    expect(db.filters).toContainEqual(['orders', 'order', ['created_at', { ascending: false }]]);
  });

  it('returns exactly the dialog fields, with no item count or sort key', async () => {
    db.responses['orders.select'] = [row({ created_at: '2026-10-02T00:00:00Z' })];
    const body = (await (await get()).json()) as Body;
    expect(body.data).toEqual([
      {
        id: 'o1',
        order_number: 'M2010-126',
        title: 'Living room',
        status: 'draft',
        order_date: '2026-10-01',
        expiry_date: '2026-12-01',
        total: 1234.5,
      },
    ]);
  });

  it('drops rows with no line items', async () => {
    db.responses['orders.select'] = [row({ id: 'empty', line_items: [] }), row({ id: 'full' })];
    const body = (await (await get()).json()) as Body;
    expect(body.data.map((r) => r.id)).toEqual(['full']);
  });

  it('returns total as a number', async () => {
    db.responses['orders.select'] = [row({ total: '1234.50' })];
    const body = (await (await get()).json()) as Body;
    expect(body.data[0]?.total).toBe(1234.5);
  });

  it('404s for an unknown or soft-deleted customer, without listing estimates', async () => {
    db.responses['customers.select'] = [];
    db.responses['orders.select'] = [row()];
    const res = await get();
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe('Customer not found');
    // The soft-delete guard is part of the lookup, not an afterthought: a
    // customer row that exists but is soft-deleted must 404 too, which is
    // only true because the query carries `deleted_at is null`.
    expect(db.filters).toContainEqual(['customers', 'is', ['deleted_at', null]]);
    expect(db.filters.some(([table]) => table === 'orders')).toBe(false);
  });
});

describe('POST /api/customers/:id/send-estimates', () => {
  /** Valid uuids — `order_ids` is uuid-validated, so 'o1' would 400. */
  const O1 = '11111111-1111-4111-8111-111111111111';
  const O2 = '22222222-2222-4222-8222-222222222222';
  const O3 = '33333333-3333-4333-8333-333333333333';

  /**
   * A sendable candidate row. `public_token` is pre-set so
   * `ensureOrderToken` mints nothing — the `orders.update` payloads below
   * are then exactly the status writes the send performed. `expiry_date`
   * is far future so no test lapses with the calendar.
   */
  const orderRow = (over: Record<string, unknown> = {}) => ({
    id: O1,
    order_number: 'M2010-126',
    title: 'Living room',
    customer_id: 'c1',
    status: 'draft',
    expiry_date: '2099-12-01',
    // Stamped onto `quoted_total` by the send (migration 48).
    total: 123,
    public_token: 'otok-1',
    terms_snapshot: null,
    line_items: [{ id: 'li1' }],
    ...over,
  });

  /** One unlocked line item, so `freezeOrderPrices` actually writes. */
  const LINE_ITEM = {
    id: 'li1',
    order_id: O1,
    item_type: 'blind',
    blinds_type: 'Roller',
    panels: [100],
    height_cm: 150,
    unit_price: 100,
    base_unit_price: null,
    locked_base_price: null,
    attributes: {},
  };

  const post = (body: unknown, id = 'c1') =>
    customersApp.request(
      `/${id}/send-estimates`,
      { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } },
      ENV
    );

  type SendBody = {
    data: {
      sent: string[];
      announced: string[];
      failed: Array<{ id: string; error: string }>;
      customer_token: string;
    };
  };

  /** The `EmailRequest` the route handed to the mocked `sendEmail`. */
  const lastEmail = () =>
    sendEmailMock.mock.calls.at(-1)?.[1] as {
      to: string;
      subject: string;
      html: string;
      attachments?: unknown;
    };

  beforeEach(() => {
    db.responses['customers.select'] = [
      { id: 'c1', first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.com', public_token: 'ctok-1' },
    ];
    db.responses['orders.select'] = [orderRow()];
    db.responses['line_items.select'] = [LINE_ITEM];
    db.responses['company_settings.select'] = [
      { company_name: 'Blinds Nisa', terms_and_conditions: 'Company terms' },
    ];
  });

  it('sends ONE email and marks every selected draft sent', async () => {
    db.responses['orders.select'] = [
      orderRow(),
      orderRow({ id: O2, order_number: 'M2010-127' }),
      orderRow({ id: O3, order_number: 'M2010-128' }),
    ];
    const res = await post({ order_ids: [O1, O2, O3] });
    expect(res.status).toBe(200);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);

    const body = (await res.json()) as SendBody;
    expect(body.data.sent).toEqual([O1, O2, O3]);
    expect(body.data.announced).toEqual([]);
    expect(body.data.failed).toEqual([]);
    expect(body.data.customer_token).toBe('ctok-1');

    // The freeze really wrote the lock to line_items (one write per order),
    // not just the log line that says it did — and the migration-48 stamp
    // went down beside it, which is what the editor's price-update
    // notices are later measured against.
    const itemWrites = (db.updatePayloads['line_items'] ?? []) as Record<string, unknown>[];
    const lockWrites = itemWrites.filter((w) => 'locked_base_price' in w);
    expect(lockWrites).toHaveLength(3);
    for (const w of lockWrites) expect(w.locked_base_price).toBe(100);
    const stampWrites = itemWrites.filter((w) => 'quoted_base_price' in w);
    expect(stampWrites).toHaveLength(3);
    for (const w of stampWrites) expect(w.quoted_base_price).toBe(100);

    const orderWrites = (db.updatePayloads['orders'] ?? []) as Record<string, unknown>[];
    const statusWrites = orderWrites.filter((p) => 'status' in p);
    expect(statusWrites).toHaveLength(3);
    for (const payload of statusWrites) {
      expect(payload).toEqual({
        status: 'sent',
        sent_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        terms_snapshot: 'Company terms',
      });
    }
    // Each send also clears any dismissal: a new quote, so a price that
    // moves away from it has to speak up again.
    expect(orderWrites.filter((p) => 'quoted_total' in p)).toEqual([
      { quoted_total: 123, quoted_notice_ack_total: null },
      { quoted_total: 123, quoted_notice_ack_total: null },
      { quoted_total: 123, quoted_notice_ack_total: null },
    ]);

    // The customer link is the only place the figures live: no PDF rides along.
    expect(lastEmail().to).toBe('ada@example.com');
    expect('attachments' in lastEmail()).toBe(false);
    expect(lastEmail().html).toContain('/c/ctok-1');
  });

  it('writes status before freezing prices', async () => {
    db.responses['orders.select'] = [orderRow(), orderRow({ id: O2, order_number: 'M2010-127' })];
    await post({ order_ids: [O1, O2] });
    // Interleaved, not batched: each row is written and only then frozen,
    // which also proves the loop is sequential rather than a Promise.all.
    // Per row: status, freeze, then the migration-48 stamp (its item
    // write, then the order's own quoted_total).
    expect(db.calls.filter((c) => c === 'orders.update' || c === 'line_items.update')).toEqual([
      'orders.update',
      'line_items.update',
      'line_items.update',
      'orders.update',
      'orders.update',
      'line_items.update',
      'line_items.update',
      'orders.update',
    ]);
  });

  it('leaves an already-sent row untouched and names it in the email', async () => {
    db.responses['orders.select'] = [
      orderRow(),
      orderRow({ id: O2, order_number: 'M2010-127', status: 'sent' }),
    ];
    const res = await post({ order_ids: [O1, O2] });
    expect(res.status).toBe(200);

    const body = (await res.json()) as SendBody;
    expect(body.data.sent).toEqual([O1]);
    expect(body.data.announced).toEqual([O2]);

    const orderWrites = (db.updatePayloads['orders'] ?? []) as Record<string, unknown>[];
    expect(orderWrites.filter((p) => 'status' in p)).toHaveLength(1);
    expect(db.filters).toContainEqual(['line_items', 'eq', ['order_id', O1]]);
    expect(db.filters).not.toContainEqual(['line_items', 'eq', ['order_id', O2]]);

    expect(lastEmail().html).toContain('M2010-126');
    expect(lastEmail().html).toContain('M2010-127');
  });

  it('names the estimates in the order they were selected', async () => {
    // Ticked already-sent FIRST, draft second. The plan splits those into
    // two buckets, and concatenating the buckets would swap them in the
    // email — the consultant's order is the contract (`SelectionPlan`).
    db.responses['orders.select'] = [
      orderRow(),
      orderRow({ id: O2, order_number: 'M2010-127', status: 'sent' }),
    ];
    await post({ order_ids: [O2, O1] });
    const html = lastEmail().html;
    expect(html).toContain('M2010-127');
    expect(html.indexOf('M2010-127')).toBeLessThan(html.indexOf('M2010-126'));
  });

  it('logs the send line and the price lock on a row that went through', async () => {
    // One draft plus one already-sent row: `total` counts the estimates
    // newly marked sent, NOT the two the email names.
    db.responses['orders.select'] = [
      orderRow(),
      orderRow({ id: O2, order_number: 'M2010-127', status: 'sent' }),
    ];
    await post({ order_ids: [O1, O2] });
    expect(db.insertPayloads['order_logs']).toEqual([
      {
        order_id: O1,
        message: 'Estimate emailed to ada@example.com (1 of 1 in one send).',
        source: 'staff',
      },
      { order_id: O1, message: 'Item prices locked at send.', source: 'staff' },
    ]);
  });

  it('logs the send but not the price lock when the freeze fails', async () => {
    db.opErrors['line_items.update'] = [{ message: 'freeze refused' }];
    const res = await post({ order_ids: [O1] });
    expect(res.status).toBe(200);

    const body = (await res.json()) as SendBody;
    // The row IS `sent` — `sent` holds the price lock, so this is the safe
    // half-write — but the consultant is told the freeze needs a retry.
    expect(body.data.sent).toEqual([O1]);
    expect(body.data.failed).toEqual([{ id: O1, error: 'freeze refused' }]);
    expect(db.insertPayloads['order_logs']).toEqual([
      {
        order_id: O1,
        message: 'Estimate emailed to ada@example.com (1 of 1 in one send).',
        source: 'staff',
      },
    ]);
  });

  it('keeps going when a status write throws instead of returning an error', async () => {
    db.responses['orders.select'] = [
      orderRow(),
      orderRow({ id: O2, order_number: 'M2010-127' }),
      orderRow({ id: O3, order_number: 'M2010-128' }),
    ];
    // [status o1, stamp o1, status o2] — the failure belongs to the second
    // row's STATUS write, and the migration-48 stamp sits between them.
    db.opErrors['orders.update'] = [null, null, { message: 'connection reset', throws: true }];
    const res = await post({ order_ids: [O1, O2, O3] });
    expect(res.status).toBe(200);

    // A rejection must not abort the rows after it, or the email would be
    // out with most of the selection still reading `draft` and nothing
    // in the response saying which.
    const body = (await res.json()) as SendBody;
    expect(body.data.sent).toEqual([O1, O3]);
    expect(body.data.failed).toEqual([{ id: O2, error: 'connection reset' }]);
  });

  it('counts what the link will show, not what was ticked', async () => {
    // Two live estimates already in the link, plus the one going out now.
    db.responses['orders.count'] = [2];
    db.responses['orders.select'] = [orderRow()];
    await post({ order_ids: [O1] });
    expect(lastEmail().html).toContain('You have 3');
    expect(lastEmail().html).not.toContain('You have 1');
  });

  it('returns 502 and writes nothing when the email fails', async () => {
    db.responses['orders.select'] = [orderRow(), orderRow({ id: O2, order_number: 'M2010-127' })];
    sendEmailMock.mockRejectedValueOnce(new Error('Resend is down'));
    const res = await post({ order_ids: [O1, O2] });
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toBe('Resend is down');
    expect(db.updatePayloads['orders']).toBeUndefined();
    expect(db.updatePayloads['line_items']).toBeUndefined();
    expect(db.insertPayloads['order_logs']).toBeUndefined();
  });

  it('400s a customer with no email address before sending', async () => {
    db.responses['customers.select'] = [
      { id: 'c1', first_name: 'Ada', last_name: 'Lovelace', email: '', public_token: 'ctok-1' },
    ];
    const res = await post({ order_ids: [O1] });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('This customer has no email address.');
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(db.updatePayloads['orders']).toBeUndefined();
  });

  it('404s an unknown or soft-deleted customer before sending', async () => {
    db.responses['customers.select'] = [];
    const res = await post({ order_ids: [O1] });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe('Customer not found');
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(db.filters).toContainEqual(['customers', 'is', ['deleted_at', null]]);
    expect(db.filters.some(([table]) => table === 'orders')).toBe(false);
  });

  it('400s naming the estimate that was confirmed meanwhile, not the sendable one', async () => {
    db.responses['orders.select'] = [
      orderRow(),
      orderRow({ id: O2, order_number: 'M2010-127', status: 'confirmed' }),
    ];
    const res = await post({ order_ids: [O1, O2] });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(
      'Estimate M2010-127 cannot be sent in its current status.'
    );
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(db.updatePayloads['orders']).toBeUndefined();
  });

  it('400s naming the estimate that expired meanwhile', async () => {
    db.responses['orders.select'] = [orderRow({ expiry_date: '2020-01-01' })];
    const res = await post({ order_ids: [O1] });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(
      'Estimate M2010-126 has expired and cannot be sent.'
    );
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(db.updatePayloads['orders']).toBeUndefined();
  });

  it('rejects a duplicate id, an empty list, 21 ids, and a non-uuid id', async () => {
    const duplicate = await post({ order_ids: [O1, O1] });
    expect(duplicate.status).toBe(400);
    expect(((await duplicate.json()) as { error: string }).error).toBe('Select each estimate only once.');

    expect((await post({ order_ids: [] })).status).toBe(400);

    const twentyOne = Array.from(
      { length: 21 },
      (_, i) => `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`
    );
    expect((await post({ order_ids: twentyOne })).status).toBe(400);

    expect((await post({ order_ids: ['not-a-uuid'] })).status).toBe(400);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('rejects an unknown field in the body', async () => {
    const res = await post({ order_ids: [O1], total: 1 });
    expect(res.status).toBe(400);
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(db.updatePayloads['orders']).toBeUndefined();
  });

  it('rejects a 1001-character message', async () => {
    const res = await post({ order_ids: [O1], message: 'x'.repeat(1001) });
    expect(res.status).toBe(400);
    expect(sendEmailMock).not.toHaveBeenCalled();
    // One character less is accepted, so the limit itself is what refused it.
    expect((await post({ order_ids: [O1], message: 'x'.repeat(1000) })).status).toBe(200);
  });

  it('reports a row whose status write failed under failed, with 200', async () => {
    db.responses['orders.select'] = [orderRow(), orderRow({ id: O2, order_number: 'M2010-127' })];
    // Padded for the stamp's own `orders.update`, as above.
    db.opErrors['orders.update'] = [null, null, { message: 'row is locked' }];
    const res = await post({ order_ids: [O1, O2] });
    expect(res.status).toBe(200);

    const body = (await res.json()) as SendBody;
    expect(body.data.sent).toEqual([O1]);
    expect(body.data.failed).toEqual([{ id: O2, error: 'row is locked' }]);
    // A row that never reached `sent` must not be frozen: `draft` does not
    // hold the price lock, so frozen items would be re-priced on the next save.
    expect(db.filters).not.toContainEqual(['line_items', 'eq', ['order_id', O2]]);
  });

  it('is safe to run twice', async () => {
    // The state a first send leaves behind: every selected row already `sent`.
    db.responses['orders.select'] = [
      orderRow({ status: 'sent' }),
      orderRow({ id: O2, order_number: 'M2010-127', status: 'sent' }),
    ];
    const res = await post({ order_ids: [O1, O2] });
    expect(res.status).toBe(200);

    const body = (await res.json()) as SendBody;
    expect(body.data.sent).toEqual([]);
    expect(body.data.announced).toEqual([O1, O2]);
    expect(db.updatePayloads['orders']).toBeUndefined();
    expect(db.updatePayloads['line_items']).toBeUndefined();
    expect(db.insertPayloads['order_logs']).toBeUndefined();
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });
});
