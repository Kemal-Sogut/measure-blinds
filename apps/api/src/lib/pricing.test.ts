// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Unit tests for the server-side pricing and totals modules.
 *
 * These encode the SAME expected values as the web-side suites
 * (apps/web/src/lib/pricing.test.ts / totals.test.ts). If either side
 * drifts from the shared formulas, one of the suites fails — that is
 * the sync guarantee between live preview and authoritative recalc.
 */

import { describe, it, expect } from 'vitest';
import {
  applyWidthMinimum,
  applyHeightMinimum,
  calculateBlindUnitPrice,
  calculateBlindUnitPriceForType,
} from './pricing';
import { getCalculator, normalizeBlindType } from './calculators';
import { calculateTotals } from './totals';
import { generateOrderNumber, parseDateOnly } from './orderNumber';

describe('pricing (server)', () => {
  it('matches the plan verification example: W=140, H=200, $50/m² → $140', () => {
    expect(
      calculateBlindUnitPrice({
        panels: [140],
        height_cm: 200,
        material_price_per_sqm: 50,
        cassette_price_per_m: 0,
        control_price_per_item: 0,
      })
    ).toBe(140);
  });

  it('applies width and height minimums', () => {
    expect(applyWidthMinimum(60)).toBe(100);
    expect(applyHeightMinimum(150)).toBe(200);
    expect(applyHeightMinimum(210)).toBe(210);
  });

  it('sums panels, charges controls per panel and cassette per meter', () => {
    const price = calculateBlindUnitPrice({
      panels: [70, 70],
      height_cm: 200,
      material_price_per_sqm: 50,
      cassette_price_per_m: 20,
      control_price_per_item: 10,
    });
    expect(price).toBe(140 + 28 + 20);
  });
});

describe('blind-type calculator registry', () => {
  it('normalises names, stripping spacing/case and a trailing "blind"', () => {
    expect(normalizeBlindType('Roller Blind')).toBe('roller');
    expect(normalizeBlindType('  ROLLER ')).toBe('roller');
    expect(normalizeBlindType('Vertical Sheer')).toBe('verticalsheer');
    expect(normalizeBlindType('Sun-screen/Solar')).toBe('sunscreensolar');
  });

  it('resolves each canonical type to its own calculator', () => {
    expect(getCalculator('Roller').blindType).toBe('Roller');
    expect(getCalculator('Zebra').blindType).toBe('Zebra');
    expect(getCalculator('Curtains').blindType).toBe('Curtains');
    // Alias + legacy snapshot name both resolve.
    expect(getCalculator('solar').blindType).toBe('Sunscreen/Solar');
    expect(getCalculator('Roller Blind').blindType).toBe('Roller');
  });

  it('falls back to the default calculator for unknown/empty types', () => {
    expect(getCalculator('Nonexistent').blindType).toBe('Default');
    expect(getCalculator('').blindType).toBe('Default');
    expect(getCalculator(null).blindType).toBe('Default');
  });

  it('type-aware pricing matches the default formula while all types inherit it', () => {
    const inputs = {
      panels: [70, 70],
      height_cm: 200,
      material_price_per_sqm: 50,
      cassette_price_per_m: 20,
      control_price_per_item: 10,
    };
    const expected = calculateBlindUnitPrice(inputs);
    for (const type of ['Roller', 'Zebra', 'Honeycomb', 'Shutter', 'Curtains', 'Nonexistent']) {
      expect(calculateBlindUnitPriceForType(type, inputs)).toBe(expected);
    }
  });
});

describe('totals (server)', () => {
  it('applies discount before 13% HST', () => {
    const t = calculateTotals([200], 'fixed', 50);
    expect(t.taxable_amount).toBe(150);
    expect(t.tax_amount).toBe(19.5);
    expect(t.total).toBe(169.5);
  });

  it('percent discount and clamping', () => {
    expect(calculateTotals([200], 'percent', 10).discount_amount).toBe(20);
    expect(calculateTotals([100], 'fixed', 250).taxable_amount).toBe(0);
    expect(calculateTotals([100], 'fixed', -5).discount_amount).toBe(0);
  });
});

describe('orderNumber (server)', () => {
  it('formats per §4: Tuesday Aug 4 2026, 1st of day → T0408-126', () => {
    expect(generateOrderNumber(new Date(2026, 7, 4), 1)).toBe('T0408-126');
  });

  it('parseDateOnly avoids the UTC midnight shift', () => {
    const d = parseDateOnly('2026-08-04');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(4);
  });
});
