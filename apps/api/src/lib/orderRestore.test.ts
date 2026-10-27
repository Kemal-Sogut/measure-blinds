// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins the restore decision rules in `orderRestore.ts`: which statuses
 * may restore, the 404/409/500 answers and the 409's exact copy, the
 * revision's locks winning the overlay (and no overlay at all on an order
 * that holds no locks), and the GET loader's malformed-id guard.
 *
 * The Supabase client is a one-query scripted fake: every function here
 * issues at most the single `order_revisions` read.
 */

import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  canRestoreRevision,
  loadRevisionSource,
  overlayRevisionLocks,
  planRestore,
  restoreLogLine,
} from './orderRestore';
import type { RevisionSource } from './orderRevisions';
import type { StoredLock } from './priceLockStore';

const REV_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';

/** A Supabase fake whose one `order_revisions` read answers `result`. */
function fakeSb(result: { data: unknown; error: { message: string } | null }): {
  sb: SupabaseClient;
  reads: number;
} {
  const state = { reads: 0 };
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => {
      state.reads += 1;
      return result;
    },
  };
  return {
    sb: { from: () => builder } as unknown as SupabaseClient,
    get reads() {
      return state.reads;
    },
  };
}

/** A stored row carrying a lock at `base` under `fingerprint`. */
function lockedRow(uid: string, base: number, fingerprint: string): Record<string, unknown> {
  return { uid, locked_base_price: base, locked_inputs_fingerprint: fingerprint, attributes: {} };
}

const SOURCE: RevisionSource = {
  order: { title: 'Front room', discount_type: 'fixed', discount_value: 0 },
  line_items: [lockedRow('u1', 98, 'fp-rev1'), lockedRow('u3', 40, 'fp-gone')],
};

describe('canRestoreRevision', () => {
  it('allows the estimate stages only', () => {
    expect(['draft', 'sent', 'expired'].map(canRestoreRevision)).toEqual([true, true, true]);
    expect(['awaiting_payment', 'in_progress', 'ready', 'installed'].map(canRestoreRevision)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
});

describe('restoreLogLine', () => {
  it('names the revision and that nothing was sent', () => {
    expect(restoreLogLine(3)).toBe('Restored Rev 3 (not sent yet).');
  });
});

describe('planRestore', () => {
  it('returns the source for a restorable order', async () => {
    const { sb } = fakeSb({ data: { rev_no: 1, source: SOURCE }, error: null });
    expect(await planRestore(sb, 'o1', REV_ID, 'sent')).toEqual({ ok: true, rev_no: 1, source: SOURCE });
  });

  it('404s a revision that is not this order’s, whatever the status', async () => {
    const { sb } = fakeSb({ data: null, error: null });
    expect(await planRestore(sb, 'o1', REV_ID, 'installed')).toMatchObject({ ok: false, status: 404 });
  });

  it('409s a confirmed order, naming the revision', async () => {
    const { sb } = fakeSb({ data: { rev_no: 2, source: SOURCE }, error: null });
    expect(await planRestore(sb, 'o1', REV_ID, 'awaiting_payment')).toEqual({
      ok: false,
      status: 409,
      error: "Rev 2 can't be restored once the estimate is confirmed.",
    });
  });

  it('500s an unreadable revision instead of calling it missing', async () => {
    const { sb } = fakeSb({ data: null, error: { message: 'connection reset' } });
    expect(await planRestore(sb, 'o1', REV_ID, 'sent')).toEqual({
      ok: false,
      status: 500,
      error: 'connection reset',
    });
  });
});

describe('overlayRevisionLocks', () => {
  const current = (): Map<string, StoredLock> =>
    new Map([
      ['u1', { base: 120.4, fingerprint: 'fp-rev2', snapshot: {} as StoredLock['snapshot'] }],
      ['u2', { base: 25, fingerprint: 'fp-preset', snapshot: {} as StoredLock['snapshot'] }],
    ]);

  it('lets the revision’s lock win and keeps the current ones it lacks', () => {
    const merged = overlayRevisionLocks(current(), SOURCE);
    expect(merged?.get('u1')).toMatchObject({ base: 98, fingerprint: 'fp-rev1' });
    expect(merged?.get('u2')).toMatchObject({ base: 25, fingerprint: 'fp-preset' });
    // An item since removed comes back with the lock it was quoted under.
    expect(merged?.get('u3')).toMatchObject({ base: 40, fingerprint: 'fp-gone' });
  });

  it('builds no locks for an order that holds none (a draft prices live)', () => {
    expect(overlayRevisionLocks(undefined, SOURCE)).toBeUndefined();
  });
});

describe('loadRevisionSource', () => {
  it('returns the revision number and its source', async () => {
    const { sb } = fakeSb({ data: { rev_no: 1, source: SOURCE }, error: null });
    expect(await loadRevisionSource(sb, 'o1', REV_ID)).toEqual({ data: { rev_no: 1, source: SOURCE } });
  });

  it('404s a malformed id without querying', async () => {
    const fake = fakeSb({ data: { rev_no: 1, source: SOURCE }, error: null });
    expect(await loadRevisionSource(fake.sb, 'o1', 'not-a-uuid')).toEqual({
      status: 404,
      error: 'Revision not found',
    });
    expect(fake.reads).toBe(0);
  });

  it('tells a missing revision from an unreadable one', async () => {
    expect(await loadRevisionSource(fakeSb({ data: null, error: null }).sb, 'o1', REV_ID)).toMatchObject({
      status: 404,
    });
    expect(
      await loadRevisionSource(fakeSb({ data: null, error: { message: 'boom' } }).sb, 'o1', REV_ID)
    ).toEqual({ status: 500, error: 'boom' });
  });
});
