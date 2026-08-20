// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Per-option money for a SAVED line item — what the Order Presentation
 * page puts in each option column.
 *
 * Nothing else in the app turns a stored `LineItem` back into pricing
 * inputs: the editor builds them from the catalog and the Worker builds
 * them from catalog rows at save time. This module builds them from the
 * item's own SNAPSHOT columns instead, so the page reports what was
 * actually charged rather than what the catalog says today.
 *
 * The costs themselves come from `BaseBlindType.describeUnitCosts` — the
 * same calculation that produced the price — so a price basis is never
 * interpreted twice. What this module adds on top is the reconciliation
 * (see {@link describeLineBreakdown}): rounding legs independently does
 * NOT reproduce the stored `line_total`, and a customer-facing table whose
 * row does not add up is worse than one with no money in it at all.
 */

import { getBlindType } from './blindTypes';
import type { CatalogSlot, HardwareCharge } from './blindTypes/base';
import type { LineItem } from '../types';

/**
 * The option types the presentation table has a column for.
 *
 * `color` is a member despite carrying no money: it is a choice the
 * customer made and asked to filter on, and modelling it here keeps the
 * table and the filter bar reading from one list.
 */
export type OptionColumn = 'material' | 'color' | CatalogSlot;

/** Column order, left to right. */
export const OPTION_COLUMNS: readonly OptionColumn[] = [
  'material',
  'color',
  'cassette',
  'bottom_rail',
  'control',
  'installation',
];

/** Customer-facing heading for each option column. */
export const OPTION_COLUMN_LABELS: Record<OptionColumn, string> = {
  material: 'Material',
  color: 'Colour',
  cassette: 'Cassette',
  bottom_rail: 'Bottom rail',
  control: 'Control',
  installation: 'Installation',
};

/**
 * One option column's content for one line.
 *
 * `name === null` means the blind carries no option of this type — the
 * cell renders as a dash, and the column may be dropped entirely if no
 * visible line fills it. `amount === null` means the column carries no
 * money at all (colour); `amount === 0` is different again — a real choice
 * that happens to add nothing, which renders as a bare name.
 */
export interface OptionCell {
  name: string | null;
  amount: number | null;
}

/** Everything one table row needs, already reconciled to the stored total. */
export interface LineBreakdown {
  cells: Record<OptionColumn, OptionCell>;
  /**
   * Money on this line that no option column explains: add-ons, and the
   * gap a consultant's price override opened. Zero on an ordinary line —
   * never rounding noise, because the cells were fitted to the stored
   * price rather than summed independently of it.
   */
  adjustment: number;
  /** The stored `line_total`, echoed so callers total one field. */
  lineTotal: number;
}

/** Rounds to 2 decimal places (half-up), like every money path in the app. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Reads one hardware slot's snapshotted name off a line item. */
const SLOT_NAME: Record<CatalogSlot, (item: LineItem) => string | null> = {
  cassette: (item) => item.cassette_name,
  bottom_rail: (item) => item.bottom_rail_name,
  control: (item) => item.control_name,
  installation: (item) => item.installation_name,
};

/**
 * Rebuilds the `hardware` map the item was priced with, from its snapshot
 * columns.
 *
 * A slot is ABSENT when its id is null, never a zero charge — matching how
 * both the Worker and the editor build the map, and preserving the
 * difference between "no cassette" and "a cassette that costs nothing". A
 * row saved before migration 36 can carry an id with a null basis; it is
 * treated as absent, because there is no way to know what basis it was
 * charged on and guessing would invent money.
 */
function hardwareFromLineItem(item: LineItem): Partial<Record<CatalogSlot, HardwareCharge>> {
  const hardware: Partial<Record<CatalogSlot, HardwareCharge>> = {};
  if (item.cassette_id && item.cassette_price_basis) {
    hardware.cassette = {
      price: Number(item.cassette_price_per_m) || 0,
      basis: item.cassette_price_basis,
    };
  }
  if (item.bottom_rail_id && item.bottom_rail_price_basis) {
    hardware.bottom_rail = {
      price: Number(item.bottom_rail_price_per_m) || 0,
      basis: item.bottom_rail_price_basis,
    };
  }
  if (item.control_id && item.control_price_basis) {
    hardware.control = {
      price: Number(item.control_price_per_item) || 0,
      basis: item.control_price_basis,
    };
  }
  if (item.installation_id && item.installation_price_basis) {
    hardware.installation = {
      price: Number(item.installation_price_per_item) || 0,
      basis: item.installation_price_basis,
    };
  }
  return hardware;
}

/** An empty cell for every column — the starting point each row fills in. */
function emptyCells(): Record<OptionColumn, OptionCell> {
  return {
    material: { name: null, amount: null },
    color: { name: null, amount: null },
    cassette: { name: null, amount: null },
    bottom_rail: { name: null, amount: null },
    control: { name: null, amount: null },
    installation: { name: null, amount: null },
  };
}

/**
 * Splits one line item into per-option cells that sum EXACTLY to its
 * stored `line_total`.
 *
 * The reconciliation is the whole point. `line_total` is built as
 * `round2(unit_price × qty) + addonsTotal(addons)`, so `Σ round2(leg ×
 * qty)` is not the same number — with five legs the two can differ by two
 * or three cents. Left alone that surfaces as a phantom adjustment on an
 * ordinary line, which is exactly the "why doesn't this add up?" moment
 * the column exists to prevent. So the hardware cells are computed
 * directly and the MATERIAL cell is fitted to close the gap: it is always
 * present and always the largest leg, so a two-cent correction cannot push
 * it negative or be noticed.
 *
 * `base_unit_price` is read in preference to `unit_price` because on an
 * overridden line it is the price the options actually produced, leaving
 * the override itself to show up as the adjustment. This matches how
 * `originalLineTotal` already defines the "was" price.
 *
 * Preset and custom items have no options; they come back with every cell
 * empty and their whole `line_total` as the adjustment, which is why the
 * page lists them separately rather than in the option table.
 */
export function describeLineBreakdown(item: LineItem): LineBreakdown {
  const cells = emptyCells();
  const lineTotal = round2(Number(item.line_total) || 0);

  if (item.item_type !== 'blind') {
    return { cells, adjustment: lineTotal, lineTotal };
  }

  const quantity = Number(item.quantity) || 0;
  const calcUnit = Number(item.base_unit_price ?? item.unit_price) || 0;
  const optionsLine = round2(calcUnit * quantity);

  const legs = getBlindType(item.blinds_type).describeUnitCosts({
    panels: item.panels,
    height_cm: Number(item.height_cm) || 0,
    material_price_per_sqm: Number(item.material_price_per_sqm) || 0,
    hardware: hardwareFromLineItem(item),
    attributes: item.attributes,
  });

  let hardwareSum = 0;
  for (const slot of ['cassette', 'bottom_rail', 'control', 'installation'] as CatalogSlot[]) {
    const name = SLOT_NAME[slot](item);
    if (name === null) continue;
    const amount = round2((legs[slot] ?? 0) * quantity);
    cells[slot] = { name, amount };
    hardwareSum += amount;
  }

  cells.material = {
    name: item.material_name,
    amount: round2(optionsLine - hardwareSum),
  };
  cells.color = { name: item.color || null, amount: null };

  return { cells, adjustment: round2(lineTotal - optionsLine), lineTotal };
}
