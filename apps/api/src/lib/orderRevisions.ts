// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Estimate revisions: numbered, frozen copies of what the customer was
 * SENT (migration 50, `order_revisions`).
 *
 * A revision is cut on a send, never on a save, and only when something
 * customer-visible changed since the latest one. {@link stampSent} is the
 * single entry point for that: it replaces every direct call to
 * `stampQuotedFigures` (migration 48) so the quoted-figure stamp and the
 * revision are written together, with the same `'overwrite' | 'fill'`
 * meaning. Invariant: right after any send,
 * `orders.quoted_total === latestRevision.total`.
 *
 * Each revision stores two copies. `snapshot` is the customer view
 * ({@link PublicQuote}) used for the customer page, diffs and email.
 * `source` is the staff copy used to restore a revision; it holds raw
 * `line_items` rows (hidden items, uids and lock columns) and so is
 * deliberately NOT part of {@link RevisionRow}: only
 * {@link readRevisionSource} ever selects it, so it cannot ride into a
 * response by accident.
 *
 * AI_GUIDELINES rule 1: nothing here computes money. The snapshot holds
 * the server-computed figures already stored on the order.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { buildPublicQuote, type PublicQuote } from './publicQuote';
import { diffQuotes, type QuoteChange } from './quoteDiff';
import { stampQuotedFigures } from './priceLockStore';

/**
 * Explicit column list for every revision read except
 * {@link readRevisionSource}. Never `*`: that would drag the staff-only
 * `source` copy along with it.
 */
const REVISION_COLUMNS = 'id, order_id, rev_no, sent_at, source_kind, total, snapshot';

/** Postgres `unique_violation`, raised when two sends race for one `rev_no`. */
const UNIQUE_VIOLATION = '23505';

/**
 * The staff copy of an order as saved at a send, used to restore a
 * revision into the editor. Holds the order-level editable fields and
 * EVERY `line_items` row exactly as stored (hidden items, `uid`, catalog
 * ids, `attributes`, overrides and the price-lock columns).
 */
export interface RevisionSource {
  order: {
    title: string | null;
    discount_type: 'fixed' | 'percent';
    discount_value: number;
  };
  line_items: Record<string, unknown>[];
}

/**
 * One revision as it may be returned to a client. `source` is
 * intentionally absent, so a revision row can be serialized without
 * leaking raw line items; read it with {@link readRevisionSource}.
 */
export interface RevisionRow {
  id: string;
  order_id: string;
  rev_no: number;
  sent_at: string;
  source_kind: 'email' | 'manual' | 'stage';
  total: number;
  snapshot: PublicQuote;
}

/** A Supabase error reduced to the two fields this module looks at. */
type DbError = { message: string; code?: string } | null;

/**
 * Reads the latest revision of an order, keeping the database error so
 * callers that must not guess (the writer) can surface it.
 */
async function fetchLatest(
  sb: SupabaseClient,
  orderId: string
): Promise<{ row: RevisionRow | null; error: DbError }> {
  const { data, error } = await sb
    .from('order_revisions')
    .select(REVISION_COLUMNS)
    .eq('order_id', orderId)
    .order('rev_no', { ascending: false })
    .limit(1)
    .maybeSingle();
  return { row: (data as RevisionRow | null) ?? null, error };
}

/**
 * Reads an order with ALL its line items (hidden included) ordered by
 * position — the one query both the snapshot and the source derive from.
 */
async function fetchOrderWithItems(
  sb: SupabaseClient,
  orderId: string
): Promise<{ order: Record<string, unknown> | null; error: DbError }> {
  const { data, error } = await sb
    .from('orders')
    .select('*, line_items(*)')
    .eq('id', orderId)
    .order('position', { referencedTable: 'line_items' })
    .maybeSingle();
  return { order: (data as Record<string, unknown> | null) ?? null, error };
}

/**
 * Reads the staff-only restore copy of one revision.
 *
 * @param sb Service-role Supabase client.
 * @param orderId The order the caller is acting on.
 * @param revisionId The revision to read.
 * @returns The revision number and its {@link RevisionSource}, or `null`
 *   when the revision does not exist OR belongs to a different order
 *   (the order filter is what stops one order restoring from another).
 */
export async function readRevisionSource(
  sb: SupabaseClient,
  orderId: string,
  revisionId: string
): Promise<{ rev_no: number; source: RevisionSource } | null> {
  const { data } = await sb
    .from('order_revisions')
    .select('rev_no, source')
    .eq('id', revisionId)
    .eq('order_id', orderId)
    .maybeSingle();
  return (data as { rev_no: number; source: RevisionSource } | null) ?? null;
}

/**
 * Reads the latest revision of an order (highest `rev_no`).
 *
 * @returns The {@link RevisionRow} without `source`, or `null` when the
 *   order has never been sent under revision tracking (or the read failed).
 */
export async function readLatestRevision(
  sb: SupabaseClient,
  orderId: string
): Promise<RevisionRow | null> {
  return (await fetchLatest(sb, orderId)).row;
}

/**
 * Builds the quote as it stands in the saved order right now.
 *
 * @returns The live {@link PublicQuote} (hidden items dropped, lines still
 *   carrying `uid`), or `null` when the order cannot be read.
 */
export async function readLiveQuote(
  sb: SupabaseClient,
  orderId: string
): Promise<PublicQuote | null> {
  const { order } = await fetchOrderWithItems(sb, orderId);
  return order ? buildPublicQuote(order) : null;
}

/**
 * Compares the saved order with the latest revision. Read-only.
 *
 * @returns The latest revision (or `null` for an order that has none) and
 *   the customer-visible differences since it. `changes` is empty when
 *   there is no revision to compare against; callers distinguish that
 *   case by `latest === null`.
 */
export async function pendingChanges(
  sb: SupabaseClient,
  orderId: string
): Promise<{ latest: RevisionRow | null; changes: QuoteChange[] }> {
  const latest = await readLatestRevision(sb, orderId);
  if (!latest) return { latest: null, changes: [] };
  const live = await readLiveQuote(sb, orderId);
  return { latest, changes: live ? diffQuotes(latest.snapshot, live) : [] };
}

/**
 * Records a send: stamps the quoted figures, then cuts a revision when
 * one is due. Drop-in replacement for `stampQuotedFigures` with the same
 * contract; call it after `freezeOrderPrices` so the `source` rows
 * already carry their locks.
 *
 * `mode` keeps its migration-48 meaning. A revision is written when the
 * order has none yet, or when `mode === 'overwrite'` and the customer-
 * visible quote differs from the latest revision. A `'fill'` (a stage
 * reached without a send) never adds to an existing history.
 *
 * @param sb Service-role Supabase client.
 * @param orderId The order that was just sent or advanced.
 * @param mode `'overwrite'` at a genuine send, `'fill'` otherwise.
 * @param kind What triggered the stamp: `'email'`, `'manual'` (mark-sent)
 *   or `'stage'` (status jump / confirm).
 * @returns An error message, or `null` on success. A failed stamp returns
 *   its message unchanged and writes no revision. Losing a `rev_no` race
 *   (`23505`) is success: the racing send recorded the same state.
 */
export async function stampSent(
  sb: SupabaseClient,
  orderId: string,
  mode: 'overwrite' | 'fill',
  kind: RevisionRow['source_kind']
): Promise<string | null> {
  const stampError = await stampQuotedFigures(sb, orderId, mode);
  if (stampError) return stampError;

  const { row: latest, error: latestError } = await fetchLatest(sb, orderId);
  if (latestError) return latestError.message;
  if (latest && mode === 'fill') return null;

  const { order, error: orderError } = await fetchOrderWithItems(sb, orderId);
  if (orderError) return orderError.message;
  if (!order) return 'Order not found';

  const snapshot = buildPublicQuote(order);
  if (latest && diffQuotes(latest.snapshot, snapshot).length === 0) return null;

  const source: RevisionSource = {
    order: {
      title: (order.title ?? null) as string | null,
      discount_type: order.discount_type as 'fixed' | 'percent',
      discount_value: Number(order.discount_value),
    },
    line_items: (order.line_items ?? []) as Record<string, unknown>[],
  };

  const { error: insertError } = await sb.from('order_revisions').insert({
    order_id: orderId,
    rev_no: (latest?.rev_no ?? 0) + 1,
    source_kind: kind,
    total: snapshot.total,
    snapshot,
    source,
  });
  if (!insertError) return null;
  // A racing send already took this rev_no with the same state.
  if (insertError.code === UNIQUE_VIOLATION) return null;
  return insertError.message;
}
