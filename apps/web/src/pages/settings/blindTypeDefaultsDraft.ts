// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * `DefaultsDraft` and `sanitizeDraftForType` — the draft shape and
 * catalog-sanitizing rule for the "Default Options" settings page
 * (`BlindTypeDefaults.tsx`) — no JSX.
 *
 * Split out of `BlindTypeDefaults.tsx` for the same reason
 * `lineItemDrafts.ts` is split out of `LineItemEditor.tsx`: React Fast
 * Refresh (`react/only-export-components`) breaks when a module exports
 * both components and plain functions/types, forcing a full reload on
 * every edit instead of a hot swap. Keeping this pure logic in its own
 * `.ts` file also makes it directly unit-testable without React or a
 * running page.
 */

import { materialsForType, slotsForType, type Catalogs } from '../orders/lineItemDrafts';

/**
 * All-string mirror of a saved defaults row's five option fields, `''`
 * meaning "no default" — the shape every `OptionSelect` on the Default
 * Options page reads and writes. Kept separate from `BlindTypeDefaults`
 * (the API row type, whose fields are `string | null`) for the same
 * reason every other draft in this app is string-typed: a `<select>`
 * cannot bind to `null`.
 */
export interface DefaultsDraft {
  material_id: string;
  cassette_id: string;
  bottom_rail_id: string;
  control_id: string;
  installation_id: string;
}

/**
 * Clears any field in `draft` that is no longer a valid pick for
 * `typeName` under the CURRENT `catalogs` — i.e. re-applies the exact
 * scoping the card renders from (`materialsForType` for Material,
 * `slotsForType` for each hardware slot) to the values that are about to
 * be DISPLAYED or SAVED, not just to whatever the draft happens to hold.
 *
 * Exists because a saved default can go stale without the Default
 * Options page ever being touched: a hardware slot's last active+scoped
 * option can be deactivated or unlinked on another settings page, or a
 * Material can be unlinked from this type on the Materials page. When
 * that happens the card stops RENDERING the affected field (the same
 * scoping rule that decided to render it), but the row still carries the
 * old id — and the page's `toPatch` always resends every field, so every
 * subsequent save on that card would 400 on an id the user has no
 * control left to clear. Calling this before every save (see
 * `BlindTypeDefaults.tsx`'s module doc) is what keeps a card from
 * becoming permanently unsavable; calling it when building the display
 * draft as well keeps the UI from ever showing a value that cannot match
 * any rendered option.
 *
 * Hardware fields are cleared at the SLOT level (`slotsForType`), matching
 * what the card actually renders — not at the individual-option level
 * (`optionsForType`), which `OptionSelect` already tolerates on its own by
 * keeping a selected-but-now-inactive option visible in its list as long
 * as the slot itself is still offered. Material has no separate "slot"
 * concept, so it is checked directly against `materialsForType`'s id list.
 *
 * Pure — catalogs and a type name in, a sanitized draft out.
 */
export function sanitizeDraftForType(
  draft: DefaultsDraft,
  catalogs: Catalogs,
  typeName: string
): DefaultsDraft {
  const materials = materialsForType(catalogs, typeName);
  const slots = slotsForType(catalogs, typeName);
  const validMaterial = materials.some((m) => m.id === draft.material_id);
  return {
    material_id: validMaterial ? draft.material_id : '',
    cassette_id: slots.has('cassette') ? draft.cassette_id : '',
    bottom_rail_id: slots.has('bottom_rail') ? draft.bottom_rail_id : '',
    control_id: slots.has('control') ? draft.control_id : '',
    installation_id: slots.has('installation') ? draft.installation_id : '',
  };
}
