// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Curtains blind-type module — the first type to leave the shared base
 * formula.
 *
 * Curtain fabric is bought by the running metre and the amount needed is
 * set by the pleat style's fullness, not by the drop, so:
 *
 *   fabric  = width_m x pleat multiplier x material price per metre
 *   control = panels x control price per panel   (base behaviour)
 *   install = a fixed charge for the rod or track
 *
 * Height is measured and reaches the manufacturer copy, but does NOT
 * price. For Curtains materials the shared `material_price_per_sqm`
 * column therefore holds DOLLARS PER RUNNING METRE — the per-type
 * Materials page relabels the field to match, and an m² price entered
 * there would badly under-quote.
 *
 * Curtains have no cassette and no bottom rail: `requiredCatalogs` drops
 * both, so the Worker stores null for them and rejects an id if one is
 * sent.
 *
 * The multiplier and the installation charge are PRICE INPUTS, so the
 * client never sends either. `attributeSchema` declares only the two ids;
 * `catalogRefs` tells the Worker (and the web preview) which table to
 * resolve them against and where to snapshot the result. A client that
 * sends `pleat_multiplier` directly is rejected with a 400, because the
 * schema is strict and does not declare it.
 *
 * AUTHORITATIVE twin of `apps/web/src/lib/blindTypes/curtains.ts`; the
 * mirrored `pricing.test.ts` suites fail on any drift.
 */

import { z } from 'zod';
import { BaseBlindType, type BlindAttributes, type BlindPricingInputs } from './base';

export class CurtainsBlindType extends BaseBlindType {
  readonly blindType = 'Curtains';
  readonly aliases = ['curtain'];

  /**
   * Both ids are OPTIONAL: migration 29 left every historical row at `{}`
   * and `attributes.test.ts` asserts that still parses. The fallbacks in
   * `calculateUnitPrice` are the identity values, so an old row re-saves
   * at exactly today's price.
   */
  readonly attributeSchema = BaseBlindType.attrs({
    pleat_type_id: z.string().uuid().optional(),
    installation_id: z.string().uuid().optional(),
  });

  readonly catalogRefs = [
    {
      attrKey: 'pleat_type_id',
      table: 'pleat_types',
      valueColumn: 'multiplier',
      nameKey: 'pleat_name',
      valueKey: 'pleat_multiplier',
      noun: 'pleat type',
    },
    {
      attrKey: 'installation_id',
      table: 'installation_options',
      valueColumn: 'price_per_item',
      nameKey: 'installation_name',
      valueKey: 'installation_price',
      noun: 'installation option',
    },
  ] as const;

  readonly requiredCatalogs = ['control'] as const;

  /**
   * Customer-facing lines. Deliberately the snapshot NAMES only — the
   * multiplier and the installation charge are internal pricing detail
   * and are never printed on an estimate, invoice or customer page.
   */
  describeAttributes(attrs: BlindAttributes): { label: string; value: string }[] {
    const out: { label: string; value: string }[] = [];
    if (attrs.installation_name) {
      out.push({ label: 'Installation', value: String(attrs.installation_name) });
    }
    if (attrs.pleat_name) out.push({ label: 'Pleat', value: String(attrs.pleat_name) });
    return out;
  }

  /**
   * Fabric by the running metre x fullness, plus the per-panel control
   * charge and the one-off installation charge. The cassette and bottom
   * rail prices are ignored outright rather than routed through a hook:
   * this type has neither, and the Worker stores null for both.
   */
  calculateUnitPrice(item: BlindPricingInputs): number {
    const width = this.applyWidthMinimum(item.panels.reduce((a, b) => a + b, 0));
    const pleat = numericOr(item.attributes.pleat_multiplier, 1);
    const install = numericOr(item.attributes.installation_price, 0);
    const total =
      (width / 100) * pleat * item.material_price_per_sqm +
      this.controlCost(item.panels.length, item.control_price_per_item) +
      install;
    return Math.round(total * 100) / 100;
  }
}

/**
 * Reads a numeric attribute, falling back when it is absent or unusable.
 * A legacy `{}` row and a blob that somehow holds a non-number both land
 * on the identity value rather than producing NaN, which would otherwise
 * poison the line total and the whole order total with it.
 */
function numericOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
