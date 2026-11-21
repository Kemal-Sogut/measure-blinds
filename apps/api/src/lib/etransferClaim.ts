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

/** Maps a failed lookup to a retryable error; nothing is guessed or released. */
function lookupError(f: LookupFailure): ClaimedPaymentResult {
  return { kind: 'error', message: `Could not verify the payment record (${f.failed}). Please try again.` };
}

const MISMATCH: ClaimedPaymentResult = {
  kind: 'conflict',
  code: 'client_key_mismatch',
  message: 'This payment key was already used for a different payment. Reopen the payment sheet and try again.',
};

/** A lookup that could not be answered; the caller must not guess. */
interface LookupFailure {
  failed: string;
}

/** Finds the payment recorded under `key`, on any order (the UNIQUE is global). */
async function findByKey(sb: SupabaseClient, key: string): Promise<StoredPayment | null | LookupFailure> {
  const { data, error } = await sb
    .from('payments')
    .select('id, order_id, amount')
    .eq('client_key', key)
    .maybeSingle();
  if (error) return { failed: error.message };
  return (data as StoredPayment | null) ?? null;
}

/** Type guard separating a failed lookup from a found-or-absent answer. */
function failed<T>(v: T | LookupFailure): v is LookupFailure {
  return typeof v === 'object' && v !== null && 'failed' in v;
}

/**
 * Decides whether `stored` (found by this request's key) is exactly what
 * this request asked for: same order, same amount, and the same e-Transfer
 * outcome.
 *
 * With an e-Transfer named, it matches only when that transfer is linked to
 * `stored`, or is this order's still-unlinked applied claim while no other
 * transfer is linked to `stored` (an identical submit mid-flight). With none
 * named, `stored` must have no linked transfer. Any lookup failure is
 * returned as such, never read as "absent".
 */
async function matchesRequest(
  sb: SupabaseClient,
  stored: StoredPayment,
  orderId: string,
  input: ClaimedPaymentInput
): Promise<boolean | LookupFailure> {
  if (stored.order_id !== orderId) return false;
  if (Math.abs(Number(stored.amount) - input.amount) >= AMOUNT_EPSILON) return false;

  const { data: linkedRows, error: linkedError } = await sb
    .from('etransfers')
    .select('id')
    .eq('payment_id', stored.id);
  if (linkedError) return { failed: linkedError.message };
  const linked = (linkedRows as Array<{ id: string }> | null) ?? [];

  if (!input.etransfer_id) return linked.length === 0;
  if (linked.some((r) => r.id === input.etransfer_id)) return true;
  if (linked.length > 0) return false;

  const { data, error } = await sb
    .from('etransfers')
    .select('id, status, order_id, payment_id')
    .eq('id', input.etransfer_id)
    .maybeSingle();
  if (error) return { failed: error.message };
  const row = data as { status: string; order_id: string | null; payment_id: string | null } | null;
  return !!row && row.status === 'applied' && row.order_id === orderId && row.payment_id === null;
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
    if (failed(stored)) return lookupError(stored);
    if (stored) {
      const match = await matchesRequest(sb, stored, orderId, input);
      if (failed(match)) return lookupError(match);
      return match ? { kind: 'replay' } : MISMATCH;
    }
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
      if (failed(stored)) return lookupError(stored);
      if (stored) {
        const match = await matchesRequest(sb, stored, orderId, input);
        if (failed(match)) return lookupError(match);
        return match ? { kind: 'replay' } : MISMATCH;
      }
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

  const stored = key ? await findByKey(sb, key) : null;

  if ('duplicate' in result) {
    // The key's payment exists, and it was not written by this call. Our
    // claim (if any) was won by us alone, so the winner cannot be applying
    // the same transfer: never link it, give it back.
    if (input.etransfer_id) await releaseClaim(sb, orderId, input.etransfer_id);
    if (failed(stored)) return lookupError(stored);
    if (!stored) return { kind: 'error', message: 'Payment key already used, but its payment could not be found.' };
    if (input.etransfer_id) return MISMATCH;
    const match = await matchesRequest(sb, stored, orderId, input);
    if (failed(match)) return lookupError(match);
    return match ? { kind: 'replay' } : MISMATCH;
  }

  // Ambiguous insert failure. If the key's payment exists after all, the
  // money is in the ledger: link rather than release, and report it as
  // recorded so the route runs its post-payment steps.
  if (failed(stored)) {
    // Unknown whether the payment landed: leave the claim for staff.
    if (input.etransfer_id) {
      await logOrderEvent(
        sb,
        orderId,
        `e-Transfer ${input.etransfer_id} was left claimed: the payment write failed and could not be re-checked (${stored.failed}). Check the payment list before retrying.`
      );
    }
    return lookupError(stored);
  }
  if (stored) {
    const match = await matchesRequest(sb, stored, orderId, input);
    if (failed(match)) {
      if (input.etransfer_id) {
        await logOrderEvent(
          sb,
          orderId,
          `e-Transfer ${input.etransfer_id} was left claimed: the payment could not be re-checked (${match.failed}). Check the payment list before retrying.`
        );
      }
      return lookupError(match);
    }
    if (match) {
      if (input.etransfer_id) await linkClaim(sb, orderId, input.etransfer_id, stored.id);
      return { kind: 'recorded', paymentId: stored.id };
    }
    if (input.etransfer_id) await releaseClaim(sb, orderId, input.etransfer_id);
    return MISMATCH;
  }
  if (input.etransfer_id) await releaseClaim(sb, orderId, input.etransfer_id);
  return { kind: 'error', message: result.errorMessage };
}
