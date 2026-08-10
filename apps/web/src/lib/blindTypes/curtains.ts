// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Curtains blind-type module.
 *
 * Placeholder for a future custom formula. For now it inherits the shared
 * default calculation from BaseBlindType unchanged; the type-specific
 * pricing will be implemented here later by overriding the cost hooks.
 */

import { BaseBlindType } from './base';

export class CurtainsBlindType extends BaseBlindType {
  readonly blindType = 'Curtains';
  readonly aliases = ['curtain'];
}
