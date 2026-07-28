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
 * TWO PRINT PATHS, one selection:
 *   - "Print" goes through the browser to a Windows-installed printer.
 *     This is the shop PC. With Chrome started using --kiosk-printing
 *     the dialog is suppressed entirely.
 *   - "Send to printer" queues a job for the shop-floor agent. iOS has
 *     no Web Bluetooth, so from an iPad this is the only path that can
 *     reach the printer at all.
 *
 * Opened in a new tab from the order page, following the Manufacturer
 * Copy / Order Overview pattern.
 */

import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import PageHeader from '../../components/PageHeader';
import { useOrder, useEnqueuePrintLabels } from '../../hooks/useOrders';
import { buildLabels, type LabelFields } from '../../lib/labels';

/**
 * One label at its true printed proportions.
 *
 * Rows sit at fixed positions rather than flowing, mirroring the TSPL
 * renderer: a blind with no cassette leaves that row blank instead of
 * pulling the rows below it up, so the same fact is always in the same
 * place across a batch. `print:break-after-page` makes each label its
 * own sheet.
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
  const { data: order, isLoading } = useOrder(id);
  const enqueue = useEnqueuePrintLabels();

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

  /** Queues the current selection for the shop-floor agent. */
  async function handleSend() {
    if (!id || !selected.length) return;
    try {
      const result = await enqueue.mutateAsync({
        id,
        items: allSelected ? undefined : selected.map((l) => l.index),
      });
      toast.success(`Queued ${result.label_count} label(s) for the printer.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not queue the labels.');
    }
  }

  return (
    <div className="min-h-screen bg-surface-muted print:bg-white">
      {/*
        Print rules live in the page rather than the global stylesheet:
        the 3in x 1.5in page size must not leak onto any other printable
        view (the cut sheet and the order overview are both Letter).
      */}
      <style>{`
        @media print {
          @page { size: 3in 1.5in; margin: 0 }
          html, body { margin: 0; padding: 0; background: #fff }
        }
      `}</style>

      <PageHeader
        title="Labels"
        backTo={id ? `/orders/${id}` : '/'}
        right={
          <div className="flex items-center gap-2 print:hidden">
            <button
              onClick={handleSend}
              disabled={!selected.length || enqueue.isPending}
              className="flex h-9 items-center rounded-sm border border-border-input bg-surface px-3 text-sm font-medium text-text-secondary hover:bg-surface-sunken disabled:opacity-50"
            >
              {enqueue.isPending ? 'Queueing…' : 'Send to printer'}
            </button>
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

      <div className="mx-auto w-full max-w-lg p-4">
        {isLoading && <p className="text-sm text-text-muted">Loading…</p>}

        {!isLoading && !labels.length && (
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
