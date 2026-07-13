// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Line item draft models, pricing helpers, and edit-form components.
 *
 * The old inline BlindItemCard / FlatItemCard have been replaced by
 * BlindEditForm and FlatEditForm which live inside popup modals rather
 * than expanded inline in the page.  BulkEditForm lets the user change
 * only material, cassette, and control across all selected blind items
 * without touching any measurement or quantity fields.
 *
 * Drafts hold every numeric field as a string so partially-typed values
 * ("12.", "") never fight the keyboard; parsing happens in the pricing
 * helpers and at save time.
 */

import { calculateBlindUnitPriceForType } from '../../lib/pricing';
import type { Material, CassetteOption, ControlOption, BlindType } from '../../types';

/* ------------------------------------------------------------------ */
/* Draft models                                                        */
/* ------------------------------------------------------------------ */

/** Editable state of one blind line item (strings for free typing). */
export interface BlindDraft {
  key: string;
  item_type: 'blind';
  room_name: string;
  blinds_type: string;
  panels: string[];
  height_cm: string;
  material_id: string;
  cassette_id: string;
  control_id: string;
  color: string;
  note: string;
  quantity: string;
}

/** Editable state of one preset/custom line item. */
export interface FlatDraft {
  key: string;
  item_type: 'preset' | 'custom';
  description: string;
  quantity: string;
  unit_price: string;
}

export type ItemDraft = BlindDraft | FlatDraft;

/** Catalog data needed to price and render blind forms. */
export interface Catalogs {
  materials: Material[];
  cassettes: CassetteOption[];
  controls: ControlOption[];
  blindTypes: BlindType[];
}

/**
 * Materials available for a given blind type name. Materials are scoped
 * per type (managed under Settings → Materials → <type>): only those
 * LINKED to the selected type are offered. When no type is selected yet
 * (or the name is unknown/legacy free-text), an empty list is returned
 * so the user must pick a blind type first.
 */
export function materialsForType(catalogs: Catalogs, blindsType: string): Material[] {
  const typeId = catalogs.blindTypes.find((t) => t.name === blindsType)?.id;
  if (!typeId) return [];
  return catalogs.materials.filter((m) => m.blind_type_ids.includes(typeId));
}

/** Parses a positive number from a draft string; null when invalid. */
export function parsePositive(value: string): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Live price preview for a blind draft. Returns null until every
 * required field (panels, height, all three options) is filled.
 */
export function blindDraftPrice(
  draft: BlindDraft,
  catalogs: Catalogs
): { unit: number; total: number } | null {
  const panels = draft.panels.map(parsePositive);
  const height = parsePositive(draft.height_cm);
  const qty = parsePositive(draft.quantity);
  const material = catalogs.materials.find((m) => m.id === draft.material_id);
  const cassette = catalogs.cassettes.find((x) => x.id === draft.cassette_id);
  const control = catalogs.controls.find((x) => x.id === draft.control_id);
  if (panels.some((p) => p === null) || panels.length === 0) return null;
  if (!height || !qty || !material || !cassette || !control) return null;

  // Dispatch to the selected blind type's calculator (default fallback).
  const unit = calculateBlindUnitPriceForType(draft.blinds_type, {
    panels: panels as number[],
    height_cm: height,
    material_price_per_sqm: Number(material.price_per_sqm),
    cassette_price_per_m: Number(cassette.price_per_m),
    control_price_per_item: Number(control.price_per_item),
    quantity: qty,
  });
  return { unit, total: Math.round(unit * qty * 100) / 100 };
}

/** Live price preview for a preset/custom draft; null until valid. */
export function flatDraftPrice(draft: FlatDraft): { unit: number; total: number } | null {
  const qty = parsePositive(draft.quantity);
  const unit = Number(draft.unit_price);
  if (!qty || !Number.isFinite(unit) || unit < 0) return null;
  const rounded = Math.round(unit * 100) / 100;
  return { unit: rounded, total: Math.round(rounded * qty * 100) / 100 };
}

/* ------------------------------------------------------------------ */
/* Shared UI bits                                                      */
/* ------------------------------------------------------------------ */

const INPUT =
  'h-11 w-full rounded-sm border border-border-input bg-surface px-3 text-sm text-text-primary';
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

/* ------------------------------------------------------------------ */
/* Edit forms (used inside popup modals)                               */
/* ------------------------------------------------------------------ */

/**
 * Full blind editing form — all fields: room, type, panels, height,
 * quantity, material, cassette, control + live pricing footer.
 * Designed to be embedded inside a modal; does not include its own
 * save/cancel buttons.
 */
export function BlindEditForm({
  draft,
  catalogs,
  onChange,
}: {
  draft: BlindDraft;
  catalogs: Catalogs;
  onChange: (next: BlindDraft) => void;
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
    'flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border border-border-input bg-surface text-lg font-semibold text-text-secondary hover:bg-surface-sunken';

  // Blind types the dropdown offers: active ones, plus the current
  // value if it is inactive or a legacy free-text entry not in the list.
  const typeInList = catalogs.blindTypes.some((t) => t.name === draft.blinds_type);

  return (
    <div className="flex flex-col gap-3.5">
      {/* Blind type (dropdown) */}
      <label>
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
                  className="h-11 w-full rounded-sm border border-border-input bg-surface px-2 text-center font-mono text-sm"
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

      {/* Material / Cassette / Control */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <OptionSelect
          label="Material"
          value={draft.material_id}
          onChange={(id) => onChange({ ...draft, material_id: id })}
          options={materialsForType(catalogs, draft.blinds_type)}
          placeholder={draft.blinds_type ? 'Select…' : 'Pick a blind type first'}
        />
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
      </div>

      {/* Color (free text, no price effect; shown on the item, PDF & customer view) */}
      <label>
        <span className={LABEL}>Color</span>
        <input
          placeholder="e.g. White, Oak, Charcoal"
          value={draft.color}
          onChange={(e) => onChange({ ...draft, color: e.target.value })}
          maxLength={100}
          className={INPUT}
        />
      </label>

      {/* Note (shown to the customer under the item) */}
      <label>
        <span className={LABEL}>Note</span>
        <textarea
          value={draft.note}
          onChange={(e) => onChange({ ...draft, note: e.target.value })}
          maxLength={1000}
          rows={2}
          placeholder="e.g. Inside mount, motor on the left"
          className="w-full rounded-sm border border-border-input bg-surface px-3 py-2 text-sm text-text-primary"
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
            className="h-11 w-16 rounded-sm border border-border-input bg-surface px-2 text-center font-mono text-sm"
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

      <div className="flex justify-between border-t border-border pt-3 text-[13px]">
        <span className="text-text-muted">
          Unit: <span className="font-mono">{price ? `$${price.unit.toFixed(2)}` : '—'}</span>
        </span>
        <span className="font-semibold text-text-primary">
          Total: <span className="font-mono">{price ? `$${price.total.toFixed(2)}` : '—'}</span>
        </span>
      </div>
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
    <div className="flex flex-col gap-3.5">
      <label>
        <span className={LABEL}>Description</span>
        <input
          placeholder="Description"
          value={draft.description}
          onChange={(e) => onChange({ ...draft, description: e.target.value })}
          className={INPUT}
        />
      </label>
      <div className="grid grid-cols-2 gap-3.5">
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
 * Bulk-edit form — only material, cassette and control are exposed.
 * Each starts as "" (no change); only non-empty selections are applied
 * by the parent when the user clicks Apply. The Material list is not
 * type-filtered here because a bulk selection may span several blind
 * types; every Material is offered.
 */
export interface BulkEditState {
  material_id: string;
  cassette_id: string;
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
    <div className="flex flex-col gap-3.5">
      <p className="text-[13px] text-text-muted">
        Only the selected options will be changed. Leave a field on "No change" to keep each
        item's current value.
      </p>
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
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
