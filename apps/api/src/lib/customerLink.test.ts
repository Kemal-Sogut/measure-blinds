// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins the mint-if-absent rules for the customer link (and the per-order
 * token the portal hands out): an existing token is reused untouched, a
 * missing one is minted with an `is(public_token, null)` guard, and a lost
 * race reads back the winner instead of returning a token nobody stored.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ensureCustomerToken, ensureOrderToken, customerLinkUrl, countActiveEstimates } from './customerLink';

type Result = { data: unknown; error: null | { message: string }; count?: number };
let script: Record<string, Result[]>;
let log: Array<{ table: string; op: string; calls: Array<[string, unknown[]]> }>;

/** Thenable fake: each `<table>.<op>` pops the next scripted result. */
function fakeSb(): SupabaseClient {
  return {
    from(table: string) {
      const entry = { table, op: 'select', calls: [] as Array<[string, unknown[]]> };
      log.push(entry);
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'update', 'eq', 'neq', 'is', 'gte', 'in']) {
        b[m] = (...args: unknown[]) => {
          if (m === 'update') entry.op = 'update';
          entry.calls.push([m, args]);
          return b;
        };
      }
      const next = (): Result =>
        script[`${table}.${entry.op}`]?.shift() ?? { data: null, error: null, count: 0 };
      b.maybeSingle = async () => next();
      (b as { then: unknown }).then = (ok: (v: unknown) => unknown) => Promise.resolve(ok(next()));
      return b;
    },
  } as unknown as SupabaseClient;
}

beforeEach(() => {
  script = {};
  log = [];
});

describe('ensureCustomerToken', () => {
  it('reuses an existing token without writing', async () => {
    script['customers.select'] = [{ data: { id: 'c1', public_token: 'tok-1' }, error: null }];
    expect(await ensureCustomerToken(fakeSb(), 'c1')).toBe('tok-1');
    expect(log.some((e) => e.op === 'update')).toBe(false);
  });

  it('mints one under an is-null guard when absent', async () => {
    script['customers.select'] = [{ data: { id: 'c1', public_token: null }, error: null }];
    script['customers.update'] = [{ data: { public_token: 'minted' }, error: null }];
    expect(await ensureCustomerToken(fakeSb(), 'c1')).toBe('minted');
    const upd = log.find((e) => e.op === 'update')!;
    expect(upd.calls).toContainEqual(['is', ['public_token', null]]);
  });

  it('reads back the winner when the guarded update lost a race', async () => {
    script['customers.select'] = [
      { data: { id: 'c1', public_token: null }, error: null },
      { data: { public_token: 'winner' }, error: null },
    ];
    script['customers.update'] = [{ data: null, error: null }];
    expect(await ensureCustomerToken(fakeSb(), 'c1')).toBe('winner');
  });

  it('returns null for an unknown customer', async () => {
    script['customers.select'] = [{ data: null, error: null }];
    expect(await ensureCustomerToken(fakeSb(), 'nope')).toBeNull();
  });
});

describe('ensureOrderToken', () => {
  it('returns the existing token untouched', async () => {
    expect(await ensureOrderToken(fakeSb(), 'o1', 'have')).toBe('have');
    expect(log).toHaveLength(0);
  });
  it('mints when missing', async () => {
    script['orders.update'] = [{ data: { public_token: 'new-o' }, error: null }];
    expect(await ensureOrderToken(fakeSb(), 'o1', null)).toBe('new-o');
  });
});

describe('customerLinkUrl', () => {
  it('builds the /c/ link', () => {
    expect(customerLinkUrl('https://app.example', 't')).toBe('https://app.example/c/t');
  });
});

describe('countActiveEstimates', () => {
  it('counts sent, unexpired estimates, excluding one order when asked', async () => {
    script['orders.select'] = [{ data: null, error: null, count: 2 }];
    expect(await countActiveEstimates(fakeSb(), 'c1', '2026-10-22', 'o9')).toBe(2);
    const calls = log[0].calls;
    expect(calls).toContainEqual(['eq', ['status', 'sent']]);
    expect(calls).toContainEqual(['gte', ['expiry_date', '2026-10-22']]);
    expect(calls).toContainEqual(['neq', ['id', 'o9']]);
  });
});
