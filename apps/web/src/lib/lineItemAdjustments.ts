// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Live-preview per-line-item price adjustments: the unit-price override
 * and the flat-priced add-on list.
 *
 * This is the ONE place the meanings of `unit_price` and
 * `base_unit_price` are decided. `unit_price` is always the price
 * CHARGED — an override writes the new figure there, which is why every
 * downstream reader (PDF, customer page, manufacturer copy, totals) needs
 * no knowledge that overriding exists. `base_unit_price` carries the
 * server-calculated figure and is non-null ONLY while an override is in
 * effect, so "is this overridden?" has exactly one answer in the data.
 *
 * Add-ons are flat by rule: an add-on price lands in the line total once,
 * regardless of quantity. The unit leg and the add-on leg are rounded
 * separately, matching how `totals.ts` rounds every intermediate stage,
 * so a preview and the charge agree to the cent.
 *
 * TWIN of apps/api/src/lib/lineItemAdjustments.ts, which is the
 * AUTHORITATIVE implementation — nothing computed here can influence what
 * is charged. The two MUST stay in sync; both are pinned by equivalent
 * unit tests.
 */

/** One consultant-added extra: a label and a flat price. */
export interface Addon {
  label: string;
  price: number;
}

/** Everything needed to price one line item after adjustments. */
export interface AdjustmentInput {
  /** The calculated unit price — blind formula, preset catalog, or typed. */
  base: number;
  quantity: number;
  /** Consultant-entered unit price, or `null` when not overridden. */
  override: number | null;
  addons: Addon[];
}

/** The money fields an adjusted line item is written with. */
export interface AdjustedPrice {
  unit_price: number;
  base_unit_price: number | null;
  addons: Addon[];
  line_total: number;
}

/** Rounds to 2 decimal places (half-up). */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Sum of every add-on price, to the cent. */
export function addonsTotal(addons: Addon[]): number {
  return round2(addons.reduce((sum, a) => sum + a.price, 0));
}

/**
 * Applies an override and add-ons to a calculated base price.
 *
 * `override: 0` is a real override (a line given away), not an absent
 * one — only `null` means "charge the calculated price". Callers that
 * must not allow overriding (custom items, legacy presets with no
 * catalog provenance) pass `null` rather than relying on a check here.
 */
export function applyPriceAdjustments(input: AdjustmentInput): AdjustedPrice {
  const overridden = input.override !== null;
  const unit_price = round2(overridden ? input.override! : input.base);
  const addons = input.addons.map((a) => ({ label: a.label, price: round2(a.price) }));
  return {
    unit_price,
    base_unit_price: overridden ? round2(input.base) : null,
    addons,
    line_total: round2(unit_price * input.quantity) + addonsTotal(addons),
  };
}

/**
 * What this line would have totalled at its calculated price — the figure
 * printed struck through beside the charged one. `null` when the item is
 * not overridden, which is the signal to print nothing at all.
 *
 * Add-ons are included: they are charged either way, so excluding them
 * would show the customer a "was" price that never existed.
 */
export function originalLineTotal(item: {
  base_unit_price: number | null;
  quantity: number;
  addons: Addon[];
}): number | null {
  if (item.base_unit_price === null) return null;
  return round2(item.base_unit_price * item.quantity) + addonsTotal(item.addons);
}
