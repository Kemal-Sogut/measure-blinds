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
import { buildPublicQuote, toPublicLines, type PublicQuote } from './publicQuote';
import { describeChange, diffQuotes } from './quoteDiff';
import { checkLatestRevision, listRevisions, readRevisionByNo } from './orderRevisions';

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

/** Generic customer-facing wording for a failed read; no DB detail leaks. */
const READ_FAILED = 'Something went wrong. Please try again.';

/**
 * Builds the response of `GET /public/estimate/:token/revisions/:rev`:
 * one earlier revision for the customer's read-only "previous versions"
 * view. Available at any order status (history stays readable after
 * confirmation) and only for the order the token opened. Lines pass
 * through `toPublicLines`; the row's id, kind and staff copy are never
 * part of the body.
 *
 * @param sb Service-role Supabase client.
 * @param orderId The order the token opened.
 * @param revParam The raw `:rev` route parameter; anything but a
 *   positive integer reads as "no such revision" (404).
 * @returns The HTTP status and JSON body for the route to send.
 */
export async function publicRevisionResponse(
  sb: SupabaseClient,
  orderId: string,
  revParam: string
): Promise<{ status: 200 | 404 | 500; body: Record<string, unknown> }> {
  if (!/^[1-9]\d{0,5}$/.test(revParam)) {
    return { status: 404, body: { error: 'Revision not found' } };
  }
  const read = await readRevisionByNo(sb, orderId, Number(revParam));
  if ('error' in read) return { status: 500, body: { error: READ_FAILED } };
  if (!read.row) return { status: 404, body: { error: 'Revision not found' } };
  const { rev_no, sent_at, snapshot } = read.row;
  return {
    status: 200,
    body: {
      data: {
        rev_no,
        sent_at,
        ...snapshot,
        line_items: toPublicLines(snapshot.line_items),
        read_only: true,
      },
    },
  };
}

/** What a customer confirmation records about the revision accepted. */
export interface Acceptance {
  /** Latest revision's id, or `null` for an order never sent under tracking. */
  acceptedRevisionId: string | null;
  /**
   * Trail line for staff when the saved order has moved on since that
   * revision (the customer accepted the sent revision, not the unsent
   * edits), else `null`.
   */
  divergenceLog: string | null;
}

/**
 * Decides what a customer confirmation records: the customer accepts the
 * revision their page shows, which is the latest one. Read-only — the
 * route writes `acceptedRevisionId` inside its own guarded update and
 * logs `divergenceLog` only once that update has won.
 *
 * @param sb Service-role Supabase client.
 * @param order The order row as `loadByToken` read it (with `line_items`).
 * @returns The {@link Acceptance}, or `{ error }` when the revision could
 *   not be read — the caller answers 500 so an acceptance is never
 *   recorded blind.
 */
export async function resolveAcceptance(
  sb: SupabaseClient,
  order: Record<string, unknown>
): Promise<Acceptance | { error: string }> {
  const read = await checkLatestRevision(sb, String(order.id));
  if ('error' in read) return { error: read.error };
  const latest = read.row;
  if (!latest) return { acceptedRevisionId: null, divergenceLog: null };
  const diverged = diffQuotes(latest.snapshot, buildPublicQuote(order)).length > 0;
  return {
    acceptedRevisionId: latest.id,
    divergenceLog: diverged
      ? `Customer confirmed Rev ${latest.rev_no}; later unsent changes are not part of it.`
      : null,
  };
}
