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
  type BlindPricingInputs,
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

  it('sums only the visible line totals it is given', () => {
    // Hidden items are filtered out BEFORE this function is called, here
    // and in the web preview alike. Mirrors the identically named case
    // in apps/web/src/lib/totals.test.ts — the two must agree.
    const t = calculateTotals([364], 'fixed', 0);
    expect(t.subtotal).toBe(364);
    expect(t.total).toBe(411.32);
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

describe('describeUnitCosts (server)', () => {
  /** A blind carrying a charge on all four slots, one per basis family. */
  const loaded: BlindPricingInputs = {
    panels: [140],
    height_cm: 200,
    material_price_per_sqm: 50,
    hardware: {
      cassette: { price: 12, basis: 'per_m' as PriceBasis },
      bottom_rail: { price: 8, basis: 'per_m' as PriceBasis },
      control: { price: 25, basis: 'per_panel' as PriceBasis },
      installation: { price: 30, basis: 'per_unit' as PriceBasis },
    },
    attributes: {},
  };

  it('reports the material leg plus one leg per charge carried', () => {
    // toBeCloseTo, not toBe: (140/100) * 12 is 16.799999999999997 in
    // IEEE-754. The legs are deliberately unrounded — the price rounds
    // their SUM once — so exact equality would fail for reasons that have
    // nothing to do with the formula.
    const legs = getBlindType('Roller').describeUnitCosts(loaded);
    expect(legs.material).toBeCloseTo(140, 10); // 140 × 200 × 50 / 10000
    expect(legs.cassette).toBeCloseTo(16.8, 10); // 1.4 m × 12
    expect(legs.bottom_rail).toBeCloseTo(11.2, 10); // 1.4 m × 8
    expect(legs.control).toBeCloseTo(25, 10); // 1 panel × 25
    expect(legs.installation).toBeCloseTo(30, 10); // flat
  });

  it('omits a slot the blind does not carry rather than reporting it as 0', () => {
    const legs = getBlindType('Roller').describeUnitCosts({
      panels: [140],
      height_cm: 200,
      material_price_per_sqm: 50,
      hardware: {},
      attributes: {},
    });
    expect(Object.keys(legs)).toEqual(['material']);
    expect(legs.control).toBeUndefined();
  });

  it('inserts hardware legs in the order both callers build the map', () => {
    // Not cosmetic: calculateUnitPrice reduces over these values and
    // floating-point addition is not associative, so a different order
    // could shift the last ULP and, at a half-cent boundary, the cent.
    expect(Object.keys(getBlindType('Roller').describeUnitCosts(loaded))).toEqual([
      'material',
      'cassette',
      'bottom_rail',
      'control',
      'installation',
    ]);
  });

  it('applies the width and height minimums, like the price does', () => {
    const legs = getBlindType('Roller').describeUnitCosts({
      panels: [60],
      height_cm: 150,
      material_price_per_sqm: 50,
      hardware: { cassette: { price: 12, basis: 'per_m' as PriceBasis } },
      attributes: {},
    });
    expect(legs.material).toBeCloseTo(100, 10); // minimised to 100cm × 200cm
    expect(legs.cassette).toBeCloseTo(12, 10); // charged on the minimised 100cm
  });

  it('sums to calculateUnitPrice for every registered blind type', () => {
    for (const type of [
      'Roller',
      'Zebra',
      'Sunscreen/Solar',
      'Roman',
      'Honeycomb',
      'Shutter',
      'Vertical Panel',
      'Vertical Roller',
      'Vertical Sheer',
      'Curtains',
    ]) {
      const module = getBlindType(type);
      const { material, ...hw } = module.describeUnitCosts(loaded);
      const summed =
        Math.round((material + Object.values(hw).reduce((s, c) => s + (c ?? 0), 0)) * 100) / 100;
      expect(summed).toBe(module.calculateUnitPrice(loaded));
    }
  });
});

describe('describeMaterialUsage (server)', () => {
  /** A blind whose raw dimensions are BELOW both minimums, so billed and measured differ. */
  function small(): BlindPricingInputs {
    return {
      panels: [60],
      height_cm: 80,
      material_price_per_sqm: 50,
      hardware: {},
      attributes: {},
    };
  }

  it('reports billed square metres with the minimums applied', () => {
    // 60cm → 100cm, 80cm → 100cm, so 1.00 m² is billed on 0.48 m² measured.
    const usage = getBlindType('Roller').describeMaterialUsage(small());
    expect(usage.unit).toBe('sqm');
    expect(usage.quantity).toBeCloseTo(1, 10);
    expect(usage.measured).toBeCloseTo(0.48, 10);
  });

  it('reports billed and measured as equal once both minimums are cleared', () => {
    const usage = getBlindType('Roller').describeMaterialUsage({
      ...small(),
      panels: [140],
      height_cm: 200,
    });
    expect(usage.quantity).toBeCloseTo(2.8, 10);
    expect(usage.measured).toBeCloseTo(2.8, 10);
  });

  it('sums panel widths before applying the width minimum', () => {
    const usage = getBlindType('Roller').describeMaterialUsage({
      ...small(),
      panels: [70, 90],
      height_cm: 200,
    });
    expect(usage.quantity).toBeCloseTo(3.2, 10);
  });

  it('reports running metres for Curtains, not square metres', () => {
    // 3.0 m × 2.5 fullness + 1 panel × 0.5 m hem = 8.00 running metres.
    const usage = getBlindType('Curtains').describeMaterialUsage({
      panels: [300],
      height_cm: 200,
      material_price_per_sqm: 40,
      hardware: {},
      attributes: { pleat_multiplier: 2.5 },
    });
    expect(usage.unit).toBe('running_m');
    expect(usage.quantity).toBeCloseTo(8, 10);
  });

  it('leaves the Curtains hem allowance out of the fullness multiplication', () => {
    // Fullness 1 → 3.0 + 2 panels × 0.5 = 4.00, NOT (3.0 + 1.0) × 1.
    const usage = getBlindType('Curtains').describeMaterialUsage({
      panels: [150, 150],
      height_cm: 200,
      material_price_per_sqm: 40,
      hardware: {},
      attributes: { pleat_multiplier: 1 },
    });
    expect(usage.quantity).toBeCloseTo(4, 10);
  });

  it('applies the width minimum to Curtains but never the height minimum', () => {
    // 60cm → 100cm = 1.0 m running × 2 + 1 hem × 0.5 = 2.50; height is irrelevant.
    const usage = getBlindType('Curtains').describeMaterialUsage({
      panels: [60],
      height_cm: 80,
      material_price_per_sqm: 40,
      hardware: {},
      attributes: { pleat_multiplier: 2 },
    });
    expect(usage.quantity).toBeCloseTo(2.5, 10);
    expect(usage.measured).toBeCloseTo(1.7, 10);
  });
});

describe('describeMaterialUsage agrees with the material leg it reports on', () => {
  /**
   * The spec (§4.2) deliberately does NOT derive `materialCost` from
   * `describeMaterialUsage`, because reassociating the multiplication
   * could move a stored cent. This test is the entire mitigation for
   * that decision: it is what turns a silent drift between the two
   * expressions into a failure.
   */
  const CASES: { type: string; item: BlindPricingInputs }[] = [
    { type: 'Roller', item: { panels: [60], height_cm: 80, material_price_per_sqm: 45, hardware: {}, attributes: {} } },
    { type: 'Roller', item: { panels: [140], height_cm: 200, material_price_per_sqm: 50, hardware: {}, attributes: {} } },
    { type: 'Roller', item: { panels: [120], height_cm: 150, material_price_per_sqm: 33.33, hardware: {}, attributes: {} } },
    { type: 'Roller', item: { panels: [100], height_cm: 200, material_price_per_sqm: 19.99, hardware: {}, attributes: {} } },
    { type: 'Zebra', item: { panels: [70, 90], height_cm: 210, material_price_per_sqm: 62.5, hardware: {}, attributes: {} } },
    { type: 'Roman', item: { panels: [99.9], height_cm: 199, material_price_per_sqm: 41.1, hardware: {}, attributes: {} } },
    { type: 'Sunscreen/Solar', item: { panels: [250], height_cm: 260, material_price_per_sqm: 77, hardware: {}, attributes: {} } },
    { type: 'Honeycomb', item: { panels: [180], height_cm: 100, material_price_per_sqm: 55, hardware: {}, attributes: {} } },
    { type: 'Shutter', item: { panels: [200], height_cm: 200, material_price_per_sqm: 120, hardware: {}, attributes: {} } },
    { type: 'Vertical Sheer', item: { panels: [160], height_cm: 240, material_price_per_sqm: 48.75, hardware: {}, attributes: {} } },
    { type: 'Vertical Panel', item: { panels: [300], height_cm: 300, material_price_per_sqm: 30, hardware: {}, attributes: {} } },
    { type: 'Vertical Roller', item: { panels: [110], height_cm: 105, material_price_per_sqm: 66.6, hardware: {}, attributes: {} } },
    { type: 'Curtains', item: { panels: [300], height_cm: 200, material_price_per_sqm: 40, hardware: {}, attributes: { pleat_multiplier: 2.5 } } },
    { type: 'Curtains', item: { panels: [150, 150], height_cm: 200, material_price_per_sqm: 62, hardware: {}, attributes: { pleat_multiplier: 2 } } },
    { type: 'Curtains', item: { panels: [60], height_cm: 90, material_price_per_sqm: 39.95, hardware: {}, attributes: { pleat_multiplier: 3 } } },
    { type: 'Curtains', item: { panels: [420], height_cm: 280, material_price_per_sqm: 88.5, hardware: {}, attributes: {} } },
  ];

  it.each(CASES)('$type: material leg equals usage x rate', ({ type, item }) => {
    const blindType = getBlindType(type);
    const usage = blindType.describeMaterialUsage(item);
    const leg = blindType.describeUnitCosts(item).material;
    expect(usage.quantity * item.material_price_per_sqm).toBeCloseTo(leg, 6);
  });
});
