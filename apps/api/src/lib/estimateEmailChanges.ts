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
 *   2. {@link readAnnouncedChanges}, the READ-ONLY lookup the send runs
 *      before the email goes out. It diffs each already-`sent` estimate
 *      against its latest revision and writes nothing, so the
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
  for (const row of rows) {
    try {
      const res = await checkPendingChanges(sb, row.id);
      out.set(row.id, 'error' in res ? [] : res.changes.map(describeChange));
    } catch {
      out.set(row.id, []);
    }
  }
  return out;
}
