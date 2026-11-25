// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Unit tests for `recordOrderPayment`: the idempotency key reaches the
 * insert, a replayed key is reported as a duplicate instead of an error,
 * and the automatic production trigger only moves an order that is still
 * `awaiting_payment`.
 */

import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { recordOrderPayment } from './payments';

interface Script {
  insert: { data?: { id: string }; error?: { code?: string; message: string } };
  order?: { total: number; payments: Array<{ amount: number }> };
}

/** A scripted client that records what the helper wrote and how it filtered. */
function fakeSb(script: Script) {
  const inserts: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const filters: Array<[string, string, unknown]> = [];
  const sb = {
    from(table: string) {
      const b: Record<string, unknown> = {};
      b.insert = (p: Record<string, unknown>) => {
        inserts.push(p);
        return b;
      };
      b.update = (p: Record<string, unknown>) => {
        updates.push(p);
        return b;
      };
      b.select = () => b;
      b.eq = (col: string, value: unknown) => {
        filters.push([table, col, value]);
        return b;
      };
      b.single = async () => ({ data: script.insert.data ?? null, error: script.insert.error ?? null });
      b.maybeSingle = async () => ({ data: script.order ?? null, error: null });
      b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(resolve({ data: null, error: null }));
      return b;
    },
  };
  return { sb: sb as unknown as SupabaseClient, inserts, updates, filters };
}

const INPUT = { amount: 100, paid_on: '2026-11-14', note: '' };

describe('recordOrderPayment', () => {
  it('stores the idempotency key with the payment', async () => {
    const f = fakeSb({ insert: { data: { id: 'p1' } } });
    const key = '99999999-9999-4999-8999-999999999999';
    const result = await recordOrderPayment(f.sb, 'o1', 'in_progress', { ...INPUT, client_key: key });
    expect(result).toEqual({ paymentId: 'p1' });
    expect(f.inserts[0]).toMatchObject({ order_id: 'o1', amount: 100, client_key: key });
  });

  it('stores a null key when none is given (webhook payments)', async () => {
    const f = fakeSb({ insert: { data: { id: 'p1' } } });
    await recordOrderPayment(f.sb, 'o1', 'in_progress', INPUT);
    expect(f.inserts[0].client_key).toBeNull();
  });

  it('reports a replayed key as a duplicate, not an error', async () => {
    const f = fakeSb({ insert: { error: { code: '23505', message: 'duplicate key value' } } });
    const result = await recordOrderPayment(f.sb, 'o1', 'awaiting_payment', {
      ...INPUT,
      client_key: '99999999-9999-4999-8999-999999999999',
    });
    expect(result).toEqual({ duplicate: true });
    expect(f.updates).toHaveLength(0);
  });

  it('reports any other insert failure as an error', async () => {
    const f = fakeSb({ insert: { error: { code: '23514', message: 'check violation' } } });
    expect(await recordOrderPayment(f.sb, 'o1', 'awaiting_payment', INPUT)).toEqual({
      errorMessage: 'check violation',
    });
  });

  it('starts production at the 50% deposit, guarded on the order still awaiting payment', async () => {
    const f = fakeSb({ insert: { data: { id: 'p1' } }, order: { total: 200, payments: [{ amount: 100 }] } });
    await recordOrderPayment(f.sb, 'o1', 'awaiting_payment', INPUT);
    expect(f.updates).toEqual([{ status: 'in_progress' }]);
    expect(f.filters).toContainEqual(['orders', 'status', 'awaiting_payment']);
  });

  it('leaves the status alone below the deposit', async () => {
    const f = fakeSb({ insert: { data: { id: 'p1' } }, order: { total: 200, payments: [{ amount: 99 }] } });
    await recordOrderPayment(f.sb, 'o1', 'awaiting_payment', INPUT);
    expect(f.updates).toHaveLength(0);
  });
});
