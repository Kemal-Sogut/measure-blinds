// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Base blind pricing calculator — the shared "main" calculation logic
 * used today for every blind type. Each supported blind type has its
 * own calculator module (`apps/web/src/lib/calculators/<type>.ts`) that
 * EXTENDS this class; for now they all inherit the default formula
 * unchanged. A subclass diverges by overriding one of the granular cost
 * hooks (`materialCost` / `cassetteCost` / `controlCost`), the minimum
 * rules (`applyWidthMinimum` / `applyHeightMinimum`), or the whole
 * `calculateUnitPrice` — whichever is the smallest correct change.
 *
 * AUTHORITATIVE: this server class is the twin of the server-side
 * `apps/api/src/lib/calculators/base.ts` used for live keystroke
 * previews. The two MUST stay in sync; `pricing.test.ts` on both sides
 * encodes the same expected values so any drift fails a suite.
 *
 * Formula (IMPLEMENTATION.md §5), all costs summed then rounded to 2dp:
 *   material = W × H × price_per_sqm / 10000   (cm² → m²)
 *   cassette = W / 100 × price_per_m           (per linear metre of width)
 *   control  = panelCount × price_per_item     (per panel)
 * with the width minimum (raise <100cm to 100cm) and the tiered height
 * minimum (<100→100, 100–199→200, ≥200→actual) applied first.
 */

/** Inputs required to price a single blind line item. */
export interface BlindPricingInputs {
  /** Individual panel widths in cm (summed for the effective width). */
  panels: number[];
  /** Height measurement in cm. */
  height_cm: number;
  /** Material cost per m² (server-fetched snapshot). */
  material_price_per_sqm: number;
  /** Cassette cost per linear metre of width (server-fetched snapshot). */
  cassette_price_per_m: number;
  /** Control cost per panel (server-fetched snapshot). */
  control_price_per_item: number;
}

/**
 * The default calculator. Instantiable on its own (used as the fallback
 * when a blind type has no dedicated calculator) and the superclass for
 * every per-type calculator.
 */
export class BaseBlindCalculator {
  /** Human-readable label of the blind type this calculator prices. */
  readonly blindType: string = 'Default';

  /**
   * Extra normalised name aliases that should resolve to this
   * calculator, on top of the normalised `blindType` label itself
   * (e.g. Sunscreen/Solar also answers to "solar"). Lowercase,
   * alphanumerics only — see `normalizeBlindType` in the registry.
   */
  readonly aliases: readonly string[] = [];

  /** Raises widths below 100cm to 100cm. */
  applyWidthMinimum(totalCm: number): number {
    return totalCm < 100 ? 100 : totalCm;
  }

  /** Tiered height minimum: <100→100, 100–199→200, ≥200→actual. */
  applyHeightMinimum(heightCm: number): number {
    if (heightCm < 100) return 100;
    if (heightCm < 200) return 200;
    return heightCm;
  }

  /** Material cost for the (already-minimised) width and height. */
  protected materialCost(widthCm: number, heightCm: number, pricePerSqm: number): number {
    return (widthCm * heightCm * pricePerSqm) / 10000;
  }

  /** Cassette cost, charged per linear metre of the effective width. */
  protected cassetteCost(widthCm: number, pricePerM: number): number {
    return (widthCm / 100) * pricePerM;
  }

  /** Control cost, charged per panel. */
  protected controlCost(panelCount: number, pricePerItem: number): number {
    return panelCount * pricePerItem;
  }

  /**
   * Unit price of one blind: material + cassette + control with the
   * width/height minimums applied first, rounded to 2 decimals.
   */
  calculateUnitPrice(item: BlindPricingInputs): number {
    const width = this.applyWidthMinimum(item.panels.reduce((a, b) => a + b, 0));
    const height = this.applyHeightMinimum(item.height_cm);
    const total =
      this.materialCost(width, height, item.material_price_per_sqm) +
      this.cassetteCost(width, item.cassette_price_per_m) +
      this.controlCost(item.panels.length, item.control_price_per_item);
    return Math.round(total * 100) / 100;
  }
}
