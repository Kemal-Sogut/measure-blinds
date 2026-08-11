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
  canOverridePrice,
  flatDraftPrice,
  parseAddons,
  parseDraftAttributes,
  parseOverride,
  type BlindDraft,
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
   * the two ids the client originally sent.
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

  it('keeps the ids and drops the server-written snapshot keys', () => {
    expect(parseDraftAttributes(reopenedCurtain())).toEqual({
      pleat_type_id: PLEAT_ID,
      installation_id: INSTALL_ID,
    });
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
