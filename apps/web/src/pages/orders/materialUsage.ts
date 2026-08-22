// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Material usage aggregation for the internal per-m² discount report — no JSX.
 *
 * Fabric is the flexible leg of a quote: cassettes, rails, controls and
 * installation run on tighter margins, so a discount is reasoned about as
 * "give back $X per square metre of fabric". This module answers the two
 * questions that reasoning needs — how much of each material does this
 * order carry, and at what rate — by asking each line's blind-type module
 * rather than re-deriving any area formula. `describeMaterialUsage` is the
 * single source of a billed quantity; nothing here recomputes one.
 *
 * Everything reported is BILLED quantity: the width and height minimums
 * are applied, because that is what the material leg charged. `measured`
 * travels alongside it so the panel can show how much of the billed area
 * is minimum inflation rather than fabric the customer had.
 *
 * Deliberately React-free and separate from `MaterialUsageDialog.tsx`, for
 * the same Fast Refresh reason `lineItemDrafts.ts` is: a module exporting
 * both components and plain functions cannot be hot-swapped safely.
 */

import { getBlindType, type MaterialUnit } from '../../lib/blindTypes';
import { blindDraftInputs, type Catalogs, type ItemDraft } from './lineItemDrafts';

/** Rounds to whole cents, as every money helper in the app does. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Identity of one material row — material AND rate unit.
 *
 * Both halves are load-bearing. Materials are scoped to blind types
 * through `material_blind_types`, and that join permits one material
 * linked to both Curtains and a m²-priced type; without the unit in the
 * key, running metres and square metres would pool into one meaningless
 * number. The dialog reuses this key to store that row's rate input and
 * its applied give-back, so the grouping and the UI can never disagree
 * about what "one row" is.
 */
export function materialRowKey(materialId: string, unit: MaterialUnit): string {
  return `${materialId}::${unit}`;
}

/**
 * One material's contribution across an order, in the unit that
 * material's rate is quoted in for the types that used it.
 *
 * `amount` is the FABRIC leg only — not the charged price. A consultant's
 * manual override or an add-on is not a fabric-rate change, so neither
 * may distort the effective $/m² this row reports.
 */
export interface MaterialUsageRow {
  materialId: string;
  /** Catalog name at the time of viewing; the panel's row label. */
  materialName: string;
  unit: MaterialUnit;
  /** Billed quantity across every contributing line, line quantity included. */
  quantity: number;
  /** The same figure with the minimum rules skipped. Reporting only. */
  measuredQuantity: number;
  /** The material's catalog rate — $/m² or $/running-m, per `unit`. */
  rate: number;
  /** Fabric-leg revenue across those lines. */
  amount: number;
  /** How many visible lines contributed, for the dialog's own context. */
  lineCount: number;
}

/** Order-wide billed figures for one rate unit. */
export interface MaterialUsageTotal {
  quantity: number;
  measured: number;
  amount: number;
}

/**
 * What the Material usage panel renders. `totals` carries a key only for
 * a unit some line actually used, so the panel can decide whether to show
 * a running-metre rate input at all.
 */
export interface MaterialUsageSummary {
  /** Descending by `amount` — the biggest fabric spend reads first. */
  rows: MaterialUsageRow[];
  totals: Partial<Record<MaterialUnit, MaterialUsageTotal>>;
  /** Visible lines carrying no material: preset, custom, or incomplete. */
  excludedCount: number;
}

/**
 * Summarises the material an order's drafts consume, grouped per material
 * and rate unit.
 *
 * Three exclusion rules, each mirroring behaviour that already exists:
 *
 * 1. HIDDEN lines are dropped first, matching `calculateTotals` and the
 *    Worker's own filter — a line excluded from the total must not attract
 *    a give-back. Being dropped first is also why a hidden incomplete line
 *    is not reported as incomplete.
 * 2. PRESET and CUSTOM lines have no material and are counted into
 *    `excludedCount` so the panel can say so out loud.
 * 3. INCOMPLETE blind drafts — anything `blindDraftInputs` refuses — are
 *    counted the same way. A row the editor will not price must not appear
 *    here with a confident area.
 *
 * Grouping is by material AND unit. Materials are scoped to blind types
 * through `material_blind_types`, and that join permits one material
 * linked to both Curtains and a m²-priced type; without the unit in the
 * key, running metres and square metres would pool into one meaningless
 * number.
 */
export function summarizeMaterialUsage(
  items: ItemDraft[],
  catalogs: Catalogs
): MaterialUsageSummary {
  const groups = new Map<string, MaterialUsageRow>();
  let excludedCount = 0;

  for (const item of items) {
    if (item.hidden) continue;
    if (item.item_type !== 'blind') {
      excludedCount += 1;
      continue;
    }
    const inputs = blindDraftInputs(item, catalogs);
    if (!inputs) {
      excludedCount += 1;
      continue;
    }
    const material = catalogs.materials.find((m) => m.id === item.material_id);
    if (!material) {
      excludedCount += 1;
      continue;
    }

    const blindType = getBlindType(item.blinds_type);
    const usage = blindType.describeMaterialUsage(inputs);
    const rate = inputs.material_price_per_sqm;
    const qty = inputs.quantity;
    const key = materialRowKey(material.id, usage.unit);

    const row = groups.get(key) ?? {
      materialId: material.id,
      materialName: material.name,
      unit: usage.unit,
      quantity: 0,
      measuredQuantity: 0,
      rate,
      amount: 0,
      lineCount: 0,
    };
    row.lineCount += 1;
    row.quantity += usage.quantity * qty;
    row.measuredQuantity += usage.measured * qty;
    // The fabric leg, taken from the type's own breakdown rather than
    // multiplied out here, so a type that prices fabric unusually is
    // reported the way it actually charges.
    row.amount += blindType.describeUnitCosts(inputs).material * qty;
    groups.set(key, row);
  }

  const rows = [...groups.values()].sort((a, b) => b.amount - a.amount);

  const totals: Partial<Record<MaterialUnit, MaterialUsageTotal>> = {};
  for (const row of rows) {
    const running = totals[row.unit] ?? { quantity: 0, measured: 0, amount: 0 };
    running.quantity += row.quantity;
    running.measured += row.measuredQuantity;
    running.amount += row.amount;
    totals[row.unit] = running;
  }

  return { rows, totals, excludedCount };
}

/**
 * The dollar give-back a set of per-unit rates comes to across a summary.
 *
 * A unit with no rate entered contributes nothing rather than falling
 * back to another unit's figure — a blank field must never quietly
 * discount an order. The result is rounded to whole cents because it goes
 * straight into the fixed-discount field, which is money.
 */
export function giveBackAmount(
  summary: MaterialUsageSummary,
  rates: Partial<Record<MaterialUnit, number>>
): number {
  let total = 0;
  for (const [unit, figures] of Object.entries(summary.totals)) {
    // `Object.entries` over a Partial<Record> types the value as possibly
    // undefined even though a present key always carries one.
    if (!figures) continue;
    const rate = rates[unit as MaterialUnit];
    if (!rate || !Number.isFinite(rate) || rate <= 0) continue;
    total += figures.quantity * rate;
  }
  return round2(total);
}

/**
 * The dollar give-back one material row comes to at a reduced rate.
 *
 * Clamped at zero: a rate typed ABOVE the catalog rate is a typo or a
 * change of mind, never a request to add a negative discount — the
 * discount field is money the customer comes off, and it has no
 * meaningful negative. The dialog says so on screen rather than letting a
 * silent zero look like a working Apply.
 */
export function rowGiveBack(row: MaterialUsageRow, rate: number): number {
  if (!Number.isFinite(rate) || rate < 0) return 0;
  return round2(Math.max(0, row.rate - rate) * row.quantity);
}

/**
 * The key {@link applyGiveBackPart} files the order-wide give-back under.
 *
 * Cannot collide with a {@link materialRowKey}, which always contains
 * `::` between a uuid and a unit.
 */
export const ORDER_WIDE_GIVE_BACK = 'order-wide';

/** A composed discount: the new total, and the parts it is made of. */
export interface GiveBackComposition {
  discount: number;
  parts: Record<string, number>;
}

/**
 * Adds (or replaces, or removes) ONE give-back contribution on top of the
 * discount already in force.
 *
 * This is what makes the dialog's Apply buttons additive rather than
 * destructive: they never overwrite a line item and never overwrite each
 * other. `parts` remembers what each row last contributed, so re-applying
 * a row at a different rate SWAPS that row's figure instead of stacking a
 * second copy of it, and applying `0` (the reset) takes the row's
 * contribution back out. Anything the consultant typed into the discount
 * field by hand is the base everything else sits on, and survives both.
 *
 * `parts` is session state deliberately: nothing persists a per-material
 * rate, so after a reload the discount is just a dollar figure and this
 * map starts empty — which means Reset can no longer take back what an
 * earlier session added. The dialog says so.
 *
 * Clamped at zero, because a negative discount is not a thing. Returns
 * whole cents for the same reason `giveBackAmount` does: the result goes
 * straight into the fixed-discount field.
 */
export function applyGiveBackPart(
  parts: Record<string, number>,
  currentDiscount: number,
  key: string,
  amount: number
): GiveBackComposition {
  const base = Number.isFinite(currentDiscount) ? currentDiscount : 0;
  const previous = parts[key] ?? 0;
  const discount = round2(Math.max(0, base - previous + Math.max(0, amount)));

  const next = { ...parts };
  if (amount > 0) next[key] = round2(amount);
  else delete next[key];

  return { discount, parts: next };
}
