// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * `SectionCard` — one bulk-add section's collapsible card, split out of
 * `BulkAddSheet.tsx` once that file passed the ~500-line guideline for a
 * single-responsibility file. `BulkAddSheet.tsx` owns the sections list,
 * the accordion's `openKey`, and the confirm/validate flow; this file owns
 * only how ONE section (and the row inside it) renders and reports its own
 * events upward — it holds no section-identifying logic of its own.
 *
 * Also holds the two field reimplementations `BulkAddSheet.tsx`'s module
 * doc explains are unavoidable duplicates of `blindForms/fields.tsx`
 * components (`SectionTypeSelect` for `BlindTypeSelect`, and `RowFields`'s
 * width/height inputs for `PanelWidths`/`HeightField`), since both are used
 * only from inside a section card. The two are NOT identical, by explicit
 * design decision: `RowFields` accepts panel widths ONLY via the
 * `panelInput.ts` shorthand (one width input, no "+ Panel" or per-panel
 * remove control), whereas `PanelWidths` keeps its "+ Panel" button
 * alongside the same shorthand — a bulk-add row is meant to be typed fast
 * across many windows, so there is no per-row button to tap.
 * `SectionAttributes` — the Curtains-pleat extension point — lives here for
 * the same reason as the other two.
 *
 * A THIRD duplication, added alongside this file's contrast/layout pass:
 * `SectionCard`'s config row renders Material and Colour as raw
 * `OptionSelect`/`<input>` fields rather than through `blindForms/
 * fields.tsx`'s `MaterialAndColor` — that component wraps both in its OWN
 * 2-column grid, which cannot be pulled apart to sit as two of THREE equal
 * columns alongside Blind type. This file needs the bare fields, not the
 * pre-paired component.
 *
 * `RowFields`'s width input also carries a small "+" button that inserts
 * the `panelInput.ts` `+` separator at the input's CURRENT CARET position
 * (never blindly appended) — added because the field uses
 * `inputMode="decimal"`, and iOS's decimal keypad has no `+` key at all,
 * making the shorthand otherwise untypeable on the phone this sheet is
 * used on. `PanelWidths` needs no equivalent: its own "+ Panel" button
 * already solves the same problem by adding a whole new panel input rather
 * than editing text, so a second plus-shaped control beside it would be
 * two similar-looking buttons doing different things (an explicit
 * maintainer decision) — see `RowFields`'s own doc for how the caret
 * position is found and restored.
 *
 * Only `SectionCard` is exported; the rest are private helpers used
 * exclusively by it, kept in this file rather than `BulkAddSheet.tsx`
 * because nothing outside a section card needs them.
 */

import { useEffect, useRef, useState } from 'react';
import {
  applyTypeDefaults,
  materialsForType,
  parsePositive,
  type BlindDraft,
  type Catalogs,
} from './lineItemDrafts';
import type { BulkMeasureRow, BulkSection } from './bulkAdd';
import { parsePanelInput } from './panelInput';
import {
  AttributeSelect,
  FormSplitter,
  HardwareRow,
  INPUT,
  LABEL,
  OptionSelect,
} from './blindForms/fields';
import { getBlindType } from '../../lib/blindTypes';

/** Shared chevron path for the section card's expand/collapse control. */
const CHEVRON_PATH = 'm6 9 6 6 6-6';

/**
 * A section's blind-type dropdown — the near-duplicate of `fields.tsx`'s
 * `BlindTypeSelect` `BulkAddSheet.tsx`'s module doc explains.
 *
 * Calls `applyTypeDefaults` WITHOUT `keepValid`: a bulk-add section starts
 * from a blank config, so there is never a "current pick" worth preserving
 * across a type change, unlike the single-item editor (which keeps a still
 * valid pick alive when the type is edited after other fields were
 * already set).
 */
function SectionTypeSelect({
  config,
  catalogs,
  onChange,
}: {
  config: BlindDraft;
  catalogs: Catalogs;
  onChange: (next: BlindDraft) => void;
}) {
  const typeInList = catalogs.blindTypes.some((t) => t.name === config.blinds_type);
  return (
    <label className="block min-w-0">
      <span className={LABEL}>Blind type</span>
      <select
        value={config.blinds_type}
        onChange={(e) => onChange(applyTypeDefaults(config, e.target.value, catalogs))}
        className={INPUT}
      >
        <option value="">Select…</option>
        {config.blinds_type && !typeInList && (
          <option value={config.blinds_type}>{config.blinds_type}</option>
        )}
        {catalogs.blindTypes
          .filter((t) => t.active || t.name === config.blinds_type)
          .map((t) => (
            <option key={t.id} value={t.name}>
              {t.name}
            </option>
          ))}
      </select>
    </label>
  );
}

/**
 * A section's type-specific attribute inputs — the extension point for "a
 * section whose blind type has attributes must expose them".
 *
 * Curtains is the only blind type with a UI-editable attribute today (its
 * Pleat picker, `pleat_type_id` — see `CurtainsForm.tsx`), so this is the
 * only case below. There is no generic, declarative registry of
 * "attribute key → label → catalog list" to drive this from (each
 * per-type form file hand-writes its own `AttributeSelect`/`AttributeText`
 * calls), so a future type that grows an attribute needs a case added HERE
 * too, exactly as it needs one added to its own `<Type>Form.tsx` — the two
 * are a matching pair the same way `blindForms/index.ts`'s form registry
 * and `lib/blindTypes/registry.ts`'s pricing registry are, and can drift
 * apart the same way if only one is updated.
 *
 * Reuses `AttributeSelect` itself (the actual reusable primitive) rather
 * than reimplementing the picker — only the "which type shows what" gating
 * is local to this sheet.
 */
function SectionAttributes({
  config,
  catalogs,
  onChange,
}: {
  config: BlindDraft;
  catalogs: Catalogs;
  onChange: (next: BlindDraft) => void;
}) {
  if (getBlindType(config.blinds_type).blindType !== 'Curtains') return null;
  return (
    <AttributeSelect
      draft={config}
      onChange={onChange}
      attrKey="pleat_type_id"
      label="Pleat"
      options={catalogs.pleatTypes}
    />
  );
}

/**
 * One measurement row's fields — room name, a single width entry, height,
 * and a remove control — laid out on ONE LINE: `grid-cols-[4fr_3fr_3fr]`
 * splits Room/Width/Height 40/30/30 (the `fr` form rather than literal
 * percentages, so `gap-2` between the columns is subtracted from the track
 * sizes automatically instead of overflowing them). The ✕ remove control
 * sits OUTSIDE that grid, as a fixed `h-11 w-11` flex sibling — it does not
 * eat into the 40/30/30 split. All three inputs keep the 44px (`h-11`)
 * touch height the rest of this sheet uses; at this density their visible
 * `<label>` is gone in favour of a `placeholder` (still visible when empty)
 * plus an `aria-label` (screen-reader only) — every input keeps one
 * regardless of what a sighted user sees.
 *
 * Deliberately NOT the same shape as the single-item form's `PanelWidths`:
 * this row has ONE width input, no "+ Panel" button, and no per-panel
 * remove control (an explicit design decision — see this file's module
 * doc). Typing `'118.5+118'` here does not split live; the row keeps the
 * raw string in `width_cm` and `expandBulkSections` (`bulkAdd.ts`) is what
 * runs it through `parsePanelInput` at add-time to produce the eventual
 * line item's `panels` array. The "Panels total" caption below the row
 * previews that same split as the consultant types, so they can confirm
 * the shorthand parsed the way they meant before confirming the whole
 * sheet.
 *
 * The width input also carries a small "+" button (`insertPlusAtCaret`
 * below), because `inputMode="decimal"` has no `+` key on iOS's on-screen
 * keypad — without it the shorthand above is simply untypeable on the
 * device this sheet is used on. It inserts at the CARET, not the end of
 * the string: a consultant who taps back into the first number to fix a
 * typo (correcting the `118.5` in `"118.5+118"`) must be able to add the
 * separator where their cursor actually is. `pendingCaret` + `widthInputRef`
 * restore both focus AND the caret position AFTER the insert, reusing the
 * same ref-map / "wants focus" pattern `BulkAddSheet.tsx`'s Enter-to-add-row
 * hop and `PanelWidths`'s own split-focus effect already use — the effect
 * runs once the DOM reflects the new value (passive effects run after
 * commit), so the caret lookup can never miss. Without restoring it, tapping
 * "+" a second time would keep landing at the end of the string instead of
 * where it was tapped, silently defeating the whole point of the button.
 *
 * `registerRoomInput` is a ref callback rather than a plain `ref` object:
 * the sheet keeps ONE map of room inputs keyed by row key (rows come and
 * go), and a ref callback is how a row registers/unregisters itself into
 * that shared map as it mounts/unmounts. `onEnterHeight` fires on Enter in
 * the height field — the sheet uses it to append a new row and focus that
 * new row's room input, so a whole run of windows can be typed without
 * reaching for the "+ Row" button.
 */
function RowFields({
  row,
  onChange,
  onRemove,
  onEnterHeight,
  registerRoomInput,
}: {
  row: BulkMeasureRow;
  onChange: (next: BulkMeasureRow) => void;
  onRemove: () => void;
  onEnterHeight: () => void;
  registerRoomInput: (el: HTMLInputElement | null) => void;
}) {
  const panelSum = parsePanelInput(row.width_cm).reduce(
    (a, p) => a + (parsePositive(p) ?? 0),
    0
  );
  const widthInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingCaret, setPendingCaret] = useState<number | null>(null);

  useEffect(() => {
    if (pendingCaret === null) return;
    const el = widthInputRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(pendingCaret, pendingCaret);
    }
    setPendingCaret(null);
  }, [pendingCaret, row.width_cm]);

  /**
   * Inserts a `+` panel separator into `width_cm` at the input's CURRENT
   * caret position — falling back to the end of the value when the input
   * never had focus (e.g. tapped straight from another row) — rather than
   * blindly appending it. See this function's rationale in the doc comment
   * above: `inputMode="decimal"` has no `+` key on iOS, so this button is
   * the only way to type the shorthand on the device this sheet targets,
   * and it must land the separator where the consultant is actually
   * editing, not always at the end.
   */
  function insertPlusAtCaret() {
    const el = widthInputRef.current;
    const caret = el?.selectionStart ?? row.width_cm.length;
    const next = row.width_cm.slice(0, caret) + '+' + row.width_cm.slice(caret);
    onChange({ ...row, width_cm: next });
    setPendingCaret(caret + 1);
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border-light p-2.5">
      <div className="flex items-start gap-2">
        <div className="grid min-w-0 flex-1 grid-cols-[4fr_3fr_3fr] gap-2">
          <input
            ref={registerRoomInput}
            placeholder="Room"
            aria-label="Room name"
            value={row.room_name}
            onChange={(e) => onChange({ ...row, room_name: e.target.value })}
            className={INPUT}
          />

          <div className="relative min-w-0">
            <input
              ref={widthInputRef}
              inputMode="decimal"
              placeholder="Width (cm)"
              aria-label="Width in centimeters — type + or tap the + button to add another panel"
              value={row.width_cm}
              onChange={(e) => onChange({ ...row, width_cm: e.target.value })}
              className={`${INPUT} truncate pr-8 font-mono`}
            />
            <button
              type="button"
              onClick={insertPlusAtCaret}
              aria-label="Insert panel separator at cursor"
              className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-sm border border-border-input bg-surface text-sm font-semibold leading-none text-brand-600"
            >
              +
            </button>
          </div>

          <input
            inputMode="decimal"
            placeholder="Height (cm)"
            aria-label="Height in centimeters"
            value={row.height_cm}
            onChange={(e) => onChange({ ...row, height_cm: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onEnterHeight();
              }
            }}
            className={`${INPUT} font-mono`}
          />
        </div>

        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove row"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-sunken hover:text-danger"
        >
          ✕
        </button>
      </div>

      <p className="pl-0.5 text-[11px] text-text-muted">
        Panels total: <span className="font-mono">{panelSum > 0 ? panelSum : '—'}</span>
      </p>
    </div>
  );
}

/**
 * One bulk-add section: a collapsible card whose header shows the chosen
 * blind type (or "New section") and its row count, and whose body — shown
 * only while expanded — holds the shared config half (type, material,
 * colour, type attributes, hardware) above a splitter, then the
 * measurement rows and the "+ Row" button below it.
 *
 * CARD TREATMENT mirrors the order-details page's own cards (`rounded-xl
 * border ... bg-surface shadow-md`), but with `border-border-strong`
 * instead of the softer `border-light` those cards use — the maintainer's
 * complaint was that sections "can't be chosen by eye" in a sheet that can
 * stack several of them; the darker border plus the shadow are what let
 * one card's edge read as a card at arm's length in daylight, instead of
 * dissolving into the sheet's own `bg-surface` background. The OPEN
 * section additionally gets a `bg-brand-50` header tint (and swaps its
 * body divider to `border-border-strong` too, matching the card's own
 * border rather than the collapsed `border-light`), in place of a heavier
 * border: giving every card the SAME strong border and marking the open
 * one by colour keeps exactly one border weight on screen — layering a
 * heavier border on top of the new uniformly-dark ones would instead read
 * as a THIRD weight competing with the first two. Colour is also already
 * how this app marks "the active one" elsewhere (e.g. the calendar's own
 * `bg-brand-50` "today" cell), so this reuses an established convention
 * rather than inventing a new one. Collapsed headers keep only the type
 * name and row count — nothing else changes about them.
 *
 * CONFIG ROW: Blind type, Material and Colour render as three EQUAL
 * columns (`grid grid-cols-1 sm:grid-cols-3`, stacking on a narrow phone)
 * rather than through the shared `MaterialAndColor` — see the module doc's
 * "third duplication" note for why that component can't be reused here.
 * Hardware and the Curtains attribute picker (`SectionAttributes`) keep
 * their own row below, unchanged.
 *
 * Deliberately OMITS `RoomField`, `QuantityStepper`, `PriceBlock` and
 * `NoteField` (override/add-ons/note): those are per-row, fixed by
 * `expandBulkSections` regardless of what the config carries, or removed
 * entirely (see `bulkAdd.ts`'s `expandBulkSections`/`BulkSection` docs) —
 * room comes from each `RowFields`; quantity and price adjustments are
 * fixed at expansion time so offering them here would edit a value the
 * expansion never reads; and a bulk-add section's shared note field was
 * dropped outright (a maintainer decision) — the row-level item note stays
 * editable later, per item, in the single-item edit form `NoteField`
 * already covers.
 *
 * Every callback is already bound to this section's key by the parent
 * (`BulkAddSheet`), so this component itself holds no section-identifying
 * logic — it only renders `section` and forwards events upward.
 */
export function SectionCard({
  section,
  index,
  open,
  catalogs,
  onToggle,
  onRemove,
  onConfigChange,
  onAddRow,
  onRowChange,
  onRemoveRow,
  onEnterHeight,
  registerRoomInput,
}: {
  section: BulkSection;
  index: number;
  open: boolean;
  catalogs: Catalogs;
  onToggle: () => void;
  onRemove: () => void;
  onConfigChange: (next: BlindDraft) => void;
  onAddRow: () => void;
  onRowChange: (rowKey: string, next: BulkMeasureRow) => void;
  onRemoveRow: (rowKey: string) => void;
  onEnterHeight: () => void;
  registerRoomInput: (rowKey: string) => (el: HTMLInputElement | null) => void;
}) {
  const label = section.config.blinds_type || 'New section';
  const rowCount = section.rows.length;

  return (
    <div className="overflow-hidden rounded-xl border border-border-strong bg-surface shadow-md">
      <div className={`flex items-center gap-1 p-2.5 ${open ? 'bg-brand-50' : ''}`}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1 text-left"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          >
            <path d={CHEVRON_PATH} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">
            {label}
          </span>
          <span className="shrink-0 text-[12px] text-text-muted">
            {rowCount} row{rowCount !== 1 ? 's' : ''}
          </span>
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Delete section ${index + 1}`}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-sunken hover:text-danger"
        >
          ✕
        </button>
      </div>

      {open && (
        <div className="flex flex-col gap-3.5 border-t border-border-strong p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <SectionTypeSelect config={section.config} catalogs={catalogs} onChange={onConfigChange} />
            <OptionSelect
              label="Material"
              value={section.config.material_id}
              onChange={(id) => onConfigChange({ ...section.config, material_id: id })}
              options={materialsForType(catalogs, section.config.blinds_type)}
              placeholder={section.config.blinds_type ? 'Select…' : 'Pick a blind type first'}
            />
            <label className="min-w-0">
              <span className={LABEL}>Color</span>
              <input
                placeholder="e.g. White, Oak, Charcoal"
                value={section.config.color}
                onChange={(e) => onConfigChange({ ...section.config, color: e.target.value })}
                maxLength={100}
                className={INPUT}
              />
            </label>
          </div>

          <SectionAttributes config={section.config} catalogs={catalogs} onChange={onConfigChange} />
          <HardwareRow draft={section.config} catalogs={catalogs} onChange={onConfigChange} />

          <FormSplitter />

          <div className="flex flex-col gap-2.5">
            {section.rows.map((row) => (
              <RowFields
                key={row.key}
                row={row}
                onChange={(next) => onRowChange(row.key, next)}
                onRemove={() => onRemoveRow(row.key)}
                onEnterHeight={onEnterHeight}
                registerRoomInput={registerRoomInput(row.key)}
              />
            ))}
            <button
              type="button"
              onClick={onAddRow}
              className="h-11 rounded-sm border border-dashed border-border-input text-[13px] font-medium text-brand-600"
            >
              + Row
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
