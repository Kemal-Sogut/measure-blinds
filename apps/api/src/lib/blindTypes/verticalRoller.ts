// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Vertical Roller blind-type module.
 *
 * Currently inherits the shared default calculation from BaseBlindType.
 * Override the cost hooks (materialCost / cassetteCost / bottomRailCost /
 * controlCost) or the
 * minimum rules here to give this blind type its own formula.
 */

import { BaseBlindType } from './base';

export class VerticalRollerBlindType extends BaseBlindType {
  readonly blindType = 'Vertical Roller';
}
