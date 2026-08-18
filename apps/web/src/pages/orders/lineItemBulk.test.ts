// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * `applyBulkPatch` tests.
 *
 * Covers the five behaviours the function contracts to: a non-blind item
 * passes through untouched; a blind-type change resets onto that type's
 * saved defaults before the rest of the patch overlays on top; leaving the
 * type on "no change" falls back to the pre-existing slot-guarded option
 * patch; color is a plain no-change-when-empty field; and a bulk value for
 * a slot the (possibly just-changed) type does not use is dropped rather
 * than written, because the Worker would reject it.
 */

import { describe, it, expect } from 'vitest';
import type { BlindDraft, Catalogs, FlatDraft } from './lineItemDrafts';
import { applyBulkPatch, type BulkEditState } from './lineItemBulk';

/**
 * Three blind types so a "type set" patch has somewhere real to reset
 * onto:
 *
 * - Roller: cassette (`c1` default, `c2` alt) and control (`k1` default,
 *   `k2` alt) are scoped; bottom rail and installation are not — mirrors
 *   the unused-slot fixture pattern in `lineItemDrafts.test.ts`.
 * - Zebra: cassette (`c-zebra`, `c-zebra-2`) and control (`z-k1`) are
 *   scoped, with no saved defaults row — the type an item starts as
 *   before a bulk patch moves it onto Roller.
 * - Curtains: only installation (`ins-1`) is scoped, nothing else — used
 *   to prove a bulk value for a slot the new type drops entirely.
 */
const ROLLER = { id: 't-roller', name: 'Roller', active: true, sort_order: 0 };
const ZEBRA = { id: 't-zebra', name: 'Zebra', active: true, sort_order: 1 };
const CURTAINS = { id: 't-curtains', name: 'Curtains', active: true, sort_order: 2 };

function catalogs(overrides: Partial<Catalogs> = {}): Catalogs {
  return {
    blindTypes: [ROLLER, ZEBRA, CURTAINS],
    materials: [
      {
        id: 'm-roller',
        name: 'Roller Fabric',
        price_per_sqm: 50,
        active: true,
        sort_order: 0,
        width_cm: null,
        blind_type_ids: [ROLLER.id],
      },
      {
        id: 'm-zebra',
        name: 'Zebra Fabric',
        price_per_sqm: 55,
        active: true,
        sort_order: 1,
        width_cm: null,
        blind_type_ids: [ZEBRA.id],
      },
    ],
    cassettes: [
      { id: 'c1', name: 'Roller Standard', price: 20, price_basis: 'per_m', active: true, sort_order: 0, blind_type_ids: [ROLLER.id] },
      { id: 'c2', name: 'Roller Deluxe', price: 30, price_basis: 'per_m', active: true, sort_order: 1, blind_type_ids: [ROLLER.id] },
      { id: 'c-zebra', name: 'Zebra Standard', price: 15, price_basis: 'per_m', active: true, sort_order: 2, blind_type_ids: [ZEBRA.id] },
      { id: 'c-zebra-2', name: 'Zebra Deluxe', price: 25, price_basis: 'per_m', active: true, sort_order: 3, blind_type_ids: [ZEBRA.id] },
    ],
    // No bottom rail is scoped to Roller or Zebra — the slot is unused by
    // both; only installation is unused by neither (Curtains uses it).
    bottomRails: [],
    controls: [
      { id: 'k1', name: 'Chain', price: 0, price_basis: 'per_panel', active: true, sort_order: 0, blind_type_ids: [ROLLER.id] },
      { id: 'k2', name: 'Wand', price: 0, price_basis: 'per_panel', active: true, sort_order: 1, blind_type_ids: [ROLLER.id] },
      { id: 'z-k1', name: 'Zebra Chain', price: 0, price_basis: 'per_panel', active: true, sort_order: 2, blind_type_ids: [ZEBRA.id] },
    ],
    pleatTypes: [],
    installationOptions: [
      { id: 'ins-1', name: 'Rod', price: 45, price_basis: 'per_unit', active: true, sort_order: 0, blind_type_ids: [CURTAINS.id] },
    ],
    defaults: [
      {
        blind_type_id: ROLLER.id,
        material_id: 'm-roller',
        cassette_id: 'c1',
        bottom_rail_id: null,
        control_id: 'k1',
        installation_id: null,
      },
    ],
    ...overrides,
  };
}

/** A complete Zebra blind draft — the baseline each case mutates. */
function draft(overrides: Partial<BlindDraft> = {}): BlindDraft {
  return {
    unit_price_override: '',
    show_original_price: true,
    addons: [],
    key: 'd1',
    uid: null,
    hidden: false,
    item_type: 'blind',
    room_name: 'Living Room',
    blinds_type: 'Zebra',
    panels: ['120'],
    height_cm: '210',
    material_id: 'm-zebra',
    cassette_id: 'c-zebra',
    bottom_rail_id: '',
    control_id: 'z-k1',
    installation_id: '',
    color: 'White',
    note: 'Handle with care',
    quantity: '1',
    attributes: {},
    ...overrides,
  };
}

function flat(overrides: Partial<FlatDraft> = {}): FlatDraft {
  return {
    key: 'f1',
    uid: null,
    hidden: false,
    item_type: 'custom',
    title: 'Extra work',
    description: '',
    preset_id: null,
    quantity: '2',
    unit_price: '100',
    unit_price_override: '',
    show_original_price: true,
    addons: [],
    ...overrides,
  };
}

/** Every field on "no change" — the baseline each case fills in. */
const NOTHING: BulkEditState = {
  blinds_type: '',
  material_id: '',
  cassette_id: '',
  bottom_rail_id: '',
  control_id: '',
  installation_id: '',
  color: '',
};

describe('applyBulkPatch', () => {
  it('returns non-blind items unchanged', () => {
    const item = flat();
    const next = applyBulkPatch(
      item,
      { ...NOTHING, material_id: 'm-roller', color: 'Blue' },
      catalogs()
    );
    expect(next).toBe(item);
  });

  it('type set → applyTypeDefaults reset, then explicit fields overlay', () => {
    const item = draft(); // a Zebra item
    const next = applyBulkPatch(
      item,
      { ...NOTHING, blinds_type: 'Roller', control_id: 'k2' },
      catalogs()
    ) as BlindDraft;
    expect(next.blinds_type).toBe('Roller');
    expect(next.cassette_id).toBe('c1'); // Roller's saved default
    expect(next.control_id).toBe('k2'); // explicit overlay wins over default k1
    // Measurement/room/note fields are untouched by the reset or the patch.
    expect(next.room_name).toBe(item.room_name);
    expect(next.panels).toEqual(item.panels);
    expect(next.height_cm).toBe(item.height_cm);
    expect(next.quantity).toBe(item.quantity);
    expect(next.note).toBe(item.note);
  });

  it('type empty → slot-guarded option patch only (existing behavior)', () => {
    const item = draft(); // Zebra: cassette+control used, bottom_rail unused
    const next = applyBulkPatch(
      item,
      { ...NOTHING, cassette_id: 'c-zebra-2', bottom_rail_id: 'irrelevant' },
      catalogs()
    ) as BlindDraft;
    expect(next.blinds_type).toBe('Zebra'); // untouched — no reset happened
    expect(next.cassette_id).toBe('c-zebra-2'); // Zebra uses cassette → applied
    expect(next.bottom_rail_id).toBe(''); // Zebra doesn't use bottom_rail → ignored
  });

  it('color set → color patched; color empty → kept', () => {
    const item = draft({ color: 'White' });
    const withColor = applyBulkPatch(item, { ...NOTHING, color: 'Charcoal' }, catalogs()) as BlindDraft;
    expect(withColor.color).toBe('Charcoal');
    const withoutColor = applyBulkPatch(item, NOTHING, catalogs()) as BlindDraft;
    expect(withoutColor.color).toBe('White');
  });

  it('slot not used by (new) type → bulk value for it is ignored', () => {
    const item = draft(); // Zebra item, currently has a cassette
    const next = applyBulkPatch(
      item,
      { ...NOTHING, blinds_type: 'Curtains', cassette_id: 'c1' },
      catalogs()
    ) as BlindDraft;
    expect(next.blinds_type).toBe('Curtains');
    expect(next.cassette_id).toBe(''); // Curtains has no cassette slot → dropped
  });
});
