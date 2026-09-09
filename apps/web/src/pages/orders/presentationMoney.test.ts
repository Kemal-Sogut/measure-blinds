// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins the order view's money formatter.
 *
 * The negative cases are the point. Every other money formatter in the app
 * interpolates naively because its figures cannot go below zero; this one
 * feeds the Adjustment column (a discounted line) and the Balance due row
 * (an overpayment), so `$-21.20` is a real thing it could print onto a
 * screen a customer is looking at. The sign must LEAD, and it must be the
 * U+2212 minus the discount row already uses — a hyphen renders visibly
 * shorter beside it.
 */

import { describe, it, expect } from 'vitest';
import { money } from './presentationMoney';

describe('money', () => {
  it('formats a positive amount to two decimals', () => {
    expect(money(1234.5)).toBe('$1234.50');
  });

  it('pads a whole number to two decimals', () => {
    expect(money(40)).toBe('$40.00');
  });

  it('formats zero without a sign', () => {
    expect(money(0)).toBe('$0.00');
  });

  it('leads a negative with the sign, keeping $ against the digits', () => {
    expect(money(-21.2)).toBe('−$21.20');
  });

  it('uses the U+2212 minus, not a hyphen', () => {
    expect(money(-5)).toBe('−$5.00');
    expect(money(-5)).not.toContain('-');
  });

  it('treats null and undefined as zero rather than printing NaN', () => {
    expect(money(null)).toBe('$0.00');
    expect(money(undefined)).toBe('$0.00');
  });

  it('treats a non-numeric value as zero', () => {
    expect(money(Number.NaN)).toBe('$0.00');
  });

  it('rounds half up at the cent, like every money path in the app', () => {
    expect(money(0.005)).toBe('$0.01');
    expect(money(19.999)).toBe('$20.00');
  });
});
