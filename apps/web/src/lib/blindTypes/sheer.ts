// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Sheer blind-type module — a sheer curtain, priced EXACTLY like
 * Curtains.
 *
 * Sheer fabric is bought the same way curtain fabric is: by the running
 * metre of finished width, multiplied by the pleat fullness, plus the
 * per-panel hem allowance. Height is measured for the manufacturer copy
 * but does not price. So this module inherits every leg of
 * `CurtainsBlindType` — `materialCost`, `describeMaterialUsage`, the
 * `pleat_type_id` attribute schema, its `pleat_types` catalog ref and the
 * customer-facing "Pleat" line — and changes only the label it answers to.
 *
 * Because it SUBCLASSES Curtains, every "does this type price by the
 * running metre?" check is written as `instanceof CurtainsBlindType`
 * rather than a name compare, so Sheer picks up the per-metre Materials
 * label, the Pleat Types link and the bulk-add Pleat picker for free. A
 * future formula change to Curtains therefore changes Sheer too — split
 * this off `BaseBlindType` if the two ever need to diverge.
 *
 * Distinct from "Vertical Sheer": the registry normalises "Sheer" to
 * `sheer` and "Vertical Sheer" to `verticalsheer`, so the two never
 * collide. As with Curtains, `material_price_per_sqm` on a Sheer material
 * holds DOLLARS PER RUNNING METRE.
 *
 * Twin of the AUTHORITATIVE `apps/api/src/lib/blindTypes/sheer.ts`; the
 * mirrored `pricing.test.ts` suites fail on any drift.
 */

import { CurtainsBlindType } from './curtains';

export class SheerBlindType extends CurtainsBlindType {
  readonly blindType = 'Sheer';
  readonly aliases = ['sheers'];
}
