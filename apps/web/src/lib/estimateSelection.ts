// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pure logic for the send-estimates picker dialog (spec 2026-10-24).
 *
 * The dialog lists a customer's sendable estimates (all ticked by default),
 * lets the consultant untick some, and emails ONE customer link covering the
 * rest. Everything here is a pure function over plain arrays so it can be
 * unit-tested without a component harness — `apps/web` has none. No clock,
 * network or React: the dialog and its hooks are layered on top.
 *
 * Eligibility (right customer, draft-or-sent, not expired, has line items)
 * is decided by the server; nothing here re-filters the rows it is given.
 * The one exception is a DRAFT with incomplete items (spec 2026-11-02):
 * the server lists it, with `incomplete_items`, so the consultant can see
 * it exists, but the send would refuse it — so {@link isSendable} keeps it
 * out of every selection.
 */

/**
 * One row of `GET /api/customers/:id/sendable-estimates`. Mirrors the server
 * payload exactly; `status` is only ever `draft` or `sent` because the
 * server has already excluded every other state.
 */
export interface SendableEstimate {
  id: string;
  order_number: string;
  title: string | null;
  status: 'draft' | 'sent';
  order_date: string;
  expiry_date: string;
  total: number;
  /**
   * How many of a draft's items are still incomplete (the Worker's
   * `attachIncompleteCounts`); `0` for a sent row. Optional so a list from
   * a Worker that predates the field reads as complete — that Worker has
   * no incomplete items to report.
   */
  incomplete_items?: number;
}

/**
 * Whether a row can be ticked: false only for a DRAFT with incomplete
 * items, which the Worker's send refuses outright (and with it the whole
 * request). A sent row is never re-judged — it left draft complete.
 */
export function isSendable(row: SendableEstimate): boolean {
  return !(row.status === 'draft' && (row.incomplete_items ?? 0) > 0);
}

/**
 * The selection the dialog opens with: every SENDABLE row's id, in `rows`
 * order. Sending is opt-out — the consultant unticks what should not go —
 * except that an incomplete draft ({@link isSendable}) never starts ticked.
 */
export function initialSelection(rows: SendableEstimate[]): string[] {
  return rows.filter(isSendable).map((r) => r.id);
}

/**
 * Adds `id` to `selected` if absent, removes it if present, and returns a new
 * array ordered by `rows` (not by click order) so the send payload matches
 * the order the consultant sees. Ids not present in `rows` are dropped, since
 * the list is a snapshot and a stale id could never be sent anyway, and so
 * is any row {@link isSendable} refuses — ticking an incomplete draft is a
 * no-op. Does not mutate its input.
 */
export function toggleSelection(
  selected: string[],
  id: string,
  rows: SendableEstimate[]
): string[] {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return rows.filter((r) => next.has(r.id) && isSendable(r)).map((r) => r.id);
}

/**
 * Label for the dialog's send button: `Send estimate` for one, `Send N
 * estimates` for several. At zero it returns `Send estimates` — the button is
 * disabled then, so the label is a resting state, not an instruction.
 */
export function sendButtonLabel(count: number): string {
  if (count === 0) return 'Send estimates';
  if (count === 1) return 'Send estimate';
  return `Send ${count} estimates`;
}

/**
 * The single toast string shown after `POST /api/customers/:id/send-estimates`
 * answers HTTP 200 with a non-empty `failed` list.
 *
 * The email DID go out in this case — retrying is safe but the customer
 * already has the mail — so the message leads with that. Affected estimates
 * are named by `order_number`, falling back to the raw id when the id is not
 * in `rows` (the list is a snapshot and may have changed).
 *
 * Wording decision: a `failed` id can ALSO appear in the response's `sent`
 * list (its status write succeeded but the later price freeze failed), and
 * this function is deliberately not told which case it is. So it never says
 * an estimate "was not sent"; it says the estimate "could not be fully
 * recorded", which is true both for a row that was never marked and for one
 * that was marked but not frozen. The server's per-row `error` text is
 * technical and is not shown to the consultant. The closing instruction
 * agrees with the count: "the estimate" for one, "each estimate" for several.
 *
 * Precondition: `failed` is non-empty (the dialog only calls this when the
 * response carries failures); an empty list yields a sentence with no names.
 */
export function partialFailureMessage(
  failed: Array<{ id: string; error: string }>,
  rows: SendableEstimate[]
): string {
  const numberById = new Map(rows.map((r) => [r.id, r.order_number]));
  const names = failed.map((f) => numberById.get(f.id) ?? f.id).join(', ');
  const which = failed.length === 1 ? 'the estimate' : 'each estimate';
  return `The email was sent, but ${names} could not be fully recorded. Open ${which} and check its status before sending it again.`;
}
