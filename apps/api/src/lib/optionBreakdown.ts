// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Per-hardware-option money for a SAVED line item — the figure printed
 * beside each option on the customer's documents (estimate/invoice PDF)
 * and on the public order page.
 *
 * SERVER-AUTHORITATIVE (AI_GUIDELINES rule 1). The public page is
 * unauthenticated and holds no catalog, so it cannot derive these itself;
 * the Worker computes them from the item's own SNAPSHOT columns and sends
 * finished numbers. That also means the figures report what was actually
 * charged when the order was saved, not what the catalog says today.
 *
 * The costs come from `BaseBlindType.describeUnitCosts` — the same
 * calculation that produced `unit_price` — so a price basis is never
 * interpreted twice. This module only rebuilds that call's inputs from
 * stored columns, scales each leg to the LINE (× quantity) and rounds.
 *
 * Scope is the four hardware slots deliberately. The material leg is
 * omitted: it is the fabric the blind is made of rather than an extra
 * chosen on top, and it is also the leg the presentation table fits its
 * rounding into (`apps/web/src/lib/optionBreakdown.ts`), so quoting it
 * here as an independent figure would state a number that page corrects.
 * Colour and blind-type attributes carry no separable leg at all.
 *
 * Twin of the hardware half of `apps/web/src/lib/optionBreakdown.ts`
 * (which serves the internal Order Presentation table from the full
 * `LineItem` type). Both read the same snapshot columns under the same
 * absent-vs-zero rule; a change to that rule must land on both sides.
 */

import { getBlindType } from './blindTypes/registry';
import type { CatalogSlot, HardwareCharge, PriceBasis } from './blindTypes/base';

/**
 * The subset of a stored `line_items` row this module needs.
 *
 * Every field is optional and loosely typed on purpose: the callers hand
 * over rows straight out of PostgREST (`Record<string, any>`), and a
 * document assembled by an older code path — a warranty or receipt
 * payload — must degrade to "no per-option figures" rather than throw.
 */
export interface OptionPricedItem {
  item_type?: string | null;
  blinds_type?: string | null;
  panels?: number[] | null;
  height_cm?: number | string | null;
  quantity?: number | string | null;
  attributes?: Record<string, string | number | boolean> | null;
  cassette_id?: string | null;
  cassette_price_per_m?: number | string | null;
  cassette_price_basis?: PriceBasis | null;
  bottom_rail_id?: string | null;
  bottom_rail_price_per_m?: number | string | null;
  bottom_rail_price_basis?: PriceBasis | null;
  control_id?: string | null;
  control_price_per_item?: number | string | null;
  control_price_basis?: PriceBasis | null;
  installation_id?: string | null;
  installation_price_per_item?: number | string | null;
  installation_price_basis?: PriceBasis | null;
}

/**
 * What each hardware option added to the LINE, keyed by slot. A slot is
 * absent when the blind carries no option of that kind, or when the row
 * predates the stored price basis and the charge cannot be reconstructed.
 */
export type OptionLineAmounts = Partial<Record<CatalogSlot, number>>;

/** Rounds to 2 decimal places (half-up), like every money path in the app. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Rebuilds the `hardware` map the item was priced with, from its snapshot
 * columns.
 *
 * A slot is ABSENT when its id is null, never a zero charge — matching how
 * `resolveLineItems` builds the map at save time, and preserving the
 * difference between "no cassette" and "a cassette that costs nothing". A
 * row saved before migration 36 can carry an id with a null basis; it is
 * treated as absent, because there is no way to know what basis it was
 * charged on and guessing would invent money.
 */
function hardwareFromLineItem(item: OptionPricedItem): Partial<Record<CatalogSlot, HardwareCharge>> {
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

/**
 * What each hardware option on `item` added to its line total.
 *
 * Line-level, not per-blind: the figure sits beside an option on a
 * document whose money column is the line total, so `leg × quantity`
 * rounded to the cent is the number that reconciles with what the reader
 * is looking at.
 *
 * Returns `{}` for anything that is not a blind (presets, custom lines
 * carry no options) and for a blind whose slots are all empty. Callers
 * decide what to do with a `0` — the documents print the option's name
 * alone, because a customer reading "$0.00" beside a choice learns
 * nothing the absence of a figure does not already say.
 *
 * `material_price_per_sqm` is deliberately passed as 0: only the hardware
 * legs are read back out, and the material leg does not influence them.
 */
export function optionLineAmounts(item: OptionPricedItem): OptionLineAmounts {
  if (item.item_type !== 'blind') return {};

  const hardware = hardwareFromLineItem(item);
  if (Object.keys(hardware).length === 0) return {};

  const quantity = Number(item.quantity) || 0;
  const legs = getBlindType(item.blinds_type).describeUnitCosts({
    panels: item.panels ?? [],
    height_cm: Number(item.height_cm) || 0,
    material_price_per_sqm: 0,
    hardware,
    attributes: item.attributes ?? {},
  });

  const amounts: OptionLineAmounts = {};
  for (const slot of ['cassette', 'bottom_rail', 'control', 'installation'] as CatalogSlot[]) {
    if (legs[slot] === undefined) continue;
    amounts[slot] = round2((legs[slot] ?? 0) * quantity);
  }
  return amounts;
}
