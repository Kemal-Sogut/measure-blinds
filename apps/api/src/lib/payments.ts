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
  /**
   * Idempotency key (`payments.client_key`, UNIQUE — migration 18). The
   * staff app mints one per Record Payment sheet; a second insert with
   * the same key is reported as `{ duplicate: true }` and writes nothing.
   * Omitted by the e-Transfer webhook, which dedupes on the Gmail
   * message id instead.
   */
  client_key?: string;
}

/** Postgres unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = '23505';

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
 * @returns the new payment id; `{ duplicate: true }` when `client_key` was
 * already recorded (nothing written); or an error message
 */
export async function recordOrderPayment(
  sb: SupabaseClient,
  orderId: string,
  currentStatus: string,
  input: RecordPaymentInput
): Promise<{ paymentId: string } | { duplicate: true } | { errorMessage: string }> {
  const { data, error } = await sb
    .from('payments')
    .insert({
      order_id: orderId,
      amount: input.amount,
      paid_on: input.paid_on,
      note: input.note,
      client_key: input.client_key ?? null,
    })
    .select('id')
    .single();
  if (error) {
    // The only UNIQUE on `payments` is client_key: this submit was
    // already recorded, so the replay must not record it again.
    if (error.code === UNIQUE_VIOLATION && input.client_key) return { duplicate: true };
    return { errorMessage: error.message };
  }

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
        // Guarded: `currentStatus` was read before the insert, and the
        // order may have been reversed or advanced by hand since.
        await sb.from('orders').update({ status: 'in_progress' }).eq('id', orderId).eq('status', 'awaiting_payment');
      }
    }
  }
  return { paymentId: String(data.id) };
}
