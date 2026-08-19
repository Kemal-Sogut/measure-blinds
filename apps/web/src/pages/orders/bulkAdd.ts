// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Bulk-ADD: pure expansion and validation for the "configure one section,
 * type many rows" line-item flow.
 *
 * Today a consultant adds blinds to an order one at a time, re-picking the
 * same blind type, material and hardware for every window in a room or
 * house. Bulk add flips that: the consultant configures ONE section (a
 * blind type plus its material/hardware/colour/note — everything that
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
  slotsForType,
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
 * Expands bulk-add sections into order line-item drafts: one draft
 * per measurement row, carrying its section's blind configuration and the
 * row's room + measurements. Quantity is fixed at 1 per row (spec: a
 * duplicate room is typed twice, not counted as quantity 2 — two rows for
 * "Bedroom" become two separate line items, each independently editable
 * and removable afterwards). Pure — hosts append the result to the items
 * state.
 *
 * Field provenance per output draft:
 * - From the ROW: `room_name`, `panels` (derived from the row's `width_cm`
 *   shorthand string via `parsePanelInput` — see below), `height_cm`.
 * - From the SECTION's `config`: everything else — `blinds_type`,
 *   `material_id`, every hardware slot, `color`, `note`, `attributes`
 *   (copied, not shared — see below), `uid`/`hidden` (both start at
 *   the config's blank values: `null` / `false`, since every expanded item
 *   is new and unsaved).
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
 * they were typed in, because `flatMap` is order-preserving and this
 * function does no reordering of its own.
 *
 * Does not validate — call `validateBulkSections` first and only expand
 * once it returns `null`, same division of labor `buildPayload` keeps
 * between the payload builder and its own inline checks.
 */
export function expandBulkSections(sections: BulkSection[]): BlindDraft[] {
  return sections.flatMap((s) =>
    s.rows.map((r) => ({
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
 * colour, note, or an attribute).
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
 */
export function bulkAddHasContent(sections: BulkSection[]): boolean {
  const rowHasContent = (row: BulkMeasureRow) =>
    row.room_name.trim() !== '' ||
    row.height_cm.trim() !== '' ||
    row.width_cm.trim() !== '';
  const configHasContent = (config: BlindDraft) =>
    config.blinds_type !== '' ||
    config.material_id !== '' ||
    config.cassette_id !== '' ||
    config.bottom_rail_id !== '' ||
    config.control_id !== '' ||
    config.installation_id !== '' ||
    config.color !== '' ||
    config.note !== '' ||
    Object.values(config.attributes).some((v) => v.trim() !== '');
  return sections.some((s) => configHasContent(s.config) || s.rows.some(rowHasContent));
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Validates bulk-add sections before they are expanded and appended to the
 * order, returning the first problem found as a user-facing message, or
 * `null` when every section is ready to expand.
 *
 * MUST mirror `buildPayload`'s rules, message wording, AND CHECK ORDER in
 * `OrderDetail.tsx` (e.g. "choose a material.", "choose a cassette.",
 * "enter every panel width.") — the Worker enforces the identical
 * constraints on save, so a section that passes here and is then expanded
 * must always be acceptable to `buildPayload`'s own per-item checks. The
 * two are independent implementations by necessity (this checks ONE
 * config against MANY rows before expansion; `buildPayload` checks
 * already-expanded, one-config-per-item drafts after it) and must be kept
 * in sync by hand if either changes — including the ORDER checks run in,
 * because when a section has more than one problem at once, the order
 * decides which message the consultant sees first, and the two functions
 * must agree on that or the same broken section would report two
 * different "first" problems depending on which check ran it.
 *
 * `buildPayload` checks a blind item in this order: panels, height,
 * material, each hardware slot the type uses, quantity, then the type's
 * own attribute schema. This function follows the same order, mapped onto
 * sections-of-rows: PER-ROW measurement checks (panels, height — the
 * physical numbers a tape measure produced) run before the PER-SECTION
 * configuration checks (type, material, hardware, attributes — the shared
 * picks that apply to every row underneath). One check has no
 * `buildPayload` counterpart at all: whether a blind type has been chosen.
 * `buildPayload` never names this explicitly (an untyped blind's
 * `material_id` is always empty too, since `materialsForType('')` offers
 * nothing to pick, so it falls through to "choose a material" instead) —
 * bulk add's config UI has an explicit type picker per section, so this
 * function raises a dedicated message for it, placed immediately before
 * the material check it would otherwise be folded into. Quantity is
 * skipped entirely: `expandBulkSections` fixes every row's quantity to
 * `'1'` regardless of what the section's config carries, so validating the
 * config's own `quantity` field would reject or accept sections based on a
 * value the expansion never actually uses.
 *
 * Checked per ROW within a section, first:
 * - every panel produced by running the row's `width_cm` shorthand string
 *   through `parsePanelInput` is a positive number (a blank `width_cm`
 *   parses to one blank panel — see `parsePanelInput` — which then fails
 *   the positive-number check the same as any other empty panel would);
 * - the height is a positive number.
 *
 * `room_name` is DELIBERATELY not checked — an empty room is allowed, same
 * as a saved blind line item today (`buildPayload` never requires one).
 *
 * Checked per SECTION (the shared config, checked once rather than once
 * per row — mirrors how the fields are actually entered in the sheet),
 * after its rows:
 * - a blind type is chosen (see above — no `buildPayload` counterpart);
 * - a material is chosen;
 * - every hardware slot the chosen type actually USES has a pick
 *   (`slotsForType` — the same data-driven scoping `buildPayload` and the
 *   form dropdowns use, so a type that doesn't use e.g. installation is
 *   never blocked on it, and one that does is never let through without
 *   it);
 * - the type's attribute schema accepts the config's `attributes`
 *   (`parseDraftAttributes` — the SAME parse `buildPayload` runs on every
 *   item and `blindDraftPrice` runs for the live preview; e.g. Curtains'
 *   `pleat_type_id`, when present, must be a real uuid). Checked here, at
 *   the section, because `attributes` lives on the shared config and would
 *   otherwise fail identically on every row expanded from it — surfacing
 *   it once per section, before expansion, means the consultant never
 *   discovers an unsavable config only after `buildPayload` rejects the
 *   FIRST of what might be many already-expanded items.
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
export function validateBulkSections(sections: BulkSection[], catalogs: Catalogs): string | null {
  for (const [s, section] of sections.entries()) {
    if (section.rows.length === 0) return `Section ${s + 1}: add at least one row.`;

    for (const [r, row] of section.rows.entries()) {
      const panels = parsePanelInput(row.width_cm).map(parsePositive);
      if (panels.some((p) => p === null))
        return `Section ${s + 1}, row ${r + 1}: enter every panel width.`;
      if (!parsePositive(row.height_cm)) return `Section ${s + 1}, row ${r + 1}: enter a height.`;
    }

    const cfg = section.config;
    if (!cfg.blinds_type) return `Section ${s + 1}: choose a blind type.`;
    if (!cfg.material_id) return `Section ${s + 1}: choose a material.`;

    const uses = slotsForType(catalogs, cfg.blinds_type);
    if (uses.has('cassette') && !cfg.cassette_id) return `Section ${s + 1}: choose a cassette.`;
    if (uses.has('bottom_rail') && !cfg.bottom_rail_id)
      return `Section ${s + 1}: choose a bottom rail.`;
    if (uses.has('control') && !cfg.control_id) return `Section ${s + 1}: choose a control option.`;
    if (uses.has('installation') && !cfg.installation_id)
      return `Section ${s + 1}: choose an installation option.`;

    if (parseDraftAttributes(cfg) === null)
      return `Section ${s + 1}: check the ${cfg.blinds_type || 'blind'} options.`;
  }
  return null;
}
