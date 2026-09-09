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
 * add-ons equal the stored line total — so the footer sums are real money,
 * not indicative figures.
 *
 * `showBreakdown` governs PER-CHOICE money only: the option cells' `+$`
 * amounts, their footer totals, the add-on prices, and the Add-ons column.
 * Option NAMES, add-on LABELS, Qty, Unit, Note, every row's Line total and
 * the footer's overall total are on screen in both states — the toggle
 * hides what each individual choice cost, never what a line cost.
 *
 * Add-ons get a column because they ARE a per-choice charge, the one kind
 * an option column cannot hold: any line can carry any number of them and
 * they are named per line, not chosen from a catalog slot. The column
 * replaced an `Adjustment` column that held add-ons AND the gap a price
 * override opened — money of two unrelated kinds under a label that
 * explained neither. The override half now sits inside the material cell
 * (see `describeLineBreakdown`), which leaves this column meaning exactly
 * what its heading says.
 *
 * The column is also why the room name carries no add-on sub-lines here,
 * unlike the other-items table below it: printing `+ Rush fee $40.00` under
 * the room AND `$40.00` in the column is the same money twice on the common
 * single-add-on line. The sub-lines stay in `PresentationOtherItems`, which
 * has no Add-ons column of its own.
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
import { Td, Tf, Th, UnitPrice } from './presentationCells';
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
          {/* `+` only when there is something to add. The material cell
              absorbs a price override and can fit negative on a line sold
              below its own hardware, where `+−$50.00` would be nonsense. */}
          {cell.amount < 0 ? money(cell.amount) : `+${money(cell.amount)}`}
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
   * result, and would make `hasAddons` mean two things at once.
   */
  const { rows, columns, totals, addonsTotal, overall, quantityTotal, hasAddons } =
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
        addonsTotal:
          Math.round(rows.reduce((sum, row) => sum + row.breakdown.addons, 0) * 100) / 100,
        overall: Math.round(rows.reduce((sum, row) => sum + row.breakdown.lineTotal, 0) * 100) / 100,
        quantityTotal: rows.reduce((sum, row) => sum + (Number(row.item.quantity) || 0), 0),
        hasAddons: rows.some((row) => row.breakdown.addons !== 0),
      };
    }, [items]);

  // The column earns its width only when some visible line actually has an
  // add-on AND the breakdown is on to price it. An order of plain blinds
  // never sees it, exactly like an option column nobody filled.
  const showAddons = showBreakdown && hasAddons;

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
            {showAddons && <Th right>Add-ons</Th>}
            <Th right>Line total</Th>
            <Th>Note</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-light">
          {rows.map(({ item, breakdown }, i) => (
            <tr key={item.id}>
              <Td>{item.room_name || `Blind ${i + 1}`}</Td>
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
              {showAddons && (
                <Td right mono>
                  {breakdown.addons === 0 ? '' : money(breakdown.addons)}
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
              {rows.length} item{rows.length !== 1 ? 's' : ''}
            </Tf>
            {/* Blind type and Size have nothing to sum. */}
            <Tf>{''}</Tf>
            <Tf>{''}</Tf>
            {/* Left, under left-aligned option names — not right like the
                figure columns, so a total sits under the choices it sums. */}
            {columns.map((column) => (
              <Tf key={column}>
                {showBreakdown && totals.get(column) ? money(totals.get(column)) : ''}
              </Tf>
            ))}
            <Tf right>{quantityTotal}</Tf>
            {/* Unit prices summed across rows is not a number that means
                anything to anyone; the column exists per-row only. */}
            <Tf>{''}</Tf>
            {showAddons && <Tf right>{addonsTotal ? money(addonsTotal) : ''}</Tf>}
            <Tf right>{money(overall)}</Tf>
            <Tf>{''}</Tf>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
