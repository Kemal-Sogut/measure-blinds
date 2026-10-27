// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Restoring an earlier estimate revision (migration 50, Design decision 8).
 *
 * A restore is a normal save, not a rewind. Staff load a revision's
 * staff-only `source` into the editor (`GET /api/orders/:id/revisions/
 * :revisionId`, served by {@link loadRevisionSource}), review it, and press
 * Save, which sends the ordinary `PUT /api/orders/:id` with
 * `restore_from_revision`. Nothing is deleted and no revision is written:
 * the customer keeps the latest revision until the next send, and the
 * staff banner lists the restored content as changes not sent.
 *
 * What makes it more than a save is the price lock. {@link planRestore}
 * validates the request, and {@link overlayRevisionLocks} lays the
 * revision's own locks (`buildLockMap` over `source.line_items`) over the
 * order's current ones, so an untouched restored item matches its old
 * fingerprint and is written back at the price it was quoted at — even if
 * the catalog moved or the option was archived since, because a held
 * lock skips catalog lookup and validation in `resolveLineItems`. An item
 * edited after loading breaks its lock and is re-priced at today's
 * catalog. The client never sends money (AI_GUIDELINES rule 1): the locks
 * come from the server-stored revision.
 *
 * Kept out of `routes/orders.ts` (already far over the 800-line limit),
 * which only calls these functions.
 */

import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { checkRevisionSource, type RevisionSource } from './orderRevisions';
import { buildLockMap, type StoredLock } from './priceLockStore';

/**
 * Statuses a revision may be restored on: the estimate stages. From
 * `awaiting_payment` on, the customer has accepted a revision and changes
 * go through edit requests instead.
 */
const RESTORABLE_STATUSES: readonly string[] = ['draft', 'sent', 'expired'];

/** A revision id as the API accepts it; anything else cannot exist. */
const revisionIdSchema = z.string().uuid();

/**
 * Whether an order in `status` may restore a revision.
 *
 * @param status The order's stored status.
 * @returns `true` for `draft`, `sent` and `expired`, `false` for every
 *   confirmed stage (and any unknown status).
 */
export function canRestoreRevision(status: string): boolean {
  return RESTORABLE_STATUSES.includes(status);
}

/**
 * The order-log line written by a save that restored a revision. The
 * "(not sent yet)" is load-bearing: a restore changes nothing the
 * customer can see until the next send.
 *
 * @param revNo The restored revision's number.
 */
export function restoreLogLine(revNo: number): string {
  return `Restored Rev ${revNo} (not sent yet).`;
}

/**
 * The validated restore, or why the save must be refused before anything
 * is written: `404` for a revision that is not this order's, `409` for an
 * order past the estimate stages, `500` when the revision could not be
 * read.
 */
export type RestorePlan =
  | { ok: true; rev_no: number; source: RevisionSource }
  | { ok: false; status: 404 | 409 | 500; error: string };

/**
 * Validates a `restore_from_revision` on `PUT /api/orders/:id` and reads
 * the revision's staff copy. Read-only; called before the save writes.
 *
 * The revision is read first so the 409 can name it ("Rev 2 can't be
 * restored…"); a revision of another order is a 404 whatever the status.
 *
 * @param sb Service-role Supabase client.
 * @param orderId The order being saved.
 * @param revisionId The `restore_from_revision` the editor sent.
 * @param status The order's stored status before the save.
 * @returns A {@link RestorePlan}.
 */
export async function planRestore(
  sb: SupabaseClient,
  orderId: string,
  revisionId: string,
  status: string
): Promise<RestorePlan> {
  const res = await checkRevisionSource(sb, orderId, revisionId);
  if ('error' in res) return { ok: false, status: 500, error: res.error };
  if (!res.row) return { ok: false, status: 404, error: 'Revision not found' };
  if (!canRestoreRevision(status)) {
    return {
      ok: false,
      status: 409,
      error: `Rev ${res.row.rev_no} can't be restored once the estimate is confirmed.`,
    };
  }
  return { ok: true, rev_no: res.row.rev_no, source: res.row.source };
}

/**
 * The price-lock map a restoring save prices against: the order's current
 * locks with the revision's laid over them, so where both hold a lock for
 * the same `uid` the revision's wins.
 *
 * Only an order that holds locks gets the overlay. `currentLocks` is
 * `undefined` on a `draft` (and on the save that revives an expired
 * estimate to draft): such an order prices live, so restored items are
 * priced at today's catalog — what the editor's confirm dialog warns of.
 *
 * @param currentLocks The map `PUT /:id` built from the order's current
 *   rows, or `undefined` when the order holds no price lock.
 * @param source The restored revision's staff copy.
 * @returns The merged map, or `undefined` when there were no locks to
 *   overlay.
 */
export function overlayRevisionLocks(
  currentLocks: Map<string, StoredLock> | undefined,
  source: RevisionSource
): Map<string, StoredLock> | undefined {
  if (!currentLocks) return undefined;
  return new Map([...currentLocks, ...buildLockMap(source.line_items)]);
}

/**
 * Serves `GET /api/orders/:id/revisions/:revisionId`: the staff copy the
 * editor loads on Restore. Staff-only (behind `/api/*` JWT); `source`
 * never reaches `/public/*`.
 *
 * @param sb Service-role Supabase client.
 * @param orderId The order in the URL.
 * @param revisionId The revision in the URL; a malformed id is a 404
 *   rather than a database cast error.
 * @returns `{ data: { rev_no, source } }`, or `{ status, error }` with
 *   `404` (no such revision on this order) or `500` (unreadable).
 */
export async function loadRevisionSource(
  sb: SupabaseClient,
  orderId: string,
  revisionId: string
): Promise<
  | { data: { rev_no: number; source: RevisionSource } }
  | { status: 404 | 500; error: string }
> {
  if (!revisionIdSchema.safeParse(revisionId).success) {
    return { status: 404, error: 'Revision not found' };
  }
  const res = await checkRevisionSource(sb, orderId, revisionId);
  if ('error' in res) return { status: 500, error: res.error };
  if (!res.row) return { status: 404, error: 'Revision not found' };
  return { data: res.row };
}
