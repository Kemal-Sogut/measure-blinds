// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Internal Material usage dialog for the order editor — never shown to a
 * customer, never printed, and absent from the PDF and the public view.
 *
 * Answers one question: how much of each material does this order
 * consume, and which windows made that figure up. Each material reads as
 * a total — square metres, or running metres for Curtains — followed by
 * every window that contributed, with its own quantity in the same unit.
 * A total alone cannot say whether it came from one oversized opening or
 * six ordinary ones, and that is exactly what a consultant checks before
 * ordering fabric.
 *
 * The checkboxes are an INFORMATION tool and nothing else. Ticking a
 * window adds its quantity to the running total at the bottom of the
 * dialog and does NOTHING else: no line is hidden, repriced, selected in
 * the editor, flagged, or saved, and closing the dialog is the end of it.
 * They exist for the sub-total questions a single figure cannot answer —
 * what the upstairs rooms come to, what the three openings the customer
 * is still deciding on come to. Anyone extending this must keep that
 * promise; a checkbox that quietly acted on an order would be the most
 * surprising control on the page.
 *
 * Each material's CATALOG rate is printed beside its name — $/m², or
 * $/running-m for Curtains — so the fabric a quantity refers to can be
 * priced without leaving the dialog. It is a label, not an input and not
 * a subtotal: nothing multiplies it by the quantity beside it, because
 * the catalog rate is today's and a saved line may have been charged an
 * older one.
 *
 * This panel used to carry per-m² rate BOXES that composed a give-back
 * into the order's discount. They were removed. The typed rates were
 * session-only state, so a reload left a dollar discount the dialog could
 * neither explain nor take back, and the figures on screen stopped
 * matching the order they described. Discounting belongs to the order's
 * own discount field, which persists with the order; this panel reports
 * and never writes.
 *
 * It is a dialog rather than an inline panel because the summary rail is
 * roughly 280px wide, and a per-window list with a checkbox column was
 * unreadable there. The rail keeps only {@link MaterialUsageTrigger}, a
 * one-line summary that opens this.
 *
 * Every quantity comes from `materialUsage.ts`; no area, quantity or unit
 * basis is re-derived here. The component renders pre-computed scalars
 * and owns no arithmetic of its own beyond formatting.
 */

import { useMemo } from 'react';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import type { MaterialUnit } from '../../lib/blindTypes';
import {
  allUsageLineKeys,
  materialRowKey,
  selectedUsageTotals,
  type MaterialUsageLine,
  type MaterialUsageRow,
  type MaterialUsageSummary,
} from './materialUsage';

/** Short label for a rate unit, used in headers, totals and line rows. */
const UNIT_LABEL: Record<MaterialUnit, string> = {
  sqm: 'm²',
  running_m: 'm',
};

/** Renders `n` with the right plural, so no row reads "1 lines". */
function lines(n: number): string {
  return `${n} line${n === 1 ? '' : 's'}`;
}

/** Renders `n` with the right plural, for the selection total. */
function windows(n: number): string {
  return `${n} window${n === 1 ? '' : 's'}`;
}

/**
 * How one window is identified in a per-line breakdown.
 *
 * The MEASURED dimensions, not the billed ones — this is a label for
 * finding the window in the list above, and a 60cm blind shown as 100cm
 * would not find it. Height is omitted for `running_m` rows because
 * Curtains price on finished width alone; printing a drop beside a metre
 * figure it played no part in is how a reader concludes the two are
 * related.
 */
function dimensionsOf(line: MaterialUsageLine, unit: MaterialUnit): string {
  return unit === 'running_m'
    ? `${line.widthCm} cm wide`
    : `${line.widthCm} × ${line.heightCm} cm`;
}

/**
 * A per-unit quantity map rendered as one line, e.g. `12.40 m² · 3.50 m`.
 *
 * Units are never added together — a running metre and a square metre
 * describe different things — so a mixed order reads as two figures
 * joined, never as one sum. Returns `null` when the map is empty, which
 * is what lets a caller decide between hiding the row and printing its
 * own empty-state wording.
 */
function quantityLine(totals: Partial<Record<MaterialUnit, number>>): string | null {
  const parts = (['sqm', 'running_m'] as MaterialUnit[]).flatMap((unit) => {
    const quantity = totals[unit];
    return quantity === undefined ? [] : [`${quantity.toFixed(2)} ${UNIT_LABEL[unit]}`];
  });
  return parts.length > 0 ? parts.join(' · ') : null;
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
 * holds NO state — the open flag and the tick selection live in the
 * parent. The dialog itself must be rendered exactly ONCE, or an open
 * dialog would appear twice, stacked.
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
        {quantityLine(summary.totals)}
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
 * The selection is LIFTED into the parent (`OrderDetail`) rather than
 * held here, for two independent reasons. `Modal` unmounts its children
 * when closed, so local state would be wiped every time the dialog was
 * dismissed — a consultant who closed the dialog to check a window in the
 * list would come back to an empty tally. And the trigger renders at two
 * breakpoints that CSS merely hides, so anything shared between them has
 * to live above both. Do not push this back down into `useState`.
 *
 * Being lifted does NOT make it order state: it is never saved, never
 * sent, and never read by anything but this dialog.
 */
export interface MaterialUsageDialogProps {
  open: boolean;
  onClose: () => void;
  /**
   * Pre-aggregated usage, computed once by the parent for both surfaces.
   * Recomputed from the drafts on every keystroke, so an edited window's
   * quantity here is always the current one.
   */
  summary: MaterialUsageSummary;
  /**
   * Ticked line keys ({@link MaterialUsageLine.key}). Keys that no longer
   * appear in `summary` — an edited line that stopped pricing, a deleted
   * one — are ignored by the total rather than lingering in it.
   */
  selected: ReadonlySet<string>;
  /** Replaces the whole selection; this dialog never mutates the set. */
  onSelectedChange: (next: Set<string>) => void;
}

/**
 * One material's total and the windows that made it up, each tickable.
 *
 * The list is always open. The breakdown is the point of the panel now
 * rather than a follow-up question, and a disclosure would hide the very
 * checkboxes the dialog exists to offer.
 */
function MaterialSection({
  row,
  qualified,
  selected,
  onToggleLine,
  onToggleRow,
}: {
  row: MaterialUsageRow;
  /** True when another row shares this material's name — see below. */
  qualified: boolean;
  selected: ReadonlySet<string>;
  onToggleLine: (key: string, checked: boolean) => void;
  onToggleRow: (row: MaterialUsageRow, checked: boolean) => void;
}) {
  const selectedCount = row.lines.reduce(
    (count, line) => count + (selected.has(line.key) ? 1 : 0),
    0
  );
  const allSelected = selectedCount === row.lines.length && row.lines.length > 0;

  // One material can be scoped to several m²-priced types, and then the
  // blind type is what tells two same-sized windows apart. Decided per
  // row so an order of one type does not repeat "Roller" down every line.
  const mixedTypes = new Set(row.lines.map((line) => line.blindType)).size > 1;

  const unit = UNIT_LABEL[row.unit];

  return (
    <section className="flex flex-col gap-2 rounded-md border border-border-light bg-surface-sunken p-3">
      <div className="flex items-center justify-between gap-3">
        <label className="flex min-w-0 items-center gap-2">
          <input
            type="checkbox"
            checked={allSelected}
            // Partly-ticked rows show the mixed state rather than an
            // empty box, which would read as "nothing here is counted".
            ref={(el) => {
              if (el) el.indeterminate = selectedCount > 0 && !allSelected;
            }}
            onChange={(e) => onToggleRow(row, e.target.checked)}
            // Several rows can carry the same visible name, and a screen
            // reader gets no help from the layout that disambiguates them.
            aria-label={`Select every window using ${row.materialName} (per ${unit})`}
            className="size-4 shrink-0 accent-accent"
          />
          <span className="min-w-0">
            <span className="block wrap-anywhere text-sm font-semibold text-text-primary">
              {row.materialName}
              {qualified && (
                <span className="font-normal text-text-secondary">
                  {' '}
                  · {row.unit === 'sqm' ? 'square metres' : 'running metres'}
                </span>
              )}
              {/* The catalog rate, beside the name it belongs to. Muted
                  and un-bolded: it is reference information, not part of
                  the identity of the row, and it must not compete with
                  the quantity this panel exists to report. */}
              <span className="font-normal text-text-muted">
                {' '}
                · <span className="font-mono">${row.rate.toFixed(2)}</span> / {unit}
              </span>
            </span>
            <span className="block text-[12px] text-text-secondary">{lines(row.lineCount)}</span>
          </span>
        </label>
        <span className="shrink-0 font-mono text-[13px] text-text-primary">
          {row.quantity.toFixed(2)} {unit}
        </span>
      </div>

      <ul className="flex flex-col gap-1 border-t border-border-light pt-1 text-[12px]">
        {row.lines.map((line) => (
          <li key={line.key}>
            <label className="flex min-h-9 items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <input
                  type="checkbox"
                  checked={selected.has(line.key)}
                  onChange={(e) => onToggleLine(line.key, e.target.checked)}
                  // Two windows in one room legitimately share a label,
                  // so the size and the material go into the name too.
                  aria-label={`Count ${line.label}, ${dimensionsOf(line, row.unit)}, toward the selected ${row.materialName} total`}
                  className="size-4 shrink-0 accent-accent"
                />
                <span className="min-w-0 wrap-anywhere text-text-secondary">
                  {line.label}
                  {mixedTypes && <span className="text-text-muted"> · {line.blindType}</span>}
                  <span className="text-text-muted"> · {dimensionsOf(line, row.unit)}</span>
                  {/* Only when it carries more than one blind — an
                      unconditional "x1" on every row is noise. */}
                  {line.itemQuantity > 1 && (
                    <span className="text-text-muted"> · ×{line.itemQuantity}</span>
                  )}
                </span>
              </span>
              <span className="shrink-0 font-mono text-text-primary">
                {line.quantity.toFixed(2)} {unit}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The material breakdown: one section per material, every window
 * tickable, and the ticked quantity totalled at the bottom.
 */
export function MaterialUsageDialog({
  open,
  onClose,
  summary,
  selected,
  onSelectedChange,
}: MaterialUsageDialogProps) {
  // A material scoped to both Curtains and a m²-priced type is TWO rows
  // under one name. Left unqualified they read as a duplicate row rather
  // than as two units, so those names — and only those — carry the unit
  // in the heading.
  const ambiguousNames = useMemo(() => {
    const seen = new Set<string>();
    const twice = new Set<string>();
    for (const row of summary.rows) {
      if (seen.has(row.materialName)) twice.add(row.materialName);
      seen.add(row.materialName);
    }
    return twice;
  }, [summary.rows]);

  const selectedTotals = useMemo(
    () => selectedUsageTotals(summary, selected),
    [summary, selected]
  );
  // Counted off the summary rather than off the set's size, so a tick
  // left behind by a since-deleted line is not reported as a window.
  const selectedCount = useMemo(
    () => allUsageLineKeys(summary).filter((key) => selected.has(key)).length,
    [summary, selected]
  );
  const allCount = useMemo(() => allUsageLineKeys(summary).length, [summary]);

  const toggleLine = (key: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(key);
    else next.delete(key);
    onSelectedChange(next);
  };

  const toggleRow = (row: MaterialUsageRow, checked: boolean) => {
    const next = new Set(selected);
    for (const line of row.lines) {
      if (checked) next.add(line.key);
      else next.delete(line.key);
    }
    onSelectedChange(next);
  };

  const selectedLine = quantityLine(selectedTotals);

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
        <p className="px-1 text-[12px] text-text-secondary">
          Total material this order uses, per material and per window. Ticking a window only adds
          it to the selected total below — it changes nothing on the order.
        </p>

        {summary.rows.map((row) => (
          <MaterialSection
            key={materialRowKey(row.materialId, row.unit)}
            row={row}
            qualified={ambiguousNames.has(row.materialName)}
            selected={selected}
            onToggleLine={toggleLine}
            onToggleRow={toggleRow}
          />
        ))}

        <div className="flex items-baseline justify-between gap-3 px-1 text-[13px]">
          <span className="text-text-secondary">Total</span>
          <span className="font-mono text-text-primary">{quantityLine(summary.totals)}</span>
        </div>

        {summary.excludedCount > 0 && (
          <p className="px-1 text-[12px] text-text-secondary">
            {summary.excludedCount} item{summary.excludedCount === 1 ? '' : 's'} carry no material
            (preset, custom, or incomplete).
          </p>
        )}

        {/* The selected tally, pinned to the bottom of the scroll area so
            it stays readable while the windows being ticked are further
            up a long list. */}
        <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border border-border-light bg-surface px-3 py-2">
          <span className="text-[13px] text-text-secondary">
            Selected · {windows(selectedCount)}
          </span>
          <span className="flex items-center gap-2">
            <span className="font-mono text-[13px] text-text-primary">{selectedLine ?? '—'}</span>
            {selectedCount > 0 ? (
              <Button size="sm" variant="ghost" onClick={() => onSelectedChange(new Set())}>
                Clear
              </Button>
            ) : (
              allCount > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onSelectedChange(new Set(allUsageLineKeys(summary)))}
                >
                  Select all
                </Button>
              )
            )}
          </span>
        </div>
      </div>
    </Modal>
  );
}
