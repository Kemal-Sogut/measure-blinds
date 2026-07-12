// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Barrel for the blind-type calculator hierarchy. Exposes the base
 * calculator + inputs type, every per-type calculator, and the registry
 * (`getCalculator` / `normalizeBlindType`). Import from here rather than
 * reaching into individual calculator files.
 */

export { BaseBlindCalculator, type BlindPricingInputs } from './base';
export { getCalculator, normalizeBlindType } from './registry';
export { RollerCalculator } from './roller';
export { ZebraCalculator } from './zebra';
export { RomanCalculator } from './roman';
export { SunscreenCalculator } from './sunscreen';
export { HoneycombCalculator } from './honeycomb';
export { ShutterCalculator } from './shutter';
export { VerticalSheerCalculator } from './verticalSheer';
export { VerticalPanelCalculator } from './verticalPanel';
export { VerticalRollerCalculator } from './verticalRoller';
export { CurtainsCalculator } from './curtains';
