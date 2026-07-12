// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Blind-type calculator registry — resolves a stored blind-type name to
 * the calculator that prices it. Line items snapshot the blind type as
 * free text (`line_items.blinds_type`), so lookup is by NAME, normalised
 * to tolerate spacing, punctuation, and the legacy "… Blind" suffix
 * (e.g. "Roller Blind" and "Roller" both resolve to the Roller
 * calculator). Unknown or empty names fall back to the default base
 * calculator, so pricing never throws on an unrecognised type.
 *
 * Twin of the AUTHORITATIVE `apps/api/src/lib/calculators/registry.ts`.
 */

import { BaseBlindCalculator } from './base';
import { RollerCalculator } from './roller';
import { ZebraCalculator } from './zebra';
import { RomanCalculator } from './roman';
import { SunscreenCalculator } from './sunscreen';
import { HoneycombCalculator } from './honeycomb';
import { ShutterCalculator } from './shutter';
import { VerticalSheerCalculator } from './verticalSheer';
import { VerticalPanelCalculator } from './verticalPanel';
import { VerticalRollerCalculator } from './verticalRoller';
import { CurtainsCalculator } from './curtains';

/**
 * Normalises a blind-type name to a lookup key: lowercased, reduced to
 * alphanumerics, with a trailing "blind" token stripped. So "Roller
 * Blind", "roller", and "ROLLER" all key to "roller".
 */
export function normalizeBlindType(name: string | null | undefined): string {
  const s = (name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return s.length > 5 && s.endsWith('blind') ? s.slice(0, -5) : s;
}

/** Fallback used when a blind type has no dedicated calculator. */
const defaultCalculator = new BaseBlindCalculator();

/** One instance per supported blind type (the canonical ten). */
const calculators: readonly BaseBlindCalculator[] = [
  new RollerCalculator(),
  new ZebraCalculator(),
  new RomanCalculator(),
  new SunscreenCalculator(),
  new HoneycombCalculator(),
  new ShutterCalculator(),
  new VerticalSheerCalculator(),
  new VerticalPanelCalculator(),
  new VerticalRollerCalculator(),
  new CurtainsCalculator(),
];

/** normalised name/alias → calculator instance. */
const byKey = new Map<string, BaseBlindCalculator>();
for (const calc of calculators) {
  byKey.set(normalizeBlindType(calc.blindType), calc);
  for (const alias of calc.aliases) byKey.set(normalizeBlindType(alias), calc);
}

/**
 * Returns the calculator for a stored blind-type name, or the default
 * base calculator when the name is empty/unrecognised.
 */
export function getCalculator(blindsType: string | null | undefined): BaseBlindCalculator {
  const key = normalizeBlindType(blindsType);
  return byKey.get(key) ?? defaultCalculator;
}
