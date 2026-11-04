// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins the incomplete-item rule (spec 2026-11-02). TWIN of the other
 * workspace's file — the editor's chips/pre-checks and the Worker's
 * gates must agree on every case here, so the two files stay identical.
 */

import { describe, it, expect } from 'vitest';
import {
  countIncomplete,
  firstIncompleteMessage,
  measuredWidths,
  incompleteMessage,
  missingFields,
  type CompletenessInput,
  type CompletenessScope,
} from './lineItemCompleteness';

const ID = '11111111-1111-4111-8111-111111111111';

/** Roller uses cassette + bottom rail + control; Curtains control + installation. */
const scope: CompletenessScope = {
  isKnownType: (t) => t === 'Roller' || t === 'Curtains' || t === 'ReqTest',
  usesSlot: (t, s) =>
    (t === 'Roller' ? ['cassette', 'bottom_rail', 'control'] : t === 'Curtains' ? ['control', 'installation'] : []).includes(s),
  requiredAttributes: (t) => (t === 'ReqTest' ? [{ key: 'widget_id', noun: 'widget' }] : []),
};

function roller(over: Partial<CompletenessInput> = {}): CompletenessInput {
  return {
    item_type: 'blind',
    room_name: 'Kitchen',
    blinds_type: 'Roller',
    panels: [70, 70],
    height_cm: 200,
    material_id: ID,
    cassette_id: ID,
    bottom_rail_id: ID,
    control_id: ID,
    installation_id: null,
    attributes: {},
    ...over,
  };
}

describe('missingFields', () => {
  it('reports nothing for a complete blind', () => {
    expect(missingFields(roller(), scope)).toEqual([]);
  });

  it('lists every open field of a bulk-added blank row, in message order', () => {
    const blank = roller({ blinds_type: '', panels: [], height_cm: null, material_id: null, cassette_id: null, bottom_rail_id: null, control_id: null });
    // A blank type uses no slot, so only the four type-independent fields show.
    expect(missingFields(blank, scope)).toEqual(['blind type', 'width', 'height', 'material']);
  });

  it('treats a blank panel among measured ones as a missing width', () => {
    expect(missingFields(roller({ panels: [70, null] }), scope)).toEqual(['width']);
    expect(missingFields(roller({ panels: [70, 0] }), scope)).toEqual(['width']);
  });

  it('lists only the slots the type uses', () => {
    expect(missingFields(roller({ material_id: null, control_id: null }), scope)).toEqual(['material', 'control option']);
    const curtain = roller({ blinds_type: 'Curtains', cassette_id: null, bottom_rail_id: null, installation_id: null });
    expect(missingFields(curtain, scope)).toEqual(['installation option']);
  });

  it('leaves an unknown legacy type unconstrained on hardware', () => {
    const legacy = roller({ blinds_type: 'Venetian (legacy)', cassette_id: null, bottom_rail_id: null, control_id: null });
    expect(missingFields(legacy, scope)).toEqual([]);
  });

  it("reports a type's required attribute when blank", () => {
    expect(missingFields(roller({ blinds_type: 'ReqTest', attributes: {} }), scope)).toEqual(['widget']);
    expect(missingFields(roller({ blinds_type: 'ReqTest', attributes: { widget_id: ID } }), scope)).toEqual([]);
  });

  it('lists the Dual Shades back fabric as an open field until it is chosen', () => {
    const dual = {
      item_type: 'blind' as const,
      blinds_type: 'Dual Shades',
      panels: [100],
      height_cm: 200,
      material_id: '11111111-1111-4111-8111-111111111111',
      attributes: {},
    };
    const scope = { isKnownType: () => false, usesSlot: () => false };
    expect(missingFields(dual, scope)).toEqual(['back fabric']);
    expect(incompleteMessage(0, dual, ['back fabric'])).toBe('Item 1: choose a back fabric.');
    expect(
      missingFields({ ...dual, attributes: { back_material_id: '44444444-4444-4444-8444-444444444444' } }, scope)
    ).toEqual([]);
  });

  it('never reports a preset or custom item', () => {
    expect(missingFields({ item_type: 'preset' }, scope)).toEqual([]);
    expect(missingFields({ item_type: 'custom' }, scope)).toEqual([]);
  });
});

describe('firstIncompleteMessage', () => {
  it('names the first incomplete item by its position and room', () => {
    const items: CompletenessInput[] = [{ item_type: 'custom' }, roller({ control_id: null })];
    expect(firstIncompleteMessage(items, scope)).toBe('Item 2 (Kitchen): choose a control option.');
  });

  it('omits the room when blank and uses the measurement wording', () => {
    expect(firstIncompleteMessage([roller({ room_name: '', height_cm: null })], scope)).toBe('Item 1: enter a height.');
    expect(firstIncompleteMessage([roller({ panels: [null] })], scope)).toBe('Item 1 (Kitchen): enter every panel width.');
  });

  it('uses "an" before a vowel', () => {
    const curtain = roller({ blinds_type: 'Curtains', cassette_id: null, bottom_rail_id: null, installation_id: null });
    expect(firstIncompleteMessage([curtain], scope)).toBe('Item 1 (Kitchen): choose an installation option.');
  });

  it('returns null when every item is complete', () => {
    expect(firstIncompleteMessage([roller(), { item_type: 'preset' }], scope)).toBeNull();
  });
});

describe('countIncomplete / measuredWidths', () => {
  it('counts incomplete items, hidden or not', () => {
    expect(countIncomplete([roller(), roller({ material_id: null }), roller({ height_cm: null })], scope)).toBe(2);
  });

  it('keeps only measured widths', () => {
    expect(measuredWidths([70, null, 0, 55])).toEqual([70, 55]);
    expect(measuredWidths(null)).toEqual([]);
  });
});
