// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Server-side blind pricing — the AUTHORITATIVE implementation of the
 * IMPLEMENTATION.md §5 formula. The Worker recomputes every line item
 * from catalog prices it fetched itself, so client-supplied prices can
 * never reach the database.
 *
 * This mirrors apps/web/src/lib/pricing.ts (used for live keystroke
 * previews). The two files MUST stay in sync; both have equivalent
 * unit test suites that encode the same expected values.
 */

/** Applies the minimum width rule: widths below 100cm are charged as 100cm. */
export function applyWidthMinimum(totalCm: number): number {
  return totalCm < 100 ? 100 : totalCm;
}

/**
 * Applies the tiered minimum height rule:
 * <100cm → 100cm; 100–199cm → 200cm; ≥200cm → actual.
 */
export function applyHeightMinimum(heightCm: number): number {
  if (heightCm < 100) return 100;
  if (heightCm < 200) return 200;
  return heightCm;
}

/** Inputs required to price a single blind line item. */
export interface BlindPricingInputs {
  /** Individual panel widths in cm */
  panels: number[];
  /** Height measurement in cm */
  height_cm: number;
  /** Fabric cost per m² (server-fetched snapshot) */
  fabric_price_per_sqm: number;
  /** Cassette cost per linear meter of width (server-fetched snapshot) */
  cassette_price_per_m: number;
  /** Control cost per panel (server-fetched snapshot) */
  control_price_per_item: number;
}

/**
 * Computes the unit price of one blind:
 * fabric (W×H×price/10000) + cassette (W/100×price) + controls (panels×price),
 * with width/height minimums applied first. Rounded to 2 decimals.
 */
export function calculateBlindUnitPrice(item: BlindPricingInputs): number {
  const W = applyWidthMinimum(item.panels.reduce((a, b) => a + b, 0));
  const H = applyHeightMinimum(item.height_cm);
  const fabricCost = (W * H * item.fabric_price_per_sqm) / 10000;
  const cassetteCost = (W / 100) * item.cassette_price_per_m;
  const controlCost = item.panels.length * item.control_price_per_item;
  return Math.round((fabricCost + cassetteCost + controlCost) * 100) / 100;
}
