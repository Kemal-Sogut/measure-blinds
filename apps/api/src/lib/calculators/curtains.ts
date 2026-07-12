// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Curtains blind pricing calculator.
 *
 * Placeholder for a future custom formula. For now it inherits the shared
 * default calculation from BaseBlindCalculator unchanged; the type-specific
 * pricing will be implemented here later by overriding the cost hooks.
 */

import { BaseBlindCalculator } from './base';

export class CurtainsCalculator extends BaseBlindCalculator {
  readonly blindType = 'Curtains';
  readonly aliases = ['curtain'];
}
