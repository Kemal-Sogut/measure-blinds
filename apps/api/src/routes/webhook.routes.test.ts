// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Route tests for the e-Transfer webhook. They pin the ordering that
 * makes ingestion idempotent: the `etransfers` row is inserted FIRST
 * (its UNIQUE Gmail message id is the lock), and a payment is recorded
 * only by the request that won that insert. The matcher, the payment
 * helper, the warranty issuer and the notification writer are mocked, so
 * every database call seen here belongs to the route itself.
 * The same-money check (`lib/paymentDuplicate.ts`) is NOT mocked: its
 * one `payments` read is answered from `state.payments`, so each test
 * decides which payments the matched order already holds.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

interface State {
  calls: string[];
  inserts: Array<Record<string, unknown>>;
  updates: Array<Record<string, unknown>>;
  /** Rows written to the order activity trail (`order_logs`). */
  logs: Array<Record<string, unknown>>;
  /** When set, the etransfers INSERT fails with this error. */
  insertError: { code: string; message: string } | null;
  /** When set, the etransfers UPDATE (the link to the payment) fails with this error. */
  updateError: { message: string } | null;
  /** Rows the `payments` read answers with (the same-money check). */
  payments: Array<Record<string, unknown>>;
  /** When set, the `payments` read fails with this error. */
  paymentsError: { message: string } | null;
}

const state: State = {
  calls: [],
  inserts: [],
  updates: [],
  logs: [],
  insertError: null,
  updateError: null,
  payments: [],
  paymentsError: null,
};

function builder(table: string) {
  let op = 'select';
  let payload: Record<string, unknown> = {};
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.eq = () => b;
  b.gte = () => b;
  b.lte = () => b;
  b.insert = (p: Record<string, unknown>) => {
    op = 'insert';
    payload = p;
    return b;
  };
  b.update = (p: Record<string, unknown>) => {
    op = 'update';
    payload = p;
    return b;
  };
  const settle = () => {
    state.calls.push(`${table}.${op}`);
    if (table === 'payments' && op === 'select') {
      return state.paymentsError ? { data: null, error: state.paymentsError } : { data: state.payments, error: null };
    }
    if (table === 'etransfers' && op === 'insert') {
      if (state.insertError) return { data: null, error: state.insertError };
      state.inserts.push(payload);
      return { data: { id: 'et-1' }, error: null };
    }
    if (table === 'etransfers' && op === 'update') {
      state.updates.push(payload);
      if (state.updateError) return { data: null, error: state.updateError };
    }
    if (table === 'order_logs' && op === 'insert') state.logs.push(payload);
    return { data: null, error: null };
  };
  b.single = async () => settle();
  b.maybeSingle = async () => settle();
  b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(resolve(settle()));
  return b;
}

vi.mock('../lib/supabase', () => ({
  createSupabaseAdmin: () => ({ from: (table: string) => builder(table) }),
}));
vi.mock('../lib/etransferMatch', () => ({ resolveOrder: vi.fn() }));
vi.mock('../lib/payments', () => ({ recordOrderPayment: vi.fn() }));
vi.mock('../lib/warrantyIssue', () => ({ issueWarrantyIfPaid: vi.fn(async () => ({ status: 'not_due' })) }));
vi.mock('../lib/notifications', () => ({ recordNotification: vi.fn(async () => undefined) }));

import webhookApp from './webhook';
import { resolveOrder } from '../lib/etransferMatch';
import { recordOrderPayment } from '../lib/payments';
import { recordNotification } from '../lib/notifications';

const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
  RESEND_API_KEY: 'not-a-real-key',
  APP_URL: 'http://localhost:5173',
  ENVIRONMENT: 'test',
  ETRANSFER_WEBHOOK_SECRET: 'test-secret',
};

const BODY = {
  amount: 250,
  sender: 'Ann Lee',
  reference_message: '',
  timestamp: '2026-11-15T02:30:00.000Z', // 9:30 PM on Nov 14 in Toronto
  message_id: 'gmail-msg-1',
  raw_snippet: 'You have received $250.00',
};

function post(body: unknown, auth = 'Bearer test-secret', env: Record<string, unknown> = ENV) {
  return webhookApp.request(
    '/etransfer',
    { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    env
  );
}

beforeEach(() => {
  state.calls = [];
  state.inserts = [];
  state.updates = [];
  state.logs = [];
  state.insertError = null;
  state.updateError = null;
  vi.mocked(resolveOrder).mockReset();
  vi.mocked(recordOrderPayment).mockReset();
  // Default: the matched order holds no payments, so the existing tests
  // above exercise the unchanged apply path.
  state.payments = [];
  state.paymentsError = null;
  vi.mocked(recordNotification).mockClear();
});

describe('POST /webhooks/etransfer', () => {
  it('401s without the shared secret', async () => {
    expect((await post(BODY, 'Bearer wrong')).status).toBe(401);
    expect((await post(BODY, '')).status).toBe(401);
    expect(state.calls).toHaveLength(0);
  });

  it('401s when the secret is not configured, even for a bare "Bearer " header', async () => {
    const { ETRANSFER_WEBHOOK_SECRET: _unset, ...withoutSecret } = ENV;
    expect((await post(BODY, 'Bearer ', withoutSecret)).status).toBe(401);
    expect((await post(BODY, 'Bearer ', { ...ENV, ETRANSFER_WEBHOOK_SECRET: '' })).status).toBe(401);
    expect(state.calls).toHaveLength(0);
  });

  it('400s a payload without a Gmail message id, its only dedupe key', async () => {
    const { message_id: _omitted, ...withoutId } = BODY;
    expect((await post(withoutId)).status).toBe(400);
    expect((await post({ ...BODY, message_id: '' })).status).toBe(400);
    expect(state.calls).toHaveLength(0);
  });

  it('stores the transfer as pending BEFORE any payment is recorded', async () => {
    vi.mocked(resolveOrder).mockResolvedValue({ id: 'o1', status: 'awaiting_payment', order_number: 'T1114-126' });
    vi.mocked(recordOrderPayment).mockImplementation(async () => {
      // The claim row must already exist when money is written.
      expect(state.inserts).toHaveLength(1);
      expect(state.inserts[0]).toMatchObject({ gmail_message_id: 'gmail-msg-1', status: 'pending' });
      return { paymentId: 'p1' };
    });
    const res = await post(BODY);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'applied', order_id: 'o1' });
    expect(state.updates).toEqual([{ status: 'applied', order_id: 'o1', payment_id: 'p1' }]);
  });

  it('treats a second delivery of the same email as a duplicate and records nothing', async () => {
    state.insertError = { code: '23505', message: 'duplicate key value violates unique constraint' };
    vi.mocked(resolveOrder).mockResolvedValue({ id: 'o1', status: 'awaiting_payment', order_number: 'T1114-126' });
    const res = await post(BODY);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'duplicate' });
    expect(recordOrderPayment).not.toHaveBeenCalled();
  });

  it('answers 500 when the transfer cannot be stored, so the script retries', async () => {
    state.insertError = { code: '08006', message: 'connection failure' };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const res = await post(BODY);
      expect(res.status).toBe(500);
      expect(recordOrderPayment).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledOnce();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('answers applied and logs the database error on the order when the link fails', async () => {
    vi.mocked(resolveOrder).mockResolvedValue({ id: 'o1', status: 'awaiting_payment', order_number: 'T1114-126' });
    vi.mocked(recordOrderPayment).mockResolvedValue({ paymentId: 'p1' });
    state.updateError = { message: 'link write failed' };
    const res = await post(BODY);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'applied', order_id: 'o1' });
    expect(state.logs).toHaveLength(1);
    expect(state.logs[0]).toMatchObject({ order_id: 'o1', source: 'staff' });
    expect(String(state.logs[0].message)).toContain('link write failed');
    expect(String(state.logs[0].message)).toContain('do not apply it again');
  });

  it('leaves an unmatched transfer pending', async () => {
    vi.mocked(resolveOrder).mockResolvedValue(null);
    const res = await post(BODY);
    expect(await res.json()).toMatchObject({ status: 'pending' });
    expect(state.updates).toHaveLength(0);
  });

  it('leaves the transfer pending when the payment could not be recorded', async () => {
    vi.mocked(resolveOrder).mockResolvedValue({ id: 'o1', status: 'awaiting_payment', order_number: 'T1114-126' });
    vi.mocked(recordOrderPayment).mockResolvedValue({ errorMessage: 'write failed' });
    const res = await post(BODY);
    expect(await res.json()).toMatchObject({ status: 'pending' });
    expect(state.updates).toHaveLength(0);
  });

  it('dates the payment by the Toronto calendar, not UTC', async () => {
    vi.mocked(resolveOrder).mockResolvedValue({ id: 'o1', status: 'awaiting_payment', order_number: 'T1114-126' });
    vi.mocked(recordOrderPayment).mockResolvedValue({ paymentId: 'p1' });
    await post(BODY);
    expect(vi.mocked(recordOrderPayment).mock.calls[0][3]).toMatchObject({ paid_on: '2026-11-14' });
  });
});

describe('POST /webhooks/etransfer — same money already entered by hand', () => {
  const MATCH = { id: 'o1', status: 'awaiting_payment', order_number: 'T1114-126' };
  /** A hand-entered $250.00 payment on the matched order, dated `paid_on`. */
  const hand = (paid_on: string) => ({ id: 'p-hand', amount: '250.00', paid_on, etransfers: [] });

  beforeEach(() => {
    vi.mocked(resolveOrder).mockResolvedValue(MATCH);
    vi.mocked(recordOrderPayment).mockResolvedValue({ paymentId: 'p1' });
  });

  it('holds a matched transfer when a hand-entered payment of the same amount is dated the same day', async () => {
    state.payments = [hand('2026-11-14')];
    const res = await post(BODY);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'pending', reason: 'possible_duplicate' });
    expect(recordOrderPayment).not.toHaveBeenCalled();
    // The stored row is left exactly as inserted: pending, no order.
    expect(state.inserts[0]).toMatchObject({ status: 'pending' });
    expect(state.inserts[0]).not.toHaveProperty('order_id');
    expect(state.calls).not.toContain('etransfers.update');
    // One line on the matched order, naming the earlier payment.
    expect(state.logs).toHaveLength(1);
    expect(state.logs[0]).toMatchObject({ order_id: 'o1', source: 'staff' });
    expect(String(state.logs[0].message)).toContain('$250.00 dated November 14, 2026');
    expect(String(state.logs[0].message)).toContain('Received e-Transfers');
    // The alert says why, and carries no order number (the feed reads one as "applied to").
    const alert = vi.mocked(recordNotification).mock.calls[0][1];
    expect(alert).toMatchObject({
      kind: 'etransfer_received',
      customerName: 'Ann Lee',
      amount: 250,
      subject: 'held for review: T1114-126 already has a $250.00 payment dated November 14, 2026',
    });
    expect(alert).not.toHaveProperty('orderNumber');
  });

  it('holds it when the hand-entered payment is dated exactly 3 days away', async () => {
    state.payments = [hand('2026-11-11')];
    expect(await (await post(BODY)).json()).toEqual({ status: 'pending', reason: 'possible_duplicate' });
    expect(recordOrderPayment).not.toHaveBeenCalled();
  });

  it('applies a same-amount transfer dated 4 or more days from the hand-entered payment (deposit, then balance)', async () => {
    state.payments = [hand('2026-11-10'), hand('2026-10-20')];
    const res = await post(BODY);
    expect(await res.json()).toMatchObject({ status: 'applied', order_id: 'o1' });
    expect(recordOrderPayment).toHaveBeenCalledOnce();
    expect(state.logs).toHaveLength(0);
  });

  it('applies when the same-day payment of that amount itself came from an e-Transfer', async () => {
    state.payments = [{ ...hand('2026-11-14'), etransfers: [{ id: 'et-0' }] }];
    expect(await (await post(BODY)).json()).toMatchObject({ status: 'applied', order_id: 'o1' });
  });

  it('holds the transfer when the check cannot run — never records blind', async () => {
    state.paymentsError = { message: 'read failed' };
    const res = await post(BODY);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'pending', reason: 'possible_duplicate' });
    expect(recordOrderPayment).not.toHaveBeenCalled();
    expect(state.calls).not.toContain('etransfers.update');
    expect(String(state.logs[0].message)).toContain('could not be checked');
    expect(String(state.logs[0].message)).toContain('read failed');
  });

  it('checks before recording money', async () => {
    vi.mocked(recordOrderPayment).mockImplementation(async () => {
      expect(state.calls).toContain('payments.select');
      return { paymentId: 'p1' };
    });
    expect(await (await post(BODY)).json()).toMatchObject({ status: 'applied', order_id: 'o1' });
    expect(state.updates).toEqual([{ status: 'applied', order_id: 'o1', payment_id: 'p1' }]);
  });

  it('does not run the check for a transfer that matched no order', async () => {
    vi.mocked(resolveOrder).mockResolvedValue(null);
    await post(BODY);
    expect(state.calls).not.toContain('payments.select');
  });
});
