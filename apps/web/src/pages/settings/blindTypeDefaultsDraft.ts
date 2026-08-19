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

import { materialsForType, optionsForType, type Catalogs } from '../orders/lineItemDrafts';

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
 * `typeName` under the CURRENT `catalogs` — i.e. re-checks each field's id
 * against the exact OPTION list the card renders that field's `<select>`
 * from (`optionsForType` per hardware catalog; `materialsForType` filtered
 * to `active` for Material), not just to whatever the draft happens to
 * hold.
 *
 * Exists because a saved default can go stale without the Default
 * Options page ever being touched: an option can be deactivated or
 * unlinked from a type on another settings page while still being the
 * value some card's draft holds. Calling this before every save (see
 * `BlindTypeDefaults.tsx`'s module doc) is what keeps a card from
 * becoming permanently unsavable; calling it when building the display
 * draft as well keeps the UI from ever showing a value that cannot match
 * any rendered option.
 *
 * Deliberately OPTION-level, not slot-level: `optionsForType` (which
 * `OptionSelect`'s own option list is built from) already filters to
 * `active` options before the list reaches the control, so an id for a
 * since-deactivated option has no matching `<option>` to fall back to —
 * `OptionSelect` cannot "tolerate" it the way selecting the slot as a
 * whole might suggest. The API independently re-validates every non-null
 * id's `active` flag on save (`apps/api/src/routes/settings.ts`'s
 * `DEFAULT_LINKS` lookup), so an id that survived a slot-level check here
 * (the slot still has SOME active option, just not THIS one) would still
 * 400 — a narrower version of the exact staleness this function exists to
 * prevent. Material has no separate "slot" concept and `materialsForType`
 * does not itself filter on `active` (a documented, pre-existing
 * asymmetry with the hardware catalogs — see `materialsForType`'s own
 * JSDoc) — so `active` is checked here explicitly, matching what the API
 * accepts.
 *
 * Pure — catalogs and a type name in, a sanitized draft out.
 */
export function sanitizeDraftForType(
  draft: DefaultsDraft,
  catalogs: Catalogs,
  typeName: string
): DefaultsDraft {
  const validMaterial = materialsForType(catalogs, typeName).some(
    (m) => m.id === draft.material_id && m.active
  );
  const validId = <T extends { id: string; active: boolean; blind_type_ids: string[] }>(
    options: T[],
    id: string
  ) => optionsForType(options, catalogs.blindTypes, typeName).some((o) => o.id === id);
  return {
    material_id: validMaterial ? draft.material_id : '',
    cassette_id: validId(catalogs.cassettes, draft.cassette_id) ? draft.cassette_id : '',
    bottom_rail_id: validId(catalogs.bottomRails, draft.bottom_rail_id) ? draft.bottom_rail_id : '',
    control_id: validId(catalogs.controls, draft.control_id) ? draft.control_id : '',
    installation_id: validId(catalogs.installationOptions, draft.installation_id)
      ? draft.installation_id
      : '',
  };
}

/**
 * Computes the sanitized full draft one `BlindTypeDefaultsCard.set` call
 * should save: `draft` (last SERVER-CONFIRMED values) overlaid with
 * `pendingWrites` (any OTHER fields on the same card with a save still in
 * flight, holding their just-sent, not-yet-confirmed values) overlaid with
 * this field's freshly picked `value`, then re-sanitized against the
 * current catalogs.
 *
 * This is the merge step that closes the original non-optimistic-mutation
 * race (see `BlindTypeDefaults.tsx`'s module doc): computing a save from
 * `draft` ALONE while a sibling field's PUT is in flight would silently
 * revert that sibling's edit the moment this save lands, because a
 * full-row PUT resends every field. Folding in `pendingWrites` means a
 * concurrent, still-unconfirmed sibling edit survives.
 *
 * It also defines the recovery guarantee for a field whose OWN save has
 * already been rejected: `set` unconditionally removes a field from
 * `pendingWrites` once ITS save settles, success or failure (see `set`'s
 * own JSDoc) — so by the time this function is called for a LATER save
 * that does not name that field, `pendingWrites` no longer carries its
 * rejected value, and this merge falls back to `draft` (the last value
 * the server actually accepted) for it instead. A save fired for a
 * DIFFERENT field WHILE the rejected one is still mid-flight can still
 * carry that doomed value in its own outgoing PUT — no purely local state
 * change can un-send an already-in-flight request — but every save fired
 * after the rejection is known is guaranteed clean, which is what keeps a
 * single bad pick from blocking the rest of the card.
 *
 * Pure — no React, no network — so this exact contamination-avoidance
 * behaviour is unit-testable without a browser or a mounted component.
 */
export function nextDraftForSave(
  draft: DefaultsDraft,
  pendingWrites: Partial<DefaultsDraft>,
  field: keyof DefaultsDraft,
  value: string,
  catalogs: Catalogs,
  typeName: string
): DefaultsDraft {
  const merged: DefaultsDraft = { ...draft, ...pendingWrites, [field]: value };
  return sanitizeDraftForType(merged, catalogs, typeName);
}
