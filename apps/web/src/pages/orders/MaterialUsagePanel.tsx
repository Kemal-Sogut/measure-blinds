// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Internal Material usage panel for the order editor — never shown to a
 * customer, never printed, and absent from the PDF and the public view.
 *
 * Answers the question a discount is actually decided on: how many square
 * metres (or running metres, for Curtains) of each material is this order,
 * at what rate, and what does giving back $X per metre come to. The
 * resulting figure is written into the order's existing FIXED discount —
 * there is no stored per-m² discount type, so the rate itself is
 * scratchpad state that does not survive a reload. The panel says so on
 * screen rather than letting anyone assume otherwise.
 *
 * Every figure comes from `summarizeMaterialUsage`; no area, quantity or
 * price basis is ever re-derived here. The component only sums
 * pre-aggregated per-unit totals and subtracts a give-back rate from a
 * catalog rate — display arithmetic on scalars `materialUsage.ts` already
 * computed, not a second pricing path.
 */

import { useMemo } from 'react';
import type { MaterialUnit } from '../../lib/blindTypes';
import type { Catalogs, ItemDraft } from './lineItemDrafts';
import { giveBackAmount, summarizeMaterialUsage } from './materialUsage';

/** Short label for a rate unit, used in headers, totals and inputs. */
const UNIT_LABEL: Record<MaterialUnit, string> = {
  sqm: 'm²',
  running_m: 'm',
};

/**
 * Props for {@link MaterialUsagePanel}.
 *
 * `sqmRate` and `runningRate` are LIFTED into the parent (`OrderDetail`,
 * beside `discountValue`) rather than held as local state, because this
 * JSX is rendered at two breakpoints (`OrderDetail.tsx`'s desktop rail
 * and mobile totals card) that the CSS merely hides with `xl:hidden` /
 * `hidden xl:flex` — both instances stay mounted. Local state would give
 * each breakpoint its own independent copy, so a rate typed at one width
 * silently vanishes when the viewport crosses the breakpoint. Do not
 * push these back down into local `useState`; that regression is exactly
 * what lifting them fixed.
 */
export interface MaterialUsagePanelProps {
  /** The editor's current drafts, hidden ones included — the panel filters. */
  items: ItemDraft[];
  /**
   * The live catalog cache (materials, blind types, etc.), the same one
   * the rest of the line-item editor reads. The panel reports TODAY'S
   * rate from this cache, not a stored snapshot from when the order's
   * lines were priced — a material's rate can have moved since.
   */
  catalogs: Catalogs;
  /**
   * Give-back rate for `sqm`-priced materials, held as a raw string (see
   * `parseRate`) so a half-typed "5." does not fight the keyboard.
   * Controlled by the parent per the lifting note above.
   */
  sqmRate: string;
  onSqmRateChange: (value: string) => void;
  /**
   * Give-back rate for `running_m`-priced materials (Curtains). Same
   * raw-string contract as `sqmRate`.
   */
  runningRate: string;
  onRunningRateChange: (value: string) => void;
  /** Sets the order's fixed discount to this dollar amount. */
  onApplyDiscount: (amount: number) => void;
}

/**
 * Parses a rate input, which is held as a raw string like every other
 * numeric field in the editor so a half-typed "5." does not fight the
 * keyboard. Anything unusable reads as "no rate", never as zero-with-intent.
 */
function parseRate(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Collapsible material breakdown with a give-back calculator. Renders
 * nothing at all when no visible line carries material, so an order of
 * preset items does not grow an empty panel.
 */
export function MaterialUsagePanel({
  items,
  catalogs,
  sqmRate,
  onSqmRateChange,
  runningRate,
  onRunningRateChange,
  onApplyDiscount,
}: MaterialUsagePanelProps) {
  const summary = useMemo(() => summarizeMaterialUsage(items, catalogs), [items, catalogs]);

  const rates = useMemo(
    () => ({
      sqm: parseRate(sqmRate) ?? undefined,
      running_m: parseRate(runningRate) ?? undefined,
    }),
    [sqmRate, runningRate]
  );

  const giveBack = useMemo(() => giveBackAmount(summary, rates), [summary, rates]);

  if (summary.rows.length === 0) return null;

  // The units this order actually uses, paired with their figures, so the
  // JSX below never has to assert a Partial<Record> lookup is present.
  const usedUnits = (['sqm', 'running_m'] as MaterialUnit[]).flatMap((unit) => {
    const figures = summary.totals[unit];
    return figures ? [{ unit, figures }] : [];
  });
  const hasSqm = usedUnits.some((u) => u.unit === 'sqm');
  const hasRunning = usedUnits.some((u) => u.unit === 'running_m');
  const totalAmount = usedUnits.reduce((sum, u) => sum + u.figures.amount, 0);
  const summaryLine = usedUnits
    .map(({ unit, figures }) => `${figures.quantity.toFixed(2)} ${UNIT_LABEL[unit]}`)
    .join(' · ');
  // True when the give-back rate for ANY row exceeds that row's own
  // catalog rate — the give-back would exceed that row's entire fabric
  // revenue, which is worth calling out even though Apply stays enabled.
  const exceedsRate = summary.rows.some((row) => {
    const rate = rates[row.unit];
    return rate !== undefined && rate > row.rate;
  });

  return (
    <details className="rounded-sm border border-border-light bg-surface-sunken">
      <summary className="cursor-pointer select-none px-3 py-2 text-[13px] text-text-secondary">
        Material usage · {summaryLine}
      </summary>

      <div className="flex flex-col gap-3 border-t border-border-light px-3 py-3">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-text-secondary">
                <th className="pb-1 text-left font-normal">Material</th>
                <th className="pb-1 text-right font-normal">Qty</th>
                <th className="pb-1 text-right font-normal">Rate</th>
                <th className="pb-1 text-right font-normal">Material $</th>
              </tr>
            </thead>
            <tbody>
              {summary.rows.map((row) => {
                const rate = rates[row.unit];
                const effective = rate ? Math.max(0, row.rate - rate) : null;
                return (
                  <tr key={`${row.materialId}-${row.unit}`} className="border-t border-border-light">
                    <td className="py-1.5 pr-2 wrap-anywhere text-text-primary">{row.materialName}</td>
                    <td className="py-1.5 text-right font-mono text-text-primary">
                      {row.quantity.toFixed(2)} {UNIT_LABEL[row.unit]}
                    </td>
                    {/* The effective rate after the give-back is the margin
                        question being asked, so it is answered in place
                        rather than left as arithmetic for the reader. */}
                    <td className="py-1.5 text-right font-mono text-text-primary">
                      {effective === null ? (
                        `$${row.rate.toFixed(2)}`
                      ) : (
                        <>
                          <span className="text-text-secondary line-through">
                            ${row.rate.toFixed(2)}
                          </span>{' '}
                          ${effective.toFixed(2)}
                        </>
                      )}
                    </td>
                    <td className="py-1.5 text-right font-mono text-text-primary">
                      ${row.amount.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-border-light">
                <td className="pt-1.5 text-text-secondary">Total</td>
                <td className="pt-1.5 text-right font-mono text-text-primary">{summaryLine}</td>
                <td />
                <td className="pt-1.5 text-right font-mono text-text-primary">
                  ${totalAmount.toFixed(2)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {exceedsRate && (
          <p className="text-[12px] text-text-secondary">
            The give-back exceeds the fabric rate on at least one material.
          </p>
        )}

        {/* How much of the billed quantity is minimum inflation rather
            than fabric the customer had. Shown only when it is non-zero,
            because on an order of full-size blinds it is just noise. */}
        {usedUnits.map(({ unit, figures }) => {
          const added = figures.quantity - figures.measured;
          if (added < 0.005) return null;
          return (
            <p key={unit} className="text-[12px] text-text-secondary">
              measured {figures.measured.toFixed(2)} {UNIT_LABEL[unit]} · minimums added{' '}
              {added.toFixed(2)} {UNIT_LABEL[unit]}
            </p>
          );
        })}

        {summary.excludedCount > 0 && (
          <p className="text-[12px] text-text-secondary">
            {summary.excludedCount} item{summary.excludedCount === 1 ? '' : 's'} carry no material
            (preset, custom, or incomplete).
          </p>
        )}

        <div className="flex flex-wrap items-end gap-2 border-t border-border-light pt-3">
          {hasSqm && (
            <label className="flex flex-col gap-1">
              <span className="text-[12px] text-text-secondary">Give back $ / m²</span>
              <input
                inputMode="decimal"
                value={sqmRate}
                onChange={(e) => onSqmRateChange(e.target.value)}
                placeholder="0.00"
                className="h-9 w-24 rounded-sm border border-border-input bg-surface px-2 text-right font-mono text-[13px]"
              />
            </label>
          )}
          {hasRunning && (
            <label className="flex flex-col gap-1">
              <span className="text-[12px] text-text-secondary">Give back $ / m</span>
              <input
                inputMode="decimal"
                value={runningRate}
                onChange={(e) => onRunningRateChange(e.target.value)}
                placeholder="0.00"
                className="h-9 w-24 rounded-sm border border-border-input bg-surface px-2 text-right font-mono text-[13px]"
              />
            </label>
          )}
          <button
            type="button"
            disabled={giveBack <= 0}
            onClick={() => onApplyDiscount(giveBack)}
            className="h-9 rounded-sm border border-border-input px-3 text-[13px] font-medium text-text-primary disabled:opacity-40"
          >
            Apply ${giveBack.toFixed(2)}
          </button>
        </div>

        <p className="text-[12px] text-text-secondary">
          Applying sets the order's fixed discount. The rate itself is not saved, and the give-back
          is calculated on fabric but applied to the whole subtotal.
        </p>
      </div>
    </details>
  );
}
