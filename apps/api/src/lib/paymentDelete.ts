// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Payment deletion — removes one ledger row and hands any e-Transfer
 * behind it back to the pending inbox, without ever leaving the money
 * counted twice or in neither list.
 *
 * `etransfers.payment_id` is `ON DELETE SET NULL`, so the moment the
 * payment row goes the transfer loses its only link to it. The transfer
 * is therefore released to `pending` BEFORE the delete, found by
 * `payment_id` while that link still exists. The same discipline as
 * `lib/orderDelete.ts`, which does it for a whole order.
 *
 * Failure handling is fail-closed in both directions:
 *   - if the transfers cannot be looked up or released, the payment is
 *     NOT deleted (it would otherwise vanish while its transfer stays
 *     `applied` against nothing);
 *   - if the delete itself fails, the released transfers are re-applied
 *     to the payment, so the payment is never in the ledger while the
 *     same money sits in the pending inbox ready to be recorded again.
 *     Should that restore also fail, an activity-trail line tells staff
 *     which transfer to look at.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { logOrderEvent } from './orderLog';

/** Outcome of {@link deletePaymentReleasingEtransfer}. */
export type PaymentDeleteResult =
  | { status: 'deleted' }
  | { status: 'failed'; message: string };

/**
 * Deletes one payment, releasing its linked e-Transfer(s) first.
 *
 * @param sb Service-role Supabase client
 * @param orderId The order the payment belongs to (already verified by
 *        the caller); used to restore the link and to log
 * @param paymentId The payment to delete
 * @returns `failed` with a database message when the lookup, the release
 *          or the delete is rejected (the payment is untouched or the
 *          link restored), `deleted` otherwise
 */
export async function deletePaymentReleasingEtransfer(
  sb: SupabaseClient,
  orderId: string,
  paymentId: string
): Promise<PaymentDeleteResult> {
  const { data, error: selError } = await sb
    .from('etransfers')
    .select('id')
    .eq('payment_id', paymentId);
  if (selError) return { status: 'failed', message: selError.message };
  const ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);

  if (ids.length > 0) {
    const { error: relError } = await sb
      .from('etransfers')
      .update({ status: 'pending', order_id: null, payment_id: null })
      .in('id', ids)
      .eq('status', 'applied');
    if (relError) return { status: 'failed', message: relError.message };
  }

  const { error: delError } = await sb.from('payments').delete().eq('id', paymentId);
  if (!delError) return { status: 'deleted' };

  if (ids.length > 0) {
    const { error: restoreError } = await sb
      .from('etransfers')
      .update({ status: 'applied', order_id: orderId, payment_id: paymentId })
      .in('id', ids);
    if (restoreError) {
      await logOrderEvent(
        sb,
        orderId,
        `Payment delete failed and its e-Transfer link could not be restored (e-Transfer ${ids.join(', ')}); check the pending inbox.`
      );
    }
  }
  return { status: 'failed', message: delError.message };
}
