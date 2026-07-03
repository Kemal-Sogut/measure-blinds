// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Line item editor cards for the estimate screen, plus the draft
 * models they edit.
 *
 * Drafts hold every numeric field as a string so partially-typed
 * values ("12.", "") never fight the keyboard; parsing happens in the
 * pricing helpers and at save time. Blind cards recompute unit price
 * and line total on every keystroke via the client pricing lib (the
 * Worker recomputes authoritatively on save). Dropdowns are native
 * <select> elements for the best mobile UX (plan Phase 10 item 9).
 */

import { calculateBlindUnitPrice } from '../../lib/pricing';
import type { Fabric, CassetteOption, ControlOption } from '../../types';

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
  fabric_id: string;
  cassette_id: string;
  control_id: string;
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

/** Catalog data needed to price and render blind cards. */
export interface Catalogs {
  fabrics: Fabric[];
  cassettes: CassetteOption[];
  controls: ControlOption[];
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
  const fabric = catalogs.fabrics.find((f) => f.id === draft.fabric_id);
  const cassette = catalogs.cassettes.find((x) => x.id === draft.cassette_id);
  const control = catalogs.controls.find((x) => x.id === draft.control_id);
  if (panels.some((p) => p === null) || panels.length === 0) return null;
  if (!height || !qty || !fabric || !cassette || !control) return null;

  const unit = calculateBlindUnitPrice({
    panels: panels as number[],
    height_cm: height,
    fabric_price_per_sqm: Number(fabric.price_per_sqm),
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

const INPUT = 'h-11 w-full rounded-lg border border-border bg-surface px-3 text-base';

/** Card chrome with a remove button in the corner. */
function Card({
  title,
  onRemove,
  children,
}: {
  title: string;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-elevated p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-text-secondary">{title}</span>
        <button
          onClick={onRemove}
          aria-label="Remove item"
          className="flex h-11 w-11 items-center justify-center rounded-lg text-danger hover:bg-red-50"
        >
          ✕
        </button>
      </div>
      {children}
    </div>
  );
}

/** Native select bound to active catalog options. */
function OptionSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  options: { id: string; name: string; active: boolean }[];
}) {
  return (
    <label className="min-w-0 flex-1 text-xs font-medium text-text-secondary">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`mt-1 ${INPUT}`}>
        <option value="">Select…</option>
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
/* Cards                                                               */
/* ------------------------------------------------------------------ */

/** Editor card for one blind line item with live pricing. */
export function BlindItemCard({
  draft,
  catalogs,
  onChange,
  onRemove,
}: {
  draft: BlindDraft;
  catalogs: Catalogs;
  onChange: (next: BlindDraft) => void;
  onRemove: () => void;
}) {
  const price = blindDraftPrice(draft, catalogs);
  const panelSum = draft.panels.reduce((a, p) => a + (parsePositive(p) ?? 0), 0);

  /** Updates one panel width by index. */
  function setPanel(i: number, value: string) {
    const panels = draft.panels.slice();
    panels[i] = value;
    onChange({ ...draft, panels });
  }

  return (
    <Card title="Standard Blind" onRemove={onRemove}>
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <input
            placeholder="Room name"
            value={draft.room_name}
            onChange={(e) => onChange({ ...draft, room_name: e.target.value })}
            className={INPUT}
          />
          <input
            placeholder="Blinds type"
            value={draft.blinds_type}
            onChange={(e) => onChange({ ...draft, blinds_type: e.target.value })}
            className={INPUT}
          />
        </div>

        {/* Panels */}
        <div>
          <span className="text-xs font-medium text-text-secondary">
            Panel widths (cm) — total: {panelSum > 0 ? panelSum : '—'}
          </span>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {draft.panels.map((p, i) => (
              <span key={i} className="flex items-center gap-1">
                <input
                  inputMode="decimal"
                  value={p}
                  onChange={(e) => setPanel(i, e.target.value)}
                  className="h-11 w-20 rounded-lg border border-border bg-surface px-2 text-base"
                  aria-label={`Panel ${i + 1} width`}
                />
                {draft.panels.length > 1 && (
                  <button
                    onClick={() =>
                      onChange({ ...draft, panels: draft.panels.filter((_, j) => j !== i) })
                    }
                    aria-label={`Remove panel ${i + 1}`}
                    className="flex h-11 w-8 items-center justify-center text-text-muted"
                  >
                    ✕
                  </button>
                )}
              </span>
            ))}
            <button
              onClick={() => onChange({ ...draft, panels: [...draft.panels, ''] })}
              className="h-11 rounded-lg border border-dashed border-border px-3 text-sm text-text-secondary"
            >
              + Panel
            </button>
          </div>
        </div>

        <div className="flex gap-2">
          <label className="min-w-0 flex-1 text-xs font-medium text-text-secondary">
            Height (cm)
            <input
              inputMode="decimal"
              value={draft.height_cm}
              onChange={(e) => onChange({ ...draft, height_cm: e.target.value })}
              className={`mt-1 ${INPUT}`}
            />
          </label>
          <label className="min-w-0 flex-1 text-xs font-medium text-text-secondary">
            Quantity
            <input
              inputMode="numeric"
              value={draft.quantity}
              onChange={(e) => onChange({ ...draft, quantity: e.target.value })}
              className={`mt-1 ${INPUT}`}
            />
          </label>
        </div>

        <div className="flex gap-2">
          <OptionSelect
            label="Fabric"
            value={draft.fabric_id}
            onChange={(id) => onChange({ ...draft, fabric_id: id })}
            options={catalogs.fabrics}
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

        <div className="flex justify-between rounded-lg bg-surface px-3 py-2 text-sm">
          <span className="text-text-muted">
            Unit: {price ? `$${price.unit.toFixed(2)}` : '—'}
          </span>
          <span className="font-semibold text-text-primary">
            Total: {price ? `$${price.total.toFixed(2)}` : '—'}
          </span>
        </div>
      </div>
    </Card>
  );
}

/** Editor card for a preset or custom line item. */
export function FlatItemCard({
  draft,
  onChange,
  onRemove,
}: {
  draft: FlatDraft;
  onChange: (next: FlatDraft) => void;
  onRemove: () => void;
}) {
  const price = flatDraftPrice(draft);
  return (
    <Card title={draft.item_type === 'preset' ? 'Preset Item' : 'Custom Item'} onRemove={onRemove}>
      <div className="flex flex-col gap-2">
        <input
          placeholder="Description"
          value={draft.description}
          onChange={(e) => onChange({ ...draft, description: e.target.value })}
          className={INPUT}
        />
        <div className="flex gap-2">
          <label className="min-w-0 flex-1 text-xs font-medium text-text-secondary">
            Quantity
            <input
              inputMode="numeric"
              value={draft.quantity}
              onChange={(e) => onChange({ ...draft, quantity: e.target.value })}
              className={`mt-1 ${INPUT}`}
            />
          </label>
          <label className="min-w-0 flex-1 text-xs font-medium text-text-secondary">
            Unit price ($)
            <input
              inputMode="decimal"
              value={draft.unit_price}
              onChange={(e) => onChange({ ...draft, unit_price: e.target.value })}
              className={`mt-1 ${INPUT}`}
            />
          </label>
        </div>
        <div className="flex justify-end rounded-lg bg-surface px-3 py-2 text-sm">
          <span className="font-semibold text-text-primary">
            Total: {price ? `$${price.total.toFixed(2)}` : '—'}
          </span>
        </div>
      </div>
    </Card>
  );
}
