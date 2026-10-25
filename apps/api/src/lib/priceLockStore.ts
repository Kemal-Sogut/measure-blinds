// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Persistence side of the per-item price lock (migration 39) — reading
 * stored locks, freezing an order's prices when its estimate goes out,
 * and releasing them if the order is put back to `draft`.
 *
 * Deliberately separate from `lib/priceLock.ts`: that module is the pure
 * fingerprint rule and the authoritative twin of the web copy, so it
 * must stay free of Supabase. Everything here touches the database and
 * therefore exists on the Worker only.
 *
 * Freeze/release points, in `routes/orders.ts` and `lib/estimateSend.ts`.
 * Prices freeze when the estimate REACHES THE CUSTOMER, not later: quoting a
 * figure is the commitment, and confirmation only accepts it.
 *   - the multi-estimate send (`POST /api/customers/:id/send-estimates`, in
 *     `lib/estimateSend.ts`) and `POST /:id/mark-sent` → {@link freezeOrderPrices}
 *   - `POST /:id/confirm`, and `POST /:id/status` moving to `sent` or
 *     beyond → freeze too, so a stage reached without passing through
 *     a send is still locked (the call is a no-op for items already
 *     frozen)
 *   - `POST /:id/status` reverting to `draft` → {@link clearOrderPriceLocks}
 *   - reviving a lapsed estimate to `draft` in `PUT /:id` → clear
 *
 * `POST /:id/unconfirm` and an accepted cancellation request do NOT
 * release: both land the order back on `sent`, where the customer is
 * still holding the estimate that quoted those prices.
 *
 * Migration 48 adds a SECOND pair of figures with a different question
 * to answer — `line_items.quoted_base_price` and `orders.quoted_total`,
 * written by {@link stampQuotedFigures}. The lock says what price is in
 * force; these say what the customer was LAST SENT, which the lock
 * cannot, because a save re-locks an edited item at its new figure. The
 * editor's price-update notices are the difference between the two.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { pricingFingerprint, type PriceLock, type PriceLockInput } from './priceLock';

/**
 * The catalog snapshot a locked item keeps.
 *
 * A frozen price must not be re-published beside re-fetched rates: if a
 * material went from $25 to $30/m² after the estimate went out, showing the new
 * rate next to the old price would make the invoice's own arithmetic
 * unreadable (and would break `optionBreakdown`, which fits the legs to
 * the stored price). So while the lock holds, these columns are written
 * back exactly as they were.
 */
export interface LockedSnapshot {
  material_name: string | null;
  material_price_per_sqm: number | null;
  cassette_name: string | null;
  cassette_price_per_m: number | null;
  cassette_price_basis: string | null;
  bottom_rail_name: string | null;
  bottom_rail_price_per_m: number | null;
  bottom_rail_price_basis: string | null;
  control_name: string | null;
  control_price_per_item: number | null;
  control_price_basis: string | null;
  installation_name: string | null;
  installation_price_per_item: number | null;
  installation_price_basis: string | null;
  attributes: Record<string, string | number | boolean>;
}

/** One stored lock: the frozen price, its fingerprint, its snapshot. */
export interface StoredLock extends PriceLock {
  snapshot: LockedSnapshot;
}

/** Number-or-null coercion for a PostgREST numeric column. */
function n(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/** String-or-null coercion for a nullable text column. */
function s(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

/**
 * Re-derives the pricing inputs of one STORED line item, so the same
 * fingerprint function can be applied to a database row and to an
 * incoming payload item.
 *
 * The stored `attributes` blob carries the Worker's own snapshot keys
 * alongside the consultant's inputs; `pricingFingerprint` strips them,
 * which is what lets a row and the payload that produced it fingerprint
 * alike.
 */
export function lockInputFromRow(row: Record<string, unknown>): PriceLockInput {
  if (row.item_type !== 'blind') {
    const presetId = s(row.preset_id);
    return {
      item_type: row.item_type === 'preset' ? 'preset' : 'custom',
      preset_id: presetId,
      // A preset with provenance is priced from its catalog row, and the
      // client never sends a figure for it — so it has no typed input to
      // fingerprint. For a legacy preset or a custom item the input IS
      // the typed figure, which is the CALCULATED one: an override moves
      // it off `unit_price` and onto `base_unit_price`.
      unit_price: presetId ? null : (n(row.base_unit_price) ?? n(row.unit_price)),
    };
  }
  return {
    item_type: 'blind',
    blinds_type: String(row.blinds_type ?? ''),
    panels: ((row.panels ?? []) as unknown[]).map((p) => Number(p)),
    height_cm: Number(row.height_cm ?? 0),
    material_id: s(row.material_id),
    cassette_id: s(row.cassette_id),
    bottom_rail_id: s(row.bottom_rail_id),
    control_id: s(row.control_id),
    installation_id: s(row.installation_id),
    attributes: (row.attributes ?? {}) as Record<string, unknown>,
  };
}

/** Lifts the catalog snapshot columns off a stored row. */
function snapshotFromRow(row: Record<string, unknown>): LockedSnapshot {
  return {
    material_name: s(row.material_name),
    material_price_per_sqm: n(row.material_price_per_sqm),
    cassette_name: s(row.cassette_name),
    cassette_price_per_m: n(row.cassette_price_per_m),
    cassette_price_basis: s(row.cassette_price_basis),
    bottom_rail_name: s(row.bottom_rail_name),
    bottom_rail_price_per_m: n(row.bottom_rail_price_per_m),
    bottom_rail_price_basis: s(row.bottom_rail_price_basis),
    control_name: s(row.control_name),
    control_price_per_item: n(row.control_price_per_item),
    control_price_basis: s(row.control_price_basis),
    installation_name: s(row.installation_name),
    installation_price_per_item: n(row.installation_price_per_item),
    installation_price_basis: s(row.installation_price_basis),
    attributes: (row.attributes ?? {}) as Record<string, string | number | boolean>,
  };
}

/**
 * Indexes an order's stored locks by line-item `uid` — the only stable
 * identity across the wholesale delete/insert every save performs.
 *
 * Rows with no `locked_base_price` are skipped: they are live-priced,
 * which is every item of a DRAFT order — one whose estimate has never
 * gone out, or one put back to draft since.
 */
export function buildLockMap(rows: Record<string, unknown>[] | null | undefined): Map<string, StoredLock> {
  const map = new Map<string, StoredLock>();
  for (const row of rows ?? []) {
    const base = n(row.locked_base_price);
    const fingerprint = s(row.locked_inputs_fingerprint);
    if (base === null || fingerprint === null || !row.uid) continue;
    map.set(String(row.uid), { base, fingerprint, snapshot: snapshotFromRow(row) });
  }
  return map;
}

/** The columns a freeze or a release writes. */
interface LockColumns {
  locked_base_price: number | null;
  locked_inputs_fingerprint: string | null;
}

/**
 * Freezes every UNLOCKED line item of an order at the price it currently
 * carries.
 *
 * Called the moment an estimate leaves the building — the multi-estimate send
 * (`POST /api/customers/:id/send-estimates`) or `POST /:id/mark-sent` — and
 * again at every later stage that could be reached without passing through
 * those (`/confirm` from a draft, a manual `/status` jump), so a quoted price
 * is frozen from the first moment a customer has seen it.
 *
 * The frozen figure is the CALCULATED price — `base_unit_price` while an
 * override is in effect, otherwise `unit_price` — because the override is
 * re-applied on every save and freezing the overridden figure would apply
 * it twice.
 *
 * An item that ALREADY carries a lock is left alone: it was frozen when
 * the estimate went out, and a later stage change is not a re-quote. Only
 * editing that item's own pricing inputs re-prices it, and the save that
 * does so writes the new lock itself.
 *
 * @returns an error message, or null on success. A failure must fail the
 *          transition it accompanies: an order that reached `sent` with
 *          no locks would keep silently re-pricing itself on save, which
 *          is the exact bug the lock exists to prevent.
 */
export async function freezeOrderPrices(
  sb: SupabaseClient,
  orderId: string
): Promise<string | null> {
  const { data, error } = await sb
    .from('line_items')
    .select('*')
    .eq('order_id', orderId)
    .is('locked_base_price', null);
  if (error) return error.message;
  const rows = (data ?? []) as Record<string, unknown>[];

  const writes = rows.map(async (row) => {
    const columns: LockColumns = {
      locked_base_price: n(row.base_unit_price) ?? n(row.unit_price) ?? 0,
      locked_inputs_fingerprint: pricingFingerprint(lockInputFromRow(row)),
    };
    return sb.from('line_items').update(columns).eq('id', row.id as string);
  });
  const results = await Promise.all(writes);
  const failed = results.find((r) => r.error);
  return failed?.error?.message ?? null;
}

/**
 * The columns a quoted-figure stamp or a release writes.
 *
 * The acknowledgement travels with the stamp everywhere: a figure
 * dismissed by staff is an answer to one quote, and the moment that
 * quote is replaced (or released) the answer is stale.
 */
export interface QuotedColumns {
  quoted_base_price: number | null;
  quoted_notice_ack_base: number | null;
}

/**
 * Records what the customer is being SENT: each line item's calculated
 * base price and the order's grand total, in `quoted_base_price` and
 * `quoted_total` (migration 48).
 *
 * The editor shows a price-update notice wherever today's figure differs
 * from the stamp — per item at the top of its details form, and once
 * below the order total. So the stamp, not the price lock, is what those
 * notices are measured against: a save re-locks an edited item at its
 * NEW price, which would make a lock-based notice vanish exactly when it
 * was earned.
 *
 * `mode` decides what an existing stamp means:
 *   - `'overwrite'` at a genuine send (the multi-estimate send and
 *     `/mark-sent`). Re-sending re-quotes the customer, so the stamp
 *     moves to today's figures and every notice goes quiet. This is the
 *     reset.
 *   - `'fill'` at a stage that was reached WITHOUT a send (`/confirm`
 *     from a draft, a manual `/status` jump). Mirrors
 *     {@link freezeOrderPrices}: a later stage is not a re-quote, so an
 *     existing stamp is left exactly where the send put it.
 *
 * The stamped figure is the CALCULATED price — `base_unit_price` while an
 * override is in effect, otherwise `unit_price` — matching the lock, so
 * the two figures are always comparable.
 *
 * Both filters are applied in memory rather than in the query: the rule
 * is small, the row counts are tiny, and keeping it here is what the
 * tests pin it to.
 *
 * @returns an error message, or null on success. Treated exactly like a
 *          freeze failure by its callers — an order that reached `sent`
 *          with no stamp would show no notice when its prices later
 *          moved, which is the bug this exists to prevent.
 */
export async function stampQuotedFigures(
  sb: SupabaseClient,
  orderId: string,
  mode: 'overwrite' | 'fill'
): Promise<string | null> {
  const { data: order, error: orderError } = await sb
    .from('orders')
    .select('total, quoted_total')
    .eq('id', orderId)
    .maybeSingle();
  if (orderError) return orderError.message;
  if (!order) return 'Order not found';

  const { data, error } = await sb
    .from('line_items')
    .select('id, base_unit_price, unit_price, quoted_base_price')
    .eq('order_id', orderId);
  if (error) return error.message;

  const rows = ((data ?? []) as Record<string, unknown>[]).filter(
    (row) => mode === 'overwrite' || n(row.quoted_base_price) === null
  );
  const writes = rows.map(async (row) => {
    const columns: QuotedColumns = {
      quoted_base_price: n(row.base_unit_price) ?? n(row.unit_price) ?? 0,
      // Any dismissal is dropped with the stamp it answered: this is a
      // NEW quote, so a price that moves away from it has to speak up
      // again however recently staff silenced the last one.
      quoted_notice_ack_base: null,
    };
    return sb.from('line_items').update(columns).eq('id', row.id as string);
  });
  const results = await Promise.all(writes);
  const failed = results.find((r) => r.error);
  if (failed?.error) return failed.error.message;

  if (mode === 'fill' && n(order.quoted_total) !== null) return null;
  const { error: totalError } = await sb
    .from('orders')
    .update({ quoted_total: n(order.total) ?? 0, quoted_notice_ack_total: null })
    .eq('id', orderId);
  return totalError?.message ?? null;
}

/**
 * Indexes an order's stored quoted figures — the stamp and the
 * acknowledgement that may have silenced its notice — by line-item
 * `uid`.
 *
 * `PUT /:id` replaces every line item wholesale, so both have to be
 * carried across that replacement by uid, the only identity that
 * survives it. A row with neither (never sent) maps to nothing and is
 * re-inserted with nulls, which is what it had. Shaped as the columns
 * themselves so the caller spreads the result rather than rebuilding it.
 */
export function buildQuotedMap(
  rows: Record<string, unknown>[] | null | undefined
): Map<string, QuotedColumns> {
  const map = new Map<string, QuotedColumns>();
  for (const row of rows ?? []) {
    if (!row.uid) continue;
    const quoted = n(row.quoted_base_price);
    const ack = n(row.quoted_notice_ack_base);
    if (quoted === null && ack === null) continue;
    map.set(String(row.uid), { quoted_base_price: quoted, quoted_notice_ack_base: ack });
  }
  return map;
}

/**
 * Releases an order's price locks, returning every item to live pricing.
 *
 * Called when an order is put back to `draft` — a manual status change
 * to draft, or reviving a lapsed estimate by extending its expiry. A
 * draft is a quote nobody is holding, so it is priced from today's
 * catalog again and the next send freezes what that send shows. NOT
 * called when a confirmation is reversed: that lands the order on
 * `sent`, where the customer still holds the estimate.
 *
 * The migration-48 quoted figures go with them: a draft is a quote
 * nobody has been sent, so there is no figure for a price-update notice
 * to be measured against, and leaving a stale one would accuse the next
 * live re-price of having moved a price the customer never saw.
 *
 * Best-effort by design: the status change it accompanies has already
 * been persisted, and a stale lock only means one save too many keeps a
 * price — the next send re-freezes whatever is unlocked either way.
 */
export async function clearOrderPriceLocks(sb: SupabaseClient, orderId: string): Promise<void> {
  const columns: LockColumns & QuotedColumns = {
    locked_base_price: null,
    locked_inputs_fingerprint: null,
    quoted_base_price: null,
    quoted_notice_ack_base: null,
  };
  await sb.from('line_items').update(columns).eq('order_id', orderId);
  await sb
    .from('orders')
    .update({ quoted_total: null, quoted_notice_ack_total: null })
    .eq('id', orderId);
}
