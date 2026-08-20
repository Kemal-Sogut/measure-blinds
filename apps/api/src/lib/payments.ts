// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Shared payment-recording helper used by both the authenticated
 * "record payment" route and the e-Transfer webhook, so the lifecycle
 * side effect is applied identically no matter how the payment arrives.
 *
 * The side effect is the AUTOMATIC production trigger: an order still
 * `awaiting_payment` advances to `in_progress` as soon as the ledger
 * reaches the standard 50% deposit (`total / 2`) — never on a smaller
 * first payment. This is the SAME 50% figure the customer is quoted
 * (`routes/public.ts` `depositDue`) and the e-Transfer matcher recognises
 * (`lib/etransferMatch.ts`); the three must agree.
 *
 * The trigger only ever moves an order FORWARD, and only from
 * `awaiting_payment`. A staff member may still advance an
 * under-deposited order to production by hand (that path is a different
 * route and is deliberately not gated here); this helper simply stops a
 * token payment from doing it automatically.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Tolerance for "the deposit has been reached": half a cent, so a
 * deposit paid to the exact rounded figure still counts despite float
 * drift. Same epsilon the e-Transfer matcher and the warranty issuer
 * use for their own money comparisons.
 */
const DEPOSIT_EPSILON = 0.005;

/** Sums a payment ledger to 2dp. */
function sumPayments(payments: Array<{ amount: number | string }> | null | undefined): number {
  const total = (payments ?? []).reduce((acc, p) => acc + Number(p.amount), 0);
  return Math.round(total * 100) / 100;
}

/** Rounds to 2dp — the standard-deposit basis is `total / 2`. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** One ledger entry to insert. */
export interface RecordPaymentInput {
  amount: number;
  paid_on: string;
  note: string;
}

/**
 * Inserts a payment ledger row and, when the order is still
 * `awaiting_payment` and the ledger has now reached the 50% deposit,
 * advances it to `in_progress` (the automatic production trigger).
 *
 * The cumulative paid-to-date is re-read from the ledger AFTER the insert
 * rather than derived from `input.amount` alone, so a series of smaller
 * payments crossing the threshold together triggers production exactly
 * like one payment that clears it. A payment below the threshold leaves
 * the order `awaiting_payment` for staff to advance (or the customer to
 * top up) — it is still recorded.
 *
 * @param sb Service-role Supabase client
 * @param orderId The order the payment belongs to
 * @param currentStatus The order's status BEFORE this payment
 * @param input The ledger row to insert
 * @returns the new payment id, or an error message on failure
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
    // Re-read the order total and the full ledger (now including the row
    // just inserted): production begins only once paid-to-date reaches
    // the 50% deposit, not on the first dollar received.
    const { data: order } = await sb
      .from('orders')
      .select('total, payments(amount)')
      .eq('id', orderId)
      .maybeSingle();
    if (order) {
      const paid = sumPayments(order.payments as Array<{ amount: number | string }> | null);
      const deposit = round2(Number(order.total) / 2);
      if (paid + DEPOSIT_EPSILON >= deposit) {
        await sb.from('orders').update({ status: 'in_progress' }).eq('id', orderId);
      }
    }
  }
  return { paymentId: String(data.id) };
}
