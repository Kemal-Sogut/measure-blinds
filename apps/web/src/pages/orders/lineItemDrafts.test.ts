// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Draft-to-payload conversion tests for blind line items.
 *
 * `parseDraftAttributes` is the ONLY place a draft's string attribute
 * values become typed values. Both the live price preview and the save
 * payload go through it, so a bug here would show a price the server
 * would not agree with — the one failure mode the twin pricing suites
 * cannot catch, because they never see a draft.
 */

import { describe, it, expect } from 'vitest';
import type { CatalogSlot } from '../../lib/blindTypes/base';
import { getBlindType } from '../../lib/blindTypes';
import {
  applyBulkEditToDraft,
  applyTypeDefaults,
  blindDraftPrice,
  bulkEditSelection,
  canOverridePrice,
  countMeasurementRows,
  flatDraftPrice,
  measurementRowState,
  measurementRowsToDrafts,
  newBlindDraft,
  newMeasurementRow,
  optionsForType,
  parseAddons,
  parseDraftAttributes,
  parseOverride,
  slotsForType,
  type BlindDraft,
  type BlindDraftDefaults,
  type BulkEditState,
  type Catalogs,
  type FlatDraft,
  type ItemDraft,
  type MeasurementRow,
} from './lineItemDrafts';

/**
 * A complete, valid blind draft — the baseline each case mutates. The
 * adjustment fields sit at their neutral values (no override, no
 * add-ons), so a case that does not mention them prices from the formula
 * alone.
 */
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
    blinds_type: 'Roller',
    panels: ['120'],
    height_cm: '210',
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

describe('parseDraftAttributes', () => {
  it('returns {} for a type with no declared attributes', () => {
    expect(parseDraftAttributes(draft())).toEqual({});
  });

  it('returns {} for an unknown legacy type name', () => {
    expect(parseDraftAttributes(draft({ blinds_type: 'Something Old' }))).toEqual({});
  });

  it('drops a key the type does not declare', () => {
    // Dropped rather than rejected: a draft carries whatever keys the
    // previously selected type left behind, and the payload builder must
    // still be able to save. The SERVER is the gate that matters — it
    // re-parses through the same strict schema and 400s on a key the
    // client should not have sent.
    expect(parseDraftAttributes(draft({ attributes: { nope: 'x' } }))).toEqual({});
  });

  it('returns null when a DECLARED key holds an invalid value', () => {
    expect(
      parseDraftAttributes(draft({ blinds_type: 'Curtains', attributes: { pleat_type_id: 'Pinch' } }))
    ).toBeNull();
  });

  it('drops blank strings rather than sending empty values', () => {
    // A field the user has not filled must look ABSENT to the schema, so
    // its default applies. Present-and-empty would read as NaN on a
    // numeric field and reject a draft the user considers incomplete,
    // not wrong.
    expect(parseDraftAttributes(draft({ attributes: { nope: '' } }))).toEqual({});
  });

  it('trims surrounding whitespace before parsing', () => {
    expect(parseDraftAttributes(draft({ attributes: { nope: '   ' } }))).toEqual({});
  });
});

describe('parseDraftAttributes round-trip', () => {
  const PLEAT_ID = '66666666-6666-4666-8666-666666666666';
  const INSTALL_ID = '77777777-7777-4777-8777-777777777777';

  /**
   * A saved curtain re-opened for editing. `toDrafts` stringifies the
   * PERSISTED blob, which carries the Worker's snapshot keys alongside
   * the id the client originally sent.
   *
   * The three `installation_*` keys are kept in this fixture on purpose
   * even though migration 35 stripped them from every stored row: a blob
   * that somehow still holds them must be filtered out rather than
   * re-sent, because the strict schema no longer declares them.
   */
  function reopenedCurtain(): BlindDraft {
    return draft({
      blinds_type: 'Curtains',
      attributes: {
        pleat_type_id: PLEAT_ID,
        pleat_name: 'Pinch',
        pleat_multiplier: '2.5',
        installation_id: INSTALL_ID,
        installation_name: 'Rod',
        installation_price: '45',
      },
    });
  }

  it('keeps the pleat id and drops the server-written snapshot keys', () => {
    // `installation_id` is a COLUMN since migration 35, so it is not an
    // attribute the type declares and does not survive the parse.
    expect(parseDraftAttributes(reopenedCurtain())).toEqual({ pleat_type_id: PLEAT_ID });
  });

  it('does not return null for a re-opened curtain', () => {
    // Regression: the strict schema rejects the snapshot keys, so an
    // unfiltered draft parsed to null and the curtain silently lost its
    // pleat and installation on the second save.
    expect(parseDraftAttributes(reopenedCurtain())).not.toBeNull();
  });

  it('never lets a client re-send a resolved price', () => {
    // The multiplier is in the draft but must not survive into the
    // payload — it is a price, and only the Worker may set it.
    const parsed = parseDraftAttributes(reopenedCurtain()) ?? {};
    expect(parsed).not.toHaveProperty('pleat_multiplier');
    expect(parsed).not.toHaveProperty('installation_price');
    expect(parsed).not.toHaveProperty('installation_id');
  });
});

/* ------------------------------------------------------------------ */
/* Blind-type scoping                                                  */
/* ------------------------------------------------------------------ */

describe('optionsForType / slotsForType', () => {
  const ROLLER = { id: 'bt-roller', name: 'Roller', active: true, sort_order: 0 };
  const CURTAINS = { id: 'bt-curtains', name: 'Curtains', active: true, sort_order: 1 };
  /** Curtains declares `pleat_type_id` as a uuid, so the fixture needs one. */
  const PLEAT_ID = '66666666-6666-4666-8666-666666666666';

  /**
   * Catalogs scoped the way migration 35's backfill leaves them: Roller
   * takes a cassette, a rail and a control; Curtains takes a control and
   * an installation option. `cas-off` is linked to Roller but INACTIVE,
   * and `ins-free` is a second, zero-priced installation option used to
   * isolate the charge.
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
          blind_type_ids: [ROLLER.id, CURTAINS.id],
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
        { id: 'ct1', name: 'Chain', price: 0, price_basis: 'per_panel', active: true, sort_order: 0, blind_type_ids: [ROLLER.id, CURTAINS.id] },
      ],
      pleatTypes: [{ id: PLEAT_ID, name: 'Pinch', multiplier: 2, active: true, sort_order: 0 }],
      defaults: [],
      installationOptions: [
        { id: 'ins-1', name: 'Rod', price: 45, price_basis: 'per_unit', active: true, sort_order: 0, blind_type_ids: [CURTAINS.id] },
        { id: 'ins-free', name: 'None', price: 0, price_basis: 'per_unit', active: true, sort_order: 1, blind_type_ids: [CURTAINS.id] },
      ],
      ...overrides,
    };
  }

  it('offers only the options scoped to the selected type', () => {
    expect(optionsForType(catalogs().cassettes, catalogs().blindTypes, 'Roller').map((o) => o.id))
      .toEqual(['c1']);
    expect(optionsForType(catalogs().cassettes, catalogs().blindTypes, 'Curtains')).toEqual([]);
  });

  it('offers nothing for an empty or unknown type name', () => {
    expect(optionsForType(catalogs().cassettes, catalogs().blindTypes, '')).toEqual([]);
    expect(
      optionsForType(catalogs().cassettes, catalogs().blindTypes, 'Venetian (legacy)')
    ).toEqual([]);
  });

  it('reports exactly the slots with at least one scoped active option', () => {
    expect([...slotsForType(catalogs(), 'Roller')].sort()).toEqual([
      'bottom_rail',
      'cassette',
      'control',
    ]);
    expect([...slotsForType(catalogs(), 'Curtains')].sort()).toEqual(['control', 'installation']);
    expect([...slotsForType(catalogs(), 'Venetian (legacy)')]).toEqual([]);
  });

  it('excludes an inactive option from the slot decision', () => {
    const onlyRetired = catalogs({
      cassettes: catalogs().cassettes.filter((c) => c.id === 'cas-off'),
    });
    expect(slotsForType(onlyRetired, 'Roller').has('cassette')).toBe(false);
  });

  describe('blindDraftPrice', () => {
    /** A Roller draft with every slot Roller uses filled. */
    const roller = draft({ blinds_type: 'Roller', panels: ['100'], height_cm: '200' });
    /** A Curtains draft: no cassette, no rail, control and installation. */
    const curtain = draft({
      blinds_type: 'Curtains',
      panels: ['100'],
      height_cm: '200',
      cassette_id: '',
      bottom_rail_id: '',
      attributes: { pleat_type_id: PLEAT_ID },
    });

    it('returns null while a scoped slot is unfilled', () => {
      expect(blindDraftPrice({ ...roller, cassette_id: '' }, catalogs())).toBeNull();
      expect(blindDraftPrice({ ...curtain, installation_id: '' }, catalogs())).toBeNull();
    });

    it('prices a type whose control slot is unscoped with no control chosen', () => {
      const noControls = catalogs({ controls: [] });
      expect(blindDraftPrice({ ...roller, control_id: '' }, noControls)).not.toBeNull();
    });

    it('adds the installation charge for a type that has the slot', () => {
      // `DraftPrice.base` is the calculated unit price before overrides
      // and add-ons; `ins-free` is priced at 0, so the gap is the charge.
      const priced = blindDraftPrice({ ...curtain, installation_id: 'ins-1' }, catalogs());
      const free = blindDraftPrice({ ...curtain, installation_id: 'ins-free' }, catalogs());
      expect(priced!.base).toBe(free!.base + 45);
    });

    it('ignores a stale id for a slot the type does not use', () => {
      // Switching type can leave an id behind; the slot is gone, so it
      // must not be charged — the Worker would reject it outright.
      const stale = { ...curtain, installation_id: 'ins-free', cassette_id: 'c1' };
      expect(blindDraftPrice(stale, catalogs())!.base).toBe(
        blindDraftPrice({ ...curtain, installation_id: 'ins-free' }, catalogs())!.base
      );
    });
  });
});

/* ------------------------------------------------------------------ */
/* Price adjustments                                                   */
/* ------------------------------------------------------------------ */

/** A complete, valid custom draft — the baseline each case mutates. */
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

describe('parseOverride', () => {
  it('reads an empty string as no override', () => {
    expect(parseOverride('')).toEqual({ valid: true, value: null });
  });

  it('reads whitespace as no override', () => {
    expect(parseOverride('   ')).toEqual({ valid: true, value: null });
  });

  it('reads zero as a real override', () => {
    // A line given away is an override, not an absent one.
    expect(parseOverride('0')).toEqual({ valid: true, value: 0 });
  });

  it('rejects a negative figure', () => {
    expect(parseOverride('-5')).toEqual({ valid: false });
  });

  it('rejects text', () => {
    expect(parseOverride('abc')).toEqual({ valid: false });
  });
});

describe('parseAddons', () => {
  it('drops rows with a blank label', () => {
    expect(parseAddons([{ key: 'a', label: '  ', price: '50' }])).toEqual([]);
  });

  it('treats a blank or unparsable price as zero so typing never blanks the preview', () => {
    expect(parseAddons([{ key: 'a', label: 'Rush fee', price: '' }])).toEqual([
      { label: 'Rush fee', price: 0 },
    ]);
    expect(parseAddons([{ key: 'a', label: 'Rush fee', price: 'ab' }])).toEqual([
      { label: 'Rush fee', price: 0 },
    ]);
  });

  it('trims labels', () => {
    expect(parseAddons([{ key: 'a', label: ' Rush fee ', price: '50' }])).toEqual([
      { label: 'Rush fee', price: 50 },
    ]);
  });

  it('strips the React list key from the payload shape', () => {
    expect(parseAddons([{ key: 'a', label: 'Rush fee', price: '50' }])[0]).not.toHaveProperty('key');
  });
});

describe('canOverridePrice', () => {
  it('is false for a custom item', () => {
    expect(canOverridePrice(flat())).toBe(false);
  });

  it('is false for a legacy preset with no provenance', () => {
    expect(canOverridePrice(flat({ item_type: 'preset', preset_id: null }))).toBe(false);
  });

  it('is true for a preset with provenance', () => {
    expect(canOverridePrice(flat({ item_type: 'preset', preset_id: 'p1' }))).toBe(true);
  });

  it('is true for a blind', () => {
    expect(canOverridePrice(draft())).toBe(true);
  });
});

describe('flatDraftPrice', () => {
  it('returns the typed price as both base and unit when not overridden', () => {
    expect(flatDraftPrice(flat())).toEqual({ base: 100, unit: 100, addonsTotal: 0, total: 200 });
  });

  it('ignores an override on a custom item', () => {
    expect(flatDraftPrice(flat({ unit_price_override: '10' }))?.unit).toBe(100);
  });

  it('applies an override on a preset with provenance', () => {
    const price = flatDraftPrice(
      flat({ item_type: 'preset', preset_id: 'p1', unit_price_override: '80' })
    );
    expect(price).toEqual({ base: 100, unit: 80, addonsTotal: 0, total: 160 });
  });

  it('adds add-ons once, on top of the override', () => {
    const price = flatDraftPrice(
      flat({
        item_type: 'preset',
        preset_id: 'p1',
        unit_price_override: '80',
        addons: [{ key: 'a', label: 'Rush fee', price: '50' }],
      })
    );
    expect(price?.addonsTotal).toBe(50);
    expect(price?.total).toBe(210); // 80 x 2 + 50
  });

  it('blanks the preview when the override does not parse', () => {
    expect(
      flatDraftPrice(flat({ item_type: 'preset', preset_id: 'p1', unit_price_override: 'abc' }))
    ).toBeNull();
  });

  it('does not blank the preview for a half-typed add-on', () => {
    expect(
      flatDraftPrice(flat({ addons: [{ key: 'a', label: 'Rush fee', price: '' }] }))?.total
    ).toBe(200);
  });
});

/* ------------------------------------------------------------------ */
/* Bulk-edit selection                                                 */
/* ------------------------------------------------------------------ */

describe('bulkEditSelection', () => {
  const roller = draft({ key: 'r1', blinds_type: 'Roller' });
  const roller2 = draft({ key: 'r2', blinds_type: 'Roller' });
  const curtain = draft({ key: 'c1', blinds_type: 'Curtains' });
  const custom = flat({ key: 'f1' });

  /** Shorthand: the verdict for these keys out of this item list. */
  const verdict = (items: ItemDraft[], ...keys: string[]) =>
    bulkEditSelection(items, new Set(keys));

  it('refuses an empty selection', () => {
    expect(verdict([roller])).toEqual({ ok: false, reason: 'empty' });
  });

  it('refuses a selection containing a preset or custom item', () => {
    // Neither carries a material or a hardware slot to edit at all.
    expect(verdict([roller, custom], 'r1', 'f1')).toEqual({ ok: false, reason: 'non_blind' });
  });

  it('refuses blinds of two different types', () => {
    // Every catalog is scoped per type, so there is no one set of
    // options that could serve both rows.
    expect(verdict([roller, curtain], 'r1', 'c1')).toEqual({ ok: false, reason: 'mixed_types' });
  });

  it('refuses blinds whose type has not been chosen yet', () => {
    const blank = draft({ key: 'b1', blinds_type: '' });
    expect(verdict([blank], 'b1')).toEqual({ ok: false, reason: 'no_type' });
  });

  it('resolves the shared type and the keys it applies to', () => {
    expect(verdict([roller, roller2, curtain], 'r1', 'r2')).toEqual({
      ok: true,
      blindsType: 'Roller',
      keys: ['r1', 'r2'],
    });
  });

  it('ignores items that are not selected', () => {
    // A curtain sitting in the same order must not block a Roller-only
    // selection — only what is ticked is inspected.
    expect(verdict([curtain, roller], 'r1').ok).toBe(true);
  });

  it('groups a legacy free-text type like any other', () => {
    // Nothing is scoped to it, so the form will offer nothing — but the
    // selection itself is coherent and must not report "mixed".
    const legacy = draft({ key: 'l1', blinds_type: 'Venetian (legacy)' });
    const legacy2 = draft({ key: 'l2', blinds_type: 'Venetian (legacy)' });
    expect(verdict([legacy, legacy2], 'l1', 'l2')).toEqual({
      ok: true,
      blindsType: 'Venetian (legacy)',
      keys: ['l1', 'l2'],
    });
  });
});

/* ------------------------------------------------------------------ */
/* Bulk-edit application                                               */
/* ------------------------------------------------------------------ */

describe('applyBulkEditToDraft', () => {
  /** Every field on "no change" — the baseline each case fills in. */
  const NOTHING: BulkEditState = {
    material_id: '',
    cassette_id: '',
    bottom_rail_id: '',
    control_id: '',
    installation_id: '',
  };
  /** The slots a Roller-like type uses; installation is deliberately out. */
  const ROLLER_SLOTS = new Set<CatalogSlot>(['cassette', 'bottom_rail', 'control']);

  it('writes the ids that were chosen', () => {
    const next = applyBulkEditToDraft(
      draft({ material_id: 'old-m', cassette_id: 'old-c' }),
      { ...NOTHING, material_id: 'm2', cassette_id: 'c2' },
      ROLLER_SLOTS
    );
    expect(next.material_id).toBe('m2');
    expect(next.cassette_id).toBe('c2');
  });

  it('leaves a slot alone when its field is on "no change"', () => {
    const next = applyBulkEditToDraft(
      draft({ control_id: 'keep-me' }),
      { ...NOTHING, material_id: 'm2' },
      ROLLER_SLOTS
    );
    expect(next.control_id).toBe('keep-me');
  });

  it('drops an id for a slot the type does not use', () => {
    // The Worker rejects an id for an unscoped slot, so writing one here
    // would make the whole order unsavable.
    const next = applyBulkEditToDraft(
      draft({ installation_id: '' }),
      { ...NOTHING, installation_id: 'ins-1' },
      ROLLER_SLOTS
    );
    expect(next.installation_id).toBe('');
  });

  it('clears a price override on an item it changes', () => {
    // The override was typed against the OLD options and wins over the
    // calculated price, so leaving it would void the bulk re-price.
    const next = applyBulkEditToDraft(
      draft({ unit_price_override: '250' }),
      { ...NOTHING, material_id: 'm2' },
      ROLLER_SLOTS
    );
    expect(next.unit_price_override).toBe('');
  });

  it('keeps add-ons and the original-price flag when it clears an override', () => {
    // Add-ons sit ON TOP of the price rather than replacing it, so a
    // re-price does not invalidate them.
    const before = draft({
      unit_price_override: '250',
      show_original_price: false,
      addons: [{ key: 'a', label: 'Rush fee', price: '50' }],
    });
    const next = applyBulkEditToDraft(before, { ...NOTHING, material_id: 'm2' }, ROLLER_SLOTS);
    expect(next.addons).toEqual(before.addons);
    expect(next.show_original_price).toBe(false);
  });

  it('returns the draft untouched when nothing applies', () => {
    // Including the override: an item the run misses must not lose its
    // negotiated price as a side effect.
    const before = draft({ unit_price_override: '250' });
    expect(applyBulkEditToDraft(before, NOTHING, ROLLER_SLOTS)).toBe(before);
    expect(
      applyBulkEditToDraft(before, { ...NOTHING, installation_id: 'ins-1' }, ROLLER_SLOTS)
    ).toBe(before);
  });
});

/* ------------------------------------------------------------------ */
/* Type-defaults application                                          */
/* ------------------------------------------------------------------ */

/**
 * `applyTypeDefaults` is the single place a blind-type change resets a
 * draft's material/hardware picks — the type dropdown, bulk edit and
 * bulk add all route through it (Task 5), so its semantics here are the
 * contract those three share.
 */
describe('applyTypeDefaults', () => {
  const ROLLER = { id: 't1', name: 'Roller', active: true, sort_order: 0 };

  /**
   * Roller: cassette and control are scoped+active (two cassette choices,
   * one of them retired/unlinked to prove the "ignored" cases); NO bottom
   * rail or installation option is scoped at all, so those two slots are
   * unused by the type. Material `m1` is scoped to Roller. The saved
   * defaults row picks `c1` for cassette and leaves control (a USED slot)
   * with no default, to prove "used but no default" resolves to `''`.
   */
  function catalogs(overrides: Partial<Catalogs> = {}): Catalogs {
    return {
      blindTypes: [ROLLER],
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
        { id: 'c2', name: 'Deluxe', price: 30, price_basis: 'per_m', active: true, sort_order: 1, blind_type_ids: [ROLLER.id] },
        { id: 'c-inactive', name: 'Retired', price: 15, price_basis: 'per_m', active: false, sort_order: 2, blind_type_ids: [ROLLER.id] },
        { id: 'c-unlinked', name: 'Zebra Only', price: 25, price_basis: 'per_m', active: true, sort_order: 3, blind_type_ids: [] },
      ],
      // No bottom rail is scoped to Roller at all — the slot is unused.
      bottomRails: [],
      controls: [
        { id: 'k1', name: 'Chain', price: 0, price_basis: 'per_panel', active: true, sort_order: 0, blind_type_ids: [ROLLER.id] },
      ],
      pleatTypes: [],
      // No installation option is scoped to Roller — the slot is unused.
      installationOptions: [],
      defaults: [
        {
          blind_type_id: ROLLER.id,
          material_id: 'm1',
          cassette_id: 'c1',
          bottom_rail_id: null,
          control_id: null,
          installation_id: null,
        },
      ],
      ...overrides,
    };
  }

  /** A Roller draft with every slot blank, ready to have defaults applied. */
  function blank(): BlindDraft {
    return draft({
      blinds_type: 'Roller',
      material_id: '',
      cassette_id: '',
      bottom_rail_id: '',
      control_id: '',
      installation_id: '',
    });
  }

  it('seeds scoped defaults and clears unscoped slots', () => {
    const next = applyTypeDefaults(blank(), 'Roller', catalogs());
    expect(next.blinds_type).toBe('Roller');
    expect(next.material_id).toBe('m1'); // default applied
    expect(next.cassette_id).toBe('c1'); // default applied
    expect(next.bottom_rail_id).toBe(''); // slot unused by type
    expect(next.control_id).toBe(''); // slot used, no default → empty
    expect(next.installation_id).toBe(''); // slot unused by type
  });

  it('reset semantics: existing valid picks are replaced by defaults', () => {
    const next = applyTypeDefaults({ ...blank(), cassette_id: 'c2' }, 'Roller', catalogs());
    expect(next.cassette_id).toBe('c1'); // c2 valid but reset to default
  });

  it('keepValid keeps a still-valid current pick over the default', () => {
    const next = applyTypeDefaults(
      { ...blank(), cassette_id: 'c2' },
      'Roller',
      catalogs(),
      { keepValid: true }
    );
    expect(next.cassette_id).toBe('c2');
  });

  it('ignores a default that is no longer scoped/active', () => {
    // The saved default points at a cassette that is now inactive.
    const inactiveDefault = catalogs({
      defaults: [
        {
          blind_type_id: ROLLER.id,
          material_id: 'm1',
          cassette_id: 'c-inactive',
          bottom_rail_id: null,
          control_id: null,
          installation_id: null,
        },
      ],
    });
    expect(applyTypeDefaults(blank(), 'Roller', inactiveDefault).cassette_id).toBe('');

    // The saved default points at a cassette no longer linked to Roller.
    const unlinkedDefault = catalogs({
      defaults: [
        {
          blind_type_id: ROLLER.id,
          material_id: 'm1',
          cassette_id: 'c-unlinked',
          bottom_rail_id: null,
          control_id: null,
          installation_id: null,
        },
      ],
    });
    expect(applyTypeDefaults(blank(), 'Roller', unlinkedDefault).cassette_id).toBe('');
  });

  it('seeds attributes from the type registry', () => {
    // A stale attribute blob left behind by a previous type must be wiped
    // and replaced with the new type's own seed values — asserted against
    // the real registry rather than a hardcoded guess.
    const stale = { ...blank(), attributes: { pleat_type_id: 'stale-uuid' } };
    const next = applyTypeDefaults(stale, 'Roller', catalogs());
    const expected = Object.fromEntries(
      Object.entries(getBlindType('Roller').defaultAttributes()).map(([k, v]) => [k, String(v)])
    );
    expect(next.attributes).toEqual(expected);
  });

  it('keeps room, panels, height, qty, color, note untouched', () => {
    const before = draft({
      blinds_type: 'Roller',
      room_name: 'Kitchen',
      panels: ['80', '80'],
      height_cm: '150',
      quantity: '3',
      color: 'Grey',
      note: 'Handle with care',
      unit_price_override: '199',
      show_original_price: false,
      addons: [{ key: 'a', label: 'Rush fee', price: '50' }],
    });
    const next = applyTypeDefaults(before, 'Roller', catalogs());
    expect(next.room_name).toBe(before.room_name);
    expect(next.panels).toEqual(before.panels);
    expect(next.height_cm).toBe(before.height_cm);
    expect(next.quantity).toBe(before.quantity);
    expect(next.color).toBe(before.color);
    expect(next.note).toBe(before.note);
    expect(next.unit_price_override).toBe(before.unit_price_override);
    expect(next.show_original_price).toBe(before.show_original_price);
    expect(next.addons).toEqual(before.addons);
  });
});

/**
 * The bulk measurement pass: room / width / height rows in, one blank
 * blind line item per completed row out.
 *
 * The states matter as much as the conversion. A row that was started but
 * not finished must be reported, never silently dropped — a width typed
 * without its height is a measurement someone took on a ladder, and the
 * order would otherwise be short one window with nothing to say so.
 */
describe('measurementRowState', () => {
  function row(overrides: Partial<MeasurementRow> = {}): MeasurementRow {
    return { key: 'r1', room_name: '', width_cm: '', height_cm: '', ...overrides };
  }

  it('is blank when nothing at all has been typed', () => {
    expect(measurementRowState(row())).toBe('blank');
    expect(measurementRowState(row({ width_cm: '  ', height_cm: ' ' }))).toBe('blank');
  });

  it('is ready when both measurements are positive numbers', () => {
    expect(measurementRowState(row({ width_cm: '120', height_cm: '210' }))).toBe('ready');
  });

  it('accepts a half-typed decimal, like every other draft field', () => {
    expect(measurementRowState(row({ width_cm: '120.', height_cm: ' 210.5 ' }))).toBe('ready');
  });

  it('is incomplete when only one measurement is present', () => {
    expect(measurementRowState(row({ width_cm: '120' }))).toBe('incomplete');
    expect(measurementRowState(row({ height_cm: '210' }))).toBe('incomplete');
  });

  it('is incomplete when a room was named but nothing measured', () => {
    // Typing a room is intent to measure it. Treating this as blank would
    // drop the window the consultant had just walked into.
    expect(measurementRowState(row({ room_name: 'Kitchen' }))).toBe('incomplete');
  });

  it('is incomplete for a value that is not a positive number', () => {
    expect(measurementRowState(row({ width_cm: '0', height_cm: '210' }))).toBe('incomplete');
    expect(measurementRowState(row({ width_cm: '-5', height_cm: '210' }))).toBe('incomplete');
    expect(measurementRowState(row({ width_cm: 'wide', height_cm: '210' }))).toBe('incomplete');
  });
});

describe('countMeasurementRows', () => {
  it('counts ready and incomplete rows and ignores blank ones', () => {
    const rows: MeasurementRow[] = [
      { key: 'a', room_name: 'Living', width_cm: '120', height_cm: '210' },
      { key: 'b', room_name: '', width_cm: '90', height_cm: '' },
      { key: 'c', room_name: '', width_cm: '', height_cm: '' },
      { key: 'd', room_name: 'Bed', width_cm: '80', height_cm: '150' },
    ];
    expect(countMeasurementRows(rows)).toEqual({ ready: 2, incomplete: 1 });
  });

  it('counts a freshly opened popup as nothing to do', () => {
    const rows = ['r1', 'r2', 'r3'].map(newMeasurementRow);
    expect(countMeasurementRows(rows)).toEqual({ ready: 0, incomplete: 0 });
  });
});

describe('measurementRowsToDrafts', () => {
  const DEFAULTS: BlindDraftDefaults = {
    cassette_id: 'cas-1',
    bottom_rail_id: 'br-1',
    control_id: 'ctl-1',
  };

  /** Key generator matching the page's, so ordering is checkable. */
  function keys(): () => string {
    let n = 0;
    return () => `k${++n}`;
  }

  const ROWS: MeasurementRow[] = [
    { key: 'a', room_name: '  Living Room  ', width_cm: ' 120 ', height_cm: ' 210 ' },
    { key: 'b', room_name: 'Half', width_cm: '90', height_cm: '' },
    { key: 'c', room_name: '', width_cm: '', height_cm: '' },
    { key: 'd', room_name: '', width_cm: '80', height_cm: '150' },
  ];

  it('creates one item per completed row, in the order they were typed', () => {
    const drafts = measurementRowsToDrafts(ROWS, DEFAULTS, keys());
    expect(drafts.map((d) => [d.panels[0], d.height_cm])).toEqual([
      ['120', '210'],
      ['80', '150'],
    ]);
    expect(drafts.map((d) => d.key)).toEqual(['k1', 'k2']);
  });

  it('skips incomplete and blank rows', () => {
    // The caller refuses to apply while an incomplete row exists; this is
    // the second half of that rule, not a licence to lose one.
    expect(measurementRowsToDrafts(ROWS, DEFAULTS, keys())).toHaveLength(2);
  });

  it('trims the room name and leaves it empty when none was given', () => {
    const drafts = measurementRowsToDrafts(ROWS, DEFAULTS, keys());
    expect(drafts[0].room_name).toBe('Living Room');
    expect(drafts[1].room_name).toBe('');
  });

  it('leaves the blind type, material and installation unset', () => {
    // The whole point of the pass: measurements now, specification later.
    const [first] = measurementRowsToDrafts(ROWS, DEFAULTS, keys());
    expect(first.blinds_type).toBe('');
    expect(first.material_id).toBe('');
    expect(first.installation_id).toBe('');
    expect(first.attributes).toEqual({});
  });

  it('carries the house default hardware, exactly like Add Standard Blind', () => {
    const [first] = measurementRowsToDrafts(ROWS, DEFAULTS, keys());
    expect(first.cassette_id).toBe('cas-1');
    expect(first.bottom_rail_id).toBe('br-1');
    expect(first.control_id).toBe('ctl-1');
  });

  it('starts every item at quantity 1 with no price adjustments', () => {
    const [first] = measurementRowsToDrafts(ROWS, DEFAULTS, keys());
    expect(first.quantity).toBe('1');
    expect(first.unit_price_override).toBe('');
    expect(first.addons).toEqual([]);
  });

  it('produces the same draft the single-blind button does, plus measurements', () => {
    // One shape, one set of defaults: the two paths must not drift.
    const [first] = measurementRowsToDrafts([ROWS[0]], DEFAULTS, keys());
    expect(first).toEqual({
      ...newBlindDraft('k1', DEFAULTS),
      room_name: 'Living Room',
      panels: ['120'],
      height_cm: '210',
    });
  });

  it('returns nothing when no row was completed', () => {
    expect(measurementRowsToDrafts(['r1', 'r2'].map(newMeasurementRow), DEFAULTS, keys())).toEqual(
      []
    );
  });
});
