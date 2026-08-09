// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Line-item edit-form components.
 *
 * The old inline BlindItemCard / FlatItemCard have been replaced by
 * BlindEditForm and FlatEditForm which live inside popup modals rather
 * than expanded inline in the page.  BulkEditForm lets the user change
 * only material, cassette, bottom rail, and control across all selected
 * blind items without touching any measurement or quantity fields.
 *
 * The draft models and every pure function over them live in
 * `./lineItemDrafts.ts`, deliberately apart: this file exports only
 * components, which is what lets React Fast Refresh hot-swap a form edit
 * instead of reloading the page. Do not move plain functions back in
 * here. Forms read and write draft STRINGS and never parse — the two
 * conversion points are `parseDraftAttributes` and the payload builder.
 *
 * Every container and control here carries `min-w-0`, deliberately. A
 * `<select>`'s min-content width is the width of its LONGEST option, and
 * grid/flex children default to `min-width: auto` — so one catalog entry
 * named "Blackout Premium Charcoal 3000" is enough to push a column, and
 * then the whole popup, past the edge of a phone screen. `min-w-0` lets
 * the control shrink and clip its own label instead. Do not remove it
 * when editing these forms.
 */

import type { ReactNode } from 'react';
import {
  blindDraftPrice,
  flatDraftPrice,
  materialsForType,
  parsePositive,
  type BlindDraft,
  type Catalogs,
  type FlatDraft,
} from './lineItemDrafts';

/* ------------------------------------------------------------------ */
/* Shared UI bits                                                      */
/* ------------------------------------------------------------------ */

const INPUT =
  'h-11 w-full min-w-0 rounded-md border border-border-input bg-surface px-3 text-sm text-text-primary';
const LABEL = 'mb-1.5 block text-xs font-medium text-text-secondary';

/** Native select bound to active catalog options. */
export function OptionSelect({
  label,
  value,
  onChange,
  options,
  placeholder = 'Select…',
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  options: { id: string; name: string; active: boolean }[];
  placeholder?: string;
}) {
  return (
    <label className="min-w-0 flex-1">
      <span className={LABEL}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={INPUT}>
        <option value="">{placeholder}</option>
        {options
          .filter((o) => o.active || o.id === value)
          .map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
      </select>
    </label>
  );
}

/**
 * One titled block of the blind popup (Basics / Options / Details).
 *
 * Purely presentational: it renders a small uppercase caption above a
 * vertical stack of fields. Consecutive sections are separated by
 * `<FormSplitter />` rather than by borders on the section itself, so a
 * section can be reordered or dropped without leaving a stray rule.
 */
function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3.5">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * Hairline rule between two form sections, drawn in the neutral
 * `border-light` token (the same tone used for rows inside a card) so it
 * reads as a natural pause rather than a second card edge.
 */
function FormSplitter() {
  return <hr className="border-0 border-t border-border-light" />;
}

/* ------------------------------------------------------------------ */
/* Edit forms (used inside popup modals)                               */
/* ------------------------------------------------------------------ */

/**
 * Full blind editing form, split into three splitter-separated sections:
 *
 *  1. Basics  — blind type, room, panel widths, height.
 *  2. Options — material + color on one row, cassette + control + bottom
 *     rail on the next.
 *  3. Details — note, quantity, the live price readout, and the caller's
 *     action buttons.
 *
 * Designed to be embedded inside a modal. It owns no save logic: the host
 * passes its own Cancel/Save controls through `footer` so they land at the
 * end of the Details section instead of floating under the whole form.
 */
export function BlindEditForm({
  draft,
  catalogs,
  onChange,
  footer,
}: {
  draft: BlindDraft;
  catalogs: Catalogs;
  onChange: (next: BlindDraft) => void;
  /** Action buttons rendered at the bottom of the Details section. */
  footer?: ReactNode;
}) {
  const price = blindDraftPrice(draft, catalogs);
  const panelSum = draft.panels.reduce((a, p) => a + (parsePositive(p) ?? 0), 0);

  function setPanel(i: number, value: string) {
    const panels = draft.panels.slice();
    panels[i] = value;
    onChange({ ...draft, panels });
  }

  function setQuantity(next: number) {
    onChange({ ...draft, quantity: String(Math.max(1, next)) });
  }

  const qty = parsePositive(draft.quantity) ?? 1;
  const stepBtn =
    'flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border-input bg-surface text-lg font-semibold text-text-secondary hover:bg-surface-sunken';

  // Blind types the dropdown offers: active ones, plus the current
  // value if it is inactive or a legacy free-text entry not in the list.
  const typeInList = catalogs.blindTypes.some((t) => t.name === draft.blinds_type);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* ── 1. Basics ───────────────────────────────────────────────── */}
      <FormSection title="Basics">
        {/* Blind type (dropdown) */}
        <label className="block min-w-0">
          <span className={LABEL}>Blind type</span>
          <select
            value={draft.blinds_type}
            onChange={(e) => {
              const blinds_type = e.target.value;
              // Drop a selected Material that isn't offered for the new type.
              const stillValid = materialsForType({ ...catalogs }, blinds_type).some(
                (m) => m.id === draft.material_id
              );
              onChange({
                ...draft,
                blinds_type,
                material_id: stillValid ? draft.material_id : '',
              });
            }}
            className={INPUT}
          >
            <option value="">Select…</option>
            {draft.blinds_type && !typeInList && (
              <option value={draft.blinds_type}>{draft.blinds_type}</option>
            )}
            {catalogs.blindTypes
              .filter((t) => t.active || t.name === draft.blinds_type)
              .map((t) => (
                <option key={t.id} value={t.name}>
                  {t.name}
                </option>
              ))}
          </select>
        </label>

        {/* Room name */}
        <label>
          <span className={LABEL}>Room</span>
          <input
            placeholder="Living Room"
            value={draft.room_name}
            onChange={(e) => onChange({ ...draft, room_name: e.target.value })}
            className={INPUT}
          />
        </label>

        {/* Width (panels 85%) + Panel button (15%) */}
        <div>
          <span className={LABEL}>
            Width (cm) — panels total:{' '}
            <span className="font-mono">{panelSum > 0 ? panelSum : '—'}</span>
          </span>
          <div className="mt-1 flex items-stretch gap-2">
            <div className="flex min-w-0 flex-1 gap-2">
              {draft.panels.map((p, i) => (
                <div key={i} className="relative min-w-0 flex-1">
                  <input
                    inputMode="decimal"
                    value={p}
                    onChange={(e) => setPanel(i, e.target.value)}
                    className="h-11 w-full rounded-md border border-border-input bg-surface px-2 text-center font-mono text-sm"
                    aria-label={`Panel ${i + 1} width`}
                  />
                  {draft.panels.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        onChange({ ...draft, panels: draft.panels.filter((_, j) => j !== i) })
                      }
                      aria-label={`Remove panel ${i + 1}`}
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border-input bg-surface text-[10px] text-text-muted hover:text-danger"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => onChange({ ...draft, panels: [...draft.panels, ''] })}
              className="h-11 w-[15%] shrink-0 rounded-sm border border-dashed border-border-input text-[13px] font-medium text-brand-600"
            >
              + Panel
            </button>
          </div>
        </div>

        {/* Height */}
        <label>
          <span className={LABEL}>Height (cm)</span>
          <input
            inputMode="decimal"
            value={draft.height_cm}
            onChange={(e) => onChange({ ...draft, height_cm: e.target.value })}
            className={`${INPUT} font-mono`}
          />
        </label>
      </FormSection>

      <FormSplitter />

      {/* ── 2. Options ──────────────────────────────────────────────── */}
      <FormSection title="Options">
        {/* Material + Color (color is free text and has no price effect;
            it is shown on the item, the PDF and the customer view) */}
        <div className="grid min-w-0 grid-cols-1 gap-3.5 sm:grid-cols-2">
          <OptionSelect
            label="Material"
            value={draft.material_id}
            onChange={(id) => onChange({ ...draft, material_id: id })}
            options={materialsForType(catalogs, draft.blinds_type)}
            placeholder={draft.blinds_type ? 'Select…' : 'Pick a blind type first'}
          />
          <label className="min-w-0">
            <span className={LABEL}>Color</span>
            <input
              placeholder="e.g. White, Oak, Charcoal"
              value={draft.color}
              onChange={(e) => onChange({ ...draft, color: e.target.value })}
              maxLength={100}
              className={INPUT}
            />
          </label>
        </div>

        {/* Cassette / Control / Bottom rail */}
        <div className="grid min-w-0 grid-cols-1 gap-3.5 sm:grid-cols-3">
          <OptionSelect
            label="Cassette"
            value={draft.cassette_id}
            onChange={(id) => onChange({ ...draft, cassette_id: id })}
            options={catalogs.cassettes}
          />
          <OptionSelect
            label="Control"
            value={draft.control_id}
            onChange={(id) => onChange({ ...draft, control_id: id })}
            options={catalogs.controls}
          />
          <OptionSelect
            label="Bottom rail"
            value={draft.bottom_rail_id}
            onChange={(id) => onChange({ ...draft, bottom_rail_id: id })}
            options={catalogs.bottomRails}
          />
        </div>
      </FormSection>

      <FormSplitter />

      {/* ── 3. Details ──────────────────────────────────────────────── */}
      <FormSection title="Details">
        {/* Note (shown to the customer under the item) */}
        <label>
          <span className={LABEL}>Note</span>
          <textarea
            value={draft.note}
            onChange={(e) => onChange({ ...draft, note: e.target.value })}
            maxLength={1000}
            rows={2}
            placeholder="e.g. Inside mount, motor on the left"
            className="w-full rounded-md border border-border-input bg-surface px-3 py-2 text-sm text-text-primary"
          />
        </label>

        {/* Quantity stepper */}
        <div>
          <span className={LABEL}>Quantity</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setQuantity(Math.floor(qty) - 1)}
              aria-label="Decrease quantity"
              className={stepBtn}
            >
              −
            </button>
            <input
              inputMode="numeric"
              value={draft.quantity}
              onChange={(e) => onChange({ ...draft, quantity: e.target.value })}
              aria-label="Quantity"
              className="h-11 w-16 rounded-md border border-border-input bg-surface px-2 text-center font-mono text-sm"
            />
            <button
              type="button"
              onClick={() => setQuantity(Math.floor(qty) + 1)}
              aria-label="Increase quantity"
              className={stepBtn}
            >
              +
            </button>
          </div>
        </div>

        <div className="flex justify-between border-t border-border-light pt-3 text-[13px]">
          <span className="text-text-muted">
            Unit: <span className="font-mono">{price ? `$${price.unit.toFixed(2)}` : '—'}</span>
          </span>
          <span className="font-semibold text-text-primary">
            Total: <span className="font-mono">{price ? `$${price.total.toFixed(2)}` : '—'}</span>
          </span>
        </div>

        {footer}
      </FormSection>
    </div>
  );
}

/** Full preset/custom editing form. */
export function FlatEditForm({
  draft,
  onChange,
}: {
  draft: FlatDraft;
  onChange: (next: FlatDraft) => void;
}) {
  const price = flatDraftPrice(draft);
  return (
    <div className="flex min-w-0 flex-col gap-3.5">
      <label className="block min-w-0">
        <span className={LABEL}>Description</span>
        <input
          placeholder="Description"
          value={draft.description}
          onChange={(e) => onChange({ ...draft, description: e.target.value })}
          className={INPUT}
        />
      </label>
      <div className="grid min-w-0 grid-cols-2 gap-3.5">
        <label className="min-w-0">
          <span className={LABEL}>Quantity</span>
          <input
            inputMode="numeric"
            value={draft.quantity}
            onChange={(e) => onChange({ ...draft, quantity: e.target.value })}
            className={`${INPUT} font-mono`}
          />
        </label>
        <label className="min-w-0">
          <span className={LABEL}>Unit price ($)</span>
          <input
            inputMode="decimal"
            value={draft.unit_price}
            onChange={(e) => onChange({ ...draft, unit_price: e.target.value })}
            className={`${INPUT} font-mono`}
          />
        </label>
      </div>
      <div className="flex justify-end border-t border-border pt-3 text-[13px]">
        <span className="font-semibold text-text-primary">
          Total: <span className="font-mono">{price ? `$${price.total.toFixed(2)}` : '—'}</span>
        </span>
      </div>
    </div>
  );
}

/**
 * Bulk-edit form — only material, cassette, bottom rail and control are
 * exposed. Each starts as "" (no change); only non-empty selections are
 * applied by the parent when the user clicks Apply. The Material list is
 * not type-filtered here because a bulk selection may span several blind
 * types; every Material is offered.
 */
export interface BulkEditState {
  material_id: string;
  cassette_id: string;
  bottom_rail_id: string;
  control_id: string;
}

export function BulkEditForm({
  state,
  catalogs,
  onChange,
}: {
  state: BulkEditState;
  catalogs: Catalogs;
  onChange: (next: BulkEditState) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3.5">
      <p className="text-[13px] text-text-muted">
        Only the selected options will be changed. Leave a field on "No change" to keep each
        item's current value.
      </p>
      <div className="grid min-w-0 grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <OptionSelect
          label="Material"
          value={state.material_id}
          onChange={(id) => onChange({ ...state, material_id: id })}
          options={catalogs.materials}
          placeholder="No change"
        />
        <OptionSelect
          label="Cassette"
          value={state.cassette_id}
          onChange={(id) => onChange({ ...state, cassette_id: id })}
          options={catalogs.cassettes}
          placeholder="No change"
        />
        <OptionSelect
          label="Bottom rail"
          value={state.bottom_rail_id}
          onChange={(id) => onChange({ ...state, bottom_rail_id: id })}
          options={catalogs.bottomRails}
          placeholder="No change"
        />
        <OptionSelect
          label="Control"
          value={state.control_id}
          onChange={(id) => onChange({ ...state, control_id: id })}
          options={catalogs.controls}
          placeholder="No change"
        />
      </div>
    </div>
  );
}
