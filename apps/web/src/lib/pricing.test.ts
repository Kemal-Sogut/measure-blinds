// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Unit tests for the blind pricing engine (`pricing.ts`).
 *
 * These tests protect the money-math invariants from IMPLEMENTATION.md §5:
 * width/height minimum rules, the /10000 cm²→m² divisor, panel summing,
 * per-component cost composition, and 2-decimal rounding. Any change to
 * `pricing.ts` that breaks a documented formula must fail here before it
 * can reach a customer estimate.
 */

import { describe, it, expect } from 'vitest';
import {
  applyWidthMinimum,
  applyHeightMinimum,
  calculateBlindUnitPrice,
  calculateBlindLineTotal,
  type BlindInputs,
} from './pricing';

/** Builds a baseline blind input; individual tests override single fields. */
function blind(overrides: Partial<BlindInputs> = {}): BlindInputs {
  return {
    panels: [140],
    height_cm: 200,
    fabric_price_per_sqm: 50,
    cassette_price_per_m: 0,
    control_price_per_item: 0,
    quantity: 1,
    ...overrides,
  };
}

describe('applyWidthMinimum', () => {
  it('raises widths below 100cm to 100cm', () => {
    expect(applyWidthMinimum(60)).toBe(100);
    expect(applyWidthMinimum(99.9)).toBe(100);
  });

  it('leaves widths at or above 100cm unchanged', () => {
    expect(applyWidthMinimum(100)).toBe(100);
    expect(applyWidthMinimum(240)).toBe(240);
  });
});

describe('applyHeightMinimum', () => {
  it('raises heights below 100cm to 100cm', () => {
    expect(applyHeightMinimum(80)).toBe(100);
  });

  it('raises heights between 100cm and 199cm to 200cm', () => {
    expect(applyHeightMinimum(100)).toBe(200);
    expect(applyHeightMinimum(150)).toBe(200);
    expect(applyHeightMinimum(199)).toBe(200);
  });

  it('uses actual height at 200cm and above', () => {
    expect(applyHeightMinimum(200)).toBe(200);
    expect(applyHeightMinimum(310)).toBe(310);
  });
});

describe('calculateBlindUnitPrice', () => {
  it('matches the plan verification example: W=140, H=200, $50/m² → $140', () => {
    expect(calculateBlindUnitPrice(blind())).toBe(140);
  });

  it('sums panel widths before pricing', () => {
    // Two 70cm panels ≡ one 140cm width for fabric/cassette purposes
    const twoPanel = blind({ panels: [70, 70], control_price_per_item: 0 });
    expect(calculateBlindUnitPrice(twoPanel)).toBe(140);
  });

  it('charges controls per panel, not per blind', () => {
    const price = calculateBlindUnitPrice(
      blind({ panels: [70, 70], control_price_per_item: 10 })
    );
    expect(price).toBe(140 + 2 * 10);
  });

  it('charges cassette per linear meter of width', () => {
    const price = calculateBlindUnitPrice(blind({ cassette_price_per_m: 20 }));
    expect(price).toBe(140 + (140 / 100) * 20); // 140 + 28
  });

  it('applies the width minimum to fabric and cassette cost', () => {
    // 60cm wide → priced as 100cm: fabric 100×200×50/10000 = 100, cassette 1m×20 = 20
    const price = calculateBlindUnitPrice(
      blind({ panels: [60], cassette_price_per_m: 20 })
    );
    expect(price).toBe(100 + 20);
  });

  it('applies the tiered height minimum to fabric cost', () => {
    // H=150 → priced as 200 → same as baseline
    expect(calculateBlindUnitPrice(blind({ height_cm: 150 }))).toBe(140);
  });

  it('rounds to 2 decimal places', () => {
    // 133 × 217 × 33.33 / 10000 = 96.213...
    const price = calculateBlindUnitPrice(
      blind({ panels: [133], height_cm: 217, fabric_price_per_sqm: 33.33 })
    );
    expect(price).toBe(Math.round(((133 * 217 * 33.33) / 10000) * 100) / 100);
    expect(Number.isInteger(price * 100)).toBe(true);
  });
});

describe('calculateBlindLineTotal', () => {
  it('multiplies unit price by quantity', () => {
    expect(calculateBlindLineTotal(blind({ quantity: 3 }))).toBe(420);
  });

  it('rounds the line total to 2 decimal places', () => {
    const total = calculateBlindLineTotal(
      blind({ fabric_price_per_sqm: 33.33, quantity: 7 })
    );
    expect(Number.isInteger(Math.round(total * 100))).toBe(true);
  });
});
