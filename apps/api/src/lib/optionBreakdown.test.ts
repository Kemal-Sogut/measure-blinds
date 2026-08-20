// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Contract for `optionLineAmounts` — the per-hardware-option figures the
 * PDF and the public order page print beside each option name.
 *
 * The expected values are computed from the formula in
 * `blindTypes/base.ts` on the MINIMISED dimensions, because that is what
 * the saved `unit_price` was charged on; a suite that asserted the raw
 * measurements would pass while the documents disagreed with the total.
 *
 * The absent-vs-zero rule is asserted directly: "no cassette" and "a
 * cassette that costs nothing" are different facts, and only the second
 * one may ever reach a document as a named option.
 */

import { describe, it, expect } from 'vitest';
import { optionLineAmounts, type OptionPricedItem } from './optionBreakdown';

/**
 * A blind with one charge on each basis, quantity 2.
 *
 * 70 + 70 = 140cm wide (above the 100cm minimum, so unchanged) and 200cm
 * high (at the ≥200 tier, so unchanged) — the minimums are exercised
 * separately below rather than hidden inside every expectation.
 */
const blind: OptionPricedItem = {
  item_type: 'blind',
  blinds_type: 'Roller',
  panels: [70, 70],
  height_cm: 200,
  quantity: 2,
  attributes: {},
  cassette_id: 'cas-1',
  cassette_price_per_m: 10,
  cassette_price_basis: 'per_m',
  bottom_rail_id: 'rail-1',
  bottom_rail_price_per_m: 5,
  bottom_rail_price_basis: 'per_sqm',
  control_id: 'ctl-1',
  control_price_per_item: 12,
  control_price_basis: 'per_panel',
  installation_id: 'inst-1',
  installation_price_per_item: 30,
  installation_price_basis: 'per_unit',
};

describe('optionLineAmounts', () => {
  it('charges each slot on its own basis, scaled to the line', () => {
    // per_m:     140/100 × 10       = 14.00 × 2 = 28.00
    // per_sqm:   140 × 200 / 10000 × 5 = 14.00 × 2 = 28.00
    // per_panel: 2 panels × 12      = 24.00 × 2 = 48.00
    // per_unit:  30                 = 30.00 × 2 = 60.00
    expect(optionLineAmounts(blind)).toEqual({
      cassette: 28,
      bottom_rail: 28,
      control: 48,
      installation: 60,
    });
  });

  it('charges the dimension minimums, like the price it must reconcile with', () => {
    // 40cm wide → charged as 100cm; 150cm high → charged as 200cm.
    const small = { ...blind, panels: [40], height_cm: 150, quantity: 1 };
    expect(optionLineAmounts(small)).toEqual({
      cassette: 10, // 100/100 × 10
      bottom_rail: 10, // 100 × 200 / 10000 × 5
      control: 12, // 1 panel × 12
      installation: 30,
    });
  });

  it('rounds each line figure to the cent', () => {
    const odd = { ...blind, panels: [133], cassette_price_per_m: 9.99, quantity: 3 };
    // 133/100 × 9.99 = 13.2867 × 3 = 39.8601 → 39.86
    expect(optionLineAmounts(odd).cassette).toBe(39.86);
  });

  it('reports a chosen option that costs nothing as 0, not as absent', () => {
    const free = { ...blind, cassette_price_per_m: 0 };
    expect(optionLineAmounts(free).cassette).toBe(0);
    expect('cassette' in optionLineAmounts(free)).toBe(true);
  });

  it('omits a slot the blind carries no option in', () => {
    const noRail = {
      ...blind,
      bottom_rail_id: null,
      bottom_rail_price_per_m: null,
      bottom_rail_price_basis: null,
    };
    expect('bottom_rail' in optionLineAmounts(noRail)).toBe(false);
  });

  it('omits a pre-migration-36 row whose basis was never stored', () => {
    // The rate alone cannot say what was charged, and guessing a basis
    // would invent money on a historical document.
    const legacy = { ...blind, control_price_basis: null };
    expect('control' in optionLineAmounts(legacy)).toBe(false);
  });

  it('returns nothing for items that carry no options at all', () => {
    expect(optionLineAmounts({ ...blind, item_type: 'preset' })).toEqual({});
    expect(optionLineAmounts({ ...blind, item_type: 'custom' })).toEqual({});
    expect(optionLineAmounts({ item_type: 'blind' })).toEqual({});
  });

  it('tolerates numeric columns arriving as PostgREST strings', () => {
    const strings = {
      ...blind,
      height_cm: '200',
      quantity: '2',
      cassette_price_per_m: '10',
    } as OptionPricedItem;
    expect(optionLineAmounts(strings).cassette).toBe(28);
  });
});
