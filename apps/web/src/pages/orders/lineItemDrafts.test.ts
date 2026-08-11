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
import { parseDraftAttributes, type BlindDraft } from './lineItemDrafts';

/** A complete, valid blind draft — the baseline each case mutates. */
function draft(overrides: Partial<BlindDraft> = {}): BlindDraft {
  return {
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
