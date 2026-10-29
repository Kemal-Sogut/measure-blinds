// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Type and pure helper behind the customer page's "Updated … · version N"
 * chip.
 *
 * The customer only ever sees the LATEST sent version and its sent date.
 * There is no way to open or compare an earlier one from the public page:
 * the Worker serves no revision list, no per-revision endpoint and no
 * change lines, so nothing here fetches or diffs.
 *
 * Lives beside `CustomerView` rather than in `lib/portal.ts`, which is the
 * multi-estimate portal's data layer, not this page's.
 */

/** The version the customer is shown (`revision` on the public payload). */
export interface RevisionStamp {
  /** 1-based version number; the latest is the highest. */
  rev_no: number;
  /** ISO timestamp of the send that cut this version. */
  sent_at: string;
}

/**
 * `Mon D` in en-CA, pinned to Toronto so the label cannot shift a day with
 * the viewer's own timezone (and tests stay deterministic).
 */
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    timeZone: 'America/Toronto',
  });
}

/**
 * Text of the version chip under the header, e.g. `Updated Oct 26 · version 2`.
 *
 * The chip tells a returning customer the quote changed since they last
 * looked, so a first version (nothing to be "updated" from) and an order
 * with no revision at all (sent before revision tracking) get no chip.
 *
 * @param revision - The revision the customer is being shown, or null
 * @returns The chip text, or null when no chip should render
 */
export function chipLabel(revision: RevisionStamp | null): string | null {
  if (!revision || revision.rev_no < 2) return null;
  return `Updated ${shortDate(revision.sent_at)} · version ${revision.rev_no}`;
}
