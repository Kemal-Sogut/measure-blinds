// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Zebra blind pricing calculator.
 *
 * Currently inherits the shared default calculation from BaseBlindCalculator.
 * Override the cost hooks (materialCost / cassetteCost / controlCost) or the
 * minimum rules here to give this blind type its own formula.
 */

import { BaseBlindCalculator } from './base';

export class ZebraCalculator extends BaseBlindCalculator {
  readonly blindType = 'Zebra';
}
