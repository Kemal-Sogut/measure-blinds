// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Unit tests for `optionBreakdown.ts`.
 *
 * These protect the invariant the order view is built on: every blind
 * row's option cells plus its add-ons equal the stored `line_total`
 * EXACTLY, so nothing shown to a customer fails to add up. The fixtures
 * carry real snapshot values, including a case where naive per-leg
 * rounding misses the stored total by two cents.
 *
 * They also pin the privacy property the page depends on: a price override
 * is absorbed into the material cell, so no column of the breakdown
 * discloses one. `show_original_price` is the only control over that, and
 * it discloses through the struck-through unit price alone.
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
    const { cells, addons } = describeLineBreakdown(lineItem());
    expect(cells.material).toEqual({ name: 'Blackout White', amount: 140 });
    expect(addons).toBe(0);
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
    const { cells, addons } = describeLineBreakdown(item);
    expect(cells.cassette.amount).toBe(22.87);
    expect(cells.bottom_rail.amount).toBe(26.91);
    expect(cells.control.amount).toBe(79.96);
    expect(cells.installation.amount).toBe(133.32);
    expect(cells.material.amount).toBe(393.38); // not 393.40
    expect(addons).toBe(0);
  });

  it('reports the add-ons total', () => {
    const { addons } = describeLineBreakdown(
      lineItem({ addons: [{ label: 'Rush fee', price: 40 }], line_total: 180 })
    );
    expect(addons).toBe(40);
  });

  it('sums several add-ons into the one figure', () => {
    const { addons } = describeLineBreakdown(
      lineItem({
        addons: [
          { label: 'Rush fee', price: 40 },
          { label: 'Removal', price: 12.5 },
        ],
        line_total: 192.5,
      })
    );
    expect(addons).toBe(52.5);
  });

  it('absorbs a price override into the material cell, leaving no trace', () => {
    // Calculated 140, charged 120, qty 2 → the row decomposes the 240 that
    // was CHARGED. Nothing anywhere reports the missing 40.
    const { cells, addons } = describeLineBreakdown(
      lineItem({ quantity: 2, base_unit_price: 140, unit_price: 120, line_total: 240 })
    );
    expect(cells.material).toEqual({ name: 'Blackout White', amount: 240 });
    expect(addons).toBe(0);
  });

  it('absorbs the override whether or not the original is shown', () => {
    // `show_original_price` governs the struck-through unit price and
    // nothing else: the breakdown is identical either way.
    const shown = describeLineBreakdown(
      lineItem({
        quantity: 2,
        base_unit_price: 140,
        unit_price: 120,
        line_total: 240,
        show_original_price: true,
      })
    );
    const hidden = describeLineBreakdown(
      lineItem({
        quantity: 2,
        base_unit_price: 140,
        unit_price: 120,
        line_total: 240,
        show_original_price: false,
      })
    );
    expect(shown).toEqual(hidden);
  });

  it('keeps an override and add-ons apart', () => {
    const { cells, addons } = describeLineBreakdown(
      lineItem({
        quantity: 2,
        base_unit_price: 140,
        unit_price: 120,
        addons: [{ label: 'Rush fee', price: 40 }],
        line_total: 280,
      })
    );
    // The override is in the material cell; the add-on is its own figure.
    // Under the old adjustment column these two cancelled to a bare zero.
    expect(cells.material.amount).toBe(240);
    expect(addons).toBe(40);
  });

  it('fits the material cell negative on a blind sold below its hardware', () => {
    // Hardware alone is 25 + 30 = 55/unit; the line was given away at 40.
    const { cells, addons } = describeLineBreakdown(
      lineItem({
        control_id: 'ct-1',
        control_name: 'Cordless',
        control_price_per_item: 25,
        control_price_basis: 'per_panel',
        installation_id: 'i-1',
        installation_name: 'Top fix',
        installation_price_per_item: 30,
        installation_price_basis: 'per_unit',
        base_unit_price: 195,
        unit_price: 40,
        line_total: 40,
      })
    );
    expect(cells.control.amount).toBe(25);
    expect(cells.installation.amount).toBe(30);
    expect(cells.material.amount).toBe(-15);
    expect(addons).toBe(0);
  });

  it('hands a preset or custom line back with no option cells', () => {
    const { cells, addons, lineTotal } = describeLineBreakdown(
      lineItem({ item_type: 'preset', title: 'Call-out fee', unit_price: 75, line_total: 75 })
    );
    expect(cells.material).toEqual({ name: null, amount: null });
    expect(addons).toBe(0);
    expect(lineTotal).toBe(75);
  });

  it('reports a preset line add-ons figure even though nothing reconciles', () => {
    const { addons, lineTotal } = describeLineBreakdown(
      lineItem({
        item_type: 'preset',
        title: 'Call-out fee',
        unit_price: 75,
        addons: [{ label: 'After hours', price: 25 }],
        line_total: 100,
      })
    );
    expect(addons).toBe(25);
    expect(lineTotal).toBe(100);
  });

  it('always satisfies: sum of cells + add-ons === line_total, for blinds', () => {
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
      lineItem({
        base_unit_price: 200,
        unit_price: 33.33,
        addons: [{ label: 'Rush', price: 0.01 }],
        line_total: 33.34,
      }),
    ];
    for (const item of cases) {
      const { cells, addons, lineTotal } = describeLineBreakdown(item);
      const summed = Object.values(cells).reduce((s, c) => s + (c.amount ?? 0), 0);
      expect(Math.round((summed + addons) * 100) / 100).toBe(lineTotal);
    }
  });
});
