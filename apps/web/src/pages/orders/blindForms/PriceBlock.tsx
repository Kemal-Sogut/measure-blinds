// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * The price section at the foot of every line-item edit form: the
 * calculated price, the override that may replace it, the add-on list,
 * and the resulting totals.
 *
 * Shared by all eleven blind forms and by `FlatEditForm` — one control
 * rather than two, because an override that behaved differently on a
 * curtain than on a custom item would be a bug nobody could see. It reads
 * and writes only the three adjustment fields, so it needs no knowledge
 * of which kind of item it is editing.
 *
 * The calculated price is shown ALWAYS, including while an override is in
 * effect: a consultant discounting a line has to be able to see what they
 * are discounting from. `canOverride` false hides the override controls
 * entirely (custom items and legacy presets price themselves) while
 * leaving add-ons available.
 *
 * Replaces the old `PriceReadout` from `fields.tsx`, which showed the
 * same totals but could not edit anything.
 *
 * Every container carries `min-w-0` for the reason documented in
 * `fields.tsx`: without it one long label can push the popup past the
 * edge of a phone screen.
 */

import { INPUT, LABEL } from './fields';
import type { DraftAddon, DraftPrice, PriceAdjustmentDraft } from '../lineItemDrafts';

/** The server's cap; the add-on button disables rather than 400s. */
const MAX_ADDONS = 10;

/**
 * Monotonic key source for newly added add-on rows. Module-level because
 * a key only has to be unique within the list it is rendered into, and a
 * per-component counter would restart on every popup open and collide
 * with rows already carrying those keys.
 */
let addonSeq = 0;
function nextAddonKey(): string {
  addonSeq += 1;
  return `addon-${addonSeq}`;
}

/** Formats a figure for display, or an em dash when not yet priceable. */
function show(n: number | undefined): string {
  return n === undefined ? '—' : `$${n.toFixed(2)}`;
}

export function PriceBlock({
  price,
  adjustments,
  canOverride,
  onChange,
}: {
  price: DraftPrice | null;
  adjustments: PriceAdjustmentDraft;
  canOverride: boolean;
  onChange: (next: PriceAdjustmentDraft) => void;
}) {
  const overridden = adjustments.unit_price_override.trim() !== '';

  function setAddon(key: string, patch: Partial<DraftAddon>) {
    onChange({
      ...adjustments,
      addons: adjustments.addons.map((a) => (a.key === key ? { ...a, ...patch } : a)),
    });
  }

  return (
    <div className="flex min-w-0 flex-col gap-3 border-t border-border-light pt-3">
      {canOverride && (
        <div className="flex min-w-0 flex-col gap-2">
          <div className="grid min-w-0 grid-cols-2 gap-3">
            <div className="min-w-0">
              <span className={LABEL}>Calculated price</span>
              <p className="h-11 rounded-md border border-border-light bg-surface-sunken px-3 py-3 font-mono text-sm text-text-muted">
                {show(price?.base)}
              </p>
            </div>
            <label className="min-w-0">
              <span className={LABEL}>Override ($)</span>
              <input
                inputMode="decimal"
                placeholder="No override"
                value={adjustments.unit_price_override}
                onChange={(e) => onChange({ ...adjustments, unit_price_override: e.target.value })}
                className={`${INPUT} font-mono`}
              />
            </label>
          </div>
          {overridden && (
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-[13px] text-text-secondary">
                <input
                  type="checkbox"
                  checked={adjustments.show_original_price}
                  onChange={(e) =>
                    onChange({ ...adjustments, show_original_price: e.target.checked })
                  }
                  className="h-4 w-4 rounded-sm accent-brand-600"
                />
                Show original price to customer
              </label>
              <button
                type="button"
                onClick={() => onChange({ ...adjustments, unit_price_override: '' })}
                className="rounded-md border border-border-input px-2.5 py-1.5 text-[13px] text-text-secondary hover:bg-surface-sunken"
              >
                Reset to calculated
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex min-w-0 flex-col gap-2">
        <span className={LABEL}>Add-ons</span>
        {adjustments.addons.map((addon) => (
          <div key={addon.key} className="flex min-w-0 items-center gap-2">
            <input
              placeholder="What is it?"
              value={addon.label}
              onChange={(e) => setAddon(addon.key, { label: e.target.value })}
              aria-label="Add-on description"
              className={INPUT}
            />
            <input
              inputMode="decimal"
              placeholder="0.00"
              value={addon.price}
              onChange={(e) => setAddon(addon.key, { price: e.target.value })}
              aria-label="Add-on price"
              className={`${INPUT} w-24 shrink-0 font-mono`}
            />
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...adjustments,
                  addons: adjustments.addons.filter((a) => a.key !== addon.key),
                })
              }
              aria-label={`Remove add-on ${addon.label}`.trim()}
              className="h-11 w-11 shrink-0 rounded-md border border-border-input text-lg text-text-secondary hover:bg-surface-sunken"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          disabled={adjustments.addons.length >= MAX_ADDONS}
          onClick={() =>
            onChange({
              ...adjustments,
              addons: [...adjustments.addons, { key: nextAddonKey(), label: '', price: '' }],
            })
          }
          className="self-start rounded-md border border-border-input px-2.5 py-1.5 text-[13px] text-text-secondary hover:bg-surface-sunken disabled:opacity-50"
        >
          + Add add-on
        </button>
      </div>

      <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-border-light pt-3 text-[13px]">
        <span className="text-text-muted">
          Unit: <span className="font-mono">{show(price?.unit)}</span>
        </span>
        {price && price.addonsTotal > 0 && (
          <span className="text-text-muted">
            Add-ons: <span className="font-mono">{show(price.addonsTotal)}</span>
          </span>
        )}
        <span className="font-semibold text-text-primary">
          Total: <span className="font-mono">{show(price?.total)}</span>
        </span>
      </div>
    </div>
  );
}
