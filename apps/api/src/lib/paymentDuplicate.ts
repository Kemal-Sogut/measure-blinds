// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * "Likely the same money" check between the two ways a payment reaches an
 * order: typed in by staff (`POST /api/orders/:id/payments` without an
 * e-Transfer) and recorded from an Interac e-Transfer (the webhook, or a
 * staff member applying a pending transfer).
 *
 * Each door has its own exactly-once guard — the Gmail message id, the
 * payment sheet's `client_key`, the guarded `pending -> applied` claim —
 * but none of them can see the OTHER door. On 2026-11-25 a deposit typed
 * in by hand was recorded a second time when the Interac email for the
 * same deposit reached the webhook. This module answers one question for
 * either door: does this order already have a payment of exactly this
 * amount, DATED within {@link DUPLICATE_DATE_TOLERANCE_DAYS} calendar days
 * of this one (`payments.paid_on`), that came in the other way?
 *
 * Why dates and not "recently created": a deposit and its balance are
 * often exactly the same figure (half and half), but the balance is paid
 * well after the deposit. The same money reaching both doors carries
 * (nearly) the same payment date; a genuine second payment does not.
 *
 *  - The webhook (`routes/webhook.ts`) asks about `hand_entered` payments
 *    after it matched a transfer to an order and before it records money,
 *    using the transfer's Toronto payment date. A hit — or a check that
 *    could not run — leaves the transfer pending for a person, explained
 *    by {@link heldTransferLog} on the order and {@link heldTransferAlert}
 *    in the Alerts feed.
 *  - A hand-entered payment (`lib/etransferClaim.ts`) asks about
 *    `etransfer` payments, using the date being entered. A hit is a 409
 *    `possible_duplicate` carrying {@link manualDuplicateMessage}; the
 *    staff app asks, and resends with `confirm_duplicate: true` if the
 *    person says it really was paid twice.
 *
 * A payment "came in by e-Transfer" when an `etransfers` row links to it
 * (`etransfers.payment_id`, migration 16). The check is a heuristic, not a
 * lock: two genuine payments of the same amount a few days apart are also
 * caught, so it only ever hands the decision to a person. It never
 * deletes, merges or re-links anything.
 *
 * Dates are compared as calendar dates ("YYYY-MM-DD" → whole days), with
 * no time zone involved: both `paid_on` values are already shop-calendar
 * dates. Never throws: a failed lookup comes back as `unknown`; callers
 * treat it as "possibly a duplicate" (webhook) or as a retryable error
 * (staff route), never as "no duplicate".
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { formatDateLong } from './timeText';

/**
 * How many calendar days apart two payment dates (`paid_on`) may be and
 * still count as "likely the same money" — inclusive, either direction.
 * 3 covers a deposit typed in on the day it was promised while the
 * Interac email is dated a weekend later; a balance paid at installation,
 * weeks after the deposit, is well outside it. The ONE value both doors
 * use — change it here only.
 */
export const DUPLICATE_DATE_TOLERANCE_DAYS = 3;

/** Which door the EARLIER payment came through. */
export type PaymentOrigin = 'hand_entered' | 'etransfer';

/** The earlier payment that looks like the same money. */
export interface EarlierPayment {
  id: string;
  /** Dollars, as stored (numeric(10,2)). */
  amount: number;
  /** `payments.paid_on` ("YYYY-MM-DD"): the date the order's ledger shows. */
  paid_on: string;
}

/** Result of {@link findLikelyDuplicate}. */
export type DuplicateCheck =
  | { kind: 'none' }
  | { kind: 'found'; payment: EarlierPayment }
  /** The lookup failed or answered oddly. Callers must NOT read this as `none`. */
  | { kind: 'unknown'; message: string };

/** A check result that stops an automatic or unconfirmed payment. */
export type DuplicateHold = Exclude<DuplicateCheck, { kind: 'none' }>;

/** One `payments` row as the lookup selects it. */
interface PaymentRow {
  id: string;
  amount: number | string;
  paid_on: string;
  /** Embedded through `etransfers.payment_id`; empty for a hand-entered payment. */
  etransfers?: Array<{ id: string }> | null;
}

const DAY_MS = 86_400_000;

/** Whole cents, so 250, "250.00" and 249.999999 compare equal and 250.01 does not. */
function cents(value: number | string): number {
  return Math.round(Number(value) * 100);
}

/** "$250.00" — the format the order trail and the payment routes already use. */
function dollars(value: number): string {
  return `$${value.toFixed(2)}`;
}

/**
 * Whole days since 1970-01-01 for a real "YYYY-MM-DD" calendar date, or
 * NaN for anything else (including "2026-02-31"). UTC is used only as a
 * fixed calendar to count days on; no clock time is involved.
 */
function dayNumber(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return NaN;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(ms).toISOString().slice(0, 10) === iso ? ms / DAY_MS : NaN;
}

/** The calendar date `offset` days from day number `day`, as "YYYY-MM-DD". */
function dateOf(day: number, offset: number): string {
  return new Date((day + offset) * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Looks for an earlier payment on `orderId` of exactly `amount` (to the
 * cent) whose `paid_on` is within {@link DUPLICATE_DATE_TOLERANCE_DAYS}
 * calendar days of `paidOn` (inclusive), that came through `origin`.
 *
 * The query is bounded in SQL by order, amount and the date range; the
 * rows are re-checked here against the same rule, so the rule is stated
 * once in code a reader can follow.
 *
 * @param sb Service-role Supabase client
 * @param orderId The order the new payment is for
 * @param amount The new payment's amount in dollars
 * @param paidOn The new payment's date, "YYYY-MM-DD": the e-Transfer's
 *   Toronto date (webhook) or the date staff entered (staff route)
 * @param origin Which door the EARLIER payment must have come through:
 *   `hand_entered` (no `etransfers` row links to it) when an e-Transfer is
 *   arriving; `etransfer` when staff are typing a payment in
 * @returns `found` with the earlier payment, `none`, or `unknown` when the
 *   lookup could not answer or `paidOn` is not a calendar date (never thrown)
 */
export async function findLikelyDuplicate(
  sb: SupabaseClient,
  orderId: string,
  amount: number,
  paidOn: string,
  origin: PaymentOrigin
): Promise<DuplicateCheck> {
  const day = dayNumber(paidOn);
  if (Number.isNaN(day)) return { kind: 'unknown', message: `not a calendar date: ${paidOn}` };
  const want = cents(amount);
  try {
    const { data, error } = await sb
      .from('payments')
      .select('id, amount, paid_on, etransfers(id)')
      .eq('order_id', orderId)
      .eq('amount', (want / 100).toFixed(2))
      .gte('paid_on', dateOf(day, -DUPLICATE_DATE_TOLERANCE_DAYS))
      .lte('paid_on', dateOf(day, DUPLICATE_DATE_TOLERANCE_DAYS));
    if (error) return { kind: 'unknown', message: error.message };
    if (!Array.isArray(data)) return { kind: 'unknown', message: 'unexpected response from the payments lookup' };
    const hit = (data as unknown as PaymentRow[]).find((row) => {
      const viaEtransfer = (row.etransfers ?? []).length > 0;
      const apart = Math.abs(dayNumber(String(row.paid_on)) - day);
      return (
        cents(row.amount) === want &&
        apart <= DUPLICATE_DATE_TOLERANCE_DAYS &&
        viaEtransfer === (origin === 'etransfer')
      );
    });
    if (!hit) return { kind: 'none' };
    return {
      kind: 'found',
      payment: { id: String(hit.id), amount: Number(hit.amount), paid_on: String(hit.paid_on) },
    };
  } catch (e) {
    return { kind: 'unknown', message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * The order-trail line the webhook writes when it matched a transfer to
 * this order but did not record it. Names the earlier payment (or why it
 * could not check) and where the transfer now waits.
 */
export function heldTransferLog(amount: number, hold: DuplicateHold): string {
  const why =
    hold.kind === 'found'
      ? `a payment of ${dollars(hold.payment.amount)} dated ${formatDateLong(hold.payment.paid_on)} ` +
        `(within ${DUPLICATE_DATE_TOLERANCE_DAYS} days of this one) is already recorded here and may be the same money.`
      : `it could not be checked against the payments already recorded here (${hold.message}).`;
  return (
    `An e-Transfer of ${dollars(amount)} was matched to this order but NOT recorded automatically: ${why} ` +
    'It is waiting under Received e-Transfers in the Record payment sheet: apply it there if this is a ' +
    'second payment, or dismiss it if it is the same money.'
  );
}

/**
 * The short reason stored in the alert's `subject` for a held transfer.
 * The web renders it as "<amount> from <sender> — <reason>." (see
 * `apps/web/src/pages/notifications/notificationText.ts`), so it carries
 * no trailing period.
 */
export function heldTransferAlert(orderNumber: string, hold: DuplicateHold): string {
  return hold.kind === 'found'
    ? `held for review: ${orderNumber} already has a ${dollars(hold.payment.amount)} payment dated ` +
        formatDateLong(hold.payment.paid_on)
    : `held for review: ${orderNumber} could not be checked for an earlier payment`;
}

/**
 * The sentence the staff route returns with a 409 `possible_duplicate`;
 * the payment sheet shows it as the confirmation's message.
 */
export function manualDuplicateMessage(earlier: EarlierPayment): string {
  return (
    `An e-Transfer of ${dollars(earlier.amount)} dated ${formatDateLong(earlier.paid_on)} is already ` +
    `recorded on this order, within ${DUPLICATE_DATE_TOLERANCE_DAYS} days of this payment. ` +
    'Record this payment as well only if the customer really paid twice.'
  );
}
