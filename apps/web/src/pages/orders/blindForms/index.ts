// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Blind-form registry — resolves a stored blind-type name to the form
 * component that edits it.
 *
 * Keyed exactly the way `lib/blindTypes/registry.ts` keys its pricing
 * modules: through `normalizeBlindType`, so "Roller Blind" and "Roller"
 * both land on the Roller form. Unknown and empty names fall back to
 * `DefaultForm`, so the editor never renders blank for a legacy or
 * deactivated type.
 *
 * TWO registries rather than one because this half imports React and the
 * shared half must not — `apps/api/src/lib/blindTypes` runs on the Worker,
 * which cannot load JSX. They MUST stay key-compatible: a type with a
 * pricing module but no entry here silently renders the DEFAULT form, so
 * its type-specific inputs are simply absent from the UI — no error, no
 * type failure, just a quietly incomplete order. `blindForms.test.ts`
 * asserts the two key sets match; do not add a blind type to one registry
 * without adding it to the other.
 */

import { getBlindType, normalizeBlindType } from '../../../lib/blindTypes';
import DefaultForm from './DefaultForm';
import type { BlindFormComponent } from './fields';

import RollerForm from './RollerForm';
import ZebraForm from './ZebraForm';
import RomanForm from './RomanForm';
import SunscreenForm from './SunscreenForm';
import HoneycombForm from './HoneycombForm';
import ShutterForm from './ShutterForm';
import VerticalSheerForm from './VerticalSheerForm';
import VerticalPanelForm from './VerticalPanelForm';
import VerticalRollerForm from './VerticalRollerForm';
import CurtainsForm from './CurtainsForm';

/**
 * Canonical blind-type label → form component.
 *
 * Keyed only by each type's CANONICAL name. Aliases are deliberately
 * absent: `getBlindForm` resolves the incoming name through the pricing
 * registry first and keys on the canonical label that comes back, so the
 * two registries cannot disagree about "solar" or "curtain" even in
 * principle. Adding an alias in `lib/blindTypes/` needs no edit here.
 */
const byKey = new Map<string, BlindFormComponent>([
  [normalizeBlindType('Roller'), RollerForm],
  [normalizeBlindType('Zebra'), ZebraForm],
  [normalizeBlindType('Roman'), RomanForm],
  [normalizeBlindType('Sunscreen/Solar'), SunscreenForm],
  [normalizeBlindType('Honeycomb'), HoneycombForm],
  [normalizeBlindType('Shutter'), ShutterForm],
  [normalizeBlindType('Vertical Sheer'), VerticalSheerForm],
  [normalizeBlindType('Vertical Panel'), VerticalPanelForm],
  [normalizeBlindType('Vertical Roller'), VerticalRollerForm],
  [normalizeBlindType('Curtains'), CurtainsForm],
]);

/**
 * Returns the form for a stored blind-type name, or `DefaultForm` when the
 * name is empty or unrecognised.
 *
 * Resolution goes through `getBlindType` FIRST, so every alias, casing and
 * legacy "… Blind" spelling the pricing registry accepts lands on the same
 * form that prices it. An unrecognised name resolves to the base module,
 * whose label ('Default') is not in the map — hence `DefaultForm`.
 */
export function getBlindForm(blindsType: string | null | undefined): BlindFormComponent {
  const canonical = getBlindType(blindsType).blindType;
  return byKey.get(normalizeBlindType(canonical)) ?? DefaultForm;
}

export { DefaultForm };
export type { BlindFormComponent, BlindFormProps } from './fields';
