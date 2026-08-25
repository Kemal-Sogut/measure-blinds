// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Unit tests for `optionBreakdown.ts`.
 *
 * These protect the invariant the Order Presentation page is built on:
 * every row's option cells plus its adjustment equal the stored
 * `line_total` EXACTLY, so nothing shown to a customer fails to add up.
 * The fixtures carry real snapshot values, including a case where naive
 * per-leg rounding misses the stored total by two cents.
 */

import { describe, it, expect } from 'vitest';
import { describeLineBreakdown } from './optionBreakdown';
import type { LineItem } from '../types';

/** A saved blind line item; individual tests override single fields. */
function lineItem(overrides: Partial<LineItem> = {}): LineItem {
  return {
    id: 'li-1',
    order_id: 'o-1',
    item_type: 'blind',
    position: 0,
    uid: 'u-1',
    hidden: false,
    room_name: 'Living Room',
    blinds_type: 'Roller',
    panels: [140],
    height_cm: 200,
    material_id: 'm-1',
    material_name: 'Blackout White',
    material_price_per_sqm: 50,
    cassette_id: null,
    cassette_name: null,
    cassette_price_per_m: null,
    cassette_price_basis: null,
    bottom_rail_id: null,
    bottom_rail_name: null,
    bottom_rail_price_per_m: null,
    bottom_rail_price_basis: null,
    control_id: null,
    control_name: null,
    control_price_per_item: null,
    control_price_basis: null,
    installation_id: null,
    installation_name: null,
    installation_price_per_item: null,
    installation_price_basis: null,
    description: '',
    note: '',
    color: 'White',
    attributes: {},
    quantity: 1,
    unit_price: 140,
    line_total: 140,
    title: '',
    preset_id: null,
    base_unit_price: null,
    show_original_price: false,
    addons: [],
    locked_base_price: null,
    locked_inputs_fingerprint: null,
    created_at: '2026-08-20T00:00:00Z',
    updated_at: '2026-08-20T00:00:00Z',
    ...overrides,
  };
}

describe('describeLineBreakdown', () => {
  it('reports the material name and its cost when the blind has no hardware', () => {
    const { cells, adjustment } = describeLineBreakdown(lineItem());
    expect(cells.material).toEqual({ name: 'Blackout White', amount: 140 });
    expect(adjustment).toBe(0);
  });

  it('reports colour as a name with no money', () => {
    const { cells } = describeLineBreakdown(lineItem());
    expect(cells.color).toEqual({ name: 'White', amount: null });
  });

  it('leaves a slot the blind does not carry as an empty cell', () => {
    const { cells } = describeLineBreakdown(lineItem());
    expect(cells.control).toEqual({ name: null, amount: null });
  });

  it('charges each basis the way the price did', () => {
    const { cells } = describeLineBreakdown(
      lineItem({
        cassette_id: 'c-1',
        cassette_name: 'Slimline',
        cassette_price_per_m: 12,
        cassette_price_basis: 'per_m',
        control_id: 'ct-1',
        control_name: 'Cordless',
        control_price_per_item: 25,
        control_price_basis: 'per_panel',
        installation_id: 'i-1',
        installation_name: 'Top fix',
        installation_price_per_item: 30,
        installation_price_basis: 'per_unit',
        unit_price: 211.8, // 140 + 16.8 + 25 + 30
        line_total: 211.8,
      })
    );
    expect(cells.cassette).toEqual({ name: 'Slimline', amount: 16.8 });
    expect(cells.control).toEqual({ name: 'Cordless', amount: 25 });
    expect(cells.installation).toEqual({ name: 'Top fix', amount: 30 });
  });

  it('multiplies every cell by the quantity', () => {
    const { cells } = describeLineBreakdown(
      lineItem({
        control_id: 'ct-1',
        control_name: 'Cordless',
        control_price_per_item: 25,
        control_price_basis: 'per_unit',
        quantity: 3,
        unit_price: 165,
        line_total: 495,
      })
    );
    expect(cells.control).toEqual({ name: 'Cordless', amount: 75 });
    expect(cells.material).toEqual({ name: 'Blackout White', amount: 420 });
  });

  it('reports an option that costs nothing as 0, not as absent', () => {
    // A "Regular" control priced at $0 is still a choice the customer made.
    const { cells } = describeLineBreakdown(
      lineItem({
        control_id: 'ct-0',
        control_name: 'Regular',
        control_price_per_item: 0,
        control_price_basis: 'per_unit',
      })
    );
    expect(cells.control).toEqual({ name: 'Regular', amount: 0 });
  });

  it('fits the material cell so the row sums to the stored line total', () => {
    // Verified case: naive per-leg rounding gives material 393.40 and a
    // row that misses line_total by two cents. Material absorbs it.
    const item = lineItem({
      panels: [101],
      height_cm: 205,
      material_price_per_sqm: 47.5,
      cassette_id: 'c-1',
      cassette_name: 'Slimline',
      cassette_price_per_m: 5.66,
      cassette_price_basis: 'per_m',
      bottom_rail_id: 'br-1',
      bottom_rail_name: 'Fabric wrapped',
      bottom_rail_price_per_m: 6.66,
      bottom_rail_price_basis: 'per_m',
      control_id: 'ct-1',
      control_name: 'Cordless',
      control_price_per_item: 19.99,
      control_price_basis: 'per_panel',
      installation_id: 'i-1',
      installation_name: 'Top fix',
      installation_price_per_item: 33.33,
      installation_price_basis: 'per_unit',
      quantity: 4,
      unit_price: 164.11,
      line_total: 656.44,
    });
    const { cells, adjustment } = describeLineBreakdown(item);
    expect(cells.cassette.amount).toBe(22.87);
    expect(cells.bottom_rail.amount).toBe(26.91);
    expect(cells.control.amount).toBe(79.96);
    expect(cells.installation.amount).toBe(133.32);
    expect(cells.material.amount).toBe(393.38); // not 393.40
    expect(adjustment).toBe(0);
  });

  it('reports add-ons as the adjustment', () => {
    const { adjustment } = describeLineBreakdown(
      lineItem({ addons: [{ label: 'Rush fee', price: 40 }], line_total: 180 })
    );
    expect(adjustment).toBe(40);
  });

  it('reports a price override as the adjustment, per blind', () => {
    // Calculated 140, charged 120, qty 2 → line_total 240, adjustment −40.
    const { cells, adjustment } = describeLineBreakdown(
      lineItem({ quantity: 2, base_unit_price: 140, unit_price: 120, line_total: 240 })
    );
    expect(cells.material).toEqual({ name: 'Blackout White', amount: 280 });
    expect(adjustment).toBe(-40);
  });

  it('reports an override and add-ons together', () => {
    const { adjustment } = describeLineBreakdown(
      lineItem({
        quantity: 2,
        base_unit_price: 140,
        unit_price: 120,
        addons: [{ label: 'Rush fee', price: 40 }],
        line_total: 280,
      })
    );
    // −$40 of override, +$40 of add-on: the two really do cancel here.
    expect(adjustment).toBe(0);
  });

  it('hands a preset or custom line back with no options and its whole total', () => {
    const { cells, adjustment, lineTotal } = describeLineBreakdown(
      lineItem({ item_type: 'preset', title: 'Call-out fee', line_total: 75 })
    );
    expect(cells.material).toEqual({ name: null, amount: null });
    expect(adjustment).toBe(75);
    expect(lineTotal).toBe(75);
  });

  it('always satisfies: sum of cells + adjustment === line_total', () => {
    const cases: LineItem[] = [
      lineItem(),
      lineItem({ quantity: 3, unit_price: 140, line_total: 420 }),
      lineItem({ base_unit_price: 140, unit_price: 99.99, line_total: 99.99 }),
      lineItem({ addons: [{ label: 'Rush', price: 12.34 }], line_total: 152.34 }),
      lineItem({
        panels: [101],
        height_cm: 205,
        material_price_per_sqm: 47.5,
        cassette_id: 'c-1',
        cassette_name: 'Slimline',
        cassette_price_per_m: 5.66,
        cassette_price_basis: 'per_m',
        bottom_rail_id: 'br-1',
        bottom_rail_name: 'Fabric wrapped',
        bottom_rail_price_per_m: 6.66,
        bottom_rail_price_basis: 'per_m',
        control_id: 'ct-1',
        control_name: 'Cordless',
        control_price_per_item: 19.99,
        control_price_basis: 'per_panel',
        installation_id: 'i-1',
        installation_name: 'Top fix',
        installation_price_per_item: 33.33,
        installation_price_basis: 'per_unit',
        quantity: 4,
        unit_price: 164.11,
        line_total: 656.44,
      }),
      lineItem({ item_type: 'custom', title: 'Removal', line_total: 60 }),
    ];
    for (const item of cases) {
      const { cells, adjustment, lineTotal } = describeLineBreakdown(item);
      const summed = Object.values(cells).reduce((s, c) => s + (c.amount ?? 0), 0);
      expect(Math.round((summed + adjustment) * 100) / 100).toBe(lineTotal);
    }
  });
});
