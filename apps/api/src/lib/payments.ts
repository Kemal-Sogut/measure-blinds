// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Shared payment-recording helper used by both the authenticated
 * "record payment" route and the e-Transfer webhook, so the lifecycle
 * side effect (first payment: awaiting_payment → in_progress) is applied
 * identically no matter how the payment arrives.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** One ledger entry to insert. */
export interface RecordPaymentInput {
  amount: number;
  paid_on: string;
  note: string;
}

/**
 * Inserts a payment ledger row and, if this is the first payment
 * (order still awaiting_payment), advances the order to in_progress.
 *
 * @returns the new payment id, or an error message on failure.
 */
export async function recordOrderPayment(
  sb: SupabaseClient,
  orderId: string,
  currentStatus: string,
  input: RecordPaymentInput
): Promise<{ paymentId: string } | { errorMessage: string }> {
  const { data, error } = await sb
    .from('payments')
    .insert({ order_id: orderId, amount: input.amount, paid_on: input.paid_on, note: input.note })
    .select('id')
    .single();
  if (error) return { errorMessage: error.message };

  if (currentStatus === 'awaiting_payment') {
    await sb.from('orders').update({ status: 'in_progress' }).eq('id', orderId);
  }
  return { paymentId: String(data.id) };
}
