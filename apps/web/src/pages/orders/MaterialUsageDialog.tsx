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
 * - PER MATERIAL (one editor per row). Type a new rate for one material
 *   and Apply reprices every line using it, writing a real per-line price.
 *   This is the precise instrument: a rate change on one fabric only.
 *   The arithmetic lives in `materialRateOverrides.ts`, which also owns
 *   the promise that a hand-priced line is never overwritten.
 * - ACROSS THE ORDER (the give-back row at the bottom). One $/metre
 *   figure over every material, totalled into the order's FIXED discount.
 *   This is the blunt instrument, and it is the ORIGINAL behaviour of
 *   this panel — kept because "take $5/m² off the whole job" is still how
 *   most quotes get closed.
 *
 * Using both at once double-discounts, so the dialog says so on screen
 * rather than trusting anyone to notice.
 *
 * It is a dialog rather than an inline panel because the summary rail is
 * roughly 280px wide: a table with a per-row editor and two buttons in it
 * was unreadable there. The rail keeps only {@link MaterialUsageTrigger},
 * a one-line summary that opens this.
 *
 * Every quantity and rate comes from `summarizeMaterialUsage`; no area,
 * quantity or price basis is re-derived here. The component sums
 * pre-aggregated per-unit totals and subtracts a give-back rate from a
 * catalog rate — display arithmetic on scalars `materialUsage.ts` already
 * computed, not a second pricing path.
 */

import { useMemo } from 'react';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import type { MaterialUnit } from '../../lib/blindTypes';
import type { Catalogs, ItemDraft } from './lineItemDrafts';
import { giveBackAmount, type MaterialUsageSummary } from './materialUsage';
import { materialRateStatus, materialRowKey } from './materialRateOverrides';

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

/** The one-line summary of every rate unit the order uses. */
function summaryLineOf(summary: MaterialUsageSummary): string {
  return usedUnitsOf(summary)
    .map(({ unit, figures }) => `${figures.quantity.toFixed(2)} ${UNIT_LABEL[unit]}`)
    .join(' · ');
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
 * silently wiped every time the dialog was dismissed — including a rate
 * the consultant had already applied to lines. And the trigger renders at
 * two breakpoints that CSS merely hides, so anything shared between them
 * has to live above both. Do not push these back down into `useState`.
 */
export interface MaterialUsageDialogProps {
  open: boolean;
  onClose: () => void;
  /** Pre-aggregated usage, computed once by the parent for both surfaces. */
  summary: MaterialUsageSummary;
  /** The editor's current drafts, hidden ones included — the report filters. */
  items: ItemDraft[];
  /**
   * The live catalog cache (materials, blind types, etc.), the same one
   * the rest of the line-item editor reads. The dialog reports TODAY'S
   * rate from this cache, not a stored snapshot from when the order's
   * lines were priced — a material's rate can have moved since.
   */
  catalogs: Catalogs;
  /**
   * Per-material rate inputs keyed by {@link materialRowKey}, as raw
   * strings. A key that is ABSENT means "untouched", which is what lets
   * each box fall back to the applied rate, or failing that the catalog
   * rate, without the parent having to seed anything.
   */
  rateDrafts: Record<string, string>;
  onRateDraftChange: (key: string, value: string) => void;
  /** Reprices every line of this material+unit at `rate`. */
  onApplyRate: (materialId: string, unit: MaterialUnit, rate: number) => void;
  /**
   * Returns this material+unit's lines to their calculated price AND
   * drops its `rateDrafts` entry, so the box falls back to showing the
   * catalog rate again. Both halves are the parent's job because the
   * draft map is the parent's state.
   */
  onResetRate: (materialId: string, unit: MaterialUnit) => void;
  /**
   * Order-wide give-back rate for `sqm`-priced materials, held as a raw
   * string for the same reason the per-material ones are.
   */
  sqmRate: string;
  onSqmRateChange: (value: string) => void;
  /** Order-wide give-back rate for `running_m` materials (Curtains). */
  runningRate: string;
  onRunningRateChange: (value: string) => void;
  /** Sets the order's fixed discount to this dollar amount. */
  onApplyDiscount: (amount: number) => void;
}

/**
 * The material breakdown, its per-material rate editors, and the
 * order-wide give-back calculator.
 */
export function MaterialUsageDialog({
  open,
  onClose,
  summary,
  items,
  catalogs,
  rateDrafts,
  onRateDraftChange,
  onApplyRate,
  onResetRate,
  sqmRate,
  onSqmRateChange,
  runningRate,
  onRunningRateChange,
  onApplyDiscount,
}: MaterialUsageDialogProps) {
  const rates = useMemo(
    () => ({
      sqm: parseRate(sqmRate) ?? undefined,
      running_m: parseRate(runningRate) ?? undefined,
    }),
    [sqmRate, runningRate]
  );

  const giveBack = useMemo(() => giveBackAmount(summary, rates), [summary, rates]);

  // Recounted from the drafts on every render rather than remembered, so
  // the dialog can only describe what the lines actually say — see
  // `materialRateStatus`.
  const statuses = useMemo(
    () =>
      summary.rows.map((row) => materialRateStatus(items, catalogs, row.materialId, row.unit)),
    [summary.rows, items, catalogs]
  );

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
  const anyApplied = statuses.some((s) => s.appliedLines > 0);
  // True when the give-back rate for ANY row exceeds that row's own
  // catalog rate — the give-back would exceed that row's entire fabric
  // revenue, which is worth calling out even though Apply stays enabled.
  const exceedsRate = summary.rows.some((row) => {
    const rate = rates[row.unit];
    return rate !== undefined && rate > row.rate;
  });

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
        {summary.rows.map((row, i) => {
          const status = statuses[i];
          const key = materialRowKey(row.materialId, row.unit);
          // Untouched box shows the rate now in force: what was applied,
          // or the catalog rate when nothing has been.
          const original = status.appliedRate ?? row.rate;
          const draft = rateDrafts[key] ?? original.toFixed(2);
          const typed = parseRate(draft);
          const repriceable = status.targetLines - status.manualLines;
          const dirty = draft !== row.rate.toFixed(2) || status.appliedLines > 0;

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

              {/* The catalog-rate fabric revenue for this material. It
                  deliberately does NOT move when a rate is applied: it is
                  the baseline the change is being measured against, and
                  the effect of applying is visible in the order total. */}
              <p className="text-[12px] text-text-secondary">
                ${row.amount.toFixed(2)} fabric at the catalog rate of ${row.rate.toFixed(2)} /{' '}
                {UNIT_LABEL[row.unit]} · {lines(status.targetLines)}
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
                      onClick={() => onResetRate(row.materialId, row.unit)}
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
                  disabled={typed === null || repriceable === 0}
                  // Named for the same reason the reset button is: several
                  // rows can legitimately read "Apply to 1 line".
                  aria-label={`Apply the ${row.materialName} rate per ${UNIT_LABEL[row.unit]} to ${lines(repriceable)}`}
                  onClick={() => {
                    if (typed !== null) onApplyRate(row.materialId, row.unit, typed);
                  }}
                >
                  Apply to {lines(repriceable)}
                </Button>
              </div>

              {status.appliedLines > 0 && (
                <p className="text-[12px] text-success">
                  Charging ${status.appliedRate?.toFixed(2)} / {UNIT_LABEL[row.unit]} on{' '}
                  {lines(status.appliedLines)}.
                </p>
              )}
              {status.manualLines > 0 && (
                <p className="text-[12px] text-text-secondary">
                  {lines(status.manualLines)} priced by hand — left unchanged.
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

        <p className="px-1 text-[12px] text-text-secondary">
          Applying a rate writes a fixed price on each line, exactly like a manual override: it will
          not follow later changes to that line's measurements. Apply again after editing one.
        </p>

        <section className="flex flex-col gap-2 rounded-md border border-border-light p-3">
          <h3 className="text-sm font-semibold text-text-primary">Give back across the order</h3>
          <p className="text-[12px] text-text-secondary">
            One rate over every material, totalled into the order's fixed discount.
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
              disabled={giveBack <= 0}
              onClick={() => onApplyDiscount(giveBack)}
            >
              Apply ${giveBack.toFixed(2)}
            </Button>
          </div>

          {exceedsRate && (
            <p className="text-[12px] text-text-secondary">
              The give-back exceeds the fabric rate on at least one material.
            </p>
          )}

          {/* The two instruments discount the same money by different
              routes, so using both is almost always a mistake. */}
          {anyApplied && giveBack > 0 && (
            <p className="text-[12px] text-danger">
              A per-material rate is already in force. Adding this discount on top would give the
              same fabric away twice.
            </p>
          )}

          <p className="text-[12px] text-text-secondary">
            Sets the order's fixed discount. The rate itself is not saved, and the give-back is
            calculated on fabric but applied to the whole subtotal.
          </p>
        </section>
      </div>
    </Modal>
  );
}
