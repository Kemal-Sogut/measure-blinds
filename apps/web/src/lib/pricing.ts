// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Client-side pricing calculation logic for blind line items.
 *
 * Implements the exact pricing formula from IMPLEMENTATION.md §5:
 *   unit_price = (W × H × fabric_price_per_sqm) / 10000
 *              + (W / 100 × cassette_price_per_m)
 *              + (numPanels × control_price_per_item)
 *
 * Width and height minimums are applied independently:
 *   - Width: if total panel width < 100cm, treat as 100cm
 *   - Height: if < 100cm → 100cm; if 100-199cm → 200cm; if ≥ 200cm → actual
 *
 * These calculations run on every keystroke for live preview.
 * The Worker recalculates authoritatively on save to prevent tampering.
 */

/**
 * Applies the minimum width rule: widths below 100cm are charged as 100cm.
 *
 * @param totalCm - Total width from summing all panel widths
 * @returns Effective width in cm for pricing (minimum 100cm)
 */
export function applyWidthMinimum(totalCm: number): number {
  return totalCm < 100 ? 100 : totalCm;
}

/**
 * Applies the tiered minimum height rule for pricing:
 * - Below 100cm → charged as 100cm
 * - 100cm to 199cm → charged as 200cm
 * - 200cm and above → actual height used
 *
 * @param heightCm - Actual height measurement in cm
 * @returns Effective height in cm for pricing
 */
export function applyHeightMinimum(heightCm: number): number {
  if (heightCm < 100) return 100;
  if (heightCm < 200) return 200;
  return heightCm;
}

/** Input parameters required to calculate a single blind's unit price. */
export interface BlindInputs {
  /** Individual panel widths in cm (e.g., [70, 70] for a two-panel blind) */
  panels: number[];
  /** Height measurement in cm */
  height_cm: number;
  /** Fabric cost per square meter from the fabrics settings table */
  fabric_price_per_sqm: number;
  /** Cassette cost per linear meter (charged by width) from cassette options */
  cassette_price_per_m: number;
  /** Control mechanism cost per panel from control options */
  control_price_per_item: number;
  /** Number of identical blinds */
  quantity: number;
}

/**
 * Calculates the unit price for a single blind, applying width/height
 * minimums and summing fabric, cassette, and control costs.
 *
 * @param item - Blind specification with dimensions, pricing, and panel layout
 * @returns Unit price in dollars, rounded to 2 decimal places
 */
export function calculateBlindUnitPrice(item: BlindInputs): number {
  const numPanels = item.panels.length;
  const rawWidth = item.panels.reduce((a, b) => a + b, 0);
  const W = applyWidthMinimum(rawWidth);
  const H = applyHeightMinimum(item.height_cm);

  const fabricCost = (W * H * item.fabric_price_per_sqm) / 10000;
  const cassetteCost = (W / 100) * item.cassette_price_per_m;
  const controlCost = numPanels * item.control_price_per_item;

  return Math.round((fabricCost + cassetteCost + controlCost) * 100) / 100;
}

/**
 * Calculates the total line cost for a blind item (unit price × quantity).
 *
 * @param item - Blind specification with dimensions, pricing, and quantity
 * @returns Line total in dollars, rounded to 2 decimal places
 */
export function calculateBlindLineTotal(item: BlindInputs): number {
  return Math.round(calculateBlindUnitPrice(item) * item.quantity * 100) / 100;
}
