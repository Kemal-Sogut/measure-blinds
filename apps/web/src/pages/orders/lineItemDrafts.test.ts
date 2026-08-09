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

  it('returns null when a value is not valid for the type', () => {
    expect(parseDraftAttributes(draft({ attributes: { nope: 'x' } }))).toBeNull();
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
