// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Barrel for the blind-type module hierarchy. Exposes the base module +
 * inputs type, every per-type module, and the registry
 * (`getBlindType` / `normalizeBlindType`). Import from here rather than
 * reaching into individual blind-type files.
 */

export { BaseBlindType, type BlindPricingInputs } from './base';
export { getBlindType, normalizeBlindType } from './registry';
export { RollerBlindType } from './roller';
export { ZebraBlindType } from './zebra';
export { RomanBlindType } from './roman';
export { SunscreenBlindType } from './sunscreen';
export { HoneycombBlindType } from './honeycomb';
export { ShutterBlindType } from './shutter';
export { VerticalSheerBlindType } from './verticalSheer';
export { VerticalPanelBlindType } from './verticalPanel';
export { VerticalRollerBlindType } from './verticalRoller';
export { CurtainsBlindType } from './curtains';
