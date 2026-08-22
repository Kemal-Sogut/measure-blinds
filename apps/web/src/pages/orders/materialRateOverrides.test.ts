// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Tests for the Material usage dialog's per-material rate overrides.
 *
 * Three properties are load-bearing and each is asserted directly rather
 * than through the UI:
 *
 * 1. A repriced line is priced by its OWN blind type at the new rate —
 *    checked by pinning the price delta to `billed quantity × rate delta`
 *    rather than to a hard-coded figure, so the assertion still means
 *    something if hardware pricing changes around it.
 * 2. A price a consultant typed by hand is never destroyed. Apply skips
 *    it, Reset leaves it standing.
 * 3. Reset undoes exactly what Apply wrote — no more (other materials,
 *    other rate units, hand-typed lines) and no less.
 */

import { describe, it, expect } from 'vitest';
import {
  applyMaterialRate,
  decodeAppliedRate,
  encodeAppliedRate,
  materialRateStatus,
  revertMaterialRate,
} from './materialRateOverrides';
import { blindDraftPrice, type BlindDraft, type Catalogs, type FlatDraft } from './lineItemDrafts';

const ROLLER = { id: 'bt-roller', name: 'Roller', active: true, sort_order: 0 };
const CURTAINS = { id: 'bt-curtains', name: 'Curtains', active: true, sort_order: 1 };

/**
 * Mirrors `materialUsage.test.ts`'s catalog: `m1` is scoped to both Roller
 * and Curtains, which is what makes the two-rate-units-for-one-material
 * case reachable at all.
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

/** A Curtains draft on the same material — 3.00 m + 0.50 m hem = 3.50 m. */
function curtain(overrides: Partial<BlindDraft> = {}): BlindDraft {
  return blind({
    key: 'c1',
    blinds_type: 'Curtains',
    panels: ['300'],
    cassette_id: '',
    bottom_rail_id: '',
    ...overrides,
  });
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

/** The calculated (un-overridden) unit price of a draft. */
function basePrice(draft: BlindDraft): number {
  const price = blindDraftPrice(draft, catalogs());
  if (!price) throw new Error('fixture does not price');
  return price.base;
}

describe('encodeAppliedRate / decodeAppliedRate', () => {
  it('round-trips a rate with its unit', () => {
    expect(decodeAppliedRate(encodeAppliedRate('sqm', 42.5))).toEqual({ unit: 'sqm', rate: 42.5 });
    expect(decodeAppliedRate(encodeAppliedRate('running_m', 12))).toEqual({
      unit: 'running_m',
      rate: 12,
    });
  });

  it('reads anything unusable as "not ours", so the line counts as hand-priced', () => {
    expect(decodeAppliedRate(undefined)).toBeNull();
    expect(decodeAppliedRate('')).toBeNull();
    expect(decodeAppliedRate('45')).toBeNull();
    expect(decodeAppliedRate('litres:45')).toBeNull();
    expect(decodeAppliedRate('sqm:abc')).toBeNull();
    expect(decodeAppliedRate('sqm:0')).toBeNull();
    expect(decodeAppliedRate('sqm:-5')).toBeNull();
  });
});

describe('applyMaterialRate', () => {
  it('writes the override and its provenance on a matching line', () => {
    const result = applyMaterialRate([blind()], catalogs(), 'm1', 'sqm', 45);
    expect(result).toMatchObject({ applied: 1, skipped: 0 });
    const item = result.items[0] as BlindDraft;
    expect(item.unit_price_override).not.toBe('');
    expect(decodeAppliedRate(item.material_rate_applied)).toEqual({ unit: 'sqm', rate: 45 });
  });

  it('applying the catalog rate reproduces the calculated price exactly', () => {
    const draft = blind();
    const result = applyMaterialRate([draft], catalogs(), 'm1', 'sqm', 50);
    expect(Number((result.items[0] as BlindDraft).unit_price_override)).toBeCloseTo(
      basePrice(draft),
      2
    );
  });

  it('moves the unit price by billed quantity x the rate delta', () => {
    const draft = blind();
    const result = applyMaterialRate([draft], catalogs(), 'm1', 'sqm', 45);
    // 2.80 m² billed, $5/m² off.
    expect(Number((result.items[0] as BlindDraft).unit_price_override)).toBeCloseTo(
      basePrice(draft) - 2.8 * 5,
      2
    );
  });

  it('prices per unit, not per line — quantity does not inflate the override', () => {
    const one = applyMaterialRate([blind()], catalogs(), 'm1', 'sqm', 45);
    const three = applyMaterialRate([blind({ quantity: '3' })], catalogs(), 'm1', 'sqm', 45);
    expect((three.items[0] as BlindDraft).unit_price_override).toBe(
      (one.items[0] as BlindDraft).unit_price_override
    );
  });

  it('skips a hand-typed override instead of destroying it', () => {
    const result = applyMaterialRate(
      [blind({ unit_price_override: '999' })],
      catalogs(),
      'm1',
      'sqm',
      45
    );
    expect(result).toMatchObject({ applied: 0, skipped: 1 });
    expect((result.items[0] as BlindDraft).unit_price_override).toBe('999');
    expect((result.items[0] as BlindDraft).material_rate_applied).toBeUndefined();
  });

  it('reprices a line it wrote itself, so a second rate can be tried', () => {
    const first = applyMaterialRate([blind()], catalogs(), 'm1', 'sqm', 45);
    const second = applyMaterialRate(first.items, catalogs(), 'm1', 'sqm', 40);
    expect(second).toMatchObject({ applied: 1, skipped: 0 });
    expect(Number((second.items[0] as BlindDraft).unit_price_override)).toBeCloseTo(
      basePrice(blind()) - 2.8 * 10,
      2
    );
  });

  it('leaves other materials, hidden lines, presets and incomplete drafts alone', () => {
    const items = [
      blind({ key: 'other', material_id: 'm2' }),
      blind({ key: 'hidden', hidden: true }),
      blind({ key: 'incomplete', height_cm: '' }),
      flat(),
    ];
    const result = applyMaterialRate(items, catalogs(), 'm1', 'sqm', 45);
    expect(result).toMatchObject({ applied: 0, skipped: 0 });
    expect(result.items).toEqual(items);
  });

  it('only touches the rate unit it was given, for a dual-scoped material', () => {
    const result = applyMaterialRate([blind(), curtain()], catalogs(), 'm1', 'sqm', 45);
    expect(result.applied).toBe(1);
    expect((result.items[0] as BlindDraft).unit_price_override).not.toBe('');
    expect((result.items[1] as BlindDraft).unit_price_override).toBe('');
  });

  it('reprices the running-metre side when asked for that unit', () => {
    const result = applyMaterialRate([blind(), curtain()], catalogs(), 'm1', 'running_m', 45);
    expect(result.applied).toBe(1);
    expect((result.items[0] as BlindDraft).unit_price_override).toBe('');
    // 3.50 running m, $5/m off.
    expect(Number((result.items[1] as BlindDraft).unit_price_override)).toBeCloseTo(
      basePrice(curtain()) - 3.5 * 5,
      2
    );
  });

  it('does not disturb add-ons', () => {
    const addons = [{ key: 'a1', label: 'Motor', price: '120' }];
    const result = applyMaterialRate([blind({ addons })], catalogs(), 'm1', 'sqm', 45);
    expect((result.items[0] as BlindDraft).addons).toEqual(addons);
  });
});

describe('revertMaterialRate', () => {
  it('clears the override and provenance it wrote', () => {
    const applied = applyMaterialRate([blind()], catalogs(), 'm1', 'sqm', 45);
    const result = revertMaterialRate(applied.items, 'm1', 'sqm');
    expect(result.reverted).toBe(1);
    expect((result.items[0] as BlindDraft).unit_price_override).toBe('');
    expect((result.items[0] as BlindDraft).material_rate_applied).toBe('');
  });

  it('leaves a hand-typed override standing', () => {
    const items = [blind({ unit_price_override: '999' })];
    const result = revertMaterialRate(items, 'm1', 'sqm');
    expect(result.reverted).toBe(0);
    expect((result.items[0] as BlindDraft).unit_price_override).toBe('999');
  });

  it('reverts only the rate unit it was given', () => {
    const sqm = applyMaterialRate([blind(), curtain()], catalogs(), 'm1', 'sqm', 45);
    const both = applyMaterialRate(sqm.items, catalogs(), 'm1', 'running_m', 30);
    const result = revertMaterialRate(both.items, 'm1', 'sqm');
    expect(result.reverted).toBe(1);
    expect((result.items[0] as BlindDraft).unit_price_override).toBe('');
    expect((result.items[1] as BlindDraft).unit_price_override).not.toBe('');
  });

  it('reverts a line that has since become unpriceable', () => {
    const applied = applyMaterialRate([blind()], catalogs(), 'm1', 'sqm', 45);
    // The consultant clears the height after applying; the line can no
    // longer be priced, but its stale override must still be removable.
    const edited = [{ ...(applied.items[0] as BlindDraft), height_cm: '' }];
    const result = revertMaterialRate(edited, 'm1', 'sqm');
    expect(result.reverted).toBe(1);
    expect(result.items[0].unit_price_override).toBe('');
  });
});

describe('materialRateStatus', () => {
  it('reports nothing applied on untouched drafts', () => {
    expect(materialRateStatus([blind()], catalogs(), 'm1', 'sqm')).toEqual({
      appliedRate: null,
      targetLines: 1,
      appliedLines: 0,
      manualLines: 0,
    });
  });

  it('counts applied lines and reports the rate they carry', () => {
    const applied = applyMaterialRate(
      [blind({ key: 'a' }), blind({ key: 'b' })],
      catalogs(),
      'm1',
      'sqm',
      45
    );
    expect(materialRateStatus(applied.items, catalogs(), 'm1', 'sqm')).toEqual({
      appliedRate: 45,
      targetLines: 2,
      appliedLines: 2,
      manualLines: 0,
    });
  });

  it('counts hand-priced lines separately, so the dialog can warn about them', () => {
    const items = [blind({ key: 'a' }), blind({ key: 'b', unit_price_override: '999' })];
    const applied = applyMaterialRate(items, catalogs(), 'm1', 'sqm', 45);
    expect(materialRateStatus(applied.items, catalogs(), 'm1', 'sqm')).toEqual({
      appliedRate: 45,
      targetLines: 2,
      appliedLines: 1,
      manualLines: 1,
    });
  });

  it('goes back to nothing applied after a revert', () => {
    const applied = applyMaterialRate([blind()], catalogs(), 'm1', 'sqm', 45);
    const reverted = revertMaterialRate(applied.items, 'm1', 'sqm');
    expect(materialRateStatus(reverted.items, catalogs(), 'm1', 'sqm')).toMatchObject({
      appliedRate: null,
      appliedLines: 0,
    });
  });
});
