// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * The Order Presentation option table — one row per blind, one column per
 * option type, and a `<tfoot>` carrying a total for every money column.
 *
 * Purely presentational: it renders exactly the rows it is handed, so the
 * page owns filtering and this component's totals are automatically "the
 * totals for what is on screen". All money comes from
 * `describeLineBreakdown`, which guarantees each row's cells plus its
 * adjustment equal the stored line total — so the footer sums are real
 * money, not indicative figures.
 *
 * Columns for option types no visible blind carries are dropped entirely
 * rather than rendered full of dashes: an order of plain rollers should
 * not present a customer with four empty columns. The table scrolls inside
 * its own container so the page body never scrolls sideways on a tablet.
 */

import { useMemo, type ReactNode } from 'react';
import {
  OPTION_COLUMNS,
  OPTION_COLUMN_LABELS,
  describeLineBreakdown,
  type OptionCell,
  type OptionColumn,
} from '../../lib/optionBreakdown';
import type { LineItem } from '../../types';

/**
 * Formats a number as dollars, e.g. `$1234.50`.
 *
 * Unlike the Order Overview's helper this one has to survive NEGATIVES —
 * the adjustment column goes below zero whenever a consultant discounts a
 * line — so the sign leads and the dollar sign hugs the digits. Naive
 * interpolation yields `$-21.20`, which reads as a typo on a screen the
 * customer is looking at. The U+2212 minus matches the discount row on
 * the page's order-total strip.
 */
function money(value: number | null | undefined): string {
  const amount = Number(value) || 0;
  return `${amount < 0 ? '−' : ''}$${Math.abs(amount).toFixed(2)}`;
}

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

/** Header cell. */
function Th({ children, right = false }: { children: ReactNode; right?: boolean }) {
  return (
    <th
      className={`whitespace-nowrap px-3 py-2 text-xs font-semibold uppercase tracking-wide text-text-muted ${right ? 'text-right' : 'text-left'}`}
    >
      {children}
    </th>
  );
}

/** Body cell. `mono` marks money and size figures. */
function Td({
  children,
  right = false,
  mono = false,
}: {
  children: ReactNode;
  right?: boolean;
  mono?: boolean;
}) {
  return (
    <td
      className={`px-3 py-2 text-[13px] text-text-secondary ${right ? 'text-right' : 'text-left'} ${mono ? 'whitespace-nowrap font-mono' : ''}`}
    >
      {children}
    </td>
  );
}

/** Footer cell — heavier than a body cell, since it carries the totals. */
function Tf({ children, right = false }: { children: ReactNode; right?: boolean }) {
  return (
    <td
      className={`whitespace-nowrap px-3 py-2 font-mono text-sm font-semibold text-text-primary ${right ? 'text-right' : 'text-left'}`}
    >
      {children}
    </td>
  );
}

/**
 * One option cell: the chosen option's name, with what it added to this
 * line beneath it.
 *
 * An option that adds nothing prints its name alone — a customer reading a
 * column of "$0.00" learns nothing and starts wondering what it means.
 */
function OptionValue({ cell }: { cell: OptionCell }) {
  if (cell.name === null) return <>—</>;
  return (
    <>
      <span className="block">{cell.name}</span>
      {cell.amount !== null && cell.amount !== 0 && (
        <span className="mt-0.5 block font-mono text-xs text-text-muted">
          +{money(cell.amount)}
        </span>
      )}
    </>
  );
}

export default function PresentationTable({ items }: { items: LineItem[] }) {
  /**
   * Rows, their surviving column set, and every footer figure — recomputed
   * only when the visible items change. A column survives when at least
   * one visible row fills it, so the table narrows as the filters narrow.
   */
  const { rows, columns, totals, adjustmentTotal, overall, quantityTotal, showAdjustment } =
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
        showAdjustment: rows.some((row) => row.breakdown.adjustment !== 0),
      };
    }, [items]);

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full min-w-[900px] border-collapse">
        <thead>
          <tr className="border-b border-border bg-surface-muted">
            <Th>Room</Th>
            <Th>Blind type</Th>
            <Th right>Size (cm)</Th>
            {columns.map((column) => (
              <Th key={column}>{OPTION_COLUMN_LABELS[column]}</Th>
            ))}
            <Th right>Qty</Th>
            {showAdjustment && <Th right>Adjustment</Th>}
            <Th right>Line total</Th>
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
                  <OptionValue cell={breakdown.cells[column]} />
                </Td>
              ))}
              <Td right mono>
                {item.quantity}
              </Td>
              {showAdjustment && (
                <Td right mono>
                  {breakdown.adjustment === 0 ? '' : money(breakdown.adjustment)}
                </Td>
              )}
              <Td right mono>
                {money(breakdown.lineTotal)}
              </Td>
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
                {totals.get(column) ? money(totals.get(column)) : ''}
              </Tf>
            ))}
            <Tf right>{quantityTotal}</Tf>
            {showAdjustment && <Tf right>{adjustmentTotal ? money(adjustmentTotal) : ''}</Tf>}
            <Tf right>{money(overall)}</Tf>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
