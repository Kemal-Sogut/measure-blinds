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
import type { PriceBasis } from './blindTypes/base';
import { getBlindType, normalizeBlindType } from './blindTypes';
import { calculateTotals } from './totals';
import { generateOrderNumber, parseDateOnly } from './orderNumber';

describe('pricing (server)', () => {
  it('matches the plan verification example: W=140, H=200, $50/m² → $140', () => {
    expect(
      calculateBlindUnitPrice({
        panels: [140],
        height_cm: 200,
        material_price_per_sqm: 50,
        hardware: {},
        attributes: {},
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
      hardware: {
        cassette: { price: 20, basis: 'per_m' as const },
        control: { price: 10, basis: 'per_panel' as const },
      },
      attributes: {},
    });
    expect(price).toBe(140 + 28 + 20);
  });

  it('charges the bottom rail per metre of the minimised width, like the cassette', () => {
    const base = {
      panels: [70, 70],
      height_cm: 200,
      material_price_per_sqm: 50,
      hardware: {},
      attributes: {},
    };
    // 140cm wide → 1.4m. A $15/m rail adds $21 on top of the $140 material.
    expect(
      calculateBlindUnitPrice({
        ...base,
        hardware: { bottom_rail: { price: 15, basis: 'per_m' as const } },
      })
    ).toBe(161);
    // The width MINIMUM applies first: 60cm is charged as 100cm = 1m.
    expect(
      calculateBlindUnitPrice({
        ...base,
        panels: [60],
        material_price_per_sqm: 0,
        hardware: { bottom_rail: { price: 15, basis: 'per_m' as const } },
      })
    ).toBe(15);
    // A zero-priced rail (the seeded default) must not move the price.
    expect(
      calculateBlindUnitPrice({
        ...base,
        hardware: { bottom_rail: { price: 0, basis: 'per_m' as const } },
      })
    ).toBe(140);
  });

  it('adds the flat installation charge once per blind, not per panel', () => {
    // Charged per BLIND: not per panel like the control, and not per
    // metre of width like the cassette and the rail. Migration 35 made
    // installation a real slot, so it reaches the formula as an input.
    const base = {
      height_cm: 200,
      material_price_per_sqm: 0,
      hardware: { installation: { price: 45, basis: 'per_unit' as const } },
      attributes: {},
    };
    expect(calculateBlindUnitPrice({ ...base, panels: [140] })).toBe(45);
    expect(calculateBlindUnitPrice({ ...base, panels: [70, 70] })).toBe(45);
    expect(calculateBlindUnitPrice({ ...base, panels: [140], hardware: {} })).toBe(0);
  });
});

describe('blind-type module registry', () => {
  it('normalises names, stripping spacing/case and a trailing "blind"', () => {
    expect(normalizeBlindType('Roller Blind')).toBe('roller');
    expect(normalizeBlindType('  ROLLER ')).toBe('roller');
    expect(normalizeBlindType('Vertical Sheer')).toBe('verticalsheer');
    expect(normalizeBlindType('Sun-screen/Solar')).toBe('sunscreensolar');
  });

  it('resolves each canonical type to its own module', () => {
    expect(getBlindType('Roller').blindType).toBe('Roller');
    expect(getBlindType('Zebra').blindType).toBe('Zebra');
    expect(getBlindType('Curtains').blindType).toBe('Curtains');
    // Alias + legacy snapshot name both resolve.
    expect(getBlindType('solar').blindType).toBe('Sunscreen/Solar');
    expect(getBlindType('Roller Blind').blindType).toBe('Roller');
  });

  it('falls back to the default module for unknown/empty types', () => {
    expect(getBlindType('Nonexistent').blindType).toBe('Default');
    expect(getBlindType('').blindType).toBe('Default');
    expect(getBlindType(null).blindType).toBe('Default');
  });

  it('type-aware pricing matches the default formula for every type that inherits it', () => {
    const inputs = {
      panels: [70, 70],
      height_cm: 200,
      material_price_per_sqm: 50,
      hardware: {
        cassette: { price: 20, basis: 'per_m' as const },
        control: { price: 10, basis: 'per_panel' as const },
      },
      attributes: {},
    };
    const expected = calculateBlindUnitPrice(inputs);
    // Curtains is excluded on purpose — it is the one type that has
    // diverged. Adding a type here that has its own formula would make
    // this assertion demand the divergence be undone.
    for (const type of ['Roller', 'Zebra', 'Honeycomb', 'Shutter', 'Nonexistent']) {
      expect(calculateBlindUnitPriceForType(type, inputs)).toBe(expected);
    }
  });

  it('Curtains does NOT price like the default', () => {
    const inputs = {
      panels: [70, 70],
      height_cm: 200,
      material_price_per_sqm: 50,
      hardware: {
        cassette: { price: 20, basis: 'per_m' as const },
        control: { price: 10, basis: 'per_panel' as const },
      },
      attributes: {},
    };
    // Fabric by the metre with no pleat chosen: 1.4 × 1 × 50 = 70, plus
    // 2 panels × 0.5 m × $50 hem allowance = 50, plus 2 panels × $10
    // control = 20, plus 1.4 m × $20 cassette = 28 → 168. The default
    // prices the same inputs at 188 (its material leg is the m² area).
    expect(calculateBlindUnitPriceForType('Curtains', inputs)).toBe(168);
    expect(calculateBlindUnitPriceForType('Curtains', inputs)).not.toBe(
      calculateBlindUnitPrice(inputs)
    );
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

describe('Curtains', () => {
  /**
   * One 300cm panel of $40/m fabric with no hardware charges. The
   * material rate is per RUNNING METRE for this type, not per m².
   *
   * The 200cm height is chosen so the base area formula and the Curtains
   * formula disagree (240 vs 300): at 250cm they coincide, and every
   * assertion below would pass without the override existing.
   */
  function curtain(attributes: Record<string, string | number | boolean>) {
    return {
      panels: [300],
      height_cm: 200,
      material_price_per_sqm: 40,
      hardware: {},
      attributes,
    };
  }

  it('prices fabric by the running metre times the pleat multiplier', () => {
    // 3.0 m × 2.5 × $40 = 300, + 1 panel × 0.5 m × $40 hem = $320.00
    expect(calculateBlindUnitPriceForType('Curtains', curtain({ pleat_multiplier: 2.5 }))).toBe(320);
  });

  it('ignores height entirely', () => {
    expect(
      calculateBlindUnitPriceForType('Curtains', {
        ...curtain({ pleat_multiplier: 2.5 }),
        height_cm: 100,
      })
    ).toBe(320);
  });

  it('adds the fixed installation charge once, not per panel', () => {
    // 3.0 × 2 × 40 = 240, + 20 hem, + 45 = 305. The charge arrives as a
    // pricing INPUT now (migration 35 made installation a real slot), not
    // as a snapshot inside the attribute blob.
    expect(
      calculateBlindUnitPriceForType('Curtains', {
        ...curtain({ pleat_multiplier: 2 }),
        hardware: { installation: { price: 45, basis: 'per_unit' } },
      })
    ).toBe(305);
  });

  it('adds the control charge per panel', () => {
    // width 300 → 3.0 × 2.5 × 40 = 300, + 2 panels × 0.5 × 40 = 40 hem,
    // + 2 panels × 30 control = 400.
    // A multiplier of exactly 2 would make this equal the base formula
    // at a 200cm height, so the assertion would hold without the override.
    expect(
      calculateBlindUnitPriceForType('Curtains', {
        ...curtain({ pleat_multiplier: 2.5 }),
        panels: [150, 150],
        hardware: { control: { price: 30, basis: 'per_panel' } },
      })
    ).toBe(400);
  });

  it('charges the hem allowance per panel, not per metre of width', () => {
    // Same 300cm of curtain, split in two: the fabric leg is unchanged
    // and ONLY the hem allowance moves, 0.5 m → 1.0 m (+$20). This is the
    // assertion that fails if the allowance is ever driven by the summed
    // panel WIDTH instead of the panel COUNT.
    const onePanel = calculateBlindUnitPriceForType('Curtains', curtain({ pleat_multiplier: 2.5 }));
    const twoPanels = calculateBlindUnitPriceForType('Curtains', {
      ...curtain({ pleat_multiplier: 2.5 }),
      panels: [150, 150],
    });
    expect(twoPanels - onePanel).toBe(20);
  });

  it('does not multiply the hem allowance by the pleat fullness', () => {
    // Fabric doubles from pleat 1 → 2 (120 → 240); the $20 hem allowance
    // is identical in both, so the gap is exactly the fabric leg.
    const flat = calculateBlindUnitPriceForType('Curtains', curtain({ pleat_multiplier: 1 }));
    const full = calculateBlindUnitPriceForType('Curtains', curtain({ pleat_multiplier: 2 }));
    expect(flat).toBe(140);
    expect(full).toBe(260);
  });

  it('charges a cassette or bottom rail if one is ever scoped to it', () => {
    // Curtains used to IGNORE these outright. It no longer does: it
    // overrides the fabric leg only, and the base sums whatever hardware
    // the blind carries. In practice none is scoped to Curtains, so this
    // is unreachable from the UI — but a silent zero would be a quote the
    // shop could not explain.
    // fabric 3.0 × 2 × 40 = 240, + 20 hem = 260, + 3.0 m × $99 cassette
    // = 297, + 3.0 m × $99 rail = 297.
    expect(
      calculateBlindUnitPriceForType('Curtains', {
        ...curtain({ pleat_multiplier: 2 }),
        hardware: {
          cassette: { price: 99, basis: 'per_m' as const },
          bottom_rail: { price: 99, basis: 'per_m' as const },
        },
      })
    ).toBe(854);
  });

  it('treats a legacy {} row as flat fabric with no installation', () => {
    // Migration 29 left every historical row at {}.
    // 3.0 × 1 × 40 = 120, + 20 hem = 140.
    expect(calculateBlindUnitPriceForType('Curtains', curtain({}))).toBe(140);
  });

  it('applies the 100cm width minimum', () => {
    // 60cm raised to 100cm → 1.0 × 2.5 × 40 = 100, + 20 hem = 120.
    // The minimum lifts the WIDTH only; the hem allowance is added after
    // it and is unaffected.
    expect(
      calculateBlindUnitPriceForType('Curtains', {
        ...curtain({ pleat_multiplier: 2.5 }),
        panels: [60],
      })
    ).toBe(120);
  });
});

/* ------------------------------------------------------------------ */
/* Price basis matrix                                                  */
/* ------------------------------------------------------------------ */

describe('hardware price basis', () => {
  /**
   * One blind, no material charge, one hardware slot at $10 — so the unit
   * price IS the hardware leg and each basis is read directly.
   *
   * Dimensions chosen to make the four answers distinct: 200cm across two
   * panels, 300cm drop. Both are at or above the minimums, so nothing is
   * rounded up underneath the assertion.
   *
   * This block is the contract for what a basis MEANS. It is mirrored
   * verbatim in the twin suite; if the two ever disagree, one of them is
   * quoting a price the other would not.
   */
  function charged(basis: PriceBasis, price = 10): number {
    return calculateBlindUnitPrice({
      panels: [100, 100],
      height_cm: 300,
      material_price_per_sqm: 0,
      hardware: { cassette: { price, basis } },
      attributes: {},
    });
  }

  it('per_m charges by the linear metre of width', () => {
    // 200cm = 2.0 m × $10
    expect(charged('per_m')).toBe(20);
  });

  it('per_sqm charges by the square metre of width × height', () => {
    // 200 × 300 / 10000 = 6.0 m² × $10
    expect(charged('per_sqm')).toBe(60);
  });

  it('per_panel charges once for each panel', () => {
    // 2 panels × $10
    expect(charged('per_panel')).toBe(20);
  });

  it('per_unit charges once for the blind, whatever its size', () => {
    expect(charged('per_unit')).toBe(10);
  });

  it('charges every slot on its OWN basis in one blind', () => {
    // A blind whose four slots disagree about how they are charged is the
    // whole point of migration 36, and the case a per-slot hardcoded
    // basis could not express.
    const price = calculateBlindUnitPrice({
      panels: [100, 100],
      height_cm: 300,
      material_price_per_sqm: 0,
      hardware: {
        cassette: { price: 10, basis: 'per_m' },        // 2.0 m  → 20
        bottom_rail: { price: 10, basis: 'per_sqm' },   // 6.0 m² → 60
        control: { price: 10, basis: 'per_panel' },     // 2      → 20
        installation: { price: 10, basis: 'per_unit' }, // once   → 10
      },
      attributes: {},
    });
    expect(price).toBe(110);
  });

  it('charges the basis legs on the MINIMISED dimensions', () => {
    // 60cm wide, 80cm drop → charged as 100cm × 100cm, the same figures
    // the material leg uses. A hardware leg on the raw measurement would
    // price two lines of one quote off different dimensions.
    const perM = calculateBlindUnitPrice({
      panels: [60],
      height_cm: 80,
      material_price_per_sqm: 0,
      hardware: { cassette: { price: 10, basis: 'per_m' } },
      attributes: {},
    });
    const perSqm = calculateBlindUnitPrice({
      panels: [60],
      height_cm: 80,
      material_price_per_sqm: 0,
      hardware: { cassette: { price: 10, basis: 'per_sqm' } },
      attributes: {},
    });
    expect(perM).toBe(10); // 1.0 m
    expect(perSqm).toBe(10); // 1.0 m²
  });

  it('charges nothing for a slot the blind does not carry', () => {
    expect(
      calculateBlindUnitPrice({
        panels: [100, 100],
        height_cm: 300,
        material_price_per_sqm: 0,
        hardware: {},
        attributes: {},
        })
    ).toBe(0);
  });
});
