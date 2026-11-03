// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pure state picker behind the staff revision banner (`RevisionBannerCard.tsx`).
 *
 * The banner is the SAVED, order-level signal of what the customer holds
 * (migration 50): which revision they were last sent and whether the
 * order has moved on since. It is separate from the live, per-item
 * `PriceUpdateNotice`, and dismissing a price notice never hides it.
 * All inputs come from the order-detail read (`revisions`,
 * `unsent_changes`, `accepted_revision_id`); nothing is computed here
 * beyond choosing a state, so it stays unit-testable without React.
 */

import type { Order, OrderStatus } from '../../types';
import { holdsPriceLock, isConfirmedStatus } from '../../lib/orderStatus';

/**
 * What the banner shows.
 *
 * - `hidden`: nothing — a draft, a response without revision fields, a
 *   revision read that failed (unknown is never shown as "up to date"), or
 *   a confirmed order with no revision.
 * - `legacy`: a sent/expired order that predates revision tracking; its
 *   next send creates Rev 1.
 * - `in_sync`: the customer holds the latest revision and nothing unsent.
 * - `unsent`: saved changes the customer has not been sent (sent/expired
 *   only).
 * - `accepted_differs`: a confirmed order whose saved quote no longer
 *   matches revision `rev` (the accepted one, else the latest).
 */
export type BannerState =
  | { kind: 'hidden' }
  | { kind: 'legacy' }
  | { kind: 'in_sync'; rev: number; sentAt: string }
  | { kind: 'unsent'; rev: number; sentAt: string; changes: string[] }
  | { kind: 'accepted_differs'; rev: number; changes: string[] };

/**
 * Picks the banner state for an order from its detail response.
 *
 * Confirmed statuses (`awaiting_payment` onward) never read `unsent` or
 * `legacy`: from confirmation the customer page serves the LIVE order, so
 * "not sent to the customer" and "next send creates Rev 1" would be false.
 * There, changes since the latest revision mean the order has moved away
 * from what the customer accepted (`accepted_differs`, naming the accepted
 * revision, or the latest when none is recorded), and an order with no
 * revision shows nothing.
 *
 * @param order An order as returned by the detail read. `revisions` is
 *   newest first; `revisions === null`/absent means unknown and hides the
 *   banner, as does a status that holds no price lock (drafts keep their
 *   history but show no banner).
 * @returns The {@link BannerState} to render.
 */
export function bannerState(order: Order): BannerState {
  const { revisions, unsent_changes: changes } = order;
  if (revisions == null || !holdsPriceLock(order.status)) return { kind: 'hidden' };
  const confirmed = isConfirmedStatus(order.status);
  const latest = revisions[0];
  if (!latest) return confirmed ? { kind: 'hidden' } : { kind: 'legacy' };
  if (changes == null) return { kind: 'hidden' };

  if (changes.length === 0) return { kind: 'in_sync', rev: latest.rev_no, sentAt: latest.sent_at };
  if (confirmed) {
    const accepted = revisions.find((r) => r.id === order.accepted_revision_id) ?? latest;
    return { kind: 'accepted_differs', rev: accepted.rev_no, changes };
  }
  return { kind: 'unsent', rev: latest.rev_no, sentAt: latest.sent_at, changes };
}

/**
 * Whether the banner may offer "Send update": only while the estimate is
 * still waiting on the customer (`sent` or `expired`), the statuses whose
 * customer page shows the sent snapshot and so can be brought up to date
 * by a send. The host passes `onSendUpdate` only when this is true.
 */
export function canSendUpdate(status: OrderStatus): boolean {
  return status === 'sent' || status === 'expired';
}
