// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * `sanitizeDraftForType` and `nextDraftForSave` tests.
 *
 * `sanitizeDraftForType` is the payload-sanitising rule that keeps a
 * Default Options card savable after its scoping changes elsewhere in
 * Settings (an option deactivated or unlinked from the type, hardware or
 * Material) without this page ever being opened. See the function's own
 * JSDoc for the full rationale; these cases pin the OPTION-level (not
 * slot-level) behaviour it deliberately implements — a hardware id is
 * cleared the moment ITS OWN option goes inactive, even if the slot as a
 * whole still has other active options.
 *
 * `nextDraftForSave` is the per-field save merge `BlindTypeDefaultsCard.set`
 * delegates to. These cases pin both halves of its contract: a sibling
 * field's still-in-flight (`pendingWrites`) value survives a concurrent
 * save, and a field ABSENT from `pendingWrites` — the state after `set`'s
 * `finally` drops it, whether its own save succeeded or was rejected —
 * falls back to `draft` (server truth), never to a stale/rejected value.
 * The one thing this pure function cannot exercise is the live-timing
 * race itself (an already-in-flight sibling PUT that was built before its
 * rejection was known) — see the module's own JSDoc note on that residual,
 * accepted limit.
 */

import { describe, it, expect } from 'vitest';
import type { Catalogs } from '../orders/lineItemDrafts';
import { nextDraftForSave, sanitizeDraftForType, type DefaultsDraft } from './blindTypeDefaultsDraft';

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
    // optionsForType entirely, so the field must clear even though the id
    // itself was once valid.
    const noActiveCassette = catalogs({
      cassettes: catalogs().cassettes.map((c) => ({ ...c, active: false })),
    });
    const result = sanitizeDraftForType(validDraft(), noActiveCassette, 'Roller');
    expect(result.cassette_id).toBe('');
    // Unrelated fields, still valid, are untouched.
    expect(result.bottom_rail_id).toBe('b1');
    expect(result.control_id).toBe('ct1');
  });

  it('nulls a hardware field whose exact option went inactive, even though its SLOT is still offered', () => {
    // The stored default points at 'cas-off' (now inactive); the slot
    // itself is still offered via 'c1', but that does not make 'cas-off'
    // a valid pick — optionsForType (what OptionSelect's own list is
    // built from) filters to `active` before the id could ever match a
    // rendered <option>, and the API independently re-validates `active`
    // per id, not per slot. Sanitizing is therefore OPTION-level: this
    // MUST be cleared even with an active sibling in the same slot.
    const result = sanitizeDraftForType(validDraft({ cassette_id: 'cas-off' }), catalogs(), 'Roller');
    expect(result.cassette_id).toBe('');
    // A DIFFERENT field pointing at a still-active, still-scoped id is
    // untouched — proves this isn't a blanket slot-level clear either.
    expect(result.bottom_rail_id).toBe('b1');
  });

  it('keeps a hardware field whose exact option is still active and scoped', () => {
    // 'c1' (not 'cas-off') is the still-valid Roller cassette — pins the
    // survival side of the option-level rule the two tests above pin the
    // clearing side of.
    const result = sanitizeDraftForType(validDraft({ cassette_id: 'c1' }), catalogs(), 'Roller');
    expect(result.cassette_id).toBe('c1');
  });

  it('nulls material_id when the Material is unlinked from the type', () => {
    const unlinked = catalogs({
      materials: catalogs().materials.map((m) => ({ ...m, blind_type_ids: [] })),
    });
    const result = sanitizeDraftForType(validDraft(), unlinked, 'Roller');
    expect(result.material_id).toBe('');
  });

  it('nulls material_id when the Material is deactivated, even though still linked', () => {
    // materialsForType does not itself filter on `active` (a documented,
    // pre-existing asymmetry with the hardware catalogs), but the API's
    // DEFAULT_LINKS check requires `active` for every field including
    // Material — so sanitizeDraftForType checks `active` explicitly here
    // rather than relying on materialsForType alone.
    const deactivated = catalogs({
      materials: catalogs().materials.map((m) => ({ ...m, active: false })),
    });
    const result = sanitizeDraftForType(validDraft(), deactivated, 'Roller');
    expect(result.material_id).toBe('');
  });

  it('keeps material_id when the Material is active and still linked', () => {
    const result = sanitizeDraftForType(validDraft(), catalogs(), 'Roller');
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

describe('nextDraftForSave', () => {
  it('folds in a sibling field still mid-save instead of the stale server draft', () => {
    // `draft` (server truth) has the ORIGINAL bottom_rail_id ('b1');
    // pendingWrites says a bottom_rail edit to a DIFFERENT valid option is
    // still in flight and unconfirmed. Saving material_id must not revert
    // that unconfirmed sibling edit back to the server-truth value.
    const result = nextDraftForSave(
      validDraft(),
      { bottom_rail_id: 'b1' }, // stands in for "some other still-valid pending pick"
      'material_id',
      'm1',
      catalogs(),
      'Roller'
    );
    expect(result.bottom_rail_id).toBe('b1');
    expect(result.material_id).toBe('m1');
  });

  it('falls back to server-truth draft for a field no longer in pendingWrites, not a stale value', () => {
    // Simulates the state right after a rejected cassette edit has
    // settled: `set`'s `finally` has already removed 'cassette_id' from
    // pendingWrites (see its own JSDoc), so `draft` — last
    // SERVER-CONFIRMED value, 'c1' — is what a later save for a
    // different field must use for cassette_id, never the rejected pick.
    const draftAfterRejection = validDraft({ cassette_id: 'c1' });
    const result = nextDraftForSave(
      draftAfterRejection,
      {}, // rejected field already dropped — nothing pending for it
      'control_id',
      'ct1',
      catalogs(),
      'Roller'
    );
    expect(result.cassette_id).toBe('c1');
    expect(result.control_id).toBe('ct1');
  });

  it('re-sanitizes the merged result, clearing a pending sibling value that has since gone stale', () => {
    // pendingWrites claims 'cas-off' is a legitimate in-flight cassette
    // pick, but the CURRENT catalogs (checked at save time) say it is no
    // longer a valid option — nextDraftForSave must not save it blindly
    // just because it came from pendingWrites.
    const result = nextDraftForSave(
      validDraft(),
      { cassette_id: 'cas-off' },
      'control_id',
      'ct1',
      catalogs(),
      'Roller'
    );
    expect(result.cassette_id).toBe('');
    expect(result.control_id).toBe('ct1');
  });
});
