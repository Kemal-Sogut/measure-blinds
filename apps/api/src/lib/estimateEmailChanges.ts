// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Helpers that let the estimates email say "updated" and list what changed
 * (estimate-revisions, Task 7).
 *
 * Two halves, kept apart so the template stays free of Supabase:
 *
 *   1. PURE copy helpers ({@link isUpdateEmail}, {@link changeLinesForEmail})
 *      that `email.ts` renders from.
 *   2. {@link readAnnouncedChanges} / {@link readRevisedDraftChanges}, the
 *      READ-ONLY lookups the send runs before the email goes out. They
 *      diff each already-`sent` estimate (and each draft that already has
 *      revision history) against its latest revision and write nothing,
 *      so the
 *      email-then-persist order (AI_GUIDELINES §2) is untouched: a revision
 *      row is only cut afterwards, by `stampSent`, once the email succeeded.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EstimateEmailLine } from './email';
import { checkPendingChanges } from './orderRevisions';
import { describeChange } from './quoteDiff';

/** How many change lines one estimate shows before the rest collapse into "and {m} more". */
export const MAX_EMAIL_CHANGE_LINES = 5;

/**
 * True when the email is purely an update notice: it names at least one
 * estimate and EVERY named estimate carries a non-empty `changes` list.
 * `changes: undefined` (a new estimate) or `[]` (re-announced unchanged)
 * on any line makes it an ordinary "ready" email, so the word "updated" is
 * never used without evidence for every estimate named.
 */
export function isUpdateEmail(estimates: EstimateEmailLine[]): boolean {
  return estimates.length > 0 && estimates.every((e) => (e.changes?.length ?? 0) > 0);
}

/**
 * Caps an estimate's change descriptions for the email: at most
 * {@link MAX_EMAIL_CHANGE_LINES} lines, then a closing "and {m} more"
 * when the list was longer.
 *
 * The lines are still PLAIN TEXT and carry customer-entered labels, so
 * the template (`email.ts`) must `escapeHtml` each one when rendering.
 *
 * @param changes Described changes (`describeChange` output); may be empty.
 * @returns The lines to show, `[]` when there is nothing to list.
 */
export function changeLinesForEmail(changes: string[]): string[] {
  const shown = changes.slice(0, MAX_EMAIL_CHANGE_LINES);
  const more = changes.length - shown.length;
  return more > 0 ? [...shown, `and ${more} more`] : shown;
}

/**
 * Reads, for each already-`sent` estimate being re-announced, what the
 * customer has not yet been told: the customer-visible differences between
 * the saved order and its latest revision. Strictly read-only.
 *
 * A row with no revision (an order sent before revision tracking), or one
 * whose comparison failed to read, maps to `[]`, which the email treats as
 * a plain re-announce. A failed read must never fail the send, and must
 * never be reported to the customer as "updated" without evidence.
 *
 * @param sb Service-role Supabase client.
 * @param rows The `toAnnounce` rows of the selection.
 * @returns The change descriptions per order id, in row order.
 */
export async function readAnnouncedChanges(
  sb: SupabaseClient,
  rows: Array<{ id: string }>
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const row of rows) out.set(row.id, (await readChanges(sb, row.id))?.changes ?? []);
  return out;
}

/**
 * The draft half of {@link readAnnouncedChanges}: for each `draft` being
 * sent that ALREADY has revision history (sent, reverted to draft, edited,
 * now re-sent), what the customer has not yet been told since its latest
 * revision — so the email can say "updated" and list it, exactly as for an
 * already-`sent` row. Strictly read-only.
 *
 * A draft with no revision is a genuinely new estimate and gets NO entry,
 * so its email line keeps `changes: undefined` ("ready"). A failed read
 * also gets no entry: it must never fail the send, nor claim "updated"
 * without evidence.
 *
 * @param sb Service-role Supabase client.
 * @param rows The `toSend` (draft) rows of the selection.
 * @returns Change descriptions per order id, only for drafts with history.
 */
export async function readRevisedDraftChanges(
  sb: SupabaseClient,
  rows: Array<{ id: string }>
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const row of rows) {
    const read = await readChanges(sb, row.id);
    if (read?.hasRevision) out.set(row.id, read.changes);
  }
  return out;
}

/**
 * Diffs one order against its latest revision, never throwing. A failed
 * read is logged with the order id (ops visibility: otherwise an outage
 * here would only show up as customers getting "ready" instead of
 * "updated" emails) and returned as `null`.
 */
async function readChanges(
  sb: SupabaseClient,
  orderId: string
): Promise<{ hasRevision: boolean; changes: string[] } | null> {
  try {
    const res = await checkPendingChanges(sb, orderId);
    if ('error' in res) {
      console.warn(`Estimate email: could not read changes for order ${orderId}: ${res.error}`);
      return null;
    }
    return { hasRevision: res.latest !== null, changes: res.changes.map(describeChange) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn(`Estimate email: could not read changes for order ${orderId}: ${message}`);
    return null;
  }
}
