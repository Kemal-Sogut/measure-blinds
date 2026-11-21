// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Idempotent payment recording for `POST /api/orders/:id/payments`: the
 * replay lookup (`payments.client_key`), the e-Transfer claim
 * (`pending -> applied`), the payment insert (`lib/payments.ts`), and the
 * guarded release or link of the claim afterwards, as one unit.
 *
 * Guarantees:
 *  - A submit carrying a `client_key` records at most one payment. An exact
 *    replay (same order, same amount, same e-Transfer) is reported as
 *    `replay`; a key reused for anything different is a `conflict`, never
 *    a silent success.
 *  - An e-Transfer is claimed with a guarded update BEFORE money is written,
 *    so two staff applying the same transfer cannot both record a payment.
 *  - The claim is released only if it is still this request's own
 *    (`status = applied`, same order, no payment linked), and a failed
 *    release or link is written to the order's activity trail so staff can
 *    find a stuck transfer. Nothing here throws once a payment is committed.
 *
 * Integration: called by the payments route; the e-Transfer webhook does
 * not use it (it dedupes on the Gmail message id and calls
 * `recordOrderPayment` directly).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { logOrderEvent } from './orderLog';
import { recordOrderPayment, type RecordPaymentInput } from './payments';

/** Half a cent: float-safe equality for two money amounts. */
const AMOUNT_EPSILON = 0.005;

/** A ledger entry plus the optional pending e-Transfer it applies. */
export interface ClaimedPaymentInput extends RecordPaymentInput {
  /** Pending e-Transfer this payment applies, claimed before the write. */
  etransfer_id?: string;
}

/** Outcome of {@link recordPaymentWithClaim}; the route maps it to HTTP. */
export type ClaimedPaymentResult =
  | { kind: 'recorded'; paymentId: string }
  /** This exact submit was already recorded; nothing new was written. */
  | { kind: 'replay' }
  /** Refused with nothing written (409). */
  | { kind: 'conflict'; code: 'client_key_mismatch' | 'etransfer_unavailable'; message: string }
  | { kind: 'error'; message: string };

/** A stored payment found by its idempotency key. */
interface StoredPayment {
  id: string;
  order_id: string;
  amount: number | string;
}

const MISMATCH: ClaimedPaymentResult = {
  kind: 'conflict',
  code: 'client_key_mismatch',
  message: 'This payment key was already used for a different payment. Reopen the payment sheet and try again.',
};

/** Finds the payment recorded under `key`, on any order (the UNIQUE is global). */
async function findByKey(sb: SupabaseClient, key: string): Promise<StoredPayment | null> {
  const { data } = await sb
    .from('payments')
    .select('id, order_id, amount')
    .eq('client_key', key)
    .maybeSingle();
  return (data as StoredPayment | null) ?? null;
}

/**
 * True when `stored` is exactly what this request asked for: same order,
 * same amount and, when an e-Transfer was named, that transfer is not
 * linked to some other payment.
 */
async function matchesRequest(
  sb: SupabaseClient,
  stored: StoredPayment,
  orderId: string,
  input: ClaimedPaymentInput
): Promise<boolean> {
  if (stored.order_id !== orderId) return false;
  if (Math.abs(Number(stored.amount) - input.amount) >= AMOUNT_EPSILON) return false;
  if (input.etransfer_id) {
    const { data } = await sb
      .from('etransfers')
      .select('id, payment_id')
      .eq('id', input.etransfer_id)
      .maybeSingle();
    const row = data as { id: string; payment_id: string | null } | null;
    if (!row) return false;
    if (row.payment_id && row.payment_id !== stored.id) return false;
  }
  return true;
}

/**
 * Undoes this request's own claim. Guarded so it can never reopen a
 * transfer that another request has since applied; a failure is logged on
 * the order, not thrown.
 */
async function releaseClaim(sb: SupabaseClient, orderId: string, etransferId: string): Promise<void> {
  const { error } = await sb
    .from('etransfers')
    .update({ status: 'pending', order_id: null })
    .eq('id', etransferId)
    .eq('status', 'applied')
    .eq('order_id', orderId)
    .is('payment_id', null);
  if (error) {
    await logOrderEvent(
      sb,
      orderId,
      `e-Transfer ${etransferId} could not be returned to the pending list after a failed payment: ${error.message}`
    );
  }
}

/** Links the committed payment to its transfer; a failure is logged, never thrown. */
async function linkClaim(
  sb: SupabaseClient,
  orderId: string,
  etransferId: string,
  paymentId: string
): Promise<void> {
  const { error } = await sb.from('etransfers').update({ payment_id: paymentId }).eq('id', etransferId);
  if (error) {
    await logOrderEvent(
      sb,
      orderId,
      `Payment recorded but e-Transfer ${etransferId} could not be linked to it: ${error.message}`
    );
  }
}

/**
 * Records one payment idempotently, claiming the e-Transfer first when one
 * is named.
 *
 * @param sb Service-role Supabase client
 * @param orderId Order the payment belongs to
 * @param currentStatus The order's status before this payment
 * @param input Ledger fields, optional `client_key`, optional `etransfer_id`
 * @returns `recorded` (new payment), `replay` (already recorded, nothing
 *   written), `conflict` (409, nothing written) or `error` (500, claim released)
 */
export async function recordPaymentWithClaim(
  sb: SupabaseClient,
  orderId: string,
  currentStatus: string,
  input: ClaimedPaymentInput
): Promise<ClaimedPaymentResult> {
  const key = input.client_key;

  // Replay lookup first, before the claim: a replay carrying an e-Transfer
  // would otherwise be told its transfer "was already applied" by itself.
  if (key) {
    const stored = await findByKey(sb, key);
    if (stored) return (await matchesRequest(sb, stored, orderId, input)) ? { kind: 'replay' } : MISMATCH;
  }

  if (input.etransfer_id) {
    const { data: claimed, error } = await sb
      .from('etransfers')
      .update({ status: 'applied', order_id: orderId })
      .eq('id', input.etransfer_id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    if (error) return { kind: 'error', message: error.message };
    if (!claimed) {
      // Lost the claim. A concurrent identical submit may have won and
      // recorded this key's payment: that is a replay, not a conflict.
      const stored = key ? await findByKey(sb, key) : null;
      if (stored && (await matchesRequest(sb, stored, orderId, input))) return { kind: 'replay' };
      if (stored) return MISMATCH;
      return {
        kind: 'conflict',
        code: 'etransfer_unavailable',
        message: 'That e-Transfer has already been applied or dismissed.',
      };
    }
  }

  const result = await recordOrderPayment(sb, orderId, currentStatus, {
    amount: input.amount,
    paid_on: input.paid_on,
    note: input.note,
    client_key: key,
  });

  if ('paymentId' in result) {
    if (input.etransfer_id) await linkClaim(sb, orderId, input.etransfer_id, result.paymentId);
    return { kind: 'recorded', paymentId: result.paymentId };
  }

  // Not recorded by this call. If the key's payment exists after all (a
  // racing identical submit, or an ambiguous write failure that did land),
  // the money is in the ledger: link rather than release.
  const stored = key ? await findByKey(sb, key) : null;
  if (stored && (await matchesRequest(sb, stored, orderId, input))) {
    if (input.etransfer_id) await linkClaim(sb, orderId, input.etransfer_id, stored.id);
    return { kind: 'replay' };
  }
  if (input.etransfer_id) await releaseClaim(sb, orderId, input.etransfer_id);
  if (stored) return MISMATCH;
  if ('duplicate' in result) return { kind: 'replay' };
  return { kind: 'error', message: result.errorMessage };
}
