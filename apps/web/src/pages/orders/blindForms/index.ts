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

import { normalizeBlindType } from '../../../lib/blindTypes';
import DefaultForm from './DefaultForm';
import type { BlindFormComponent } from './fields';

/**
 * normalised name/alias → form component.
 *
 * Populated per type. Every key a type's pricing module answers to must
 * appear here too, aliases included (Sunscreen also answers to "solar",
 * Curtains to "curtain") — see `lib/blindTypes/registry.ts`.
 */
const byKey = new Map<string, BlindFormComponent>();

/**
 * Returns the form for a stored blind-type name, or `DefaultForm` when the
 * name is empty or unrecognised.
 */
export function getBlindForm(blindsType: string | null | undefined): BlindFormComponent {
  return byKey.get(normalizeBlindType(blindsType)) ?? DefaultForm;
}

export { DefaultForm };
export type { BlindFormComponent, BlindFormProps } from './fields';
