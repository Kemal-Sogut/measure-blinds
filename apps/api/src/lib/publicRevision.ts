// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Which quote the customer's estimate page is served, and the revision
 * fields that travel with it (migration 50, `order_revisions`).
 *
 * While an estimate is waiting on the customer (`sent`, or `expired`)
 * and has been sent under revision tracking, the page shows the LATEST
 * REVISION'S SNAPSHOT — what the customer was actually sent — never the
 * live order, so a staff save cannot reach the customer before a send.
 * An order with no revision (sent before tracking existed) falls back to
 * the live order, as before. From confirmation on the live order is
 * served: payments run against it, and edits there are deliberate
 * fulfilment changes.
 *
 * A failed revision read is returned as `{ error }` and NEVER falls back
 * to live data: an unreadable history is not the same as "no history",
 * and guessing would publish unsent edits.
 *
 * Everything returned here is still staff-shaped (lines carry `uid`);
 * the route passes lines through `toPublicLines` before they leave the
 * Worker. No `source`, `source_kind`, revision id or revision total is
 * ever exposed.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { buildPublicQuote, type PublicQuote } from './publicQuote';
import { describeChange, diffQuotes } from './quoteDiff';
import { listRevisions, readRevisionByNo, type RevisionRow } from './orderRevisions';

/** One revision as the customer page lists it: number and date only. */
export interface PublicRevisionRef {
  rev_no: number;
  sent_at: string;
}

/** The quote the customer page renders, plus its revision context. */
export interface ServedQuote {
  /** Snapshot of the latest revision, or the live quote (see module doc). */
  quote: PublicQuote;
  /** The latest revision, or `null` for an order never sent under tracking. */
  revision: PublicRevisionRef | null;
  /** Every revision, newest first. */
  revisions: PublicRevisionRef[];
  /**
   * What changed from the previous revision to the latest, as readable
   * lines (`describeChange`); `[]` for Rev 1 or no revision.
   */
  changes_since_previous: string[];
}

/** Statuses during which the customer is shown the sent snapshot. */
const SNAPSHOT_STATUSES = new Set(['sent', 'expired']);

function ref(row: { rev_no: number; sent_at: string }): PublicRevisionRef {
  return { rev_no: row.rev_no, sent_at: row.sent_at };
}

/**
 * Decides which quote the public estimate page serves and gathers the
 * revision fields for it.
 *
 * @param sb Service-role Supabase client.
 * @param order The order row as `loadByToken` read it (with `line_items`).
 * @param status The order's effective status (after defensive expiry).
 * @returns `{ served }`, or `{ error }` when any revision read failed —
 *   the caller answers 500 rather than falling back to live data.
 */
export async function resolveServedQuote(
  sb: SupabaseClient,
  order: Record<string, unknown>,
  status: string
): Promise<{ served: ServedQuote } | { error: string }> {
  const orderId = String(order.id);
  const listed = await listRevisions(sb, orderId);
  if ('error' in listed) return { error: listed.error };
  const [latestRef, previousRef] = listed.rows;
  if (!latestRef) {
    return {
      served: {
        quote: buildPublicQuote(order),
        revision: null,
        revisions: [],
        changes_since_previous: [],
      },
    };
  }

  const latestRead = await readRevisionByNo(sb, orderId, latestRef.rev_no);
  if ('error' in latestRead) return { error: latestRead.error };
  const latest = latestRead.row;
  if (!latest) return { error: 'Latest revision vanished mid-read' };

  let changes: string[] = [];
  if (previousRef) {
    const previousRead = await readRevisionByNo(sb, orderId, previousRef.rev_no);
    if ('error' in previousRead) return { error: previousRead.error };
    if (previousRead.row) {
      changes = diffQuotes(previousRead.row.snapshot, latest.snapshot).map(describeChange);
    }
  }

  return {
    served: {
      quote: SNAPSHOT_STATUSES.has(status) ? latest.snapshot : buildPublicQuote(order),
      revision: ref(latest),
      revisions: listed.rows.map(ref),
      changes_since_previous: changes,
    },
  };
}

/**
 * Reads one earlier revision for the customer's read-only "previous
 * versions" view. Available at any order status.
 *
 * @param revParam The raw `:rev` route parameter; anything but a
 *   positive integer reads as "no such revision".
 * @returns `{ row }` (`null` = not found) or `{ error }`.
 */
export async function readPublicRevision(
  sb: SupabaseClient,
  orderId: string,
  revParam: string
): Promise<{ row: RevisionRow | null } | { error: string }> {
  if (!/^[1-9]\d{0,5}$/.test(revParam)) return { row: null };
  return readRevisionByNo(sb, orderId, Number(revParam));
}
