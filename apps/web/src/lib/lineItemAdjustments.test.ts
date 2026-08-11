// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Unit tests for the live-preview line-item adjustment arithmetic.
 *
 * This module is a TWIN of apps/api/src/lib/lineItemAdjustments.ts, whose
 * suite asserts the identical cases. The api side is authoritative; this
 * side only previews. A divergence means the browser quotes a price the
 * Worker will not charge, which is exactly the failure AI_GUIDELINES rule
 * 1 exists to prevent — so the two suites must be edited together.
 */

import { describe, it, expect } from 'vitest';
import { applyPriceAdjustments, addonsTotal, originalLineTotal } from './lineItemAdjustments';

describe('applyPriceAdjustments', () => {
  it('charges the calculated base and records no original when not overridden', () => {
    const result = applyPriceAdjustments({ base: 120, quantity: 2, override: null, addons: [] });
    expect(result).toEqual({
      unit_price: 120,
      base_unit_price: null,
      addons: [],
      line_total: 240,
    });
  });

  it('charges the override and preserves the base as the original', () => {
    const result = applyPriceAdjustments({ base: 120, quantity: 2, override: 95, addons: [] });
    expect(result.unit_price).toBe(95);
    expect(result.base_unit_price).toBe(120);
    expect(result.line_total).toBe(190);
  });

  it('treats a zero override as an override, not as "no override"', () => {
    const result = applyPriceAdjustments({ base: 120, quantity: 1, override: 0, addons: [] });
    expect(result.unit_price).toBe(0);
    expect(result.base_unit_price).toBe(120);
    expect(result.line_total).toBe(0);
  });

  it('adds each add-on ONCE, never multiplied by quantity', () => {
    const result = applyPriceAdjustments({
      base: 100,
      quantity: 3,
      override: null,
      addons: [{ label: 'Rush fee', price: 50 }, { label: 'Site measure', price: 25 }],
    });
    expect(result.line_total).toBe(375); // 100 x 3 + 50 + 25
  });

  it('stacks add-ons on top of an override', () => {
    const result = applyPriceAdjustments({
      base: 100,
      quantity: 2,
      override: 80,
      addons: [{ label: 'Rush fee', price: 50 }],
    });
    expect(result.line_total).toBe(210); // 80 x 2 + 50
  });

  it('rounds each add-on to the cent BEFORE summing, not after', () => {
    // Each add-on price is snapshotted onto the row and lands in a
    // numeric(10,2) column, so it is rounded individually — two half-cent
    // add-ons cost 0.01 + 0.01 = 0.02, not round2(0.01) = 0.01. Summing
    // first and rounding once would quote a price the database cannot
    // store, and the preview would drift from the charge by a cent.
    const result = applyPriceAdjustments({
      base: 0,
      quantity: 3,
      override: 10.005,
      addons: [{ label: 'a', price: 0.005 }, { label: 'b', price: 0.005 }],
    });
    expect(result.unit_price).toBe(10.01);
    expect(result.addons).toEqual([
      { label: 'a', price: 0.01 },
      { label: 'b', price: 0.01 },
    ]);
    expect(result.line_total).toBe(30.05); // round2(10.01 x 3) + 0.02
  });
});

describe('addonsTotal', () => {
  it('is 0 for no add-ons', () => {
    expect(addonsTotal([])).toBe(0);
  });

  it('sums to cents', () => {
    expect(addonsTotal([{ label: 'a', price: 10.1 }, { label: 'b', price: 20.2 }])).toBe(30.3);
  });
});

describe('originalLineTotal', () => {
  it('is null when the item is not overridden', () => {
    expect(originalLineTotal({ base_unit_price: null, quantity: 2, addons: [] })).toBeNull();
  });

  it('prices the original at the base unit, add-ons included', () => {
    expect(
      originalLineTotal({
        base_unit_price: 120,
        quantity: 2,
        addons: [{ label: 'Rush fee', price: 50 }],
      })
    ).toBe(290);
  });
});
