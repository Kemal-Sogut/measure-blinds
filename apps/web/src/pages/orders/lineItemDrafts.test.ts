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
import {
  blindDraftPrice,
  canOverridePrice,
  flatDraftPrice,
  optionsForType,
  parseAddons,
  parseDraftAttributes,
  parseOverride,
  slotsForType,
  type BlindDraft,
  type Catalogs,
  type FlatDraft,
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
        { id: 'c1', name: 'Standard', price_per_m: 20, active: true, sort_order: 0, blind_type_ids: [ROLLER.id] },
        { id: 'cas-off', name: 'Retired', price_per_m: 5, active: false, sort_order: 1, blind_type_ids: [ROLLER.id] },
      ],
      bottomRails: [
        { id: 'b1', name: 'Regular', price_per_m: 0, active: true, sort_order: 0, blind_type_ids: [ROLLER.id] },
      ],
      controls: [
        { id: 'ct1', name: 'Chain', price_per_item: 0, active: true, sort_order: 0, blind_type_ids: [ROLLER.id, CURTAINS.id] },
      ],
      pleatTypes: [{ id: PLEAT_ID, name: 'Pinch', multiplier: 2, active: true, sort_order: 0 }],
      installationOptions: [
        { id: 'ins-1', name: 'Rod', price_per_item: 45, active: true, sort_order: 0, blind_type_ids: [CURTAINS.id] },
        { id: 'ins-free', name: 'None', price_per_item: 0, active: true, sort_order: 1, blind_type_ids: [CURTAINS.id] },
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
