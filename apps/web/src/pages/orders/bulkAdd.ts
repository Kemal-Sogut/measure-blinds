// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Bulk-ADD: pure expansion and validation for the "configure one section,
 * type many rows" line-item flow.
 *
 * Today a consultant adds blinds to an order one at a time, re-picking the
 * same blind type, material and hardware for every window in a room or
 * house. Bulk add flips that: the consultant configures ONE section (a
 * blind type plus its material/hardware/colour — everything that
 * stays the same across a run of windows) and then rattles off many
 * measurement rows (room name, panel widths, height) underneath it — one
 * `BlindDraft` line item per row. Several sections can exist side by side,
 * each for a different blind type, so a whole house can be measured in one
 * pass even when it mixes Roller in the bedrooms with Curtains in the
 * lounge.
 *
 * This module is the PURE logic only — expansion (`expandBulkSections`)
 * and validation (`validateBulkSections`) plus the two blank-value
 * factories the sheet UI seeds its state from. It holds no JSX and no
 * component; the bottom-sheet UI that reads/writes `BulkSection[]` is a
 * separate concern (kept out of this file for the same Fast-Refresh reason
 * `lineItemDrafts.ts`'s own header documents — mixing components and plain
 * functions in one module defeats React's hot-swap boundary).
 *
 * Split out from `lineItemDrafts.ts` rather than added to it: that file
 * sits right at the project's 800-line cap, so a second bulk flow's types
 * and functions live here instead, alongside `lineItemBulk.ts` (bulk EDIT
 * — a different feature: patching already-added items, not creating new
 * ones). Both siblings import `lineItemDrafts.ts`'s draft model and
 * scoping helpers rather than re-deriving them, so the two bulk flows
 * (bulk edit and this one) cannot drift apart on what a "blind draft" is
 * or which hardware slots a type uses.
 *
 * `nextKey` is imported from the dedicated `draftKeys.ts` (see that
 * module's doc comment) rather than defined here: it is a page-wide id
 * utility shared with several `OrderDetail.tsx` call sites that have
 * nothing to do with bulk add, so it does not belong owned by this narrow
 * feature module either.
 */

import {
  newBlindDraft,
  parseDraftAttributes,
  parsePositive,
  NO_ADJUSTMENTS,
  type BlindDraft,
  type BlindDraftDefaults,
  type Catalogs,
} from './lineItemDrafts';
import { nextKey } from './draftKeys';
import { parsePanelInput } from './panelInput';

/* ------------------------------------------------------------------ */
/* Blank-value factories                                               */
/* ------------------------------------------------------------------ */

/**
 * House default hardware for a brand-new bulk-add section: all three ids
 * empty. Mirrors `OrderDetail.tsx`'s own `blindDefaults` constant (used by
 * `addBlind`) rather than importing it, to avoid a `bulkAdd.ts` →
 * `OrderDetail.tsx` import that would create a cycle once `OrderDetail.tsx`
 * imports this module's bulk-add exports for its sheet UI.
 *
 * Nothing is seeded because nothing can be validated or scoped before a
 * blind type is chosen — once one is, `applyTypeDefaults` (called by the
 * sheet UI, not by this module) resets the section's config onto that
 * type's SAVED defaults from Settings, same as the single-item type
 * dropdown and bulk edit.
 */
const EMPTY_HARDWARE: BlindDraftDefaults = {
  cassette_id: '',
  bottom_rail_id: '',
  control_id: '',
};

/**
 * One row of the bulk-add sheet: a room label, a single width entry, and a
 * height that become one blind line item once the section's config is
 * applied to the row.
 *
 * `width_cm` deliberately holds ONE string rather than a `panels` array.
 * Unlike the single-item form's `PanelWidths` (which keeps a "+ Panel"
 * button alongside the shorthand), a bulk-add row accepts multiple panel
 * widths ONLY through the `panelInput.ts` shorthand — typing
 * `'118.5+118'` into this one field. There is no per-row "+ Panel" or
 * remove-panel control in the bulk sheet; `expandBulkSections` is what
 * runs `width_cm` through `parsePanelInput` to produce the eventual line
 * item's `panels` array, so the split logic itself stays owned by
 * `panelInput.ts` and is never duplicated here.
 *
 * Pairs with a `BulkSection.config` that already carries a chosen blind
 * type, material and hardware — bulk add exists precisely so those do not
 * have to be re-picked per window.
 *
 * Every field is a raw string, same convention as every other draft field
 * in this codebase: a half-typed "12." must not fight the keyboard.
 */
export interface BulkMeasureRow {
  key: string;
  room_name: string;
  width_cm: string;
  height_cm: string;
}

/**
 * A blank measurement row, ready to type into: no room name yet, an empty
 * width, no height. `key` is a fresh id from `nextKey`, so a sheet can
 * append any number of these to a section's `rows` without key collisions.
 */
export function newBulkRow(): BulkMeasureRow {
  return { key: nextKey(), room_name: '', width_cm: '', height_cm: '' };
}

/**
 * One bulk-add section: a shared blind configuration (`config`) plus the
 * measurement rows that will each become one line item carrying that
 * configuration. Several sections can exist at once in the sheet, one per
 * blind type the consultant is measuring in this pass.
 *
 * `key` is this section's own React list key, distinct from `config.key`
 * (the key the eventual `BlindDraft` line item would carry if the config
 * were used directly) and from every row's `key` — three independent id
 * spaces from the same shared `nextKey` sequence, because the sheet UI
 * renders sections, their config form, and their rows as three separate
 * lists.
 *
 * `config` is a full `BlindDraft` — including `panels`/`height_cm`/`key`/
 * `uid`/`hidden` fields it will never actually contribute to a saved item
 * (those come from each `BulkMeasureRow` and from `expandBulkSections`
 * instead) — rather than a narrower "blind settings" type, so the sheet
 * can reuse the SAME type-picker, material-picker and hardware-picker
 * form controls the single-item editor already has (`BlindEditForm` and
 * friends), instead of building parallel ones for a shape that only
 * differs by omission.
 */
export interface BulkSection {
  key: string;
  config: BlindDraft;
  rows: BulkMeasureRow[];
}

/**
 * A fresh bulk-add section: one blank measurement row, and a blank config
 * — no blind type, material or hardware chosen yet, quantity `'1'` — that
 * models `addBlind`'s own blank draft in `OrderDetail.tsx` (`newBlindDraft`
 * seeded with empty hardware ids). Nothing is scoped until a type is
 * picked; the sheet's type dropdown then calls `applyTypeDefaults` on
 * `config` to seed that type's saved defaults and clear whichever slot the
 * type does not use, exactly as the single-item flow does — so a section
 * created here and a blind added the ordinary way start identical.
 */
export function newBulkSection(): BulkSection {
  return {
    key: nextKey(),
    config: newBlindDraft(nextKey(), EMPTY_HARDWARE),
    rows: [newBulkRow()],
  };
}

/* ------------------------------------------------------------------ */
/* Expansion                                                           */
/* ------------------------------------------------------------------ */

/**
 * Whether a single bulk-add row has anything actually typed into it — a
 * room name, a width, or a height. This is the ONE definition of "blank
 * row" for the whole bulk-add flow, used by three different call sites
 * that each need to answer the same question from a different angle:
 * `expandBulkSections` filters rows by it (a blank row produces no item),
 * `bulkAddHasContent` checks per-row content by it (a blank row is not
 * "unsaved progress" worth a discard confirmation), and the sheet's own
 * item counter (`itemCount` in `BulkAddSheet.tsx`) counts by it too (the
 * confirm button must show — and gate on — the number of items that will
 * actually be created, not the raw row count). Three independent copies of
 * this same three-field check is exactly how those three would quietly
 * disagree again — one shared definition is what keeps the count, the
 * enabled state, and the expansion result unable to disagree.
 */
export function bulkRowHasContent(row: BulkMeasureRow): boolean {
  return row.room_name.trim() !== '' || row.width_cm.trim() !== '' || row.height_cm.trim() !== '';
}

/**
 * Expands bulk-add sections into order line-item drafts: one draft per
 * measurement row THAT HAS SOMETHING IN IT, carrying its section's blind
 * configuration and the row's room + measurements. An entirely blank row
 * (no room name, no width, no height — e.g. the sheet's own default
 * starting row before anything is typed) is SKIPPED rather than turned
 * into an empty item; a row with only one of the three filled in (a room
 * name jotted down before the tape measure comes out, say) is NOT blank
 * and still becomes an item, with its unfilled fields carried through as
 * empty strings. Quantity is fixed at 1 per row (spec: a duplicate room is
 * typed twice, not counted as quantity 2 — two rows for "Bedroom" become
 * two separate line items, each independently editable and removable
 * afterwards). Pure — hosts append the result to the items state.
 *
 * Field provenance per output draft:
 * - From the ROW: `room_name`, `panels` (derived from the row's `width_cm`
 *   shorthand string via `parsePanelInput` — see below), `height_cm`.
 * - From the SECTION's `config`: everything else — `blinds_type`,
 *   `material_id`, every hardware slot, `color`, `note`, `attributes`
 *   (copied, not shared — see below), `uid`/`hidden` (both start at
 *   the config's blank values: `null` / `false`, since every expanded item
 *   is new and unsaved). These may themselves be blank strings, when the
 *   section was never configured beyond its rows — `validateBulkSections`
 *   deliberately allows that; see that function's doc for why.
 * - Fixed regardless of either: `key` (a fresh one per item, so no two
 *   expanded drafts — or an expanded draft and its section's own `config`
 *   — ever collide), `quantity` (`'1'`), and the price-adjustment fields
 *   (`NO_ADJUSTMENTS` — no override, no add-ons — even if `config` somehow
 *   carried one, because an adjustment made against a template before any
 *   row existed has no single row it was ever meant for).
 *
 * `panels: parsePanelInput(r.width_cm)` mints a fresh array on every call —
 * there is no row-owned `panels` array to alias in the first place, unlike
 * `attributes: { ...s.config.attributes }`, which IS a deliberate SHALLOW
 * COPY of an object the row does not own. Every row expanded from one
 * section shares that section's `config` — and one `config` object can
 * produce many drafts, plus it is still held live in the sheet's own state
 * while the consultant keeps adding rows under it. Without the copy,
 * editing one expanded item's attributes afterwards (e.g. a Curtains pleat
 * picker in the single-item form) would silently reach back through the
 * shared reference and mutate the section's `config` — and every OTHER
 * item already expanded from it, since they would all alias that same
 * object. `attributes` is a plain `Record<string, string>` that the
 * blind-type input forms currently only ever REPLACE (`{ ...draft.attributes,
 * [k]: v }`, never assigned into in place), so the aliasing bug this copy
 * prevents is latent today rather than already visible — but nothing in
 * this module's contract may rely on every future caller preserving that
 * discipline. Order across sections and rows is preserved: section 1's
 * rows all precede section 2's, and each section's rows keep the order
 * they were typed in, because both the blank-row filter and `flatMap` are
 * order-preserving and this function does no reordering of its own.
 *
 * Does not validate — call `validateBulkSections` first and only expand
 * once it returns `null`, same division of labor `buildPayload` keeps
 * between the payload builder and its own inline checks.
 */
export function expandBulkSections(sections: BulkSection[]): BlindDraft[] {
  return sections.flatMap((s) =>
    s.rows
      .filter(bulkRowHasContent)
      .map((r) => ({
        ...s.config,
        key: nextKey(),
        room_name: r.room_name,
        panels: parsePanelInput(r.width_cm),
        height_cm: r.height_cm,
        attributes: { ...s.config.attributes },
        quantity: '1',
        ...NO_ADJUSTMENTS,
      }))
  );
}

/* ------------------------------------------------------------------ */
/* Discard guard                                                       */
/* ------------------------------------------------------------------ */

/**
 * Whether anything has actually been entered into the bulk-add sheet: a
 * measurement typed into any row, or a section's shared config touched
 * away from its blank defaults (blind type, material, any hardware slot,
 * colour, or an attribute). The section config has no note field of its
 * own to check here — it was removed entirely from the bulk-add sheet (a
 * maintainer decision; the row-level item note stays editable later, per
 * item, in the single-item edit form) — so `config.note` is never part of
 * this predicate.
 *
 * This sheet can hold on-site measurements for a whole house — the most
 * expensive, hardest-to-redo state in the app — so its close handler
 * (`BulkAddSheet.tsx`) must confirm before discarding once this is true: a
 * backdrop tap is easy to make by accident on a tablet. A freshly opened
 * sheet's default single section with its single blank row must read as
 * "nothing entered" — otherwise every accidental backdrop tap on an
 * untouched sheet would ask a pointless question — which is exactly what
 * lets that guard stay silent until real typing has happened.
 *
 * Deliberately more liberal than `validateBulkSections` (which asks "is
 * this section READY to expand?"): a half-typed room name with no
 * measurement yet, or a blind type picked with nothing else filled in, is
 * still real unsaved progress a consultant would not want a stray tap to
 * throw away, even though neither would pass validation.
 *
 * Per-row content is `bulkRowHasContent` — the same predicate
 * `expandBulkSections` filters blank rows by and the sheet's item counter
 * counts by, so this guard can never disagree with either about what a
 * "blank" row is.
 */
export function bulkAddHasContent(sections: BulkSection[]): boolean {
  const configHasContent = (config: BlindDraft) =>
    config.blinds_type !== '' ||
    config.material_id !== '' ||
    config.cassette_id !== '' ||
    config.bottom_rail_id !== '' ||
    config.control_id !== '' ||
    config.installation_id !== '' ||
    config.color !== '' ||
    Object.values(config.attributes).some((v) => v.trim() !== '');
  return sections.some((s) => configHasContent(s.config) || s.rows.some(bulkRowHasContent));
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Validates bulk-add sections before they are expanded and appended to the
 * order, returning the first problem found as a user-facing message, or
 * `null` when every section is ready to expand.
 *
 * DELIBERATELY PERMISSIVE — this is not a partial implementation, it is
 * the whole point, so read this before "fixing" it back in. Bulk add
 * exists for on-site measuring: a consultant walks room to room capturing
 * widths and heights before anyone has decided what blind type, material
 * or hardware goes in each window. An earlier version of this function
 * required a blind type, a material and every hardware slot the chosen
 * type uses before a section could expand at all — which meant the
 * consultant could not even START measuring until those product decisions
 * were made, defeating the entire point of a fast, on-site bulk tool. The
 * maintainer decided bulk add MAY create incomplete line items: an
 * expanded item with a blank `blinds_type` (or material, or hardware)
 * lands in the order as an ordinary draft, exactly like a blind added one
 * at a time with nothing picked yet. Bulk EDIT (the sibling
 * `lineItemBulk.ts`) is how a whole batch of those gets filled in at once
 * afterwards, back at the customer's house or later at a desk.
 *
 * COMPLETENESS IS ENFORCED LATER, AT SAVE — not here. `buildPayload` in
 * `OrderDetail.tsx` is what actually blocks an incomplete item from
 * reaching the Worker: it walks every item in the order (bulk-added or
 * not — by the time it runs, a bulk-add item is just an item like any
 * other) and returns a message naming the first offender, for example:
 *   if (!it.material_id) return `Item ${i + 1}: choose a material.`;
 *   if (uses.has('cassette') && !it.cassette_id) return `Item ${i + 1}: choose a cassette.`;
 *   if (attributes === null) return `Item ${i + 1}: check the ${it.blinds_type || 'blind'} options.`;
 * (plus the matching bottom-rail, control and installation checks). A
 * future reader who finds a blind-type / material / hardware check
 * missing from HERE and "fixes" it by adding one back would be
 * reintroducing the exact on-site dead end this relaxation exists to
 * remove — go read `buildPayload`'s blind-item branch first; it is the
 * real gate, and it already covers every field this function used to.
 *
 * What THIS function still rejects, because nothing downstream catches
 * these and letting them through would silently corrupt a measurement
 * rather than just leave a product choice for later:
 * - a section with zero rows: nothing to expand, and nothing for
 *   `buildPayload` to ever see, so no later check would ever catch an
 *   empty section either;
 * - a row's width or height that was actually TYPED but is not a
 *   positive number: a BLANK measurement is fine (filled in on-site
 *   later, same as a blank blind type), but a typo like "12a" or a stray
 *   "-5" must never silently become a saved measurement nobody actually
 *   entered;
 * - a chosen type's attributes, but ONLY once `blinds_type` is non-blank:
 *   `parseDraftAttributes` looks a schema up BY that type, so running it
 *   against a blank type is meaningless (there is nothing to validate
 *   against) and would effectively force a type pick before the config
 *   could ever pass — exactly the requirement being removed. A row with a
 *   type chosen but garbage attributes still needs to be caught here,
 *   because `expandBulkSections` copies `config.attributes` verbatim onto
 *   every row it produces, and by the time `buildPayload` rejects the
 *   first of those already-expanded items it is too late to fix them all
 *   at once from one place.
 *
 * `catalogs` is unused by this function's own checks now — the material
 * and hardware-slot checks that used `slotsForType(catalogs, ...)`, plus
 * the blind-type-chosen check, are gone. The parameter stays anyway
 * (renamed `_catalogs` to satisfy the unused-parameter check), so the
 * sheet's existing call site (`BulkAddSheet.tsx`) needs no change, and so
 * a future completeness check that legitimately needs catalog data (added
 * back here on purpose, not by accident) has somewhere to read it from
 * without a signature change.
 *
 * Checked per ROW within a section, first — mirrors the OLD per-row-then-
 * per-section ordering, even though the per-section side has shrunk to
 * one check:
 * - if `width_cm` was typed (non-blank once trimmed), every panel
 *   `parsePanelInput` splits it into must be a positive number;
 * - if `height_cm` was typed (non-blank once trimmed), it must be a
 *   positive number.
 * Neither is checked when blank — see `expandBulkSections`, which drops
 * an entirely blank row (no room, no width, no height) instead of
 * expanding it into an empty item; a row with only ONE of the three typed
 * is not "entirely blank" and still expands, blank fields and all, which
 * is exactly why an untyped width or height must not be an error here.
 *
 * `room_name` is DELIBERATELY not checked — an empty room is allowed, same
 * as a saved blind line item today (`buildPayload` never requires one).
 *
 * Checked per SECTION (the shared config, checked once rather than once
 * per row — mirrors how the fields are actually entered in the sheet),
 * after its rows:
 * - the chosen type's attribute schema accepts the config's `attributes`
 *   (`parseDraftAttributes` — the SAME parse `buildPayload` runs on every
 *   item and `blindDraftPrice` runs for the live preview; e.g. Curtains'
 *   `pleat_type_id`, when present, must be a real uuid), but only when
 *   `cfg.blinds_type` is chosen — see above.
 *
 * `section.rows.length === 0` is checked before that section's row loop
 * (there is nothing to iterate otherwise) and has no `buildPayload`
 * counterpart either — a single line item cannot have "zero rows"; an
 * empty section would otherwise silently expand to zero items with no
 * explanation.
 *
 * Section and row numbers in the returned message are ONE-based
 * (`Section 2, row 3: …`), matching how `buildPayload` numbers items and
 * how a consultant counts sections/rows on screen — not how the arrays are
 * indexed.
 */
export function validateBulkSections(sections: BulkSection[], _catalogs: Catalogs): string | null {
  for (const [s, section] of sections.entries()) {
    if (section.rows.length === 0) return `Section ${s + 1}: add at least one row.`;

    for (const [r, row] of section.rows.entries()) {
      if (row.width_cm.trim() !== '') {
        const panels = parsePanelInput(row.width_cm).map(parsePositive);
        if (panels.some((p) => p === null))
          return `Section ${s + 1}, row ${r + 1}: enter a valid width.`;
      }
      if (row.height_cm.trim() !== '' && !parsePositive(row.height_cm))
        return `Section ${s + 1}, row ${r + 1}: enter a valid height.`;
    }

    const cfg = section.config;
    if (cfg.blinds_type && parseDraftAttributes(cfg) === null)
      return `Section ${s + 1}: check the ${cfg.blinds_type} options.`;
  }
  return null;
}
