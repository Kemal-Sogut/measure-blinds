// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Internal Material usage dialog for the order editor — never shown to a
 * customer, never printed, and absent from the PDF and the public view.
 *
 * Answers the question a discount is actually decided on: how many square
 * metres (or running metres, for Curtains) of each material is this order,
 * at what rate, and what does charging less per metre come to. Two
 * instruments sit side by side because they do different jobs:
 *
 * - PER MATERIAL (one editor per row). Type a lower rate for ONE material
 *   and Apply adds `(catalog rate − your rate) × that material's billed
 *   quantity` to the order's discount. The precise instrument.
 * - ACROSS THE ORDER (the give-back row at the bottom). One $/metre figure
 *   over EVERY material at once. The blunt instrument, and the original
 *   behaviour of this panel — "take $5/m² off the whole job" is still how
 *   most quotes get closed.
 *
 * BOTH ARE PURE DISCOUNT MATH. Neither touches a line item: no unit price
 * is overridden, no line is repriced, and nothing a consultant typed into
 * a line is at risk from using this. Every Apply composes into the order's
 * single FIXED discount through `applyGiveBackPart`, which is additive — a
 * second Apply sits on top of the first rather than replacing it,
 * re-applying one row swaps that row's own figure, and Reset takes exactly
 * that row's figure back out. Applying a per-material rate AND an
 * order-wide rate that covers the same fabric does discount it twice, so
 * the dialog says so on screen.
 *
 * It is a dialog rather than an inline panel because the summary rail is
 * roughly 280px wide: a table with a per-row editor and two buttons in it
 * was unreadable there. The rail keeps only {@link MaterialUsageTrigger},
 * a one-line summary that opens this.
 *
 * Every quantity, rate and dollar figure comes from `materialUsage.ts`;
 * no area, quantity or price basis is re-derived here. The component
 * renders pre-computed scalars and owns no arithmetic of its own beyond
 * formatting.
 */

import { useMemo } from 'react';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import type { MaterialUnit } from '../../lib/blindTypes';
import {
  giveBackAmount,
  materialRowKey,
  rowGiveBack,
  ORDER_WIDE_GIVE_BACK,
  type MaterialUsageSummary,
} from './materialUsage';

/** Short label for a rate unit, used in headers, totals and inputs. */
const UNIT_LABEL: Record<MaterialUnit, string> = {
  sqm: 'm²',
  running_m: 'm',
};

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

/** Renders `n` with the right plural, so no row reads "1 lines". */
function lines(n: number): string {
  return `${n} line${n === 1 ? '' : 's'}`;
}

/**
 * The units this order actually uses, paired with their figures, so no
 * caller has to assert a `Partial<Record>` lookup is present.
 */
function usedUnitsOf(summary: MaterialUsageSummary) {
  return (['sqm', 'running_m'] as MaterialUnit[]).flatMap((unit) => {
    const figures = summary.totals[unit];
    return figures ? [{ unit, figures }] : [];
  });
}

/** The one-line summary of every rate unit the order uses. */
function summaryLineOf(summary: MaterialUsageSummary): string {
  return usedUnitsOf(summary)
    .map(({ unit, figures }) => `${figures.quantity.toFixed(2)} ${UNIT_LABEL[unit]}`)
    .join(' · ');
}

/**
 * The rail's entry point: a single row showing the order's total fabric
 * quantity, which opens {@link MaterialUsageDialog}.
 *
 * Renders nothing at all when no visible line carries material, so an
 * order of preset items does not grow an empty control.
 *
 * Safe to render at more than one breakpoint (`OrderDetail.tsx` renders
 * it in both the mobile totals card and the desktop rail) because it
 * holds NO state — the open flag and every rate live in the parent. The
 * dialog itself must be rendered exactly ONCE, or an open dialog would
 * appear twice, stacked.
 */
export function MaterialUsageTrigger({
  summary,
  onOpen,
}: {
  summary: MaterialUsageSummary;
  onOpen: () => void;
}) {
  if (summary.rows.length === 0) return null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-11 w-full items-center justify-between gap-2 rounded-sm border border-border-light bg-surface-sunken px-3 text-left text-[13px] text-text-secondary hover:bg-surface"
    >
      <span>Material usage</span>
      <span className="flex items-center gap-1 font-mono text-text-primary">
        {summaryLineOf(summary)}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </span>
    </button>
  );
}

/**
 * Props for {@link MaterialUsageDialog}.
 *
 * Every piece of state is LIFTED into the parent (`OrderDetail`, beside
 * `discountValue`) rather than held here, for two independent reasons.
 * `Modal` unmounts its children when closed, so local state would be
 * silently wiped every time the dialog was dismissed — including the
 * record of what each row has already contributed to the discount. And
 * the trigger renders at two breakpoints that CSS merely hides, so
 * anything shared between them has to live above both. Do not push these
 * back down into `useState`.
 */
export interface MaterialUsageDialogProps {
  open: boolean;
  onClose: () => void;
  /**
   * Pre-aggregated usage, computed once by the parent for both surfaces.
   * Its rates are TODAY'S catalog rates, not a stored snapshot from when
   * the order's lines were priced — a material's rate can have moved.
   */
  summary: MaterialUsageSummary;
  /**
   * Per-material rate inputs keyed by {@link materialRowKey}, as raw
   * strings. A key that is ABSENT means "untouched", which is what lets
   * each box fall back to the catalog rate without the parent having to
   * seed anything.
   */
  rateDrafts: Record<string, string>;
  onRateDraftChange: (key: string, value: string) => void;
  /**
   * What each row has already added to the discount, keyed the same way
   * (plus {@link ORDER_WIDE_GIVE_BACK}). Read-only here — the parent owns
   * the composition, this only reports and offers to change it.
   */
  appliedParts: Record<string, number>;
  /**
   * Composes `amount` into the order's fixed discount under `key`,
   * replacing whatever that key contributed before. `0` removes the
   * contribution — that is what the reset button sends.
   */
  onApplyGiveBack: (key: string, amount: number) => void;
  /**
   * Order-wide give-back rate for `sqm`-priced materials, held as a raw
   * string for the same reason the per-material ones are.
   */
  sqmRate: string;
  onSqmRateChange: (value: string) => void;
  /** Order-wide give-back rate for `running_m` materials (Curtains). */
  runningRate: string;
  onRunningRateChange: (value: string) => void;
  /**
   * True when the order's discount is currently a PERCENTAGE. Applying
   * anything here switches it to a fixed dollar figure, which discards
   * the percentage — worth saying out loud before it happens.
   */
  discountIsPercent: boolean;
}

/**
 * The material breakdown, its per-material rate editors, and the
 * order-wide give-back calculator.
 */
export function MaterialUsageDialog({
  open,
  onClose,
  summary,
  rateDrafts,
  onRateDraftChange,
  appliedParts,
  onApplyGiveBack,
  sqmRate,
  onSqmRateChange,
  runningRate,
  onRunningRateChange,
  discountIsPercent,
}: MaterialUsageDialogProps) {
  const rates = useMemo(
    () => ({
      sqm: parseRate(sqmRate) ?? undefined,
      running_m: parseRate(runningRate) ?? undefined,
    }),
    [sqmRate, runningRate]
  );

  const orderWideGiveBack = useMemo(() => giveBackAmount(summary, rates), [summary, rates]);

  // A material scoped to both Curtains and a m²-priced type is TWO rows
  // under one name. Left unqualified they read as a duplicate row rather
  // than as two rate bases, so those names — and only those — carry the
  // unit in the heading.
  const ambiguousNames = useMemo(() => {
    const seen = new Set<string>();
    const twice = new Set<string>();
    for (const row of summary.rows) {
      if (seen.has(row.materialName)) twice.add(row.materialName);
      seen.add(row.materialName);
    }
    return twice;
  }, [summary.rows]);

  const usedUnits = usedUnitsOf(summary);
  const hasSqm = usedUnits.some((u) => u.unit === 'sqm');
  const hasRunning = usedUnits.some((u) => u.unit === 'running_m');
  const totalAmount = usedUnits.reduce((sum, u) => sum + u.figures.amount, 0);
  const anyMaterialApplied = summary.rows.some(
    (row) => (appliedParts[materialRowKey(row.materialId, row.unit)] ?? 0) > 0
  );
  const orderWideApplied = appliedParts[ORDER_WIDE_GIVE_BACK] ?? 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Material usage"
      subtitle="Internal only — never printed or shown to the customer."
      footer={
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        {summary.rows.map((row) => {
          const key = materialRowKey(row.materialId, row.unit);
          const draft = rateDrafts[key] ?? row.rate.toFixed(2);
          const typed = parseRate(draft);
          const applied = appliedParts[key] ?? 0;
          const pending = typed === null ? 0 : rowGiveBack(row, typed);
          const above = typed !== null && typed > row.rate;
          // Nothing to put back when the box still reads the catalog rate
          // and this row has contributed nothing.
          const dirty = draft !== row.rate.toFixed(2) || applied > 0;

          return (
            <section
              key={key}
              className="flex flex-col gap-2 rounded-md border border-border-light bg-surface-sunken p-3"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 wrap-anywhere text-sm font-semibold text-text-primary">
                  {row.materialName}
                  {ambiguousNames.has(row.materialName) && (
                    <span className="font-normal text-text-secondary">
                      {' '}
                      · {row.unit === 'sqm' ? 'square metres' : 'running metres'}
                    </span>
                  )}
                </span>
                <span className="shrink-0 font-mono text-[13px] text-text-primary">
                  {row.quantity.toFixed(2)} {UNIT_LABEL[row.unit]}
                </span>
              </div>

              <p className="text-[12px] text-text-secondary">
                ${row.amount.toFixed(2)} fabric at ${row.rate.toFixed(2)} / {UNIT_LABEL[row.unit]} ·{' '}
                {lines(row.lineCount)}
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5">
                  <span className="text-[12px] text-text-secondary">$ / {UNIT_LABEL[row.unit]}</span>
                  <span className="relative inline-flex items-center">
                    <input
                      inputMode="decimal"
                      value={draft}
                      onChange={(e) => onRateDraftChange(key, e.target.value)}
                      aria-label={`${row.materialName} rate per ${UNIT_LABEL[row.unit]}`}
                      className="h-9 w-28 rounded-sm border border-border-input bg-surface py-0 pl-2 pr-8 text-right font-mono text-[13px]"
                    />
                    {/* Sits INSIDE the box, so "put it back" is where the
                        value being changed is rather than in the button
                        row where it would read as another Apply. */}
                    <button
                      type="button"
                      disabled={!dirty}
                      title={`Reset to the catalog rate of $${row.rate.toFixed(2)}`}
                      // Carries the unit unconditionally: a dual-scoped
                      // material is two rows, and two buttons with one
                      // accessible name are indistinguishable to a screen
                      // reader even when the visible heading disambiguates.
                      aria-label={`Reset ${row.materialName} (per ${UNIT_LABEL[row.unit]}) to the catalog rate`}
                      onClick={() => {
                        onRateDraftChange(key, row.rate.toFixed(2));
                        onApplyGiveBack(key, 0);
                      }}
                      className="absolute right-1 flex h-7 w-7 items-center justify-center rounded-sm text-text-muted hover:bg-surface-sunken disabled:opacity-30"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path
                          d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  </span>
                </label>

                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending <= 0}
                  // Named for the same reason the reset button is: several
                  // rows can legitimately offer the same dollar figure.
                  aria-label={`Discount ${row.materialName} per ${UNIT_LABEL[row.unit]} by $${pending.toFixed(2)}`}
                  onClick={() => onApplyGiveBack(key, pending)}
                >
                  Discount ${pending.toFixed(2)}
                </Button>
              </div>

              {above && (
                <p className="text-[12px] text-text-secondary">
                  Above the catalog rate — this dialog only discounts, so there is nothing to
                  apply.
                </p>
              )}
              {applied > 0 && (
                <p className="text-[12px] text-success">
                  Adding ${applied.toFixed(2)} to the discount.
                </p>
              )}
            </section>
          );
        })}

        <div className="flex items-baseline justify-between gap-3 px-1 text-[13px]">
          <span className="text-text-secondary">Total</span>
          <span className="font-mono text-text-primary">
            {summaryLineOf(summary)} · ${totalAmount.toFixed(2)}
          </span>
        </div>

        {/* How much of the billed quantity is minimum inflation rather
            than fabric the customer had. Shown only when it is non-zero,
            because on an order of full-size blinds it is just noise. */}
        {usedUnits.map(({ unit, figures }) => {
          const added = figures.quantity - figures.measured;
          if (added < 0.005) return null;
          return (
            <p key={unit} className="px-1 text-[12px] text-text-secondary">
              measured {figures.measured.toFixed(2)} {UNIT_LABEL[unit]} · minimums added{' '}
              {added.toFixed(2)} {UNIT_LABEL[unit]}
            </p>
          );
        })}

        {summary.excludedCount > 0 && (
          <p className="px-1 text-[12px] text-text-secondary">
            {summary.excludedCount} item{summary.excludedCount === 1 ? '' : 's'} carry no material
            (preset, custom, or incomplete).
          </p>
        )}

        <section className="flex flex-col gap-2 rounded-md border border-border-light p-3">
          <h3 className="text-sm font-semibold text-text-primary">Give back across the order</h3>
          <p className="text-[12px] text-text-secondary">
            One rate over every material at once, added to the same discount.
          </p>

          <div className="flex flex-wrap items-end gap-2">
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
            <Button
              size="sm"
              variant="secondary"
              disabled={orderWideGiveBack <= 0}
              onClick={() => onApplyGiveBack(ORDER_WIDE_GIVE_BACK, orderWideGiveBack)}
            >
              Discount ${orderWideGiveBack.toFixed(2)}
            </Button>
            {orderWideApplied > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onApplyGiveBack(ORDER_WIDE_GIVE_BACK, 0)}
              >
                Remove ${orderWideApplied.toFixed(2)}
              </Button>
            )}
          </div>

          {/* The two instruments discount the same fabric by different
              routes, so using both double-counts whatever they overlap on. */}
          {anyMaterialApplied && orderWideGiveBack > 0 && (
            <p className="text-[12px] text-danger">
              A per-material discount is already in force. This rate covers those materials too, so
              applying it would give the same fabric away twice.
            </p>
          )}
        </section>

        <p className="px-1 text-[12px] text-text-secondary">
          Nothing here changes a line item's price — every figure is added to the order's fixed
          discount, on top of whatever is already there.
          {discountIsPercent && ' Applying will replace the current percentage discount.'} The rates
          themselves are not saved, so after a reload the discount is just a dollar figure and Reset
          can no longer take these back out.
        </p>
      </div>
    </Modal>
  );
}
