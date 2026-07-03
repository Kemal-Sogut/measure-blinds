// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Server-side estimate totals — the AUTHORITATIVE implementation of
 * the IMPLEMENTATION.md §6 order: subtotal → discount (before tax) →
 * taxable → 13% HST → total, each stage rounded to 2 decimals.
 *
 * Mirrors apps/web/src/lib/totals.ts (client live preview). The two
 * MUST stay in sync; both are pinned by equivalent unit tests.
 */

/** Ontario HST rate — fixed by business rule. */
export const HST_RATE = 0.13;

/** Discount entry mode. */
export type DiscountType = 'fixed' | 'percent';

/** Complete totals breakdown as persisted on the estimates row. */
export interface Totals {
  subtotal: number;
  discount_amount: number;
  taxable_amount: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
}

/** Rounds to 2 decimal places (half-up). */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Computes the totals breakdown. The discount is clamped to
 * [0, subtotal] so the taxable amount can never go negative.
 */
export function calculateTotals(
  lineTotals: number[],
  discount_type: DiscountType,
  discount_value: number
): Totals {
  const subtotal = round2(lineTotals.reduce((a, b) => a + b, 0));
  const rawDiscount =
    discount_type === 'percent' ? (subtotal * discount_value) / 100 : discount_value;
  const discount_amount = round2(Math.min(Math.max(rawDiscount, 0), subtotal));
  const taxable_amount = round2(subtotal - discount_amount);
  const tax_amount = round2(taxable_amount * HST_RATE);
  const total = round2(taxable_amount + tax_amount);
  return { subtotal, discount_amount, taxable_amount, tax_rate: HST_RATE, tax_amount, total };
}
