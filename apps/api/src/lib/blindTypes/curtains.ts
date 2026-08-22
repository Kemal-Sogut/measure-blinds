// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Curtains blind-type module — the first type to leave the shared base
 * formula.
 *
 * Curtain fabric is bought by the running metre and the amount needed is
 * set by the pleat style's fullness, not by the drop, so:
 *
 *   fabric = width_m x pleat multiplier x material price per metre
 *   hems   = panels x 0.5 m x material price per metre
 *
 * Those two lines are the WHOLE override — `materialCost` and nothing
 * else. The control and the rod/track charge are ordinary hardware,
 * summed by the base on whatever basis their catalog rows declare.
 *
 * Height is measured and reaches the manufacturer copy, but does NOT
 * price. For Curtains materials the shared `material_price_per_sqm`
 * column therefore holds DOLLARS PER RUNNING METRE — the per-type
 * Materials page relabels the field to match, and an m² price entered
 * there would badly under-quote.
 *
 * Curtains have no cassette and no bottom rail — but that is no longer
 * declared here. Which hardware slots a type uses is decided by the
 * `<catalog>_blind_types` scoping tables (migration 35): the shop simply
 * links no cassette and no rail to Curtains, and the Worker then stores
 * null for both and rejects an id if one is sent. The installation
 * charge is likewise a real line-item column now, resolved by the Worker
 * from the id the client sends, so the pleat multiplier is the only
 * thing left in the attribute blob.
 *
 * That multiplier is a PRICE INPUT, so the client never sends it.
 * `attributeSchema` declares only `pleat_type_id`; `catalogRefs` tells
 * the Worker (and the web preview) which table to resolve it against and
 * where to snapshot the result. A client that sends `pleat_multiplier`
 * directly is rejected with a 400, because the schema is strict and does
 * not declare it.
 *
 * AUTHORITATIVE twin of `apps/web/src/lib/blindTypes/curtains.ts`; the
 * mirrored `pricing.test.ts` suites fail on any drift.
 */

import { z } from 'zod';
import {
  BaseBlindType,
  type BlindAttributes,
  type BlindPricingInputs,
  type MaterialUsage,
} from './base';

/**
 * Fabric consumed by the side hems and returns of ONE finished panel, in
 * running metres. Charged per panel and outside the fullness multiplier —
 * a hem is cut on the finished panel, so gathering the curtain more does
 * not make it wider.
 */
const HEM_ALLOWANCE_M = 0.5;

export class CurtainsBlindType extends BaseBlindType {
  readonly blindType = 'Curtains';
  readonly aliases = ['curtain'];

  /**
   * The id is OPTIONAL: migration 29 left every historical row at `{}`
   * and `attributes.test.ts` asserts that still parses. The fallback in
   * `calculateUnitPrice` is the identity value, so an old row re-saves
   * at exactly today's price.
   *
   * `installation_id` is deliberately ABSENT: migration 35 promoted it to
   * a real line-item column and stripped it out of every historical blob,
   * so a client sending it here is now a 400.
   */
  readonly attributeSchema = BaseBlindType.attrs({
    pleat_type_id: z.string().uuid().optional(),
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
  ] as const;

  /**
   * Customer-facing lines. Deliberately the snapshot NAME only — the
   * multiplier is internal pricing detail and is never printed on an
   * estimate, invoice or customer page. Installation is no longer listed
   * here: it is a column now, printed from `installation_name` beside the
   * cassette and the bottom rail on every document.
   */
  describeAttributes(attrs: BlindAttributes): { label: string; value: string }[] {
    const out: { label: string; value: string }[] = [];
    if (attrs.pleat_name) out.push({ label: 'Pleat', value: String(attrs.pleat_name) });
    return out;
  }

  /**
   * Fabric by the running metre x fullness, plus a per-panel making
   * allowance. HEIGHT IS IGNORED — a curtain's fabric is bought by the
   * running metre of finished width, so the drop does not price it.
   *
   * This is the ONLY leg Curtains overrides. The control and the
   * installation charge are ordinary hardware now, summed by the base on
   * whatever basis their catalog rows declare; duplicating that maths
   * here is what used to let the two drift apart. A cassette or bottom
   * rail simply never reaches this type, because none is scoped to it in
   * Settings — and if one ever were, it would now be charged rather than
   * silently ignored.
   *
   * The allowance is `HEM_ALLOWANCE_M` of fabric for every panel — side
   * hems and returns are cut once per finished panel — so it is charged
   * per panel COUNT and deliberately NOT multiplied by the fullness: a
   * hem does not get wider because the curtain is gathered more.
   */
  protected materialCost(item: BlindPricingInputs, widthCm: number, _heightCm: number): number {
    const pleat = numericOr(item.attributes.pleat_multiplier, 1);
    return (
      (widthCm / 100) * pleat * item.material_price_per_sqm +
      item.panels.length * HEM_ALLOWANCE_M * item.material_price_per_sqm
    );
  }

  /**
   * Curtains buy fabric by the running metre of finished width, so this
   * reports metres rather than square metres and ignores height exactly
   * as `materialCost` does — the drop is measured and printed on the
   * manufacturer copy, but it does not price.
   *
   * The hem allowance is added AFTER the fullness multiplication, matching
   * the leg above: a hem does not get wider because the curtain is
   * gathered more. `measured` skips only the width minimum, which is the
   * only minimum this type applies.
   */
  describeMaterialUsage(item: BlindPricingInputs): MaterialUsage {
    const rawWidthCm = item.panels.reduce((a, b) => a + b, 0);
    const widthCm = this.applyWidthMinimum(rawWidthCm);
    const pleat = numericOr(item.attributes.pleat_multiplier, 1);
    const hem = item.panels.length * HEM_ALLOWANCE_M;
    return {
      unit: 'running_m',
      quantity: (widthCm / 100) * pleat + hem,
      measured: (rawWidthCm / 100) * pleat + hem,
    };
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
