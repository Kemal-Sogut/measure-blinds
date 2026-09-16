// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Write side of the staff Alerts feed (`public.notifications`, migration
 * 43). The three producers — customer confirm and customer edit request
 * in `routes/public.ts`, and the e-Transfer webhook in
 * `routes/webhook.ts` — call `recordNotification` AFTER their own event
 * has persisted, so an alert never announces something that did not
 * happen.
 *
 * Best effort by contract: every error (thrown or returned by PostgREST)
 * is swallowed and logged. A customer's confirmation must never fail, and
 * the Apps Script must never retry an already-applied transfer, because
 * the alert row behind it could not be written.
 *
 * The read side (paged list) lives in `routes/notifications.ts`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** The event kinds the table's CHECK constraint accepts. */
export type NotificationKind = 'edit_request' | 'order_confirmed' | 'etransfer_received';

/**
 * One alert to record. Name, order number and amount are display
 * SNAPSHOTS — pass what is true at the moment of the event.
 */
export interface NotificationInput {
  kind: NotificationKind;
  /**
   * The order the alert links to. Set for `edit_request` and
   * `order_confirmed`; leave unset for `etransfer_received`, which is
   * never clickable and must survive the matched order's deletion (the
   * FK cascades).
   */
  orderId?: string | null;
  /** Order number as text; for e-Transfers, the matched order if any. */
  orderNumber?: string | null;
  /** Customer display name, or the e-Transfer sender. */
  customerName?: string | null;
  /** e-Transfer amount; omit for order events. */
  amount?: number | null;
}

/**
 * Inserts one alert row, never throwing. See the module header for why
 * failures are swallowed rather than surfaced to the caller.
 */
export async function recordNotification(
  sb: SupabaseClient,
  input: NotificationInput
): Promise<void> {
  try {
    const { error } = await sb.from('notifications').insert({
      kind: input.kind,
      order_id: input.orderId ?? null,
      order_number: input.orderNumber ?? '',
      customer_name: input.customerName ?? '',
      amount: input.amount ?? null,
    });
    if (error) console.error(`Notification (${input.kind}) not recorded:`, error.message);
  } catch (e) {
    console.error(`Notification (${input.kind}) not recorded:`, e);
  }
}
