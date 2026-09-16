// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pure presentation rules for one Alerts-feed row: its heading, its
 * sentence, and where (if anywhere) tapping it goes.
 *
 * Kept out of `NotificationsPage.tsx` for two reasons: a module that
 * exports components alone keeps its React Fast Refresh boundary, and
 * this workspace's vitest runs in node without a DOM, so the wording and
 * the link rule are only testable as plain functions
 * (`notificationText.test.ts`).
 *
 * The API stores snapshots, not sentences (migration 43), so any wording
 * change here applies to old alerts as well as new ones.
 */

import type { AppNotification, NotificationKind } from '../../types';
import { money } from '../orders/presentationMoney';

/** Short heading per kind, shown in bold on the row. */
export const NOTIFICATION_TITLES: Record<NotificationKind, string> = {
  edit_request: 'Edit requested',
  order_confirmed: 'Order confirmed',
  etransfer_received: 'New e-Transfer payment',
};

/**
 * The one-line description under the heading. Every snapshot field may
 * be blank (a customer created from a phone number alone, an e-Transfer
 * with no sender and no matching order), so each sentence degrades to a
 * generic subject rather than printing a dangling space or "for ".
 */
export function notificationDetail(n: AppNotification): string {
  const who = n.customer_name.trim();
  const order = n.order_number.trim();
  switch (n.kind) {
    case 'edit_request':
      return `${who || 'The customer'} asked for changes to ${order || 'their estimate'}.`;
    case 'order_confirmed':
      return `${who || 'The customer'} confirmed ${order || 'their estimate'}.`;
    case 'etransfer_received': {
      const from = who ? ` from ${who}` : '';
      const where = order ? `applied to ${order}` : 'waiting to be assigned to an order';
      return `${money(n.amount)}${from} — ${where}.`;
    }
  }
}

/**
 * Where tapping the row navigates: the linked order page for the two
 * order events, and `null` for e-Transfer alerts, which are deliberately
 * not clickable (an unmatched transfer has no order, and a matched one is
 * already recorded on it). An order event whose order was deleted never
 * reaches the client — the FK cascade removes the alert with it.
 */
export function notificationHref(n: AppNotification): string | null {
  if (n.kind === 'etransfer_received' || !n.order_id) return null;
  return `/orders/${n.order_id}`;
}
