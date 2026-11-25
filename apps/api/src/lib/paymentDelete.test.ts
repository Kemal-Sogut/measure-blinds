// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Unit tests for `deletePaymentReleasingEtransfer`: the e-Transfer is
 * released before the payment row goes, and when the delete fails only the
 * transfers this call released are put back, guarded on `status = pending`,
 * with a line on the order's activity trail whenever not all of them could
 * be. Route-level behaviour is covered in `routes/orders.routes.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { deletePaymentReleasingEtransfer } from './paymentDelete';

type Res = { data?: unknown; error?: { message: string } | null };

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
      for (const op of ['insert', 'update', 'delete']) {
        b[op] = (p?: unknown) => {
          call.op = op;
          call.payload = p;
          return b;
        };
      }
      b.select = () => b;
      for (const f of ['eq', 'in', 'is']) {
        b[f] = (...args: unknown[]) => {
          call.filters.push([f, args]);
          return b;
        };
      }
      b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(resolve(next()));
      return b;
    },
  };
  return { sb: sb as unknown as SupabaseClient, calls };
}

const updates = (calls: Call[]) => calls.filter((c) => c.table === 'etransfers' && c.op === 'update');
const logMessages = (calls: Call[]) =>
  calls.filter((c) => c.table === 'order_logs').map((c) => String((c.payload as { message: string }).message));

describe('deletePaymentReleasingEtransfer', () => {
  it('releases the linked transfer, then deletes the payment', async () => {
    const f = fakeSb({
      'etransfers.select': [{ data: [{ id: 'et1' }] }],
      'etransfers.update': [{ data: [{ id: 'et1' }] }],
    });
    expect(await deletePaymentReleasingEtransfer(f.sb, 'o1', 'p1')).toEqual({ status: 'deleted' });
    expect(updates(f.calls)).toHaveLength(1);
    expect(logMessages(f.calls)).toEqual([]);
  });

  it('restores only what it released, guarded on status = pending', async () => {
    const f = fakeSb({
      'etransfers.select': [{ data: [{ id: 'et1' }, { id: 'et2' }] }],
      // et2 was no longer applied, so the release did not touch it.
      'etransfers.update': [{ data: [{ id: 'et1' }] }, { data: [{ id: 'et1' }] }],
      'payments.delete': [{ error: { message: 'delete failed' } }],
    });
    expect(await deletePaymentReleasingEtransfer(f.sb, 'o1', 'p1')).toEqual({ status: 'failed', message: 'delete failed' });
    const restore = updates(f.calls)[1];
    expect(restore.payload).toEqual({ status: 'applied', order_id: 'o1', payment_id: 'p1' });
    expect(restore.filters).toContainEqual(['in', ['id', ['et1']]]);
    expect(restore.filters).toContainEqual(['eq', ['status', 'pending']]);
    expect(logMessages(f.calls)).toEqual([]);
  });

  it('logs on the order when the restore updated fewer rows than were released', async () => {
    const f = fakeSb({
      'etransfers.select': [{ data: [{ id: 'et1' }, { id: 'et2' }] }],
      'etransfers.update': [{ data: [{ id: 'et1' }, { id: 'et2' }] }, { data: [{ id: 'et1' }] }],
      'payments.delete': [{ error: { message: 'delete failed' } }],
    });
    expect((await deletePaymentReleasingEtransfer(f.sb, 'o1', 'p1')).status).toBe('failed');
    const messages = logMessages(f.calls);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('et2');
    expect(messages[0]).not.toContain('et1');
  });

  it('logs the database error when the restore itself fails', async () => {
    const f = fakeSb({
      'etransfers.select': [{ data: [{ id: 'et1' }] }],
      'etransfers.update': [{ data: [{ id: 'et1' }] }, { error: { message: 'restore failed' } }],
      'payments.delete': [{ error: { message: 'delete failed' } }],
    });
    expect((await deletePaymentReleasingEtransfer(f.sb, 'o1', 'p1')).status).toBe('failed');
    const messages = logMessages(f.calls);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('et1');
    expect(messages[0]).toContain('restore failed');
  });

  it('does not restore anything when the release touched no row', async () => {
    const f = fakeSb({
      'etransfers.select': [{ data: [{ id: 'et1' }] }],
      'etransfers.update': [{ data: [] }],
      'payments.delete': [{ error: { message: 'delete failed' } }],
    });
    expect((await deletePaymentReleasingEtransfer(f.sb, 'o1', 'p1')).status).toBe('failed');
    expect(updates(f.calls)).toHaveLength(1);
    expect(logMessages(f.calls)).toEqual([]);
  });
});
