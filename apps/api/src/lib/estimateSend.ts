// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * The multi-estimate send: one email, one customer link, several of that
 * customer's estimates.
 *
 * Two halves, deliberately kept apart within the file:
 *
 *   1. The SELECTION RULES ({@link planSelection}, {@link sendLogLine})
 *      are pure. They read no database, clock or network: the caller
 *      fetches the candidate rows and passes them in with today's date.
 *      That is what makes every rejection testable without a Supabase
 *      fake (`estimateSend.test.ts`).
 *   2. The ORCHESTRATOR ({@link runEstimateSend}) applies a plan: it
 *      reads Supabase, sends the email and writes the statuses. It lives
 *      here rather than in `routes/customers.ts` so the route stays a
 *      thin parse-and-respond handler (AI_GUIDELINES §6); the half above
 *      stays free of Supabase so it keeps testing in isolation.
 *
 * Dates are `YYYY-MM-DD` strings compared lexicographically, as everywhere
 * else in the API; no `Date` arithmetic is ever performed.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  countActiveEstimates,
  customerLinkUrl,
  ensureCustomerToken,
  ensureOrderToken,
} from './customerLink';
import { greetingName } from './customerName';
import {
  brandFromSettings,
  buildEstimatesEmailHtml,
  estimatesEmailSubject,
  sendEmail,
  type CompanyBrand,
} from './email';
import { logOrderEvent } from './orderLog';
import { freezeOrderPrices } from './priceLockStore';

/** The order columns the send route reads for each candidate row. */
export interface SendCandidateRow {
  id: string;
  order_number: string;
  title: string | null;
  customer_id: string;
  status: string;
  /** `YYYY-MM-DD`; an estimate is live through the end of this day. */
  expiry_date: string;
  /** Number of line items on the row — 0 cannot be sent. */
  item_count: number;
  public_token: string | null;
  terms_snapshot: string | null;
}

/**
 * A validated selection, split by what each row needs. Both lists keep the
 * consultant's request order, which is the order the estimates appear in
 * the customer's email.
 */
export interface SelectionPlan {
  /** Rows that were `draft`: status write + freeze, in request order. */
  toSend: SendCandidateRow[];
  /** Rows already `sent`: named in the email, never written. */
  toAnnounce: SendCandidateRow[];
}

/**
 * Validates a consultant's selection of estimate ids and splits it into
 * drafts to flip and already-sent rows to merely announce.
 *
 * A selection is sendable only when every id resolves to a row of
 * `customerId`, the row is `draft` or `sent` (a confirmed or `expired`
 * status never is), its `expiry_date` is not before `today` (the same
 * "active" rule as `countActiveEstimates`: expiry on or after today), and
 * it has at least one line item. Ids are walked in the caller's order and
 * the FIRST failure is returned, so the 400 the route sends names one
 * problem at a time. A repeated id is counted once.
 *
 * The error strings are user-facing copy for that 400 response.
 *
 * @param rows       candidate rows fetched by the route (may include extras;
 *                   only rows named in `orderIds` are considered)
 * @param orderIds   the selected estimate ids, in consultant order
 * @param customerId the customer the send is for; every row must match
 * @param today      `YYYY-MM-DD` — passed in so this stays clock-free
 * @returns `{ plan }` for a sendable selection, otherwise `{ error }`
 */
export function planSelection(
  rows: SendCandidateRow[],
  orderIds: string[],
  customerId: string,
  today: string
): { plan: SelectionPlan } | { error: string } {
  if (orderIds.length === 0) return { error: 'Select at least one estimate to send.' };

  const byId = new Map(rows.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const plan: SelectionPlan = { toSend: [], toAnnounce: [] };

  for (const id of orderIds) {
    if (seen.has(id)) continue;
    seen.add(id);

    const r = byId.get(id);
    if (!r) return { error: 'One of the selected estimates no longer exists.' };
    if (r.customer_id !== customerId) {
      return { error: 'One of the selected estimates belongs to another customer.' };
    }
    if (r.status !== 'draft' && r.status !== 'sent') {
      return { error: 'One of the selected estimates cannot be sent in its current status.' };
    }
    if (r.expiry_date < today) {
      return { error: 'One of the selected estimates has expired and cannot be sent.' };
    }
    if (r.item_count === 0) {
      return { error: 'One of the selected estimates has no line items and cannot be sent.' };
    }

    (r.status === 'draft' ? plan.toSend : plan.toAnnounce).push(r);
  }

  return { plan };
}

/**
 * Builds the activity-log line recorded for each estimate in a multi-estimate
 * send, so the history of every order shows it went out by email and that it
 * was not the only estimate marked sent by that one action.
 *
 * `total` counts the estimates NEWLY MARKED SENT by this send — the rows
 * these log lines are attached to. It is deliberately NOT the number of
 * estimates the email names: the email also lists the customer's
 * already-`sent` estimates, and those rows are never written, so counting
 * them here would describe log lines that do not exist.
 *
 * @param email  the address the link was sent to
 * @param index  1-based position of this estimate among those marked sent
 * @param total  number of estimates marked sent by this send
 */
export function sendLogLine(email: string, index: number, total: number): string {
  return `Estimate emailed to ${email} (${index} of ${total} in one send).`;
}

/* ------------------------------------------------------------------ */
/* Orchestration (Supabase + Resend)                                   */
/* ------------------------------------------------------------------ */

/** The environment bindings this module needs (a subset of `Env`). */
export interface EstimateSendEnv {
  /** Origin the customer link is built on, e.g. `https://app.example.com`. */
  APP_URL: string;
  RESEND_API_KEY: string;
  RESEND_FROM?: string;
  RESEND_REPLY_TO?: string;
}

/** The validated request body of `POST /api/customers/:id/send-estimates`. */
export interface EstimateSendInput {
  /** Selected estimate ids, in consultant order. */
  order_ids: string[];
  /** Optional personal note shown above the email's CTA. */
  message?: string;
}

/**
 * What a completed send did, per estimate.
 *
 * `sent` and `failed` can name the SAME id: a row whose status write
 * landed but whose price freeze failed is both written and reported, so
 * the consultant can see that one estimate needs a second look.
 */
export interface EstimateSendReport {
  /** Ids actually flipped to `sent` by this request. */
  sent: string[];
  /** Ids that were already `sent`: named in the email, never written. */
  announced: string[];
  /** Rows the database refused, with the message it gave. */
  failed: Array<{ id: string; error: string }>;
  /** The customer's link token, so the caller can show or copy the link. */
  customer_token: string;
}

/**
 * Either a report for the caller to return as `{ data }`, or a failure
 * with the HTTP status it deserves — the same shape `routes/orders.ts`
 * uses for its own extracted handlers.
 */
export type EstimateSendResult =
  | { data: EstimateSendReport }
  | { error: string; status: 400 | 404 | 500 | 502 };

/** The order columns a candidate row is read from (`line_items` collapses to a count). */
const CANDIDATE_SELECT =
  'id, order_number, title, customer_id, status, expiry_date, public_token, terms_snapshot, line_items(id)';

/**
 * Reads the selected orders and shapes them into {@link SendCandidateRow}s
 * for {@link planSelection}.
 *
 * `line_items(id)` is embedded purely to collapse into `item_count`: the
 * send never needs the items themselves, and PostgREST cannot filter on
 * an embedded count, so "an empty estimate cannot be sent" is enforced in
 * `planSelection` rather than in this query. Rows are NOT filtered by
 * customer or status here either — every such rule is `planSelection`'s,
 * so a mismatch produces its user-facing sentence instead of a row that
 * silently went missing.
 *
 * @returns the candidates, or the database's own message for a 500
 */
async function readSendCandidates(
  sb: SupabaseClient,
  orderIds: string[]
): Promise<{ rows: SendCandidateRow[] } | { error: string }> {
  const { data, error } = await sb.from('orders').select(CANDIDATE_SELECT).in('id', orderIds);
  if (error) return { error: error.message };
  return {
    rows: (data ?? []).map((row) => ({
      id: row.id,
      order_number: row.order_number,
      title: row.title,
      customer_id: row.customer_id,
      status: row.status,
      expiry_date: row.expiry_date,
      item_count: (row.line_items ?? []).length,
      public_token: row.public_token,
      terms_snapshot: row.terms_snapshot,
    })),
  };
}

/**
 * Reads `company_settings` for the email's brand block and for the terms
 * an estimate falls back to when it carries no snapshot of its own.
 *
 * A missing or unreadable settings row must NOT stop a send: the brand
 * falls back to `brandFromSettings`' default company name and the terms
 * stay empty, which is the same tolerance the rest of the API shows. An
 * estimate that already has a `terms_snapshot` keeps it regardless — the
 * customer is holding those terms.
 */
async function readSendBranding(
  sb: SupabaseClient
): Promise<{ brand: CompanyBrand; companyTerms: string }> {
  const { data } = await sb.from('company_settings').select('*').eq('id', 1).maybeSingle();
  const company = (data ?? {}) as {
    company_name?: string | null;
    logo_url?: string | null;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    terms_and_conditions?: string | null;
  };
  return { brand: brandFromSettings(company), companyTerms: company.terms_and_conditions ?? '' };
}

/**
 * Writes the plan's drafts to `sent`, one row at a time.
 *
 * SEQUENTIAL BY DESIGN, never `Promise.all`: a row that fails must not
 * take its siblings' writes down with it, and the activity trail reads
 * "(2 of 3)" only if the rows go in the order the email names them.
 *
 * THE STATUS WRITE COMES BEFORE THE FREEZE, which is the reverse of the
 * old per-order `POST /orders/:id/send`, and deliberate: `holdsPriceLock`
 * is false for `draft`, so a row left `draft` with frozen items would be
 * silently re-priced by the next `PUT /api/orders/:id` — unfreezing
 * figures the customer already holds by email. A row left `sent` with
 * unfrozen items is the safe half-write, because `sent` holds the lock
 * and the next freeze point catches it up.
 *
 * NEVER THROWS. Every failure — a returned `error`, a rejected query, a
 * refused freeze — is collected into `failed` and the loop moves on, so
 * the caller always learns the full outcome. The email is already gone
 * (AI_GUIDELINES §2 runs one way only), so there is nothing to roll back
 * and the request stays a 200; abandoning the remaining rows would only
 * leave more of the selection silently reading `draft`.
 *
 * @param email        address the link went to, for the log line
 * @param sentAt       one ISO timestamp for the whole send — the rows
 *                     went out in a single email, so they share its time
 * @param companyTerms fallback terms for a row with no snapshot yet
 */
async function persistSend(
  sb: SupabaseClient,
  toSend: SendCandidateRow[],
  email: string,
  sentAt: string,
  companyTerms: string
): Promise<Pick<EstimateSendReport, 'sent' | 'failed'>> {
  const sent: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];

  for (const [index, row] of toSend.entries()) {
    // Every per-row failure is caught, not propagated: supabase-js
    // REJECTS on a transport failure rather than returning an `error`, and
    // letting that escape would abandon the remaining rows and answer 500
    // — after the email has already gone out, so the consultant would
    // never learn which estimates are still reading `draft`.
    try {
      const { error } = await sb
        .from('orders')
        .update({
          status: 'sent',
          sent_at: sentAt,
          terms_snapshot: row.terms_snapshot ?? companyTerms,
        })
        .eq('id', row.id);
      if (error) {
        failed.push({ id: row.id, error: error.message });
        continue;
      }
      sent.push(row.id);

      const freezeError = await freezeOrderPrices(sb, row.id);
      if (freezeError) failed.push({ id: row.id, error: freezeError });

      await logOrderEvent(sb, row.id, sendLogLine(email, index + 1, toSend.length));
      if (!freezeError) await logOrderEvent(sb, row.id, 'Item prices locked at send.');
    } catch (e) {
      failed.push({
        id: row.id,
        error: e instanceof Error ? e.message : 'Could not mark the estimate sent.',
      });
    }
  }

  return { sent, failed };
}

/**
 * Emails a customer ONE link covering several of their estimates and
 * marks every selected draft as sent.
 *
 * Replaces the per-order `POST /api/orders/:id/send`: the customer gets
 * a single message naming each estimate, and the link (`/c/:token`) is
 * where the figures are read — so this send carries NO PDF attachment.
 *
 * The order of the steps is the contract, not a style:
 *   1. the customer must exist, not be soft-deleted, and have an email
 *      address;
 *   2. the selection is validated by {@link planSelection}, whose first
 *      rejection becomes the 400 — nothing is written on a bad selection;
 *   3. tokens are minted BEFORE the email, because a token announces
 *      nothing and the email needs the link in it (the `/pdf` download
 *      already mints the same way);
 *   4. the email goes out; a throw here is a 502 with NOT ONE database
 *      write, which is AI_GUIDELINES §2 — a status that announces
 *      something by email persists only after the email succeeds;
 *   5. only then are the statuses written, by {@link persistSend}.
 *
 * `liveCount` is how many live estimates the link will show AFTER this
 * send: the stored count plus `toSend.length`, because those rows are
 * still `draft` at that moment and so are not in the count yet. The
 * already-`sent` rows of `toAnnounce` are counted by the query itself.
 *
 * @param customerId the customer the estimates must all belong to
 * @returns a report, or an error with the status the route should send
 */
export async function runEstimateSend(
  sb: SupabaseClient,
  env: EstimateSendEnv,
  customerId: string,
  input: EstimateSendInput
): Promise<EstimateSendResult> {
  const today = new Date().toISOString().slice(0, 10);

  const { data: customer, error: customerError } = await sb
    .from('customers')
    .select('id, first_name, last_name, email')
    .eq('id', customerId)
    .is('deleted_at', null)
    .maybeSingle();
  if (customerError) return { error: customerError.message, status: 500 };
  if (!customer) return { error: 'Customer not found', status: 404 };
  const email = String(customer.email ?? '').trim();
  if (!email) return { error: 'This customer has no email address.', status: 400 };

  const candidates = await readSendCandidates(sb, input.order_ids);
  if ('error' in candidates) return { error: candidates.error, status: 500 };

  const planned = planSelection(candidates.rows, input.order_ids, customerId, today);
  if ('error' in planned) return { error: planned.error, status: 400 };
  const { toSend, toAnnounce } = planned.plan;

  let customerToken: string | null;
  try {
    customerToken = await ensureCustomerToken(sb, customerId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not prepare the link', status: 500 };
  }
  if (!customerToken) return { error: 'Customer not found', status: 404 };

  // The estimates are named in the order the consultant ticked them, which
  // is the contract `SelectionPlan` documents. `planSelection` hands back
  // two buckets, so concatenating them would quietly reorder a mixed
  // selection; the ids are already deduped there, so position in the
  // request is a total order over these rows.
  const named = [...toSend, ...toAnnounce].sort(
    (a, b) => input.order_ids.indexOf(a.id) - input.order_ids.indexOf(b.id)
  );

  // Every named estimate needs its own token too: the customer link hands
  // it to the detail view, and a `sent` row that never went out by email
  // may not have one yet.
  try {
    for (const row of named) await ensureOrderToken(sb, row.id, row.public_token);
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not prepare the link', status: 500 };
  }

  const { brand, companyTerms } = await readSendBranding(sb);

  const estimates = named.map((row) => ({ order_number: row.order_number, title: row.title }));
  let liveCount: number;
  try {
    liveCount = (await countActiveEstimates(sb, customerId, today)) + toSend.length;
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not prepare the email', status: 500 };
  }

  try {
    await sendEmail(env, {
      to: email,
      subject: estimatesEmailSubject(brand.name, estimates),
      html: buildEstimatesEmailHtml({
        company: brand,
        customerFirstName: greetingName(customer),
        message: input.message,
        viewUrl: customerLinkUrl(env.APP_URL, customerToken),
        estimates,
        liveCount,
      }),
    });
  } catch (e) {
    // Nothing has been written yet, so the selection is untouched and the
    // consultant can simply press Send again.
    return { error: e instanceof Error ? e.message : 'Email send failed', status: 502 };
  }

  const { sent, failed } = await persistSend(
    sb,
    toSend,
    email,
    new Date().toISOString(),
    companyTerms
  );
  return {
    data: { sent, announced: toAnnounce.map((row) => row.id), failed, customer_token: customerToken },
  };
}
