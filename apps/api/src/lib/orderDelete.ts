// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Order deletion — the single place that knows what a deleted order
 * takes with it and what it must leave standing.
 *
 * WHAT GOES (all by `ON DELETE CASCADE` on the FK to `orders`, so the
 * database guarantees it in one statement rather than the Worker firing
 * a delete per table and half-succeeding):
 *   - `line_items`          the order's contents
 *   - `order_logs`          the whole activity trail
 *   - `payments`            the recorded ledger for this order
 *   - `order_edit_requests` the customer's change requests
 *   - `appointments`        the INSTALLATION visit (an installation can
 *                           never exist without its order — migration 20's
 *                           `installation_requires_order` check)
 *   - every stage stamp (`cut_done_at`, `installed_at`, `warranty_sent_at`,
 *     `customer_viewed_at`, `cancel_requested_at`, the public token…) —
 *     they are columns ON the order row, so they leave with it.
 *
 * WHAT STAYS:
 *   - the `customers` row (FK is `ON DELETE RESTRICT` — deleting an order
 *     never deletes the person) and every ESTIMATE appointment, which
 *     hangs off the customer and never referenced this order at all.
 *   - the `etransfers` inbox rows: money really did arrive, and the Gmail
 *     Apps Script dedupes on `gmail_message_id`, so deleting the record
 *     of a received transfer would both erase evidence and let a
 *     re-delivered email record it a second time.
 *
 * The e-Transfer rows are why this module exists. Their FK is
 * `ON DELETE SET NULL`, so a raw `delete from orders` left them
 * `status = 'applied'` pointing at nothing: invisible to
 * `GET /payments/pending` and attached to no order — money stranded
 * where no screen in the app can reach it. {@link deleteOrderCascade}
 * releases them back to the pending inbox FIRST, so they resurface in
 * the Record Payment popup for reassignment.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** One e-Transfer link released ahead of the delete, kept to restore it. */
interface ReleasedEtransfer {
  id: string;
  payment_id: string | null;
}

/** Outcome of {@link deleteOrderCascade}. */
export type OrderDeleteResult =
  | { status: 'deleted' }
  | { status: 'not_found' }
  | { status: 'failed'; message: string };

/**
 * Deletes one order and everything that belongs to it.
 *
 * Ordering is deliberate: the e-Transfers are released BEFORE the order
 * row goes, because the moment it does the `SET NULL` cascade erases the
 * only link back to them. If the delete then fails, every released row
 * is re-applied to the order — otherwise a transfer would sit in the
 * pending inbox while the order it already paid still exists, inviting a
 * consultant to record the same money twice.
 *
 * @param sb Service-role Supabase client
 * @param orderId The order to delete
 * @returns `not_found` when no such order exists (the caller answers
 *          404), `failed` with the database message when the delete
 *          itself is rejected, `deleted` otherwise
 */
export async function deleteOrderCascade(
  sb: SupabaseClient,
  orderId: string
): Promise<OrderDeleteResult> {
  const { data: existing } = await sb
    .from('orders')
    .select('id')
    .eq('id', orderId)
    .maybeSingle();
  if (!existing) return { status: 'not_found' };

  const released = await releaseEtransfers(sb, orderId);

  const { error } = await sb.from('orders').delete().eq('id', orderId);
  if (error) {
    await restoreEtransfers(sb, orderId, released);
    return { status: 'failed', message: error.message };
  }

  return { status: 'deleted' };
}

/**
 * Unlinks the order's applied e-Transfers and returns them to the
 * unmatched inbox (`status = 'pending'`, no order, no payment).
 *
 * Only `applied` rows ever carry an `order_id` — `pending` rows are
 * unassigned by definition and `dismissed` ones are dismissed straight
 * out of the pending inbox — so filtering on the order alone cannot
 * resurrect something staff already dismissed.
 *
 * @returns the rows as they were before the update, for
 *          {@link restoreEtransfers}
 */
async function releaseEtransfers(
  sb: SupabaseClient,
  orderId: string
): Promise<ReleasedEtransfer[]> {
  const { data } = await sb
    .from('etransfers')
    .select('id, payment_id')
    .eq('order_id', orderId);
  const rows = (data ?? []) as ReleasedEtransfer[];
  if (rows.length === 0) return [];

  await sb
    .from('etransfers')
    .update({ status: 'pending', order_id: null, payment_id: null })
    .eq('order_id', orderId);

  return rows;
}

/**
 * Re-applies the links {@link releaseEtransfers} removed, used only when
 * the order delete failed and the order is still there. Row by row, since
 * each carries its own `payment_id`; the count is the number of transfers
 * ever applied to one order, so it is one or two calls in practice.
 */
async function restoreEtransfers(
  sb: SupabaseClient,
  orderId: string,
  released: ReleasedEtransfer[]
): Promise<void> {
  for (const row of released) {
    await sb
      .from('etransfers')
      .update({ status: 'applied', order_id: orderId, payment_id: row.payment_id })
      .eq('id', row.id);
  }
}
