// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Unit tests for the "likely the same money" check shared by the
 * e-Transfer webhook and the staff payment route: exact-cent amounts,
 * payment dates within ±3 calendar days, origin by e-Transfer link, and
 * that a lookup which cannot answer is reported as `unknown` — never as
 * "no duplicate". The deposit-then-balance case (same amount, paid well
 * apart) must come back `none`. Also pins the exact wording staff see on
 * the order, in the Alerts feed and in the payment sheet's question.
 *
 * The fake ignores the SQL filters and returns every scripted row, so the
 * date and amount tests below exercise the helper's own re-check — the
 * rule itself, not just the query.
 */

import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  DUPLICATE_DATE_TOLERANCE_DAYS,
  findLikelyDuplicate,
  heldTransferAlert,
  heldTransferLog,
  manualDuplicateMessage,
} from './paymentDuplicate';

interface Seen {
  table: string;
  columns: string;
  filters: Array<[string, string, unknown]>;
}

/** One scripted `payments` read; records the table, columns and filters asked for. */
function fakeSb(result: { data?: unknown; error?: { message: string } }, opts: { throws?: boolean } = {}) {
  const seen: Seen = { table: '', columns: '', filters: [] };
  const b: Record<string, unknown> = {};
  b.select = (columns: string) => {
    seen.columns = columns;
    return b;
  };
  for (const m of ['eq', 'gte', 'lte']) {
    b[m] = (column: string, value: unknown) => {
      seen.filters.push([m, column, value]);
      return b;
    };
  }
  b.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(resolve({ data: result.data ?? null, error: result.error ?? null }));
  const sb = {
    from(table: string) {
      if (opts.throws) throw new Error('network down');
      seen.table = table;
      return b;
    },
  };
  return { sb: sb as unknown as SupabaseClient, seen };
}

/** A hand-entered payment (no e-Transfer linked) of $250.00 on `paid_on`. */
const hand = (paid_on: string) => ({ id: 'p-hand', amount: '250.00', paid_on, etransfers: [] });
/** A $250.00 payment that came from an e-Transfer, on `paid_on`. */
const viaEt = (paid_on: string) => ({ id: 'p-et', amount: '250.00', paid_on, etransfers: [{ id: 'et-9' }] });

describe('findLikelyDuplicate', () => {
  it('finds a hand-entered payment of the same amount on the same day', async () => {
    const f = fakeSb({ data: [hand('2026-11-20')] });
    expect(await findLikelyDuplicate(f.sb, 'o1', 250, '2026-11-20', 'hand_entered')).toEqual({
      kind: 'found',
      payment: { id: 'p-hand', amount: 250, paid_on: '2026-11-20' },
    });
  });

  it('does not count an e-Transfer payment as hand-entered, and finds it when asked about e-Transfers', async () => {
    expect(
      await findLikelyDuplicate(fakeSb({ data: [viaEt('2026-11-20')] }).sb, 'o1', 250, '2026-11-20', 'hand_entered')
    ).toEqual({ kind: 'none' });
    expect(
      await findLikelyDuplicate(
        fakeSb({ data: [hand('2026-11-20'), viaEt('2026-11-21')] }).sb,
        'o1',
        250,
        '2026-11-20',
        'etransfer'
      )
    ).toEqual({ kind: 'found', payment: { id: 'p-et', amount: 250, paid_on: '2026-11-21' } });
  });

  it('compares to the cent', async () => {
    expect(
      await findLikelyDuplicate(
        fakeSb({ data: [{ ...hand('2026-11-20'), amount: '250.01' }] }).sb,
        'o1',
        250,
        '2026-11-20',
        'hand_entered'
      )
    ).toEqual({ kind: 'none' });
    expect(
      (await findLikelyDuplicate(fakeSb({ data: [hand('2026-11-20')] }).sb, 'o1', 249.999999, '2026-11-20', 'hand_entered'))
        .kind
    ).toBe('found');
  });

  it('treats payments dated exactly 3 days apart, either way, as the same money (also across a month end)', async () => {
    expect(DUPLICATE_DATE_TOLERANCE_DAYS).toBe(3);
    for (const [rowDate, newDate] of [
      ['2026-11-17', '2026-11-20'],
      ['2026-11-23', '2026-11-20'],
      ['2026-12-03', '2026-11-30'],
    ]) {
      expect((await findLikelyDuplicate(fakeSb({ data: [hand(rowDate)] }).sb, 'o1', 250, newDate, 'hand_entered')).kind).toBe(
        'found'
      );
    }
  });

  it('does not match a same-amount payment dated 4 or more days away (deposit, then balance)', async () => {
    for (const [rowDate, newDate] of [
      ['2026-11-16', '2026-11-20'],
      ['2026-11-24', '2026-11-20'],
      ['2026-10-28', '2026-11-01'],
      ['2026-10-21', '2026-11-20'],
    ]) {
      expect(await findLikelyDuplicate(fakeSb({ data: [hand(rowDate)] }).sb, 'o1', 250, newDate, 'hand_entered')).toEqual({
        kind: 'none',
      });
    }
  });

  it('bounds the query by order, amount and the ±3-day date range, and asks for the e-Transfer link', async () => {
    const f = fakeSb({ data: [] });
    await findLikelyDuplicate(f.sb, 'o1', 250, '2026-11-20', 'hand_entered');
    expect(f.seen.table).toBe('payments');
    expect(f.seen.columns).toContain('etransfers(id)');
    expect(f.seen.filters).toEqual([
      ['eq', 'order_id', 'o1'],
      ['eq', 'amount', '250.00'],
      ['gte', 'paid_on', '2026-11-17'],
      ['lte', 'paid_on', '2026-11-23'],
    ]);
  });

  it('counts a row without the e-Transfer embed as hand-entered (the cautious reading for the webhook)', async () => {
    const { etransfers: _dropped, ...bare } = hand('2026-11-20');
    expect((await findLikelyDuplicate(fakeSb({ data: [bare] }).sb, 'o1', 250, '2026-11-20', 'hand_entered')).kind).toBe(
      'found'
    );
  });

  it('reports a date that is not a real calendar date as unknown, without querying', async () => {
    const f = fakeSb({ data: [] });
    expect((await findLikelyDuplicate(f.sb, 'o1', 250, '2026-02-31', 'hand_entered')).kind).toBe('unknown');
    expect(f.seen.table).toBe('');
  });

  it('reports a failed lookup as unknown, never as none', async () => {
    expect(
      await findLikelyDuplicate(fakeSb({ error: { message: 'read failed' } }).sb, 'o1', 250, '2026-11-20', 'hand_entered')
    ).toEqual({ kind: 'unknown', message: 'read failed' });
  });

  it('reports a client that throws as unknown', async () => {
    expect(
      await findLikelyDuplicate(fakeSb({}, { throws: true }).sb, 'o1', 250, '2026-11-20', 'hand_entered')
    ).toEqual({ kind: 'unknown', message: 'network down' });
  });

  it('reports a response that is not a list as unknown', async () => {
    expect(
      (await findLikelyDuplicate(fakeSb({ data: { id: 'x' } }).sb, 'o1', 250, '2026-11-20', 'hand_entered')).kind
    ).toBe('unknown');
  });
});

describe('duplicate wording', () => {
  const FOUND = { kind: 'found' as const, payment: { id: 'p-hand', amount: 250, paid_on: '2026-11-20' } };
  const UNKNOWN = { kind: 'unknown' as const, message: 'read failed' };

  it('explains a held transfer on the order when a matching payment exists', () => {
    expect(heldTransferLog(250, FOUND)).toBe(
      'An e-Transfer of $250.00 was matched to this order but NOT recorded automatically: ' +
        'a payment of $250.00 dated November 20, 2026 (within 3 days of this one) is already recorded here ' +
        'and may be the same money. It is waiting under Received e-Transfers in the Record payment sheet: ' +
        'apply it there if this is a second payment, or dismiss it if it is the same money.'
    );
  });

  it('explains a held transfer on the order when the check could not run', () => {
    expect(heldTransferLog(250, UNKNOWN)).toBe(
      'An e-Transfer of $250.00 was matched to this order but NOT recorded automatically: ' +
        'it could not be checked against the payments already recorded here (read failed). ' +
        'It is waiting under Received e-Transfers in the Record payment sheet: apply it there if this is a ' +
        'second payment, or dismiss it if it is the same money.'
    );
  });

  it('gives the alert a short reason with no trailing period', () => {
    expect(heldTransferAlert('T1114-126', FOUND)).toBe(
      'held for review: T1114-126 already has a $250.00 payment dated November 20, 2026'
    );
    expect(heldTransferAlert('T1114-126', UNKNOWN)).toBe(
      'held for review: T1114-126 could not be checked for an earlier payment'
    );
  });

  it('words the payment sheet question', () => {
    expect(manualDuplicateMessage({ id: 'p-et', amount: 250, paid_on: '2026-11-20' })).toBe(
      'An e-Transfer of $250.00 dated November 20, 2026 is already recorded on this order, within 3 days of ' +
        'this payment. Record this payment as well only if the customer really paid twice.'
    );
  });
});
