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
 * Copy pattern.
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
 *
 * Cassette, bottom rail and control share ONE row (`fields.hardware`),
 * already joined and captioned by the field builder: they are three parts
 * of the same hardware spec and the freed rows keep the stock from
 * crowding. Every part is a one- or two-letter code, which is what keeps
 * that row inside the ~40 characters 10pt fits on 3in stock — the full
 * catalog names did not fit and clipped the control.
 *
 * @param fields One label's worth of already-formatted text.
 * @param pageBreak Whether to force a page break AFTER this label. The
 *   caller sets it on every printed label except the last one: a break
 *   after the final label opens a page nothing then fills, which the
 *   printer still feeds as a blank die-cut label.
 */
function Label({ fields, pageBreak }: { fields: LabelFields; pageBreak: boolean }) {
  return (
    <div
      className={`h-[1.5in] w-[3in] shrink-0 overflow-hidden border border-border bg-white p-[0.06in] font-sans text-black print:border-0 ${
        pageBreak ? 'print:break-after-page' : ''
      }`}
    >
      <div className="flex items-baseline justify-between gap-[0.05in]">
        <span className="flex min-w-0 items-baseline gap-[0.05in]">
          <span className="text-[11pt] font-bold leading-none">{fields.orderNumber}</span>
          <span className="truncate text-[10pt] leading-none">{fields.orderDate}</span>
        </span>
        <span className="shrink-0 text-[7pt] leading-none">
          {fields.index} of {fields.total}
        </span>
      </div>
      <div className="my-[0.03in] border-t border-black" />
      <div className="truncate text-[10pt] leading-tight">{fields.customer}</div>
      <div className="truncate text-[10pt] leading-tight">{fields.room}</div>
      <div className="truncate text-[11pt] font-bold leading-tight">{fields.dimensions}</div>
      <div className="my-[0.03in] border-t border-black" />
      <div className="truncate text-[10pt] leading-tight">{fields.material}</div>
      <div className="truncate text-[10pt] leading-tight">{fields.hardware}</div>
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
  /**
   * The label the printer stops after. Page breaks go BETWEEN labels, so
   * the last printed one must not carry one — and "last printed" is not
   * the last in the DOM, because any trailing label can be deselected.
   */
  const lastPrinted = selected.length ? selected[selected.length - 1].index : 0;

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
        view (the cut sheet and the order view are both Letter).

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
              className="flex h-9 items-center rounded-md shadow-sm bg-brand-600 px-3 text-sm font-medium text-white disabled:opacity-50"
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
                    <Label fields={fields} pageBreak={isOn && fields.index !== lastPrinted} />
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
