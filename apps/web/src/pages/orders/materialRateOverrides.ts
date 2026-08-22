// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Per-material rate overrides for the Material usage dialog — no JSX.
 *
 * Fabric is the flexible leg of a quote, so a discount is usually decided
 * as "charge $45/m² for this material instead of $50". This module turns
 * that decision into real line prices.
 *
 * HOW IT LANDS ON A LINE. There is no per-order material rate anywhere in
 * the schema, and `apps/api` re-prices every line from the catalog on
 * save, so a rate held only in React state would evaporate the moment the
 * order was stored. The one field that does persist a changed price is
 * `unit_price_override` — the same field a consultant types into to
 * discount a single line, and an accepted client input (`orders.ts`'s
 * `overrideField`). So applying a rate re-prices each affected line
 * THROUGH ITS OWN BLIND TYPE at the new rate and writes the result there.
 * No area formula, no leg arithmetic and no rounding rule is reimplemented
 * here: `blindDraftInputs` assembles the inputs the price preview already
 * uses, one field is swapped, and `calculateBlindUnitPriceForType` does
 * the rest.
 *
 * WHY PROVENANCE EXISTS. An override written from a rate is byte-identical
 * to one typed by hand, so `BlindDraft.material_rate_applied` records
 * which ones this tool wrote. That single fact carries two rules the
 * dialog promises: Apply never overwrites a hand-priced line, and Reset
 * clears only the lines Apply itself changed. The flag is session state —
 * see its own doc comment for what a reload means.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. An applied override is a FIXED price,
 * exactly like a hand-typed one. It does not track later edits to the
 * line's measurements: change a height afterwards and the line keeps
 * charging the old figure until the rate is applied again. That is the
 * existing override contract rather than a new behaviour, and the dialog
 * says so on screen.
 *
 * Deliberately React-free and separate from `MaterialUsageDialog.tsx`,
 * for the same Fast Refresh reason `lineItemDrafts.ts` is: a module
 * exporting both components and plain functions cannot be hot-swapped.
 */

import { getBlindType, type MaterialUnit } from '../../lib/blindTypes';
import { calculateBlindUnitPriceForType, type BlindInputs } from '../../lib/pricing';
import { blindDraftInputs, type BlindDraft, type Catalogs, type ItemDraft } from './lineItemDrafts';

/**
 * Identity of one material row, and the key its rate input is stored
 * under in the parent's draft map.
 *
 * Material AND unit, matching `summarizeMaterialUsage`'s own grouping: a
 * material scoped to both Curtains and a m²-priced type is two rows with
 * two independently editable rates, and one key would merge them.
 */
export function materialRowKey(materialId: string, unit: MaterialUnit): string {
  return `${materialId}::${unit}`;
}

/** The rate a line's override was written from, decoded from the draft. */
export interface AppliedRate {
  unit: MaterialUnit;
  rate: number;
}

/**
 * Encodes an applied rate for `BlindDraft.material_rate_applied`.
 *
 * The UNIT travels with the rate because one material can legitimately be
 * scoped to both Curtains (running metres) and a m²-priced type through
 * `material_blind_types`, which the usage report already splits into two
 * rows. Without the unit here, resetting one of those rows would revert
 * the other row's lines too.
 */
export function encodeAppliedRate(unit: MaterialUnit, rate: number): string {
  return `${unit}:${rate}`;
}

/**
 * Reads back {@link encodeAppliedRate}. Returns null for absent, malformed
 * or non-positive values — all of which mean "this override is not ours",
 * which is the conservative reading: the line is then treated as
 * hand-priced and left alone.
 */
export function decodeAppliedRate(value: string | undefined): AppliedRate | null {
  if (!value) return null;
  const sep = value.indexOf(':');
  if (sep < 0) return null;
  const unit = value.slice(0, sep);
  if (unit !== 'sqm' && unit !== 'running_m') return null;
  const rate = Number(value.slice(sep + 1));
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return { unit, rate };
}

/**
 * The priced inputs of a line this material+unit rate would govern, or
 * null when the line is not a target.
 *
 * The exclusions mirror `summarizeMaterialUsage` exactly, so the dialog
 * can never reprice a line it did not count: hidden lines are out (they
 * are excluded from the order total), non-blind lines carry no material,
 * and a draft the editor refuses to price is a draft this must not price
 * either. The unit is asked of the blind type rather than assumed, for
 * the dual-scoped-material reason in {@link encodeAppliedRate}.
 */
function targetInputs(
  item: ItemDraft,
  catalogs: Catalogs,
  materialId: string,
  unit: MaterialUnit
): BlindInputs | null {
  if (item.item_type !== 'blind') return null;
  if (item.hidden) return null;
  if (item.material_id !== materialId) return null;
  const inputs = blindDraftInputs(item, catalogs);
  if (!inputs) return null;
  if (getBlindType(item.blinds_type).describeMaterialUsage(inputs).unit !== unit) return null;
  return inputs;
}

/** Outcome of {@link applyMaterialRate}, for the dialog's own reporting. */
export interface MaterialRateResult {
  /** The new draft list; unchanged drafts keep their identity. */
  items: ItemDraft[];
  /** Lines repriced at the new rate. */
  applied: number;
  /** Target lines left untouched because they carry a hand-typed price. */
  skipped: number;
}

/**
 * Reprices every line using this material (in this rate unit) as though
 * the material cost `rate`, writing the result into each line's
 * `unit_price_override`.
 *
 * A line that already carries an override THIS TOOL DID NOT WRITE is
 * skipped and counted, never overwritten — a price a consultant typed by
 * hand is a decision, and silently replacing it would destroy it with no
 * undo. A line carrying one this tool DID write is repriced freely, which
 * is what makes trying a second rate work.
 *
 * Add-ons are untouched: they are charged on top of the unit price on
 * either side of the change, so the fabric rate has no business moving
 * them.
 */
export function applyMaterialRate(
  items: ItemDraft[],
  catalogs: Catalogs,
  materialId: string,
  unit: MaterialUnit,
  rate: number
): MaterialRateResult {
  let applied = 0;
  let skipped = 0;

  const next = items.map((item) => {
    const inputs = targetInputs(item, catalogs, materialId, unit);
    if (!inputs || item.item_type !== 'blind') return item;

    if (item.unit_price_override.trim() !== '' && decodeAppliedRate(item.material_rate_applied) === null) {
      skipped += 1;
      return item;
    }

    // The line's own type prices it, so a type that charges fabric
    // unusually is repriced the way it actually charges.
    const unitPrice = calculateBlindUnitPriceForType(item.blinds_type, {
      ...inputs,
      material_price_per_sqm: rate,
    });
    applied += 1;
    return {
      ...item,
      unit_price_override: unitPrice.toFixed(2),
      material_rate_applied: encodeAppliedRate(unit, rate),
    } satisfies BlindDraft;
  });

  return { items: next, applied, skipped };
}

/**
 * Undoes {@link applyMaterialRate} for one material and rate unit,
 * returning those lines to their calculated price.
 *
 * Only lines carrying THIS tool's provenance for THIS unit are cleared —
 * a hand-typed override survives Reset, because Apply never touched it.
 *
 * Deliberately does not consult the catalogs: the unit is read from the
 * stored provenance rather than re-derived from the draft, so a line that
 * has since been edited into an unpriceable state (a cleared height, say)
 * can still be reverted instead of keeping a stale price forever.
 */
export function revertMaterialRate(
  items: ItemDraft[],
  materialId: string,
  unit: MaterialUnit
): { items: ItemDraft[]; reverted: number } {
  let reverted = 0;

  const next = items.map((item) => {
    if (item.item_type !== 'blind') return item;
    if (item.material_id !== materialId) return item;
    if (decodeAppliedRate(item.material_rate_applied)?.unit !== unit) return item;
    reverted += 1;
    return { ...item, unit_price_override: '', material_rate_applied: '' } satisfies BlindDraft;
  });

  return { items: next, reverted };
}

/** What the dialog shows beneath one material row's rate editor. */
export interface MaterialRateStatus {
  /** The rate currently applied to this material+unit, or null for none. */
  appliedRate: number | null;
  /** Every visible, priceable line this row's rate governs. */
  targetLines: number;
  /** Lines currently priced from that applied rate. */
  appliedLines: number;
  /** Target lines Apply would skip because they are priced by hand. */
  manualLines: number;
}

/**
 * Reads the current state of one material row straight off the drafts.
 *
 * Derived rather than remembered, on purpose: a stored "3 lines repriced"
 * would go stale the moment a line was deleted, cloned, hidden, or had its
 * override cleared from the line editor. Recounting means the dialog can
 * only ever describe what the drafts actually say.
 *
 * `appliedRate` is taken from the first applied line. All lines of a row
 * are written in one pass, so they agree — and if a later edit ever left
 * them disagreeing, reporting one real rate beats inventing an average.
 */
export function materialRateStatus(
  items: ItemDraft[],
  catalogs: Catalogs,
  materialId: string,
  unit: MaterialUnit
): MaterialRateStatus {
  let appliedRate: number | null = null;
  let targetLines = 0;
  let appliedLines = 0;
  let manualLines = 0;

  for (const item of items) {
    if (!targetInputs(item, catalogs, materialId, unit) || item.item_type !== 'blind') continue;
    targetLines += 1;
    const provenance = decodeAppliedRate(item.material_rate_applied);
    if (provenance) {
      appliedLines += 1;
      if (appliedRate === null) appliedRate = provenance.rate;
    } else if (item.unit_price_override.trim() !== '') {
      manualLines += 1;
    }
  }

  return { appliedRate, targetLines, appliedLines, manualLines };
}
