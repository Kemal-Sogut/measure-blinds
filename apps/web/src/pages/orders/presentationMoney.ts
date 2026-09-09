// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * The order view's money formatter (`/orders/:id/present`).
 *
 * Its own module rather than a helper inside `presentationCells.tsx`
 * because that file exports components: a React Fast Refresh boundary
 * only holds when a module exports components alone, so a plain function
 * living beside them costs the whole file its hot reload.
 */

/**
 * Formats a number as dollars, e.g. `$1234.50`.
 *
 * Unlike the one-line formatters elsewhere in the app this has to survive
 * NEGATIVES — the adjustment column goes below zero whenever a consultant
 * discounts a line, and the balance goes below zero on an overpayment — so
 * the sign LEADS and the dollar sign hugs the digits. Naive interpolation
 * yields `$-21.20`, which reads as a typo on a screen a customer is
 * looking at. The U+2212 minus (not a hyphen) matches the discount row on
 * the order-total strip.
 *
 * `null`, `undefined` and any non-numeric input format as `$0.00` rather
 * than throwing or printing `$NaN`: every caller reads a nullable money
 * column straight off a line item, and a blank figure on a customer-facing
 * table is worse than a zero.
 *
 * Callers pass figures that are already rounded to cents (`round2`, or a
 * stored money column). A magnitude below half a cent is not expected and
 * would format as `−$0.00`.
 */
export function money(value: number | null | undefined): string {
  const amount = Number(value) || 0;
  return `${amount < 0 ? '−' : ''}$${Math.abs(amount).toFixed(2)}`;
}
