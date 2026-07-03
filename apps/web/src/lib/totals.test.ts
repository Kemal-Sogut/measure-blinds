// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Unit tests for estimate totals (`totals.ts`).
 *
 * Locks the §6 calculation order (subtotal → discount → taxable →
 * HST 13% → total), discount-before-tax semantics, clamping rules,
 * and 2-decimal rounding. The API-side copy of this logic is covered
 * by an equivalent suite; a failure in either signals drift.
 */

import { describe, it, expect } from 'vitest';
import { calculateTotals, HST_RATE } from './totals';

describe('calculateTotals', () => {
  it('computes the documented order with no discount', () => {
    const t = calculateTotals({ lineTotals: [140, 60], discount_type: 'fixed', discount_value: 0 });
    expect(t.subtotal).toBe(200);
    expect(t.discount_amount).toBe(0);
    expect(t.taxable_amount).toBe(200);
    expect(t.tax_amount).toBe(26); // 200 × 0.13
    expect(t.total).toBe(226);
    expect(t.tax_rate).toBe(HST_RATE);
  });

  it('applies a fixed discount before tax', () => {
    const t = calculateTotals({ lineTotals: [200], discount_type: 'fixed', discount_value: 50 });
    expect(t.taxable_amount).toBe(150);
    expect(t.tax_amount).toBe(19.5);
    expect(t.total).toBe(169.5);
  });

  it('applies a percent discount of the subtotal', () => {
    const t = calculateTotals({ lineTotals: [200], discount_type: 'percent', discount_value: 10 });
    expect(t.discount_amount).toBe(20);
    expect(t.taxable_amount).toBe(180);
    expect(t.total).toBe(round2(180 * 1.13));
  });

  it('clamps a fixed discount larger than the subtotal', () => {
    const t = calculateTotals({ lineTotals: [100], discount_type: 'fixed', discount_value: 250 });
    expect(t.discount_amount).toBe(100);
    expect(t.taxable_amount).toBe(0);
    expect(t.total).toBe(0);
  });

  it('clamps percent discounts above 100 and negative discounts', () => {
    const over = calculateTotals({ lineTotals: [100], discount_type: 'percent', discount_value: 150 });
    expect(over.taxable_amount).toBe(0);
    const neg = calculateTotals({ lineTotals: [100], discount_type: 'fixed', discount_value: -5 });
    expect(neg.discount_amount).toBe(0);
    expect(neg.total).toBe(113);
  });

  it('rounds every stage to 2 decimals', () => {
    const t = calculateTotals({
      lineTotals: [33.335, 66.665],
      discount_type: 'percent',
      discount_value: 7.5,
    });
    for (const v of Object.values(t)) {
      expect(Number.isInteger(Math.round(v * 100))).toBe(true);
      expect(Math.abs(v * 100 - Math.round(v * 100))).toBeLessThan(1e-9);
    }
  });

  it('handles an empty estimate', () => {
    const t = calculateTotals({ lineTotals: [], discount_type: 'fixed', discount_value: 0 });
    expect(t.subtotal).toBe(0);
    expect(t.total).toBe(0);
  });
});

/** Local mirror of the module's rounding for expected-value math. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
