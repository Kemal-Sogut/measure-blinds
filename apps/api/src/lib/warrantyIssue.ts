// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Issues the warranty certificate for an order that is paid in full —
 * the shared side effect behind BOTH ways money reaches an order.
 *
 * `POST /orders/:id/payments` (a consultant recording a payment) and
 * `POST /webhooks/etransfer` (an e-Transfer matched automatically) both
 * call this immediately after `recordOrderPayment`, exactly as they
 * share `recordOrderPayment` itself, so the customer receives the same
 * certificate no matter how they paid. The staff "resend warranty"
 * action calls it too, with `force`.
 *
 * ORDERING (AI_GUIDELINES §2, email-then-persist): `warranty_sent_at` is
 * stamped only after Resend accepts the send, so a failure leaves the
 * order re-sendable. `warranty_starts_on` is the deliberate exception —
 * it is persisted BEFORE the send, because the date an order was paid in
 * full is a fact about the order rather than about the email, and every
 * later regeneration of the certificate must reproduce the same expiry
 * dates.
 *
 * NEVER THROWS. In the automatic paths the payment is already committed
 * when this runs; a bounced warranty email must not turn a recorded
 * payment into a failed request. Every outcome comes back as a value for
 * the caller to log.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { brandFromSettings, sendEmail } from './email';
import { greetingName } from './customerName';
import { fetchLogo, toBase64 } from './pdf';
import { formatDateLong } from './timeText';
import { buildWarrantyCoverage } from './warranty';
import { buildWarrantyEmailHtml } from './warrantyEmail';
import { buildWarrantyPdf } from './warrantyPdf';

/** The environment bindings this module needs (a subset of `Env`). */
export interface WarrantyEnv {
  RESEND_API_KEY: string;
  RESEND_FROM?: string;
  RESEND_REPLY_TO?: string;
  APP_URL: string;
}

/** Why an issue attempt did nothing. */
export type WarrantySkipReason =
  | 'order_not_found'
  /** Money is still owed — the warranty is not due yet. */
  | 'balance_outstanding'
  /** Already issued and `force` was not set (the idempotency guard). */
  | 'already_sent'
  /** The customer has no email address, so nothing can be delivered. */
  | 'no_email';

/**
 * Outcome of an issue attempt. `failed` means the email provider
 * rejected the send and nothing was stamped — the order stays
 * re-sendable, and the caller decides whether that is a 502 (manual
 * resend) or an activity-log line (automatic path).
 */
export type WarrantyIssueResult =
  | { status: 'sent'; sentAt: string; email: string }
  | { status: 'skipped'; reason: WarrantySkipReason }
  | { status: 'failed'; message: string };

/** Options for one issue attempt. */
export interface WarrantyIssueOptions {
  /** Bypass the `already_sent` guard — the staff resend action. */
  force?: boolean;
  /** Optional consultant note shown in a highlighted block in the email. */
  message?: string;
}

/**
 * Tolerance for "paid in full": half a cent, so an overpayment or a
 * rounding remainder still counts as settled. Same epsilon the
 * e-Transfer matcher uses.
 */
const PAID_EPSILON = 0.005;

/** Sums a payment ledger to 2dp. */
function sumPayments(payments: Array<{ amount: number | string }> | null | undefined): number {
  const total = (payments ?? []).reduce((acc, p) => acc + Number(p.amount), 0);
  return Math.round(total * 100) / 100;
}

/**
 * The date coverage should run from: the latest `paid_on` in the ledger
 * — the day the payment that settled the order arrived. Back-dated
 * payments are honoured (the customer's money really was received then).
 * Falls back to today for the degenerate case of a zero-total order with
 * no ledger at all, which only the manual action can reach.
 */
function paidInFullDate(payments: Array<{ paid_on?: string | null }> | null | undefined): string {
  const dates = (payments ?? [])
    .map((p) => p.paid_on)
    .filter((d): d is string => typeof d === 'string' && d.length === 10)
    .sort();
  return dates[dates.length - 1] ?? new Date().toISOString().slice(0, 10);
}

/**
 * Appends one row to the order's activity trail. Best-effort — a logging
 * failure must never mask the outcome it is describing.
 */
async function log(sb: SupabaseClient, orderId: string, message: string): Promise<void> {
  try {
    await sb.from('order_logs').insert({ order_id: orderId, message });
  } catch {
    // Intentionally ignored.
  }
}

/**
 * Emails the warranty certificate when — and only when — the order's
 * balance has reached zero.
 *
 * Runs the guards in order (exists, paid in full, not already issued,
 * has an email), snapshots `warranty_starts_on` if it is not set yet,
 * renders the certificate, sends it as a PDF attachment, then stamps
 * `warranty_sent_at` and writes the activity log.
 *
 * @param sb Service-role Supabase client
 * @param env Resend credentials + `APP_URL` for the customer page link
 * @param orderId The order to issue for
 * @param opts `force` to resend an already-issued warranty; `message` for
 *             an optional consultant note
 * @returns What happened — never throws, even on network failure
 */
export async function issueWarrantyIfPaid(
  sb: SupabaseClient,
  env: WarrantyEnv,
  orderId: string,
  opts: WarrantyIssueOptions = {}
): Promise<WarrantyIssueResult> {
  try {
    const [{ data: order }, { data: company }] = await Promise.all([
      sb
        .from('orders')
        .select('*, line_items(*), customer:customers(*), payments(*)')
        .eq('id', orderId)
        .order('position', { referencedTable: 'line_items' })
        .order('paid_on', { referencedTable: 'payments' })
        .maybeSingle(),
      sb.from('company_settings').select('*').eq('id', 1).single(),
    ]);
    if (!order || !company) return { status: 'skipped', reason: 'order_not_found' };

    const balance = Math.round((Number(order.total) - sumPayments(order.payments)) * 100) / 100;
    if (balance > PAID_EPSILON) return { status: 'skipped', reason: 'balance_outstanding' };

    // Idempotency: a second payment on an already-warrantied order (or a
    // duplicate webhook delivery) must not mail the customer again.
    if (order.warranty_sent_at && !opts.force) {
      return { status: 'skipped', reason: 'already_sent' };
    }

    // Snapshot the coverage start before anything can fail, so a retry —
    // or a staff download months later — prints identical expiry dates.
    const startsOn: string = order.warranty_starts_on ?? paidInFullDate(order.payments);
    if (!order.warranty_starts_on) {
      await sb.from('orders').update({ warranty_starts_on: startsOn }).eq('id', orderId);
    }

    const email: string | undefined = order.customer?.email;
    if (!email) {
      await log(sb, orderId, 'Warranty not emailed — no email address on file.');
      return { status: 'skipped', reason: 'no_email' };
    }

    // A hidden item was never charged for, so nothing covers it.
    const coverage = buildWarrantyCoverage(
      (order.line_items ?? []).filter((li: Record<string, unknown>) => !li.hidden),
      startsOn
    );
    const issuedOn = new Date().toISOString().slice(0, 10);
    const pdf = await buildWarrantyPdf({
      order: { order_number: order.order_number, order_date: order.order_date },
      coverage,
      customer: order.customer,
      company: {
        company_name: company.company_name || 'Blinds Nisa',
        logo_url: company.logo_url,
        email: company.email,
        phone: company.phone,
        address: company.address,
      },
      issuedOn,
      logo: await fetchLogo(company.logo_url),
    });

    // The public page link is best-effort: an order that was never
    // emailed has no token yet, and minting one here would be a side
    // effect this module has no business having. The certificate itself
    // is attached either way.
    const viewUrl = order.public_token ? `${env.APP_URL}/customer/${order.public_token}` : env.APP_URL;

    await sendEmail(env, {
      to: email,
      subject: `Your warranty certificate ${order.order_number} from ${company.company_name || 'Blinds Nisa'}`,
      html: buildWarrantyEmailHtml({
        company: brandFromSettings(company),
        customerFirstName: greetingName(order.customer),
        orderNumber: order.order_number,
        coverageStart: formatDateLong(coverage.startsOn),
        standardExpiry: formatDateLong(coverage.standardExpiry),
        motorExpiry: formatDateLong(coverage.motorExpiry),
        hasMotorised: coverage.hasMotorised,
        viewUrl,
        message: opts.message,
      }),
      attachments: [
        { filename: `${order.order_number}-warranty.pdf`, content: toBase64(pdf) },
      ],
    });

    const sentAt = new Date().toISOString();
    const { error } = await sb
      .from('orders')
      .update({ warranty_sent_at: sentAt })
      .eq('id', orderId);
    if (error) return { status: 'failed', message: error.message };

    await log(sb, orderId, `Warranty certificate emailed to ${email}.`);
    return { status: 'sent', sentAt, email };
  } catch (e) {
    return { status: 'failed', message: e instanceof Error ? e.message : 'Warranty issue failed' };
  }
}
