// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Unit tests for `expiryFromPreset`.
 *
 * The cases that matter are the ones plain `setDate`/`setMonth`
 * arithmetic gets wrong: month rollover on day offsets, and the
 * end-of-month clamp for the "1 month" term (Jan 31 must not become
 * Mar 3). Also asserts the input Date is never mutated, since the caller
 * passes React state straight in.
 */

import { describe, expect, it } from 'vitest';
import { EXPIRY_PRESETS, expiryFromPreset, presetFromDates } from './expiryTerms';

/** Local-time date, avoiding UTC parsing of 'YYYY-MM-DD' strings. */
function at(y: number, m: number, d: number): Date {
  return new Date(y, m - 1, d);
}

describe('expiryFromPreset', () => {
  it('expires the same day for "on receipt"', () => {
    expect(expiryFromPreset(at(2026, 8, 4), 'on_receipt')).toEqual(at(2026, 8, 4));
  });

  it('adds day offsets', () => {
    const base = at(2026, 8, 4);
    expect(expiryFromPreset(base, 'd1')).toEqual(at(2026, 8, 5));
    expect(expiryFromPreset(base, 'd3')).toEqual(at(2026, 8, 7));
    expect(expiryFromPreset(base, 'd7')).toEqual(at(2026, 8, 11));
    expect(expiryFromPreset(base, 'd15')).toEqual(at(2026, 8, 19));
  });

  it('rolls day offsets over a month boundary', () => {
    expect(expiryFromPreset(at(2026, 8, 28), 'd7')).toEqual(at(2026, 9, 4));
  });

  it('adds one calendar month', () => {
    expect(expiryFromPreset(at(2026, 8, 4), 'm1')).toEqual(at(2026, 9, 4));
    expect(expiryFromPreset(at(2026, 12, 15), 'm1')).toEqual(at(2027, 1, 15));
  });

  it('clamps "1 month" to the last day of a shorter month', () => {
    expect(expiryFromPreset(at(2026, 1, 31), 'm1')).toEqual(at(2026, 2, 28));
    expect(expiryFromPreset(at(2028, 1, 31), 'm1')).toEqual(at(2028, 2, 29));
    expect(expiryFromPreset(at(2026, 3, 31), 'm1')).toEqual(at(2026, 4, 30));
  });

  it('does not mutate the order date', () => {
    const base = at(2026, 8, 4);
    for (const p of EXPIRY_PRESETS) expiryFromPreset(base, p.id);
    expect(base).toEqual(at(2026, 8, 4));
  });
});

describe('presetFromDates', () => {
  it('round-trips every term', () => {
    const base = at(2026, 8, 6);
    for (const p of EXPIRY_PRESETS) {
      expect(presetFromDates(base, expiryFromPreset(base, p.id))).toBe(p.id);
    }
  });

  it('recovers the term a saved order was dated with', () => {
    // The order that exposed the bug: Aug 6 → Aug 21 is the 15-day term.
    expect(presetFromDates(at(2026, 8, 6), at(2026, 8, 21))).toBe('d15');
  });

  it('returns null for a gap no term explains', () => {
    // The company default is 14 days — deliberately not a chip.
    expect(presetFromDates(at(2026, 8, 1), at(2026, 8, 15))).toBeNull();
    // Same day is a term ("on receipt"); an expiry BEFORE the order date
    // is not, even though the API/DB would reject it anyway.
    expect(presetFromDates(at(2026, 8, 4), at(2026, 8, 4))).toBe('on_receipt');
    expect(presetFromDates(at(2026, 8, 4), at(2026, 7, 30))).toBeNull();
  });

  it('ignores a time component on the order date', () => {
    const dated = new Date(2026, 7, 6, 16, 45, 30);
    expect(presetFromDates(dated, at(2026, 8, 13))).toBe('d7');
  });
});
