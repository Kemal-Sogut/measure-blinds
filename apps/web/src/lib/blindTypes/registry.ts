// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Blind-type module registry — resolves a stored blind-type name to
 * the module that owns it. Line items snapshot the blind type as
 * free text (`line_items.blinds_type`), so lookup is by NAME, normalised
 * to tolerate spacing, punctuation, and the legacy "… Blind" suffix
 * (e.g. "Roller Blind" and "Roller" both resolve to the Roller
 * module). Unknown or empty names fall back to the default base
 * module, so pricing never throws on an unrecognised type.
 *
 * Twin of the AUTHORITATIVE `apps/api/src/lib/blindTypes/registry.ts`.
 */

import { BaseBlindType } from './base';
import { RollerBlindType } from './roller';
import { ZebraBlindType } from './zebra';
import { RomanBlindType } from './roman';
import { SunscreenBlindType } from './sunscreen';
import { HoneycombBlindType } from './honeycomb';
import { ShutterBlindType } from './shutter';
import { VerticalSheerBlindType } from './verticalSheer';
import { VerticalPanelBlindType } from './verticalPanel';
import { VerticalRollerBlindType } from './verticalRoller';
import { CurtainsBlindType } from './curtains';

/**
 * Normalises a blind-type name to a lookup key: lowercased, reduced to
 * alphanumerics, with a trailing "blind" token stripped. So "Roller
 * Blind", "roller", and "ROLLER" all key to "roller".
 */
export function normalizeBlindType(name: string | null | undefined): string {
  const s = (name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return s.length > 5 && s.endsWith('blind') ? s.slice(0, -5) : s;
}

/** Fallback used when a blind type has no dedicated module. */
const defaultBlindType = new BaseBlindType();

/** One instance per supported blind type (the canonical ten). */
const blindTypes: readonly BaseBlindType[] = [
  new RollerBlindType(),
  new ZebraBlindType(),
  new RomanBlindType(),
  new SunscreenBlindType(),
  new HoneycombBlindType(),
  new ShutterBlindType(),
  new VerticalSheerBlindType(),
  new VerticalPanelBlindType(),
  new VerticalRollerBlindType(),
  new CurtainsBlindType(),
];

/** normalised name/alias → blind-type module instance. */
const byKey = new Map<string, BaseBlindType>();
for (const bt of blindTypes) {
  byKey.set(normalizeBlindType(bt.blindType), bt);
  for (const alias of bt.aliases) byKey.set(normalizeBlindType(alias), bt);
}

/**
 * Returns the blind-type module for a stored blind-type name, or the
 * default base module when the name is empty/unrecognised.
 */
export function getBlindType(blindsType: string | null | undefined): BaseBlindType {
  const key = normalizeBlindType(blindsType);
  return byKey.get(key) ?? defaultBlindType;
}
