// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Decides what the order header's "customer opened it" eye shows. Kept
 * apart from the icon component so the rule is unit-testable without a
 * DOM.
 *
 * The rule: no eye until the estimate has been sent (or was opened
 * before a stage reversal cleared `sent_at`); a grey eye while the
 * customer has not opened their page; a green eye, with the moment, once
 * they have. The data is `orders.sent_at` + `orders.customer_viewed_at`,
 * both already on the order detail read.
 */

import type { Order } from '../../types';

/**
 * What the eye shows. `hidden` renders nothing; the other two carry the
 * tooltip / screen-reader label for the icon.
 */
export type CustomerViewState =
  | { kind: 'hidden' }
  | { kind: 'unopened'; label: string }
  | { kind: 'opened'; label: string; viewedAt: string };

/**
 * Formats the opened-at moment for the tooltip, e.g. "Oct 21, 3:14 PM",
 * in the viewer's own time zone. Exported for the test.
 */
export function formatViewedAt(iso: string): string {
  return new Date(iso).toLocaleString('en-CA', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Maps an order (or the unsaved `undefined`) to the eye's state. An
 * opened page wins over a missing `sent_at`: reverting an order to draft
 * clears `sent_at` but the customer did still open it.
 */
export function customerViewState(
  order: Pick<Order, 'sent_at' | 'customer_viewed_at'> | null | undefined,
): CustomerViewState {
  if (!order) return { kind: 'hidden' };
  if (order.customer_viewed_at) {
    return {
      kind: 'opened',
      viewedAt: order.customer_viewed_at,
      label: `Customer opened the order page · ${formatViewedAt(order.customer_viewed_at)}`,
    };
  }
  if (order.sent_at) return { kind: 'unopened', label: 'Sent · customer has not opened it yet' };
  return { kind: 'hidden' };
}
