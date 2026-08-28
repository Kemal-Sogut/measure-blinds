// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * The order view's blinds table — one row per blind, one column per option
 * type, and a `<tfoot>` carrying a total for every money column.
 *
 * Purely presentational: it renders exactly the rows it is handed, so the
 * page owns filtering and this component's totals are automatically "the
 * totals for what is on screen". All option money comes from
 * `describeLineBreakdown`, which guarantees each row's cells plus its
 * adjustment equal the stored line total — so the footer sums are real
 * money, not indicative figures.
 *
 * `showBreakdown` governs PER-CHOICE money only: the option cells' `+$`
 * amounts, their footer totals, the add-on prices, and the Adjustment
 * column. Option NAMES, add-on LABELS, Qty, Unit, Note, every row's Line
 * total and the footer's overall total are on screen in both states — the
 * toggle hides what each individual choice cost, never what a line cost.
 *
 * Adjustment hides with the rest rather than persisting: it holds the money
 * no option column explains (add-ons, plus the gap a price override
 * opened), so with the breakdown off it would be the last visible fragment
 * of an otherwise-hidden decomposition, reading as an unexplained charge.
 *
 * Columns for option types no visible blind carries are dropped entirely
 * rather than rendered full of dashes: an order of plain rollers should not
 * present a customer with four empty columns. That is independent of the
 * toggle — a column survives on whether any row NAMES an option, not on
 * whether its price is showing. The table scrolls inside its own container
 * so the page body never scrolls sideways on a tablet.
 */

import { useMemo } from 'react';
import {
  OPTION_COLUMNS,
  OPTION_COLUMN_LABELS,
  describeLineBreakdown,
  type OptionCell,
  type OptionColumn,
} from '../../lib/optionBreakdown';
import { AddonLines, Td, Tf, Th, UnitPrice } from './presentationCells';
import { money } from './presentationMoney';
import type { LineItem } from '../../types';

/**
 * A blind's size for a customer: `120 × 210`, or `(120 + 80) × 210` when
 * it is split into panels. The parentheses matter — `120 + 80 × 210` reads
 * as arithmetic with the wrong precedence.
 */
function size(item: LineItem): string {
  const widths = item.panels.filter((w) => w > 0);
  if (widths.length === 0 || item.height_cm === null) return '—';
  const width = widths.length > 1 ? `(${widths.join(' + ')})` : `${widths[0]}`;
  return `${width} × ${item.height_cm}`;
}

/**
 * One option cell: the chosen option's name, with what it added to this
 * line beneath it while the breakdown is showing.
 *
 * An option that adds nothing prints its name alone even with the
 * breakdown on — a customer reading a column of "$0.00" learns nothing and
 * starts wondering what it means.
 */
function OptionValue({ cell, showBreakdown }: { cell: OptionCell; showBreakdown: boolean }) {
  if (cell.name === null) return <>—</>;
  return (
    <>
      <span className="block">{cell.name}</span>
      {showBreakdown && cell.amount !== null && cell.amount !== 0 && (
        <span className="mt-0.5 block font-mono text-xs text-text-muted">
          +{money(cell.amount)}
        </span>
      )}
    </>
  );
}

export default function PresentationTable({
  items,
  showBreakdown,
}: {
  items: LineItem[];
  showBreakdown: boolean;
}) {
  /**
   * Rows, their surviving column set, and every footer figure — recomputed
   * only when the visible items change. A column survives when at least one
   * visible row fills it, so the table narrows as the filters narrow.
   *
   * `showBreakdown` is NOT a dependency here: every figure below is
   * computed either way and the toggle decides what is rendered. Folding it
   * in would recompute the whole table on a switch flip for no change in
   * result, and would make `hasAdjustment` mean two things at once.
   */
  const { rows, columns, totals, adjustmentTotal, overall, quantityTotal, hasAdjustment } =
    useMemo(() => {
      const rows = items.map((item) => ({ item, breakdown: describeLineBreakdown(item) }));
      const columns = OPTION_COLUMNS.filter((column) =>
        rows.some((row) => row.breakdown.cells[column].name !== null)
      );
      const totals = new Map<OptionColumn, number>();
      for (const column of columns) {
        totals.set(
          column,
          Math.round(
            rows.reduce((sum, row) => sum + (row.breakdown.cells[column].amount ?? 0), 0) * 100
          ) / 100
        );
      }
      return {
        rows,
        columns,
        totals,
        adjustmentTotal:
          Math.round(rows.reduce((sum, row) => sum + row.breakdown.adjustment, 0) * 100) / 100,
        overall: Math.round(rows.reduce((sum, row) => sum + row.breakdown.lineTotal, 0) * 100) / 100,
        quantityTotal: rows.reduce((sum, row) => sum + (Number(row.item.quantity) || 0), 0),
        hasAdjustment: rows.some((row) => row.breakdown.adjustment !== 0),
      };
    }, [items]);

  // The column earns its width only when there is adjustment money AND the
  // breakdown is on to explain it.
  const showAdjustment = showBreakdown && hasAdjustment;

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full min-w-[1100px] border-collapse">
        <thead>
          <tr className="border-b border-border bg-surface-muted">
            <Th>Room</Th>
            <Th>Blind type</Th>
            <Th right>Size (cm)</Th>
            {columns.map((column) => (
              <Th key={column}>{OPTION_COLUMN_LABELS[column]}</Th>
            ))}
            <Th right>Qty</Th>
            <Th right>Unit</Th>
            {showAdjustment && <Th right>Adjustment</Th>}
            <Th right>Line total</Th>
            <Th>Note</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-light">
          {rows.map(({ item, breakdown }, i) => (
            <tr key={item.id}>
              <Td>
                <span className="block">{item.room_name || `Blind ${i + 1}`}</span>
                <AddonLines item={item} showBreakdown={showBreakdown} />
              </Td>
              <Td>{item.blinds_type || '—'}</Td>
              <Td right mono>
                {size(item)}
              </Td>
              {columns.map((column) => (
                <Td key={column}>
                  <OptionValue cell={breakdown.cells[column]} showBreakdown={showBreakdown} />
                </Td>
              ))}
              <Td right mono>
                {item.quantity}
              </Td>
              <Td right mono>
                <UnitPrice item={item} />
              </Td>
              {showAdjustment && (
                <Td right mono>
                  {breakdown.adjustment === 0 ? '' : money(breakdown.adjustment)}
                </Td>
              )}
              <Td right mono>
                {money(breakdown.lineTotal)}
              </Td>
              <Td>{item.note || '—'}</Td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border bg-surface-muted">
            <Tf>
              {rows.length} blind{rows.length !== 1 ? 's' : ''}
            </Tf>
            {/* Blind type and Size have nothing to sum. */}
            <Tf>{''}</Tf>
            <Tf>{''}</Tf>
            {columns.map((column) => (
              <Tf key={column} right>
                {showBreakdown && totals.get(column) ? money(totals.get(column)) : ''}
              </Tf>
            ))}
            <Tf right>{quantityTotal}</Tf>
            {/* Unit prices summed across rows is not a number that means
                anything to anyone; the column exists per-row only. */}
            <Tf>{''}</Tf>
            {showAdjustment && <Tf right>{adjustmentTotal ? money(adjustmentTotal) : ''}</Tf>}
            <Tf right>{money(overall)}</Tf>
            <Tf>{''}</Tf>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
