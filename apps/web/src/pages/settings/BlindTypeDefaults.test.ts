// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * `sanitizeDraftForType` tests — the payload-sanitising rule that keeps a
 * Default Options card savable after its scoping changes elsewhere in
 * Settings (a hardware slot's last active option deactivated/unlinked, or
 * a Material unlinked from the type) without this page ever being opened.
 * See the function's own JSDoc for the full rationale; these cases pin
 * the slot-level (not option-level) behaviour it deliberately implements.
 */

import { describe, it, expect } from 'vitest';
import type { Catalogs } from '../orders/lineItemDrafts';
import { sanitizeDraftForType, type DefaultsDraft } from './blindTypeDefaultsDraft';

const ROLLER = { id: 'bt-roller', name: 'Roller', active: true, sort_order: 0 };
const CURTAINS = { id: 'bt-curtains', name: 'Curtains', active: true, sort_order: 1 };

/**
 * Roller: a Material linked to it, an ACTIVE cassette ('c1') and an
 * INACTIVE-but-still-linked cassette ('cas-off'), a bottom rail, and a
 * control shared with Curtains. Curtains: no Material link, no hardware
 * scoped at all — used to exercise the "everything clears" path.
 */
function catalogs(overrides: Partial<Catalogs> = {}): Catalogs {
  return {
    blindTypes: [ROLLER, CURTAINS],
    materials: [
      {
        id: 'm1',
        name: 'Blackout',
        price_per_sqm: 50,
        active: true,
        sort_order: 0,
        width_cm: null,
        blind_type_ids: [ROLLER.id],
      },
    ],
    cassettes: [
      { id: 'c1', name: 'Standard', price: 20, price_basis: 'per_m', active: true, sort_order: 0, blind_type_ids: [ROLLER.id] },
      { id: 'cas-off', name: 'Retired', price: 5, price_basis: 'per_m', active: false, sort_order: 1, blind_type_ids: [ROLLER.id] },
    ],
    bottomRails: [
      { id: 'b1', name: 'Regular', price: 0, price_basis: 'per_m', active: true, sort_order: 0, blind_type_ids: [ROLLER.id] },
    ],
    controls: [
      { id: 'ct1', name: 'Chain', price: 0, price_basis: 'per_panel', active: true, sort_order: 0, blind_type_ids: [ROLLER.id] },
    ],
    pleatTypes: [],
    defaults: [],
    installationOptions: [],
    ...overrides,
  };
}

/** A fully valid Roller draft — every field a real, currently-scoped id. */
function validDraft(overrides: Partial<DefaultsDraft> = {}): DefaultsDraft {
  return {
    material_id: 'm1',
    cassette_id: 'c1',
    bottom_rail_id: 'b1',
    control_id: 'ct1',
    installation_id: '',
    ...overrides,
  };
}

describe('sanitizeDraftForType', () => {
  it('leaves a fully valid draft unchanged', () => {
    expect(sanitizeDraftForType(validDraft(), catalogs(), 'Roller')).toEqual(validDraft());
  });

  it('is a no-op on an already-empty draft', () => {
    const empty: DefaultsDraft = {
      material_id: '',
      cassette_id: '',
      bottom_rail_id: '',
      control_id: '',
      installation_id: '',
    };
    expect(sanitizeDraftForType(empty, catalogs(), 'Roller')).toEqual(empty);
  });

  it('nulls a hardware field whose slot has no active scoped option left', () => {
    // Both Roller cassettes deactivated — 'cassette' drops out of
    // slotsForType entirely, so the field must clear even though the id
    // itself was once valid.
    const noActiveCassette = catalogs({
      cassettes: catalogs().cassettes.map((c) => ({ ...c, active: false })),
    });
    const result = sanitizeDraftForType(validDraft(), noActiveCassette, 'Roller');
    expect(result.cassette_id).toBe('');
    // Unrelated fields are untouched.
    expect(result.bottom_rail_id).toBe('b1');
    expect(result.control_id).toBe('ct1');
  });

  it('keeps a hardware field whose SLOT is still used, even if that exact option went inactive', () => {
    // The stored default points at 'cas-off' (now inactive), but the
    // slot itself is still offered via 'c1'. Sanitizing is deliberately
    // SLOT-level, not option-level — OptionSelect's own list already
    // tolerates a selected-but-inactive option as long as the slot is
    // still offered, so this must NOT be cleared here.
    const result = sanitizeDraftForType(validDraft({ cassette_id: 'cas-off' }), catalogs(), 'Roller');
    expect(result.cassette_id).toBe('cas-off');
  });

  it('nulls material_id when the Material is unlinked from the type', () => {
    const unlinked = catalogs({
      materials: catalogs().materials.map((m) => ({ ...m, blind_type_ids: [] })),
    });
    const result = sanitizeDraftForType(validDraft(), unlinked, 'Roller');
    expect(result.material_id).toBe('');
  });

  it('does NOT null material_id when the Material is merely deactivated (still linked)', () => {
    const deactivated = catalogs({
      materials: catalogs().materials.map((m) => ({ ...m, active: false })),
    });
    // materialsForType does not filter on `active` (a documented, pre-existing
    // asymmetry with the hardware catalogs) — an inactive-but-linked Material
    // is therefore NOT cleared here. This test pins that current behaviour
    // rather than asserting a fix out of this task's scope.
    const result = sanitizeDraftForType(validDraft(), deactivated, 'Roller');
    expect(result.material_id).toBe('m1');
  });

  it('clears everything for a type with nothing scoped at all', () => {
    const result = sanitizeDraftForType(
      { material_id: 'm1', cassette_id: 'c1', bottom_rail_id: 'b1', control_id: 'ct1', installation_id: 'x' },
      catalogs(),
      'Curtains'
    );
    expect(result).toEqual({
      material_id: '',
      cassette_id: '',
      bottom_rail_id: '',
      control_id: '',
      installation_id: '',
    });
  });

  it('clears everything for an unknown/empty type name', () => {
    const result = sanitizeDraftForType(validDraft(), catalogs(), '');
    expect(result).toEqual({
      material_id: '',
      cassette_id: '',
      bottom_rail_id: '',
      control_id: '',
      installation_id: '',
    });
  });
});
