// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * The amber notice that says a price has moved since the estimate was
 * last SENT — `$200.00 → $220.00`.
 *
 * Rendered in two places, both inside the editor and neither on a
 * customer-facing document:
 *
 * - at the top of a line item's own details form (`LineItemEditor`), from
 *   `quotedPriceChange`, for that item's calculated base price;
 * - once under the order total (`OrderDetail`), for the order's grand
 *   total against `orders.quoted_total`.
 *
 * The order-level figure is NOT the sum of the per-item ones: a discount,
 * tax, add-ons, quantity and hidden items all sit between a line's base
 * price and the total, so each notice is measured against its own stamp
 * (migration 48).
 *
 * Renders nothing for `null`, which is the common case — nothing has
 * moved, or the order was never sent — so a host can hand it the result
 * of the comparison directly without guarding first.
 *
 * Every container carries `min-w-0` for the reason documented in
 * `blindForms/fields.tsx`: these popups are used at 375px, and one long
 * figure must clip rather than widen the sheet.
 */

import type { QuotedPriceChange } from './lineItemDrafts';

/** Formats one figure the way every other price readout here does. */
function show(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function PriceUpdateNotice({
  change,
  label = 'Price update',
  onDismiss,
}: {
  /** The movement to report, or null to render nothing. */
  change: QuotedPriceChange | null;
  /** Leading text; the order-level notice names the total instead. */
  label?: string;
  /**
   * Records the figure as acknowledged and hides this notice. Omitted
   * where there is nothing to dismiss against — an item the order has
   * not saved yet has no row to write the acknowledgement to — and the
   * button is then not rendered at all rather than shown inert.
   */
  onDismiss?: () => void;
}) {
  if (!change) return null;
  const delta = Math.round((change.to - change.from) * 100) / 100;
  return (
    <div
      className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 rounded-xl border border-warning/30 bg-warning-tint px-3 py-2.5 text-left"
      role="status"
    >
      <span className="text-xs font-semibold text-warning">⚠ {label}:</span>
      <span className="min-w-0 font-mono text-sm font-semibold text-warning">
        {show(change.from)} → {show(change.to)}
      </span>
      <span className="text-[11px] text-warning/80">
        {delta > 0 ? 'up' : 'down'} {show(Math.abs(delta))} since this estimate was sent
      </span>
      {onDismiss && (
        // `ml-auto` so it sits at the far end on a wide sheet and wraps
        // to its own line at 375px rather than squeezing the figures.
        <button
          type="button"
          onClick={onDismiss}
          title="Dismiss — this figure is expected"
          className="ml-auto shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold text-warning hover:bg-warning/10"
        >
          Dismiss
        </button>
      )}
    </div>
  );
}
