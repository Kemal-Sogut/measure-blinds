// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Estimate totals calculation — the exact order from IMPLEMENTATION.md §6:
 *
 *   subtotal        = Σ line_total
 *   discount_amount = fixed value, or percent of subtotal (capped at subtotal)
 *   taxable_amount  = subtotal − discount_amount
 *   tax_amount      = taxable_amount × 13% (Ontario HST, fixed)
 *   total           = taxable_amount + tax_amount
 *
 * Every intermediate value is rounded to 2 decimals so the client
 * preview matches the Worker's authoritative recalculation exactly.
 * The same logic exists in apps/api/src/lib/totals.ts — the two files
 * MUST stay in sync (both are covered by equivalent unit tests).
 */

/** Ontario HST rate — fixed by business rule, not configurable. */
export const HST_RATE = 0.13;

/** Discount entry mode. */
export type DiscountType = 'fixed' | 'percent';

/** Inputs for a totals calculation. */
export interface TotalsInput {
  /** Line totals of every line item on the estimate */
  lineTotals: number[];
  /** How the discount value is interpreted */
  discount_type: DiscountType;
  /** Dollar amount (fixed) or percentage 0-100 (percent) */
  discount_value: number;
}

/** Complete totals breakdown as stored on the estimate row. */
export interface Totals {
  subtotal: number;
  discount_amount: number;
  taxable_amount: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
}

/** Rounds to 2 decimal places using standard half-up rounding. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Computes the full totals breakdown for an estimate.
 *
 * The discount is clamped to [0, subtotal] so a fixed discount larger
 * than the subtotal (or a percent > 100) can never produce a negative
 * taxable amount.
 */
export function calculateTotals(input: TotalsInput): Totals {
  const subtotal = round2(input.lineTotals.reduce((a, b) => a + b, 0));

  const rawDiscount =
    input.discount_type === 'percent'
      ? (subtotal * input.discount_value) / 100
      : input.discount_value;
  const discount_amount = round2(Math.min(Math.max(rawDiscount, 0), subtotal));

  const taxable_amount = round2(subtotal - discount_amount);
  const tax_amount = round2(taxable_amount * HST_RATE);
  const total = round2(taxable_amount + tax_amount);

  return {
    subtotal,
    discount_amount,
    taxable_amount,
    tax_rate: HST_RATE,
    tax_amount,
    total,
  };
}
