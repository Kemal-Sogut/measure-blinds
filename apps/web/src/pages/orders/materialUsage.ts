// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Material usage aggregation for the internal fabric report — no JSX.
 *
 * The report answers ONE question and deliberately nothing else: how much
 * of each material does this order consume, and which windows made that
 * figure up. It is a reading, not an instrument — nothing here changes a
 * line item, a price, or a discount, and no caller may make it do so.
 *
 * It used to also drive a per-m² give-back calculator that composed a
 * discount out of typed rates. That was removed: the typed rates were
 * session-only, so every reload left a dollar discount whose origin the
 * dialog could no longer explain or take back — figures that contradicted
 * what the panel showed. Discounting now happens only in the order's own
 * discount field, where it persists with the order.
 *
 * Each material row carries the WINDOWS that made it up
 * ({@link MaterialUsageLine}), because "12 m² of Blackout Ivory" does not
 * say whether that is one oversized opening or six ordinary ones. Those
 * per-line figures are the same readings the row is summed from, never a
 * second calculation, so a row and its breakdown cannot disagree.
 *
 * Every quantity is asked of the line's blind-type module through
 * `describeMaterialUsage` rather than re-derived here; no area formula
 * exists in this file. Everything reported is BILLED quantity: the width
 * and height minimums are applied, because that is the material the order
 * is charged for and therefore the material that has to be bought.
 *
 * Deliberately React-free and separate from `MaterialUsageDialog.tsx`, for
 * the same Fast Refresh reason `lineItemDrafts.ts` is: a module exporting
 * both components and plain functions cannot be hot-swapped safely.
 */

import { getBlindType, type MaterialUnit } from '../../lib/blindTypes';
import { blindDraftInputs, type Catalogs, type ItemDraft } from './lineItemDrafts';

/**
 * Identity of one material row — material AND rate unit.
 *
 * Both halves are load-bearing. Materials are scoped to blind types
 * through `material_blind_types`, and that join permits one material
 * linked to both Curtains and a m²-priced type; without the unit in the
 * key, running metres and square metres would pool into one meaningless
 * number. The dialog reuses this key for its per-row "select every
 * window" control, so the grouping and the UI can never disagree about
 * what "one row" is.
 */
export function materialRowKey(materialId: string, unit: MaterialUnit): string {
  return `${materialId}::${unit}`;
}

/**
 * ONE window's contribution to a material row, in that row's rate unit.
 *
 * The material row answers "how much of this fabric does the order
 * carry"; this answers "which window did it go into", which is the
 * question asked when a single oversized opening is what pushed a
 * material's quantity up. Every figure here is the same basis as the row
 * it sits under — billed quantity, line quantity already multiplied in —
 * so the lines of a row always sum to that row's own quantity.
 *
 * `widthCm` and `heightCm` are the MEASURED dimensions the consultant
 * typed, NOT the minimum-inflated ones the quantity is billed on. They
 * are there to identify the window, and a row that showed 100cm for a
 * 60cm blind would not identify it.
 *
 * `heightCm` is carried even for `running_m` rows, where Curtains does
 * not price on it: the dialog omits it there rather than this module
 * pretending the measurement does not exist.
 */
export interface MaterialUsageLine {
  /**
   * The draft's render key. Unique across the whole order, and — because
   * a line carries exactly one material and therefore appears under
   * exactly one row — unique across the summary too. That is what lets
   * the dialog's selection be a flat set of these keys.
   */
  key: string;
  /** Room name, or the editor's own `Blind N` fallback when it is blank. */
  label: string;
  /** The line's blind type, so a material used by two types still reads. */
  blindType: string;
  /** Measured width: the panel widths summed, before any minimum. */
  widthCm: number;
  /** Measured height, before the tiered height minimum. */
  heightCm: number;
  /** How many identical blinds this one line carries. */
  itemQuantity: number;
  /** Billed quantity for the whole line, `itemQuantity` included. */
  quantity: number;
}

/**
 * One material's total across an order, in the unit that material's rate
 * is quoted in for the types that used it.
 *
 * Quantity only — no rate and no money. The fabric leg's revenue was
 * removed with the give-back calculator it existed for; the order's own
 * totals are where money is read.
 */
export interface MaterialUsageRow {
  materialId: string;
  /** Catalog name at the time of viewing; the panel's row label. */
  materialName: string;
  unit: MaterialUnit;
  /** Billed quantity across every contributing line, line quantity included. */
  quantity: number;
  /** How many visible lines contributed, for the dialog's own context. */
  lineCount: number;
  /**
   * Every contributing window, in the order the editor lists them, so the
   * per-line breakdown reads in the same sequence as the line items above
   * it. Always `lineCount` entries long, and its quantities always sum to
   * this row's own.
   */
  lines: MaterialUsageLine[];
}

/**
 * What the Material usage panel renders. `totals` carries a key only for
 * a unit some line actually used, so the panel never prints a bare
 * `0.00 m` for an order with no curtains in it.
 */
export interface MaterialUsageSummary {
  /**
   * Descending by quantity, then by name — the biggest consumer reads
   * first, and two equal rows keep a stable, alphabetical order rather
   * than an arbitrary one.
   */
  rows: MaterialUsageRow[];
  /** Billed quantity per rate unit across the whole order. */
  totals: Partial<Record<MaterialUnit, number>>;
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
 *    Worker's own filter — a line excluded from the order is not fabric
 *    anyone has to buy. Being dropped first is also why a hidden
 *    incomplete line is not reported as incomplete.
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

  for (const [index, item] of items.entries()) {
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
    const qty = inputs.quantity;
    const key = materialRowKey(material.id, usage.unit);

    const row = groups.get(key) ?? {
      materialId: material.id,
      materialName: material.name,
      unit: usage.unit,
      quantity: 0,
      lineCount: 0,
      lines: [],
    };

    row.lineCount += 1;
    row.quantity += usage.quantity * qty;
    // The same reading kept per window, so the breakdown cannot drift
    // from the row it sits under: both are the one usage figure.
    row.lines.push({
      key: item.key,
      // Matches the fallback the line-item list and the presentation
      // table already use, so one blank-roomed window is called the same
      // thing everywhere in the editor.
      label: item.room_name || `Blind ${index + 1}`,
      blindType: item.blinds_type,
      widthCm: inputs.panels.reduce((a, b) => a + b, 0),
      heightCm: inputs.height_cm,
      itemQuantity: qty,
      quantity: usage.quantity * qty,
    });
    groups.set(key, row);
  }

  const rows = [...groups.values()].sort(
    (a, b) => b.quantity - a.quantity || a.materialName.localeCompare(b.materialName)
  );

  const totals: Partial<Record<MaterialUnit, number>> = {};
  for (const row of rows) {
    totals[row.unit] = (totals[row.unit] ?? 0) + row.quantity;
  }

  return { rows, totals, excludedCount };
}

/**
 * The billed quantity of a hand-picked set of windows, per rate unit.
 *
 * Backs the dialog's checkboxes, which are an INFORMATION tool and
 * nothing else: ticking a window does not hide it, reprice it, or mark it
 * in any way that outlives the dialog. The consultant is asking "what do
 * these particular windows come to" — the cut list for one room, the
 * three openings a customer is still deciding on — and this answers it
 * without the order noticing.
 *
 * Selection is a flat set of line keys because a key identifies exactly
 * one window in exactly one row (see {@link MaterialUsageLine.key}). Keys
 * that match nothing are ignored rather than treated as zero-quantity
 * lines, so a stale tick left behind by an edited or deleted line cannot
 * survive as a phantom entry in the total.
 *
 * Units stay separate for the same reason rows do: adding a running metre
 * to a square metre produces a number that means nothing. A unit appears
 * in the result only when a selected line actually uses it.
 */
export function selectedUsageTotals(
  summary: MaterialUsageSummary,
  selected: ReadonlySet<string>
): Partial<Record<MaterialUnit, number>> {
  const totals: Partial<Record<MaterialUnit, number>> = {};
  if (selected.size === 0) return totals;

  for (const row of summary.rows) {
    for (const line of row.lines) {
      if (!selected.has(line.key)) continue;
      totals[row.unit] = (totals[row.unit] ?? 0) + line.quantity;
    }
  }
  return totals;
}

/**
 * Every line key in a summary, in row-then-editor order.
 *
 * The dialog's "select all" reads this rather than flattening the rows
 * itself, so the set it builds can only ever contain keys this summary
 * still has — the same guarantee that keeps a stale tick out of
 * {@link selectedUsageTotals}.
 */
export function allUsageLineKeys(summary: MaterialUsageSummary): string[] {
  return summary.rows.flatMap((row) => row.lines.map((line) => line.key));
}
