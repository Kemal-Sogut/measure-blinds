// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Selection rules for the multi-estimate send: one email, one customer
 * link, several of that customer's estimates.
 *
 * This module is pure. It reads no database, clock or network: the send
 * route fetches the candidate rows from Supabase, passes them in with
 * today's date, and acts on the plan returned. Keeping the rules here
 * makes every rejection testable without a Supabase fake, and lets the
 * route stay a thin orchestrator (AI_GUIDELINES §6).
 *
 * Dates are `YYYY-MM-DD` strings compared lexicographically, as everywhere
 * else in the API; no `Date` is ever constructed.
 */

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
 * send, so the history of every order shows it went out by email and how
 * many estimates shared that email.
 *
 * @param email  the address the link was sent to
 * @param index  1-based position of this estimate within the send
 * @param total  number of estimates in the send
 */
export function sendLogLine(email: string, index: number, total: number): string {
  return `Estimate emailed to ${email} (${index} of ${total} in one send).`;
}
