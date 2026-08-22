// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Aggregation tests for the internal Material usage report.
 *
 * The report exists so a consultant can decide a discount from fabric
 * quantity rather than by guessing a percentage, which makes two
 * properties load-bearing: it must count exactly the lines the order
 * total counts, and its money column must be the FABRIC leg rather than
 * the charged price. Both are asserted below.
 */

import { describe, it, expect } from 'vitest';
import {
  summarizeMaterialUsage,
  giveBackAmount,
  materialRowKey,
  rowGiveBack,
  applyGiveBackPart,
  ORDER_WIDE_GIVE_BACK,
} from './materialUsage';
import type { BlindDraft, Catalogs, FlatDraft, ItemDraft } from './lineItemDrafts';

const ROLLER = { id: 'bt-roller', name: 'Roller', active: true, sort_order: 0 };
const CURTAINS = { id: 'bt-curtains', name: 'Curtains', active: true, sort_order: 1 };

/**
 * Two m²-priced materials plus one shared with Curtains, so the mixed-unit
 * case has a material that legitimately appears under both rate units.
 */
function catalogs(overrides: Partial<Catalogs> = {}): Catalogs {
  return {
    blindTypes: [ROLLER, CURTAINS],
    materials: [
      { id: 'm1', name: 'Blackout Ivory', price_per_sqm: 50, active: true, sort_order: 0, width_cm: null, blind_type_ids: [ROLLER.id, CURTAINS.id] },
      { id: 'm2', name: 'Sunscreen Charcoal', price_per_sqm: 40, active: true, sort_order: 1, width_cm: null, blind_type_ids: [ROLLER.id] },
    ],
    cassettes: [
      { id: 'c1', name: 'Standard', price: 20, price_basis: 'per_m', active: true, sort_order: 0, blind_type_ids: [ROLLER.id] },
    ],
    bottomRails: [
      { id: 'b1', name: 'Regular', price: 0, price_basis: 'per_m', active: true, sort_order: 0, blind_type_ids: [ROLLER.id] },
    ],
    controls: [
      { id: 'ct1', name: 'Chain', price: 0, price_basis: 'per_panel', active: true, sort_order: 0, blind_type_ids: [ROLLER.id, CURTAINS.id] },
    ],
    pleatTypes: [],
    defaults: [],
    installationOptions: [],
    ...overrides,
  };
}

/** A complete, valid Roller draft: 140cm × 200cm = 2.80 m² billed, $50/m². */
function blind(overrides: Partial<BlindDraft> = {}): BlindDraft {
  return {
    unit_price_override: '',
    show_original_price: true,
    addons: [],
    key: 'd1',
    uid: null,
    hidden: false,
    item_type: 'blind',
    room_name: 'Living Room',
    blinds_type: 'Roller',
    panels: ['140'],
    height_cm: '200',
    material_id: 'm1',
    cassette_id: 'c1',
    bottom_rail_id: 'b1',
    control_id: 'ct1',
    installation_id: '',
    color: 'White',
    note: '',
    quantity: '1',
    attributes: {},
    ...overrides,
  };
}

/** A preset line — carries a price but no material. */
function flat(overrides: Partial<FlatDraft> = {}): FlatDraft {
  return {
    unit_price_override: '',
    show_original_price: true,
    addons: [],
    key: 'f1',
    uid: null,
    hidden: false,
    item_type: 'preset',
    title: 'Motorisation',
    description: '',
    preset_id: 'p1',
    quantity: '1',
    unit_price: '250',
    ...overrides,
  };
}

describe('summarizeMaterialUsage', () => {
  it('reports one row per material with the billed quantity and the fabric leg', () => {
    const summary = summarizeMaterialUsage([blind()], catalogs());
    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0]).toMatchObject({
      materialId: 'm1',
      materialName: 'Blackout Ivory',
      unit: 'sqm',
      rate: 50,
    });
    expect(summary.rows[0].quantity).toBeCloseTo(2.8, 10);
    expect(summary.rows[0].amount).toBeCloseTo(140, 10);
  });

  it('collapses two blinds of the same material into one row', () => {
    const summary = summarizeMaterialUsage(
      [blind({ key: 'a' }), blind({ key: 'b', panels: ['100'], height_cm: '200' })],
      catalogs()
    );
    expect(summary.rows).toHaveLength(1);
    // 2.80 + 2.00 m²
    expect(summary.rows[0].quantity).toBeCloseTo(4.8, 10);
    expect(summary.rows[0].amount).toBeCloseTo(240, 10);
  });

  it('multiplies billed quantity and fabric revenue by the line quantity', () => {
    const summary = summarizeMaterialUsage([blind({ quantity: '3' })], catalogs());
    expect(summary.rows[0].quantity).toBeCloseTo(8.4, 10);
    expect(summary.rows[0].amount).toBeCloseTo(420, 10);
  });

  it('excludes a hidden line entirely, matching the order total', () => {
    // A hidden line is excluded from the total and every document, so
    // giving back fabric money against it would discount thin air.
    const summary = summarizeMaterialUsage(
      [blind({ key: 'a' }), blind({ key: 'b', hidden: true })],
      catalogs()
    );
    expect(summary.rows[0].quantity).toBeCloseTo(2.8, 10);
    expect(summary.excludedCount).toBe(0);
  });

  it('counts preset and custom lines as excluded rather than pricing them', () => {
    const items: ItemDraft[] = [blind(), flat(), flat({ key: 'f2', item_type: 'custom', preset_id: null })];
    const summary = summarizeMaterialUsage(items, catalogs());
    expect(summary.rows).toHaveLength(1);
    expect(summary.excludedCount).toBe(2);
  });

  it('counts an incomplete blind as excluded rather than guessing its area', () => {
    const summary = summarizeMaterialUsage([blind(), blind({ key: 'b', height_cm: '' })], catalogs());
    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0].quantity).toBeCloseTo(2.8, 10);
    expect(summary.excludedCount).toBe(1);
  });

  it('does not count a hidden incomplete line as excluded', () => {
    // Hidden lines are gone before the completeness question is asked;
    // reporting them as "incomplete" would nag about a row the consultant
    // has already set aside.
    const summary = summarizeMaterialUsage(
      [blind(), blind({ key: 'b', height_cm: '', hidden: true })],
      catalogs()
    );
    expect(summary.excludedCount).toBe(0);
  });

  it('ignores a manual price override — an override is not a fabric-rate change', () => {
    const summary = summarizeMaterialUsage([blind({ unit_price_override: '25' })], catalogs());
    expect(summary.rows[0].quantity).toBeCloseTo(2.8, 10);
    expect(summary.rows[0].amount).toBeCloseTo(140, 10);
  });

  it('ignores add-ons, which are not fabric', () => {
    const summary = summarizeMaterialUsage(
      [blind({ addons: [{ key: 'a1', label: 'Rush', price: '75' }] })],
      catalogs()
    );
    expect(summary.rows[0].amount).toBeCloseTo(140, 10);
  });

  it('keeps square metres and running metres in separate rows and totals', () => {
    const items: ItemDraft[] = [
      blind(),
      blind({ key: 'c', blinds_type: 'Curtains', panels: ['300'], cassette_id: '', bottom_rail_id: '' }),
    ];
    const summary = summarizeMaterialUsage(items, catalogs());
    expect(summary.rows).toHaveLength(2);
    expect(summary.rows.map((r) => r.unit).sort()).toEqual(['running_m', 'sqm']);
    // Curtains with no pleat attribute: fullness 1 → 3.0 m + 0.5 m hem.
    const curtainRow = summary.rows.find((r) => r.unit === 'running_m');
    expect(curtainRow?.quantity).toBeCloseTo(3.5, 10);
    expect(summary.totals.sqm?.quantity).toBeCloseTo(2.8, 10);
    expect(summary.totals.running_m?.quantity).toBeCloseTo(3.5, 10);
  });

  it('omits a unit from the totals when no line uses it', () => {
    const summary = summarizeMaterialUsage([blind()], catalogs());
    expect(summary.totals.sqm).toBeDefined();
    expect(summary.totals.running_m).toBeUndefined();
  });

  it('reports measured below billed for an under-minimum blind', () => {
    // 60 × 80 cm bills 1.00 m² and measures 0.48 m².
    const summary = summarizeMaterialUsage(
      [blind({ panels: ['60'], height_cm: '80' })],
      catalogs()
    );
    expect(summary.rows[0].quantity).toBeCloseTo(1, 10);
    expect(summary.rows[0].measuredQuantity).toBeCloseTo(0.48, 10);
  });

  it('reports measured equal to billed once the minimums are cleared', () => {
    const summary = summarizeMaterialUsage([blind()], catalogs());
    expect(summary.rows[0].measuredQuantity).toBeCloseTo(2.8, 10);
  });

  it('orders rows by descending fabric spend', () => {
    // m2 is cheaper per m² but far larger, so it must lead.
    const items: ItemDraft[] = [
      blind({ key: 'a', material_id: 'm1' }),
      blind({ key: 'b', material_id: 'm2', panels: ['300'], height_cm: '300' }),
    ];
    const summary = summarizeMaterialUsage(items, catalogs());
    expect(summary.rows.map((r) => r.materialId)).toEqual(['m2', 'm1']);
  });

  it('returns an empty summary for an order with no lines', () => {
    const summary = summarizeMaterialUsage([], catalogs());
    expect(summary.rows).toEqual([]);
    expect(summary.totals).toEqual({});
    expect(summary.excludedCount).toBe(0);
  });
});

describe('giveBackAmount', () => {
  it('multiplies each unit total by its own rate', () => {
    const summary = summarizeMaterialUsage(
      [blind(), blind({ key: 'c', blinds_type: 'Curtains', panels: ['300'], cassette_id: '', bottom_rail_id: '' })],
      catalogs()
    );
    // 2.80 m² × $5 = 14.00, 3.50 m × $2 = 7.00
    expect(giveBackAmount(summary, { sqm: 5, running_m: 2 })).toBe(21);
  });

  it('treats a missing rate as zero rather than discounting on a blank field', () => {
    const summary = summarizeMaterialUsage([blind()], catalogs());
    expect(giveBackAmount(summary, {})).toBe(0);
  });

  it('rounds to whole cents', () => {
    const summary = summarizeMaterialUsage([blind()], catalogs());
    // 2.80 m² × $3.333 = 9.3324 → 9.33
    expect(giveBackAmount(summary, { sqm: 3.333 })).toBe(9.33);
  });
});

describe('rowGiveBack', () => {
  const row = {
    materialId: 'm1',
    materialName: 'Blackout Ivory',
    unit: 'sqm' as const,
    quantity: 10,
    measuredQuantity: 10,
    rate: 73,
    amount: 730,
    lineCount: 2,
  };

  it('is the rate difference times the billed quantity', () => {
    // $73 → $70 over 10 m².
    expect(rowGiveBack(row, 70)).toBe(30);
  });

  it('is zero at the catalog rate', () => {
    expect(rowGiveBack(row, 73)).toBe(0);
  });

  it('clamps a rate above the catalog rate rather than inventing a surcharge', () => {
    expect(rowGiveBack(row, 90)).toBe(0);
  });

  it('rejects unusable rates', () => {
    expect(rowGiveBack(row, Number.NaN)).toBe(0);
    expect(rowGiveBack(row, -5)).toBe(0);
  });

  it('rounds to whole cents, because it lands in the discount field', () => {
    expect(rowGiveBack({ ...row, quantity: 3.333, rate: 10 }, 9.99)).toBe(0.03);
  });
});

describe('applyGiveBackPart', () => {
  const key = materialRowKey('m1', 'sqm');

  it('adds on top of a discount that is already there', () => {
    const result = applyGiveBackPart({}, 25, key, 30);
    expect(result.discount).toBe(55);
    expect(result.parts).toEqual({ [key]: 30 });
  });

  it('stacks two different contributions', () => {
    const first = applyGiveBackPart({}, 0, key, 30);
    const second = applyGiveBackPart(first.parts, first.discount, ORDER_WIDE_GIVE_BACK, 20);
    expect(second.discount).toBe(50);
    expect(second.parts).toEqual({ [key]: 30, [ORDER_WIDE_GIVE_BACK]: 20 });
  });

  it('SWAPS a key rather than stacking it, so re-applying a row is idempotent', () => {
    const first = applyGiveBackPart({}, 0, key, 30);
    const again = applyGiveBackPart(first.parts, first.discount, key, 45);
    expect(again.discount).toBe(45);
    expect(again.parts).toEqual({ [key]: 45 });
  });

  it('takes a contribution back out on zero, leaving the manual base', () => {
    const typed = applyGiveBackPart({}, 12, key, 30);
    expect(typed.discount).toBe(42);
    const reset = applyGiveBackPart(typed.parts, typed.discount, key, 0);
    expect(reset.discount).toBe(12);
    expect(reset.parts).toEqual({});
  });

  it('removes only the key it is given', () => {
    const a = applyGiveBackPart({}, 0, key, 30);
    const b = applyGiveBackPart(a.parts, a.discount, ORDER_WIDE_GIVE_BACK, 20);
    const c = applyGiveBackPart(b.parts, b.discount, key, 0);
    expect(c.discount).toBe(20);
    expect(c.parts).toEqual({ [ORDER_WIDE_GIVE_BACK]: 20 });
  });

  it('never produces a negative discount', () => {
    // The consultant lowered the discount field by hand after applying.
    const result = applyGiveBackPart({ [key]: 30 }, 5, key, 0);
    expect(result.discount).toBe(0);
  });

  it('treats a missing or unusable current discount as zero', () => {
    expect(applyGiveBackPart({}, Number.NaN, key, 30).discount).toBe(30);
  });
});
