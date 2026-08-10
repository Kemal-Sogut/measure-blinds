// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Sunscreen/Solar blind-type module.
 *
 * Currently inherits the shared default calculation from BaseBlindType.
 * Override the cost hooks (materialCost / cassetteCost / bottomRailCost /
 * controlCost) or the
 * minimum rules here to give this blind type its own formula.
 */

import { BaseBlindType } from './base';

export class SunscreenBlindType extends BaseBlindType {
  readonly blindType = 'Sunscreen/Solar';
  readonly aliases = ['sunscreen', 'solar', 'sunscreensolar'];
}
