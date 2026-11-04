// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Dual Shades blind-type module — one headrail carrying TWO independent
 * rolls, a front and a back fabric, each with its own control and bottom
 * rail.
 *
 *   fabric   = area (minimums applied) x (front rate + back rate)
 *   control  = 2 x the control charge on its own basis
 *   rail     = 2 x the bottom-rail charge on its own basis
 *   cassette, installation = charged once, as for every other type
 *
 * The FRONT fabric is the ordinary `material_id` column, so every existing
 * surface (material snapshot columns, documents, bulk edit) keeps working.
 * The BACK fabric is `attributes.back_material_id`, a `catalogRefs` entry
 * pointing at the same `materials` table: the client sends only the id and
 * the Worker snapshots `back_material_name` and
 * `back_material_price_per_sqm` itself. Neither snapshot key is declared in
 * `attributeSchema`, so a client that sends one is rejected with a 400.
 *
 * The schema field is optional (every type must parse `{}`), so presence
 * is declared through `requiredAttributes`: `lib/lineItemCompleteness.ts`
 * then treats a Dual line without a back fabric as INCOMPLETE — savable on
 * a draft at $0, refused by every route that takes the order out of draft.
 *
 * `back_color` is free text, printed beside the back fabric and never
 * priced; it is listed in `displayOnlyKeys` so editing it does not break a
 * confirmed order's price lock.
 *
 * Material usage reports ONE roll's area (the base formula): the material
 * leg equals that quantity x (front + back rate), which is what the parity
 * table in both `pricing.test.ts` suites asserts. The Material usage panel
 * adds the same quantity to the back fabric's row through the generic
 * `materials` catalog-ref rule in `materialUsage.ts`.
 *
 * Twin of the AUTHORITATIVE `apps/api/src/lib/blindTypes/dualShades.ts`; the
 * mirrored `pricing.test.ts` suites fail on any drift.
 */

import { z } from 'zod';
import {
  BaseBlindType,
  type BlindAttributes,
  type BlindPricingInputs,
  type RequiredAttribute,
  type UnitCostBreakdown,
} from './base';

/**
 * Hardware legs a Dual Shade carries twice — one per roll. Cassette and
 * installation cover the whole headrail and are charged once.
 */
const DOUBLED_SLOTS = ['bottom_rail', 'control'] as const;

export class DualShadesBlindType extends BaseBlindType {
  readonly blindType = 'Dual Shades';
  readonly aliases = ['dual', 'dual shade'];

  readonly attributeSchema = BaseBlindType.attrs({
    back_material_id: z.string().uuid().optional(),
    back_color: z.string().trim().max(100).optional(),
  });

  readonly catalogRefs = [
    {
      attrKey: 'back_material_id',
      table: 'materials',
      valueColumn: 'price_per_sqm',
      nameKey: 'back_material_name',
      valueKey: 'back_material_price_per_sqm',
      noun: 'back fabric',
    },
  ] as const;

  /** Read by `lib/lineItemCompleteness.ts`: no back fabric = incomplete (draft-only, $0). */
  readonly requiredAttributes: readonly RequiredAttribute[] = [
    { key: 'back_material_id', noun: 'back fabric' },
  ];

  /** Printed, never priced: excluded from the price-lock fingerprint. */
  readonly displayOnlyKeys: readonly string[] = ['back_color'];

  /**
   * Back fabric (snapshot name) then back colour, each only when present.
   * The front fabric and colour print through the ordinary Material /
   * Color columns on every surface, so they are not repeated here.
   */
  describeAttributes(attrs: BlindAttributes): { label: string; value: string }[] {
    const out: { label: string; value: string }[] = [];
    if (attrs.back_material_name) out.push({ label: 'Back fabric', value: String(attrs.back_material_name) });
    if (attrs.back_color) out.push({ label: 'Back color', value: String(attrs.back_color) });
    return out;
  }

  /**
   * Both rolls cover the same minimised area, so the area is charged at
   * the SUM of the two rates. Kept as one expression in the base's own
   * shape (`w x h x rate / 10000`) so a zero back rate reproduces the base
   * leg bit-for-bit. A missing snapshot prices the back at 0, never NaN.
   */
  protected materialCost(item: BlindPricingInputs, widthCm: number, heightCm: number): number {
    const back = numericOr(item.attributes.back_material_price_per_sqm, 0);
    return (widthCm * heightCm * (item.material_price_per_sqm + back)) / 10000;
  }

  /**
   * The base breakdown with the control and bottom-rail legs doubled,
   * whatever basis their catalog rows declare (per unit, per panel, per m,
   * per m²). `calculateUnitPrice` sums this breakdown, so the price, the
   * line total and every per-option presentation carry the same doubled
   * figure and cannot disagree.
   */
  describeUnitCosts(item: BlindPricingInputs): UnitCostBreakdown {
    const legs = super.describeUnitCosts(item);
    for (const slot of DOUBLED_SLOTS) {
      const cost = legs[slot];
      if (cost !== undefined) legs[slot] = cost * 2;
    }
    return legs;
  }
}

/** A finite, non-negative number from a snapshot value, or `fallback`. */
function numericOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
