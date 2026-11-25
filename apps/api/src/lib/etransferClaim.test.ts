// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Unit tests for `recordPaymentWithClaim`: replay classification, the
 * guarded e-Transfer claim, and the guarded, logged release and link.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { recordPaymentWithClaim } from './etransferClaim';
import { findLikelyDuplicate } from './paymentDuplicate';

// The same-money lookup has its own unit tests (`paymentDuplicate.test.ts`);
// here it is scripted so the queues below stay about the claim alone. Its
// wording function stays real.
vi.mock('./paymentDuplicate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./paymentDuplicate')>()),
  findLikelyDuplicate: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(findLikelyDuplicate).mockReset();
  vi.mocked(findLikelyDuplicate).mockResolvedValue({ kind: 'none' });
});

type Res = { data?: unknown; error?: { code?: string; message: string } | null };

interface Call {
  table: string;
  op: string;
  payload?: unknown;
  filters: Array<[string, unknown[]]>;
}

/** Scripted client: results are consumed per `table.op`, in order. */
function fakeSb(script: Record<string, Res[]>) {
  const calls: Call[] = [];
  const sb = {
    from(table: string) {
      const call: Call = { table, op: 'select', filters: [] };
      calls.push(call);
      const next = (): Res => {
        const r = script[`${table}.${call.op}`]?.shift() ?? {};
        return { data: r.data ?? null, error: r.error ?? null };
      };
      const b: Record<string, unknown> = {};
      for (const op of ['insert', 'update']) {
        b[op] = (p: unknown) => {
          call.op = op;
          call.payload = p;
          return b;
        };
      }
      b.select = () => b;
      for (const f of ['eq', 'is']) {
        b[f] = (...args: unknown[]) => {
          call.filters.push([f, args]);
          return b;
        };
      }
      b.single = async () => next();
      b.maybeSingle = async () => next();
      b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(resolve(next()));
      return b;
    },
  };
  return { sb: sb as unknown as SupabaseClient, calls };
}

const KEY = '99999999-9999-4999-8999-999999999999';
const ET = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const INPUT = { amount: 100, paid_on: '2026-11-14', note: '', client_key: KEY };
const DUP = { code: '23505', message: 'duplicate key value' };
const ops = (calls: Call[]) => calls.map((c) => `${c.table}.${c.op}`);

describe('recordPaymentWithClaim', () => {
  it('records a plain payment', async () => {
    const f = fakeSb({ 'payments.insert': [{ data: { id: 'p1' } }] });
    expect(await recordPaymentWithClaim(f.sb, 'o1', 'in_progress', INPUT)).toEqual({
      kind: 'recorded',
      paymentId: 'p1',
    });
  });

  it('treats a stored payment with the same order and amount as a replay', async () => {
    const f = fakeSb({ 'payments.select': [{ data: { id: 'p0', order_id: 'o1', amount: '100.00' } }] });
    expect(await recordPaymentWithClaim(f.sb, 'o1', 'in_progress', INPUT)).toEqual({ kind: 'replay' });
    expect(ops(f.calls)).not.toContain('payments.insert');
  });

  it('refuses a key stored with a different amount', async () => {
    const f = fakeSb({ 'payments.select': [{ data: { id: 'p0', order_id: 'o1', amount: 250 } }] });
    expect(await recordPaymentWithClaim(f.sb, 'o1', 'in_progress', INPUT)).toMatchObject({
      kind: 'conflict',
      code: 'client_key_mismatch',
    });
    expect(ops(f.calls)).not.toContain('payments.insert');
  });

  it('refuses a key that belongs to another order', async () => {
    const f = fakeSb({ 'payments.select': [{ data: { id: 'p0', order_id: 'other', amount: 100 } }] });
    expect(await recordPaymentWithClaim(f.sb, 'o1', 'in_progress', INPUT)).toMatchObject({
      kind: 'conflict',
      code: 'client_key_mismatch',
    });
  });

  it('refuses a replay whose e-Transfer is linked to a different payment', async () => {
    const f = fakeSb({
      'payments.select': [{ data: { id: 'p0', order_id: 'o1', amount: 100 } }],
      'etransfers.select': [{ data: [{ id: 'E-other' }] }],
    });
    expect(await recordPaymentWithClaim(f.sb, 'o1', 'in_progress', { ...INPUT, etransfer_id: ET })).toMatchObject({
      kind: 'conflict',
      code: 'client_key_mismatch',
    });
    expect(ops(f.calls)).not.toContain('etransfers.update');
  });

  it('refuses sequential reuse of a key with a different, still-pending transfer', async () => {
    const f = fakeSb({
      'payments.select': [{ data: { id: 'p0', order_id: 'o1', amount: 100 } }],
      'etransfers.select': [{ data: [] }, { data: { status: 'pending', order_id: null, payment_id: null } }],
    });
    expect(await recordPaymentWithClaim(f.sb, 'o1', 'in_progress', { ...INPUT, etransfer_id: ET })).toMatchObject({
      kind: 'conflict',
      code: 'client_key_mismatch',
    });
  });

  it('accepts the in-flight winner: applied here, unlinked, nothing else linked', async () => {
    const f = fakeSb({
      'payments.select': [{ data: { id: 'p0', order_id: 'o1', amount: 100 } }],
      'etransfers.select': [{ data: [] }, { data: { status: 'applied', order_id: 'o1', payment_id: null } }],
    });
    expect(await recordPaymentWithClaim(f.sb, 'o1', 'in_progress', { ...INPUT, etransfer_id: ET })).toEqual({
      kind: 'replay',
    });
  });

  it('refuses a replay naming no transfer when the stored payment has one linked', async () => {
    const f = fakeSb({
      'payments.select': [{ data: { id: 'p0', order_id: 'o1', amount: 100 } }],
      'etransfers.select': [{ data: [{ id: ET }] }],
    });
    expect(await recordPaymentWithClaim(f.sb, 'o1', 'in_progress', INPUT)).toMatchObject({
      kind: 'conflict',
      code: 'client_key_mismatch',
    });
  });

  it('answers an error, not a mismatch, when the e-Transfer read fails', async () => {
    const f = fakeSb({
      'payments.select': [{ data: { id: 'p0', order_id: 'o1', amount: 100 } }],
      'etransfers.select': [{ error: { message: 'read failed' } }],
    });
    const r = await recordPaymentWithClaim(f.sb, 'o1', 'in_progress', INPUT);
    expect(r.kind).toBe('error');
  });

  it('answers 409-class when the claim is lost and no payment exists for the key', async () => {
    const f = fakeSb({ 'etransfers.update': [{ data: null }] });
    expect(await recordPaymentWithClaim(f.sb, 'o1', 'in_progress', { ...INPUT, etransfer_id: ET })).toMatchObject({
      kind: 'conflict',
      code: 'etransfer_unavailable',
    });
    expect(ops(f.calls)).not.toContain('payments.insert');
  });

  it('keeps a possibly-made claim, logs it on the order, and errors when the claim update errors', async () => {
    const f = fakeSb({ 'etransfers.update': [{ error: { message: 'claim timed out' } }] });
    const r = await recordPaymentWithClaim(f.sb, 'o1', 'in_progress', { ...INPUT, etransfer_id: ET });
    expect(r).toEqual({ kind: 'error', message: 'claim timed out' });
    // No release: the update may have landed, or the claim may be another request's.
    expect(f.calls.filter((c) => c.table === 'etransfers' && c.op === 'update')).toHaveLength(1);
    expect(ops(f.calls)).not.toContain('payments.insert');
    const log = f.calls.find((c) => c.table === 'order_logs');
    expect(log?.payload).toMatchObject({ order_id: 'o1' });
    const message = String((log?.payload as { message: string }).message);
    expect(message).toContain(ET);
    expect(message).toContain('may be left claimed');
    expect(message).toContain('claim timed out');
  });

  it('treats a lost claim as a replay when this key\'s payment now exists', async () => {
    const f = fakeSb({
      'payments.select': [{ data: null }, { data: { id: 'p0', order_id: 'o1', amount: 100 } }],
      'etransfers.update': [{ data: null }],
      'etransfers.select': [{ data: [{ id: ET }] }],
    });
    expect(await recordPaymentWithClaim(f.sb, 'o1', 'in_progress', { ...INPUT, etransfer_id: ET })).toEqual({
      kind: 'replay',
    });
  });

  it('claims before writing, then links the payment', async () => {
    const f = fakeSb({ 'etransfers.update': [{ data: { id: ET } }, {}], 'payments.insert': [{ data: { id: 'p1' } }] });
    const r = await recordPaymentWithClaim(f.sb, 'o1', 'in_progress', { ...INPUT, etransfer_id: ET });
    expect(r).toEqual({ kind: 'recorded', paymentId: 'p1' });
    const o = ops(f.calls);
    expect(o.indexOf('etransfers.update')).toBeLessThan(o.indexOf('payments.insert'));
    const updates = f.calls.filter((c) => c.table === 'etransfers' && c.op === 'update');
    expect(updates[0].payload).toEqual({ status: 'applied', order_id: 'o1' });
    expect(updates[1].payload).toEqual({ payment_id: 'p1' });
  });

  it('on a duplicate with another transfer linked: no link, claim released, 409', async () => {
    const f = fakeSb({
      'payments.select': [{ data: null }, { data: { id: 'p0', order_id: 'o1', amount: 100 } }],
      'etransfers.update': [{ data: { id: ET } }, {}],
      'payments.insert': [{ error: DUP }],
    });
    const r = await recordPaymentWithClaim(f.sb, 'o1', 'in_progress', { ...INPUT, etransfer_id: ET });
    expect(r).toMatchObject({ kind: 'conflict', code: 'client_key_mismatch' });
    const updates = f.calls.filter((c) => c.table === 'etransfers' && c.op === 'update');
    expect(updates).toHaveLength(2);
    const release = updates[1];
    expect(release.payload).toEqual({ status: 'pending', order_id: null });
    expect(release.filters).toContainEqual(['eq', ['status', 'applied']]);
    expect(release.filters).toContainEqual(['eq', ['order_id', 'o1']]);
    expect(release.filters).toContainEqual(['is', ['payment_id', null]]);
  });

  it('answers an error, not 200, when the lookup after a duplicate fails', async () => {
    const f = fakeSb({
      'payments.select': [{ data: null }, { error: { message: 'read failed' } }],
      'payments.insert': [{ error: DUP }],
    });
    expect((await recordPaymentWithClaim(f.sb, 'o1', 'in_progress', INPUT)).kind).toBe('error');
  });

  it('answers a replay on a duplicate with no transfer involved and a matching payment', async () => {
    const f = fakeSb({
      'payments.select': [{ data: null }, { data: { id: 'p0', order_id: 'o1', amount: 100 } }],
      'etransfers.select': [{ data: [] }],
      'payments.insert': [{ error: DUP }],
    });
    expect(await recordPaymentWithClaim(f.sb, 'o1', 'in_progress', INPUT)).toEqual({ kind: 'replay' });
  });

  it('releases the claim and reports the error when the insert fails', async () => {
    const f = fakeSb({
      'etransfers.update': [{ data: { id: ET } }, {}],
      'payments.insert': [{ error: { message: 'write failed' } }],
    });
    expect(await recordPaymentWithClaim(f.sb, 'o1', 'in_progress', { ...INPUT, client_key: undefined, etransfer_id: ET })).toEqual({
      kind: 'error',
      message: 'write failed',
    });
    expect(f.calls.filter((c) => c.table === 'etransfers' && c.op === 'update')[1].payload).toEqual({
      status: 'pending',
      order_id: null,
    });
  });

  it('links and reports recorded when the payment landed despite the insert error', async () => {
    const f = fakeSb({
      'payments.select': [{ data: null }, { data: { id: 'p9', order_id: 'o1', amount: 100 } }],
      'etransfers.update': [{ data: { id: ET } }, {}],
      'etransfers.select': [{ data: [] }, { data: { status: 'applied', order_id: 'o1', payment_id: null } }],
      'payments.insert': [{ error: { message: 'network' } }],
    });
    expect(await recordPaymentWithClaim(f.sb, 'o1', 'in_progress', { ...INPUT, etransfer_id: ET })).toEqual({
      kind: 'recorded',
      paymentId: 'p9',
    });
    const updates = f.calls.filter((c) => c.table === 'etransfers' && c.op === 'update');
    expect(updates[1].payload).toEqual({ payment_id: 'p9' });
  });

  it('keeps the claim, logs, and errors when the re-check after an insert error fails', async () => {
    const f = fakeSb({
      'payments.select': [{ data: null }, { error: { message: 'read failed' } }],
      'etransfers.update': [{ data: { id: ET } }],
      'payments.insert': [{ error: { message: 'network' } }],
    });
    const r = await recordPaymentWithClaim(f.sb, 'o1', 'in_progress', { ...INPUT, etransfer_id: ET });
    expect(r.kind).toBe('error');
    expect(f.calls.filter((c) => c.table === 'etransfers' && c.op === 'update')).toHaveLength(1);
    expect(f.calls.some((c) => c.table === 'order_logs')).toBe(true);
  });

  it('logs on the order when the release fails', async () => {
    const f = fakeSb({
      'etransfers.update': [{ data: { id: ET } }, { error: { message: 'release failed' } }],
      'payments.insert': [{ error: { message: 'write failed' } }],
    });
    await recordPaymentWithClaim(f.sb, 'o1', 'in_progress', { ...INPUT, client_key: undefined, etransfer_id: ET });
    const log = f.calls.find((c) => c.table === 'order_logs');
    expect(log?.payload).toMatchObject({ order_id: 'o1' });
    expect(String((log?.payload as { message: string }).message)).toContain('release failed');
  });

  it('logs on the order, and still succeeds, when the link fails', async () => {
    const f = fakeSb({
      'etransfers.update': [{ data: { id: ET } }, { error: { message: 'link failed' } }],
      'payments.insert': [{ data: { id: 'p1' } }],
    });
    const r = await recordPaymentWithClaim(f.sb, 'o1', 'in_progress', { ...INPUT, client_key: undefined, etransfer_id: ET });
    expect(r).toEqual({ kind: 'recorded', paymentId: 'p1' });
    const log = f.calls.find((c) => c.table === 'order_logs');
    expect(String((log?.payload as { message: string }).message)).toContain('link failed');
  });
});

describe('recordPaymentWithClaim — possible duplicate of an e-Transfer payment', () => {
  // INPUT is dated 2026-11-14; this e-Transfer payment is dated a day earlier.
  const FOUND = { kind: 'found' as const, payment: { id: 'p-et', amount: 100, paid_on: '2026-11-13' } };

  it('refuses a hand-entered payment matching an e-Transfer payment, writing nothing', async () => {
    vi.mocked(findLikelyDuplicate).mockResolvedValue(FOUND);
    const f = fakeSb({});
    expect(await recordPaymentWithClaim(f.sb, 'o1', 'in_progress', INPUT)).toEqual({
      kind: 'conflict',
      code: 'possible_duplicate',
      message:
        'An e-Transfer of $100.00 dated November 13, 2026 is already recorded on this order, within 3 days of ' +
        'this payment. Record this payment as well only if the customer really paid twice.',
    });
    // Compared against the date being entered, not today.
    expect(findLikelyDuplicate).toHaveBeenCalledWith(f.sb, 'o1', 100, '2026-11-14', 'etransfer');
    expect(ops(f.calls)).not.toContain('payments.insert');
  });

  it('checks the key FIRST: an exact replay is still a replay', async () => {
    vi.mocked(findLikelyDuplicate).mockResolvedValue(FOUND);
    const f = fakeSb({ 'payments.select': [{ data: { id: 'p0', order_id: 'o1', amount: 100 } }] });
    expect(await recordPaymentWithClaim(f.sb, 'o1', 'in_progress', INPUT)).toEqual({ kind: 'replay' });
    expect(findLikelyDuplicate).not.toHaveBeenCalled();
  });

  it('records it when the submit confirms the duplicate', async () => {
    vi.mocked(findLikelyDuplicate).mockResolvedValue(FOUND);
    const f = fakeSb({ 'payments.insert': [{ data: { id: 'p1' } }] });
    expect(
      await recordPaymentWithClaim(f.sb, 'o1', 'in_progress', { ...INPUT, confirm_duplicate: true })
    ).toEqual({ kind: 'recorded', paymentId: 'p1' });
    expect(findLikelyDuplicate).not.toHaveBeenCalled();
  });

  it('does not ask when a pending e-Transfer is being applied', async () => {
    const f = fakeSb({ 'etransfers.update': [{ data: { id: ET } }, {}], 'payments.insert': [{ data: { id: 'p1' } }] });
    await recordPaymentWithClaim(f.sb, 'o1', 'in_progress', { ...INPUT, etransfer_id: ET });
    expect(findLikelyDuplicate).not.toHaveBeenCalled();
  });

  it('answers a retryable error, writing nothing, when the check cannot run', async () => {
    vi.mocked(findLikelyDuplicate).mockResolvedValue({ kind: 'unknown', message: 'read failed' });
    const f = fakeSb({});
    expect(await recordPaymentWithClaim(f.sb, 'o1', 'in_progress', INPUT)).toEqual({
      kind: 'error',
      message: 'Could not check this order for a matching e-Transfer payment (read failed). Please try again.',
    });
    expect(ops(f.calls)).not.toContain('payments.insert');
  });
});
