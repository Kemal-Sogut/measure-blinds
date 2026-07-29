// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Production labels for an order — one 3" x 1.5" direct-thermal label
 * per physical blind, fixed behind the cassette before the unit ships.
 *
 * The label is invisible after installation, so this page optimises for
 * legibility on a shop floor and nothing else. Sizing is exact: `@page`
 * declares the stock size and every label box is exactly 3in x 1.5in
 * with zero margin, so one label is one physical label with no scaling.
 *
 * SINGLE PRINT PATH: the "Print" button goes through the browser
 * (`window.print()`) to a Windows-installed Bluetooth printer on the
 * shop PC. With Chrome started using --kiosk-printing the dialog is
 * suppressed entirely. There is no server-side print queue — printing
 * from any other device is out of scope.
 *
 * Opened in a new tab from the order page, following the Manufacturer
 * Copy / Order Overview pattern.
 */

import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import { useOrder } from '../../hooks/useOrders';
import { buildLabels, type LabelFields } from '../../lib/labels';

/**
 * One label at its true printed proportions.
 *
 * Rows are plain block elements in normal flow, NOT fixed positions: an
 * empty field collapses to zero height and every row below it moves up.
 * `print:break-after-page` makes each label its own sheet.
 */
function Label({ fields }: { fields: LabelFields }) {
  return (
    <div className="h-[1.5in] w-[3in] shrink-0 overflow-hidden border border-border bg-white p-[0.06in] font-sans text-black print:break-after-page print:border-0">
      <div className="flex items-baseline justify-between">
        <span className="text-[15pt] font-bold leading-none">{fields.orderNumber}</span>
        <span className="text-[7pt] leading-none">
          {fields.index} of {fields.total}
        </span>
      </div>
      <div className="my-[0.03in] border-t border-black" />
      <div className="truncate text-[10pt] leading-tight">{fields.customer}</div>
      <div className="truncate text-[10pt] leading-tight">{fields.room}</div>
      <div className="truncate text-[15pt] font-bold leading-tight">{fields.dimensions}</div>
      <div className="my-[0.03in] border-t border-black" />
      <div className="truncate text-[10pt] leading-tight">{fields.material}</div>
      <div className="truncate text-[10pt] leading-tight">{fields.cassette}</div>
      <div className="truncate text-[10pt] leading-tight">{fields.control}</div>
    </div>
  );
}

/**
 * The labels page. Selection state is a set of 1-based label indexes —
 * the same numbering the API uses — so a reprint of one scorched label
 * asks for exactly that label and still prints its original "3 of 7".
 */
export default function OrderLabels() {
  const { id } = useParams<{ id: string }>();
  const { data: order, isLoading, error } = useOrder(id);

  const labels = useMemo(() => (order ? buildLabels(order) : []), [order]);
  const [deselected, setDeselected] = useState<Set<number>>(new Set());

  const selected = labels.filter((l) => !deselected.has(l.index));
  const allSelected = deselected.size === 0;

  /** Flips one label's checkbox. */
  function toggle(index: number) {
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  /** Select-all is a clear; deselect-all marks every index. */
  function toggleAll() {
    setDeselected(allSelected ? new Set(labels.map((l) => l.index)) : new Set());
  }

  return (
    <div className="min-h-screen bg-surface-muted print:bg-white">
      {/*
        Print rules live in the page rather than the global stylesheet:
        the 3in x 1.5in page size must not leak onto any other printable
        view (the cut sheet and the order overview are both Letter).

        The page header is dropped on paper: it is shared with every
        other page and takes no print classes, so without this it lands
        on the first label and pushes the fields off the stock.
      */}
      <style>{`
        @media print {
          @page { size: 3in 1.5in; margin: 0 }
          html, body { margin: 0; padding: 0; background: #fff }
          header { display: none !important }
        }
      `}</style>

      <PageHeader
        title="Labels"
        backTo={id ? `/orders/${id}` : '/'}
        right={
          <div className="flex items-center gap-2 print:hidden">
            <button
              onClick={() => window.print()}
              disabled={!selected.length}
              className="flex h-9 items-center rounded-sm bg-brand-600 px-3 text-sm font-medium text-white disabled:opacity-50"
            >
              Print
            </button>
          </div>
        }
      />

      <div className="mx-auto w-full max-w-lg p-4 print:p-0">
        {isLoading && <p className="text-sm text-text-muted">Loading…</p>}
        {error && <p className="p-4 text-danger">{error.message}</p>}

        {!isLoading && !error && !labels.length && (
          <p className="text-sm text-text-muted">
            This order has no blinds to label. Preset and custom lines carry no dimensions, so
            they get no label.
          </p>
        )}

        {labels.length > 0 && (
          <>
            <div className="mb-4 flex items-center justify-between print:hidden">
              <span className="text-sm text-text-muted">
                {selected.length} of {labels.length} selected
              </span>
              <button onClick={toggleAll} className="text-sm font-medium text-brand-600">
                {allSelected ? 'Deselect all' : 'Select all'}
              </button>
            </div>

            <div className="flex flex-col items-center gap-4 print:gap-0">
              {labels.map((fields) => {
                const isOn = !deselected.has(fields.index);
                return (
                  <div key={fields.index} className={isOn ? '' : 'print:hidden'}>
                    <label className="mb-1 flex items-center gap-2 text-sm text-text-secondary print:hidden">
                      <input type="checkbox" checked={isOn} onChange={() => toggle(fields.index)} />
                      Label {fields.index}
                    </label>
                    <Label fields={fields} />
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
