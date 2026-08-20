// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Unit tests for `presentationFilters.ts` — the facet extraction and match
 * predicate behind the Order Presentation filter bar.
 *
 * The combination rule (AND across option types, OR within one) is the
 * behaviour the whole feature was specified around, so the design's own
 * ten-window worked example is encoded here verbatim.
 */

import { describe, it, expect } from 'vitest';
import {
  buildFacets,
  fieldValue,
  hasOptionFilter,
  matchesFilters,
  type PresentationFilter,
} from './presentationFilters';
import type { LineItem } from '../../types';

/** A saved blind carrying only the fields the filters read. */
function blind(overrides: Partial<LineItem> = {}): LineItem {
  return {
    item_type: 'blind',
    room_name: 'Living Room',
    blinds_type: 'Roller',
    material_name: 'Blackout White',
    color: 'White',
    cassette_name: null,
    bottom_rail_name: null,
    control_name: null,
    installation_name: null,
    ...overrides,
  } as LineItem;
}

/** Builds a filter without caring about the ids the UI mints. */
function f(field: PresentationFilter['field'], value: string): PresentationFilter {
  return { id: `${field}:${value}`, field, value };
}

describe('fieldValue', () => {
  it('reads each field off its snapshot column', () => {
    const item = blind({ control_name: 'Cordless', bottom_rail_name: 'Fabric wrapped' });
    expect(fieldValue(item, 'room_name')).toBe('Living Room');
    expect(fieldValue(item, 'blinds_type')).toBe('Roller');
    expect(fieldValue(item, 'material')).toBe('Blackout White');
    expect(fieldValue(item, 'color')).toBe('White');
    expect(fieldValue(item, 'control')).toBe('Cordless');
    expect(fieldValue(item, 'bottom_rail')).toBe('Fabric wrapped');
  });

  it('returns an empty string for an option the blind does not carry', () => {
    expect(fieldValue(blind(), 'cassette')).toBe('');
  });
});

describe('buildFacets', () => {
  it('lists each distinct value with the number of blinds carrying it', () => {
    const items = [
      blind({ control_name: 'Cordless' }),
      blind({ control_name: 'Cordless' }),
      blind({ control_name: 'Motorised' }),
    ];
    const control = buildFacets(items).find((facet) => facet.field === 'control');
    expect(control?.values).toEqual([
      { value: 'Cordless', count: 2 },
      { value: 'Motorised', count: 1 },
    ]);
  });

  it('omits a field no blind in the order carries a value for', () => {
    const fields = buildFacets([blind()]).map((facet) => facet.field);
    expect(fields).not.toContain('installation');
    expect(fields).not.toContain('cassette');
  });

  it('omits preset and custom lines — they have no options to filter on', () => {
    const items = [blind(), { item_type: 'preset', room_name: 'Call-out' } as LineItem];
    const room = buildFacets(items).find((facet) => facet.field === 'room_name');
    expect(room?.values).toEqual([{ value: 'Living Room', count: 1 }]);
  });

  it('counts over every blind, not over any filtered subset', () => {
    // The counts describe the ORDER, so they stay stable while a filter is
    // being built rather than collapsing to (0) beside the value the
    // consultant is reaching for.
    const items = [
      blind({ control_name: 'Cordless' }),
      blind({ control_name: 'Motorised' }),
      blind({ control_name: 'Motorised' }),
    ];
    const control = buildFacets(items).find((facet) => facet.field === 'control');
    expect(control?.values).toEqual([
      { value: 'Cordless', count: 1 },
      { value: 'Motorised', count: 2 },
    ]);
  });
});

describe('matchesFilters', () => {
  it('matches everything when there are no filters', () => {
    expect(matchesFilters(blind(), [])).toBe(true);
  });

  it('matches everything when a filter has no value chosen yet', () => {
    expect(matchesFilters(blind(), [f('control', '')])).toBe(true);
  });

  it('ANDs across different option types', () => {
    const both = blind({ control_name: 'Cordless', bottom_rail_name: 'Fabric wrapped' });
    const onlyControl = blind({ control_name: 'Cordless' });
    const filters = [f('control', 'Cordless'), f('bottom_rail', 'Fabric wrapped')];
    expect(matchesFilters(both, filters)).toBe(true);
    expect(matchesFilters(onlyControl, filters)).toBe(false);
  });

  it('ORs within one option type', () => {
    const filters = [f('control', 'Cordless'), f('control', 'Motorised')];
    expect(matchesFilters(blind({ control_name: 'Cordless' }), filters)).toBe(true);
    expect(matchesFilters(blind({ control_name: 'Motorised' }), filters)).toBe(true);
    expect(matchesFilters(blind({ control_name: 'Chain' }), filters)).toBe(false);
  });

  it("reproduces the design's ten-window example", () => {
    // 10 windows: 3 cordless, 5 fabric-wrapped, 2 of them both.
    const windows: LineItem[] = [
      blind({ room_name: 'W1', control_name: 'Cordless', bottom_rail_name: 'Fabric wrapped' }),
      blind({ room_name: 'W2', control_name: 'Cordless', bottom_rail_name: 'Fabric wrapped' }),
      blind({ room_name: 'W3', control_name: 'Cordless' }),
      blind({ room_name: 'W4', bottom_rail_name: 'Fabric wrapped' }),
      blind({ room_name: 'W5', bottom_rail_name: 'Fabric wrapped' }),
      blind({ room_name: 'W6', bottom_rail_name: 'Fabric wrapped' }),
      blind({ room_name: 'W7', control_name: 'Motorised' }),
      blind({ room_name: 'W8' }),
      blind({ room_name: 'W9' }),
      blind({ room_name: 'W10' }),
    ];
    const count = (filters: PresentationFilter[]) =>
      windows.filter((w) => matchesFilters(w, filters)).length;

    expect(count([f('control', 'Cordless')])).toBe(3);
    expect(count([f('bottom_rail', 'Fabric wrapped')])).toBe(5);
    expect(count([f('control', 'Cordless'), f('bottom_rail', 'Fabric wrapped')])).toBe(2);
    expect(
      count([
        f('control', 'Cordless'),
        f('control', 'Motorised'),
        f('bottom_rail', 'Fabric wrapped'),
      ])
    ).toBe(2);
  });
});

describe('hasOptionFilter', () => {
  it('is false for no filters, and for room or blind-type filters alone', () => {
    expect(hasOptionFilter([])).toBe(false);
    expect(hasOptionFilter([f('room_name', 'Living Room'), f('blinds_type', 'Roller')])).toBe(false);
  });

  it('is false for an option filter with no value chosen yet', () => {
    expect(hasOptionFilter([f('control', '')])).toBe(false);
  });

  it('is true once any option type is narrowed', () => {
    expect(hasOptionFilter([f('control', 'Cordless')])).toBe(true);
  });
});
