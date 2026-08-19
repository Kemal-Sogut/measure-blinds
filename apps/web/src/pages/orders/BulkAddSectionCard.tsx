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
 * Only `SectionCard` is exported; the rest are private helpers used
 * exclusively by it, kept in this file rather than `BulkAddSheet.tsx`
 * because nothing outside a section card needs them.
 */

import { applyTypeDefaults, parsePositive, type BlindDraft, type Catalogs } from './lineItemDrafts';
import type { BulkMeasureRow, BulkSection } from './bulkAdd';
import { parsePanelInput } from './panelInput';
import {
  AttributeSelect,
  FormSplitter,
  HardwareRow,
  INPUT,
  LABEL,
  MaterialAndColor,
  NoteField,
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
 * One measurement row's fields: room name, a single width entry, height,
 * and a remove control.
 *
 * Deliberately NOT the same shape as the single-item form's `PanelWidths`:
 * this row has ONE width input, no "+ Panel" button, and no per-panel
 * remove control (an explicit design decision — see this file's module
 * doc). Typing `'118.5+118'` here does not split live; the row keeps the
 * raw string in `width_cm` and `expandBulkSections` (`bulkAdd.ts`) is what
 * runs it through `parsePanelInput` at add-time to produce the eventual
 * line item's `panels` array. The running "panels total" caption below the
 * label previews that same split as the consultant types, so they can
 * confirm the shorthand parsed the way they meant before confirming the
 * whole sheet.
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

  return (
    <div className="flex flex-col gap-2.5 rounded-md border border-border-light p-2.5">
      <div className="flex items-end gap-2">
        <label className="min-w-0 flex-1">
          <span className={LABEL}>Room</span>
          <input
            ref={registerRoomInput}
            placeholder="Living Room"
            value={row.room_name}
            onChange={(e) => onChange({ ...row, room_name: e.target.value })}
            className={INPUT}
          />
        </label>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove row"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-sunken hover:text-danger"
        >
          ✕
        </button>
      </div>

      <label>
        <span className={LABEL}>
          Width (cm) — panels total:{' '}
          <span className="font-mono">{panelSum > 0 ? panelSum : '—'}</span>
        </span>
        <input
          inputMode="decimal"
          placeholder="118.5+118 for two panels"
          value={row.width_cm}
          onChange={(e) => onChange({ ...row, width_cm: e.target.value })}
          className={`${INPUT} font-mono`}
        />
      </label>

      <label>
        <span className={LABEL}>Height (cm)</span>
        <input
          inputMode="decimal"
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
      </label>
    </div>
  );
}

/**
 * One bulk-add section: a collapsible card whose header shows the chosen
 * blind type (or "New section") and its row count, and whose body — shown
 * only while expanded — holds the shared config half (type, material +
 * colour, type attributes, hardware, note) above a splitter, then the
 * measurement rows and the "+ Row" button below it.
 *
 * Deliberately OMITS `RoomField`, `QuantityStepper` and `PriceBlock`
 * (override/add-ons): those are per-row or excluded by design (see
 * `bulkAdd.ts`'s `expandBulkSections`/`BulkSection` docs) — room comes from
 * each `RowFields`, and quantity + price adjustments are fixed by
 * `expandBulkSections` regardless of what the config carries, so offering
 * them here would edit a value the expansion never reads.
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
    <div className="rounded-xl border border-border-light bg-surface">
      <div className="flex items-center gap-1 p-2.5">
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
        <div className="flex flex-col gap-3.5 border-t border-border-light p-3">
          <SectionTypeSelect config={section.config} catalogs={catalogs} onChange={onConfigChange} />
          <MaterialAndColor draft={section.config} catalogs={catalogs} onChange={onConfigChange} />
          <SectionAttributes config={section.config} catalogs={catalogs} onChange={onConfigChange} />
          <HardwareRow draft={section.config} catalogs={catalogs} onChange={onConfigChange} />
          <NoteField draft={section.config} onChange={onConfigChange} />

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
