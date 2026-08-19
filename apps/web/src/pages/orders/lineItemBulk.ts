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

import {
  applyTypeDefaults,
  materialsForType,
  optionsForType,
  type BlindDraft,
  type Catalogs,
  type ItemDraft,
} from './lineItemDrafts';

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
 * already was), guarded OPTION-LEVEL against the item's — possibly
 * just-changed — type: `material_id` must appear in
 * `materialsForType(catalogs, next.blinds_type)` and each hardware id
 * must appear in `optionsForType(<that slot's catalog>, catalogs.blindTypes,
 * next.blinds_type)`, and an id that fails its check is silently dropped.
 *
 * This is deliberately NOT the same as checking only that the slot is
 * USED by the new type (`slotsForType`/`uses.has(slot)`) — two different
 * blind types can both use, say, the 'control' slot while scoping
 * entirely different control OPTIONS to it. A bulk-edit dialog's dropdowns
 * re-scope option-level the moment `state.blinds_type` changes
 * (`BulkEditForm`), so a value picked before that change (e.g. a
 * Roller-only control chosen, then the type switched to Zebra in the same
 * dialog) is stale for the new type even though the new type still has a
 * 'control' slot — a slot-level check would let that stale id through and
 * the Worker would save a control not offered for Zebra, priced as the
 * Roller option. The option-level check is what actually matches what the
 * dropdowns showed the consultant, so nothing can reach the draft that
 * the form itself never re-offered. This reset-then-overlay order is what
 * lets one bulk run both switch an item's type AND pin one slot to
 * something other than that type's default in a single pass (e.g. "make
 * these all Roller, but Wand control").
 *
 * **`unit_price_override` is CLEARED whenever the patch changes anything
 * that FEEDS the calculated price** — a new blind type, a material, or
 * any hardware slot — via the shared `clearPriceOverride` (see its own
 * JSDoc for why this is the ONE place both this function and the
 * single-item blind-type dropdown implement the rule). An override pins
 * the unit price to a figure typed against the OLD options, and it wins
 * over the calculated price on both sides (`adjustedDraftPrice`), so
 * leaving it in place would show the new options while silently
 * continuing to charge the stale figure. A COLOUR-only patch is the
 * deliberate exception: colour is free text and never enters pricing, so
 * clearing the override on a pure colour edit would surprise a
 * consultant who did not touch anything price-related. `addons` and
 * `show_original_price` are left alone either way — they are additions
 * to the price rather than a replacement for it, so a re-price does not
 * invalidate them.
 *
 * Empty patch fields mean "no change" throughout, including `color`.
 *
 * @param item Any selected line item; only `item_type === 'blind'` rows
 *   are affected by anything below the first line.
 * @param patch The bulk-edit form's current state.
 * @param catalogs Live catalogs, needed to resolve the (possibly new)
 *   type's saved defaults and to option-scope every material/hardware id
 *   in the patch against it.
 * @returns The patched draft, or `item` itself, unchanged, when it is not
 *   a blind.
 */
export function applyBulkPatch(item: ItemDraft, patch: BulkEditState, catalogs: Catalogs): ItemDraft {
  if (item.item_type !== 'blind') return item;
  const next: BlindDraft = patch.blinds_type
    ? applyTypeDefaults(item, patch.blinds_type, catalogs)
    : { ...item };
  /** One hardware catalog's options scoped+active for `next`'s (possibly just-changed) type. */
  const forType = <T extends { active: boolean; blind_type_ids: string[] }>(list: T[]) =>
    optionsForType(list, catalogs.blindTypes, next.blinds_type);
  // Tracks whether anything that feeds the price was touched, so the
  // stale override is dropped on exactly those changes and never on a
  // colour-only patch.
  let pricingChanged = Boolean(patch.blinds_type);
  if (patch.material_id && materialsForType(catalogs, next.blinds_type).some((m) => m.id === patch.material_id)) {
    next.material_id = patch.material_id;
    pricingChanged = true;
  }
  if (patch.cassette_id && forType(catalogs.cassettes).some((o) => o.id === patch.cassette_id)) {
    next.cassette_id = patch.cassette_id;
    pricingChanged = true;
  }
  if (patch.bottom_rail_id && forType(catalogs.bottomRails).some((o) => o.id === patch.bottom_rail_id)) {
    next.bottom_rail_id = patch.bottom_rail_id;
    pricingChanged = true;
  }
  if (patch.control_id && forType(catalogs.controls).some((o) => o.id === patch.control_id)) {
    next.control_id = patch.control_id;
    pricingChanged = true;
  }
  if (patch.installation_id && forType(catalogs.installationOptions).some((o) => o.id === patch.installation_id)) {
    next.installation_id = patch.installation_id;
    pricingChanged = true;
  }
  if (patch.color) next.color = patch.color;
  return pricingChanged ? clearPriceOverride(next) : next;
}

/**
 * Clears a blind draft's `unit_price_override`.
 *
 * The ONE place every price-feeding write path resets a stale override
 * from — a change to blind type, material, or any hardware slot changes
 * what the calculated price would be, and a hand-typed override set
 * against the OLD options would otherwise keep winning over the freshly
 * recalculated price (`adjustedDraftPrice`), silently charging a stale
 * figure once the new options apply.
 *
 * `applyBulkPatch` (above) calls this once it has decided its whole patch
 * touched something price-feeding. The single-item blind-type dropdown
 * (`BlindTypeSelect` in `blindForms/fields.tsx`) calls this directly,
 * right after `applyTypeDefaults`, because changing a blind's type is
 * unconditionally price-feeding there — unlike a bulk patch, a single
 * type-change action has no "did anything actually change" question to
 * answer first. Before this export existed, `fields.tsx` did not clear
 * the override at all: the rule lived only inside `applyBulkPatch`, so a
 * single-item type change reset material and every hardware slot while a
 * stale override kept quoting the old price. Routing BOTH call sites
 * through this one function is what stops the rule from re-diverging
 * that way again — a future third write path gets the same behaviour for
 * free by calling this instead of writing `unit_price_override: ''`
 * inline a third time.
 *
 * @param draft Any blind draft whose price-feeding fields just changed.
 * @returns The same draft (a new object) with `unit_price_override` reset
 *   to `''`; every other field is copied through unchanged.
 */
export function clearPriceOverride(draft: BlindDraft): BlindDraft {
  return { ...draft, unit_price_override: '' };
}
