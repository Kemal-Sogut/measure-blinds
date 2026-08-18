// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Bulk-edit patch model and the one pure function that applies it to a
 * single line-item draft.
 *
 * Split out from `lineItemDrafts.ts` because that file sits at the
 * project's 800-line cap; this owns exactly the bulk-edit patch/apply pair
 * and nothing else, so it stays small and the cap stays enforceable. It
 * otherwise belongs to the same layer as `lineItemDrafts.ts` — pure,
 * JSX-free functions over the draft models defined there — and reuses
 * that module's `applyTypeDefaults` and `slotsForType` rather than
 * re-deriving them, so a bulk-edit reset can never drift from what the
 * single-item blind-type dropdown and bulk-add already do.
 */

import { applyTypeDefaults, slotsForType, type BlindDraft, type Catalogs, type ItemDraft } from './lineItemDrafts';

/**
 * What one run of the bulk-edit form asks for, read by `applyBulkPatch`.
 *
 * `blinds_type` is '' to mean "keep each item's current type"; a type
 * NAME instead resets every touched item onto that type's saved defaults
 * before anything else in the patch is applied (see `applyBulkPatch`),
 * matching the value convention `BlindTypeSelect` already uses for the
 * per-item dropdown. `color` is free text, '' likewise meaning "no
 * change". Every other field is an id for one editable hardware/material
 * slot, '' meaning "no change" — the same convention Settings → Default
 * Options and the per-item forms use, so a bulk run and a single edit
 * read as the same kind of "nothing typed" rather than two different
 * placeholders.
 */
export interface BulkEditState {
  blinds_type: string;
  material_id: string;
  cassette_id: string;
  bottom_rail_id: string;
  control_id: string;
  installation_id: string;
  color: string;
}

/**
 * Applies one bulk-edit patch to one selected item draft.
 *
 * Non-blind items (preset/custom) pass straight through, unchanged and by
 * the same reference — they carry no blind type, material or hardware
 * slot for a bulk edit to touch. This guard is what lets the caller
 * (`OrderDetail`'s `applyBulkEdit`) map every selected item through this
 * function unconditionally, without first re-checking each one's
 * `item_type`. A BLIND item, by contrast, always gets back a NEW object —
 * even a patch that changes nothing on it still allocates via `{
 * ...item }` (or via `applyTypeDefaults`, which does the same). Unlike
 * the retired `applyBulkEditToDraft`, this does not special-case a
 * same-reference no-op: `OrderDetail.applyBulkEdit` already builds a new
 * items array on every apply via `Array.prototype.map`, so preserving one
 * item's reference identity inside that map would not save a render, and
 * is not worth the extra branch.
 *
 * When `patch.blinds_type` is set, the item is first RESET onto that
 * type's saved defaults via `applyTypeDefaults` — deliberately without
 * `keepValid`, so a still-valid current pick is replaced by the default
 * rather than kept, because bulk edit means "make these items uniform".
 * Every explicitly chosen field in the patch is then overlaid on top of
 * that reset (or, when `blinds_type` is empty, on top of the item as it
 * already was), guarded by the slots the item's — possibly
 * just-changed — type actually uses: an id for a slot outside that set
 * is silently dropped, because the Worker rejects one and the whole
 * order would stop saving. This reset-then-overlay order is what lets one
 * bulk run both switch an item's type AND pin one slot to something other
 * than that type's default in a single pass (e.g. "make these all
 * Roller, but Wand control").
 *
 * `material_id` is applied whenever the patch carries one, without a
 * matching slot check — mirroring the previous bulk-edit rule, on the
 * same trust the per-item form relies on: the caller's own dropdown
 * (`materialsForType`) is what keeps an out-of-scope id from ever
 * reaching the patch in the first place.
 *
 * **`unit_price_override` is CLEARED whenever the patch changes anything
 * that FEEDS the calculated price** — a new blind type, a material, or
 * any hardware slot. An override pins the unit price to a figure typed
 * against the OLD options, and it wins over the calculated price on both
 * sides (`adjustedDraftPrice`), so leaving it in place would show the new
 * options while silently continuing to charge the stale figure. A
 * COLOUR-only patch is the deliberate exception: colour is free text and
 * never enters pricing, so clearing the override on a pure colour edit
 * would surprise a consultant who did not touch anything price-related.
 * `addons` and `show_original_price` are left alone either way — they are
 * additions to the price rather than a replacement for it, so a re-price
 * does not invalidate them.
 *
 * Empty patch fields mean "no change" throughout, including `color`.
 *
 * @param item Any selected line item; only `item_type === 'blind'` rows
 *   are affected by anything below the first line.
 * @param patch The bulk-edit form's current state.
 * @param catalogs Live catalogs, needed both to resolve the (possibly
 *   new) type's saved defaults and to know which slots it uses.
 * @returns The patched draft, or `item` itself, unchanged, when it is not
 *   a blind.
 */
export function applyBulkPatch(item: ItemDraft, patch: BulkEditState, catalogs: Catalogs): ItemDraft {
  if (item.item_type !== 'blind') return item;
  const next: BlindDraft = patch.blinds_type
    ? applyTypeDefaults(item, patch.blinds_type, catalogs)
    : { ...item };
  const uses = slotsForType(catalogs, next.blinds_type);
  // Tracks whether anything that feeds the price was touched, so the
  // stale override is dropped on exactly those changes and never on a
  // colour-only patch.
  let pricingChanged = Boolean(patch.blinds_type);
  if (patch.material_id) {
    next.material_id = patch.material_id;
    pricingChanged = true;
  }
  if (patch.cassette_id && uses.has('cassette')) {
    next.cassette_id = patch.cassette_id;
    pricingChanged = true;
  }
  if (patch.bottom_rail_id && uses.has('bottom_rail')) {
    next.bottom_rail_id = patch.bottom_rail_id;
    pricingChanged = true;
  }
  if (patch.control_id && uses.has('control')) {
    next.control_id = patch.control_id;
    pricingChanged = true;
  }
  if (patch.installation_id && uses.has('installation')) {
    next.installation_id = patch.installation_id;
    pricingChanged = true;
  }
  if (patch.color) next.color = patch.color;
  if (pricingChanged) next.unit_price_override = '';
  return next;
}
