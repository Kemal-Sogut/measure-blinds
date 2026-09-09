// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * The order view's preset/custom lines — everything that is not a blind:
 * call-out fees, site measures, one-off charges.
 *
 * A table rather than a list, matching the blinds table above it, because
 * these lines carry the same money columns (Qty, Unit, Total) and a
 * customer reading down the page should not meet two different shapes for
 * the same information. It absorbed the deleted Order Overview page's
 * "Other Items" table wholesale.
 *
 * These lines have no options — `describeLineBreakdown` returns every cell
 * empty for them — which is exactly why they are not rows in the blinds
 * table. `showBreakdown` therefore reaches only their add-on prices.
 *
 * The header subtotal is the sum of the STORED `line_total`s of the lines
 * shown. Nothing here is derived from a rate or a percentage; the order's
 * own money lives on the page's totals strip and is read verbatim from the
 * server row.
 */

import { useMemo } from 'react';
import { AddonLines, Td, Th, UnitPrice } from './presentationCells';
import { money } from './presentationMoney';
import type { LineItem } from '../../types';

export default function PresentationOtherItems({
  items,
  showBreakdown,
}: {
  items: LineItem[];
  showBreakdown: boolean;
}) {
  const total = useMemo(
    () =>
      Math.round(items.reduce((sum, item) => sum + (Number(item.line_total) || 0), 0) * 100) / 100,
    [items]
  );

  return (
    <section className="rounded-lg border border-border bg-surface print:break-inside-avoid">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
        <h3 className="text-base font-semibold text-text-primary">
          Other items{' '}
          <span className="text-sm font-normal text-text-muted">
            ({items.length} item{items.length !== 1 ? 's' : ''})
          </span>
        </h3>
        <span className="font-mono text-sm font-semibold text-text-primary">{money(total)}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse">
          <thead>
            <tr className="border-b border-border bg-surface-muted">
              <Th>Type</Th>
              <Th>Description</Th>
              <Th right>Qty</Th>
              <Th right>Unit</Th>
              <Th right>Total</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-light">
            {items.map((item, i) => (
              <tr key={item.id}>
                <Td>{item.item_type === 'preset' ? 'Preset' : 'Custom'}</Td>
                <Td>
                  {/* Title heads the cell; a row saved before titles existed
                      has only a description, which takes its place. */}
                  <span className="block">{item.title || item.description || `Item ${i + 1}`}</span>
                  {item.title && item.description && (
                    <span className="mt-0.5 block whitespace-pre-line text-xs text-text-muted">
                      {item.description}
                    </span>
                  )}
                  <AddonLines item={item} showBreakdown={showBreakdown} />
                </Td>
                <Td right mono>
                  {item.quantity}
                </Td>
                <Td right mono>
                  <UnitPrice item={item} />
                </Td>
                <Td right mono>
                  {money(item.line_total)}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
