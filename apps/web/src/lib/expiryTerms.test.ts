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
import { EXPIRY_PRESETS, expiryFromPreset } from './expiryTerms';

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
