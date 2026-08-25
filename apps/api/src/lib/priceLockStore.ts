// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Persistence side of the per-item price lock (migration 39) — reading
 * stored locks, freezing an order's prices at confirmation, and
 * releasing them when a confirmation is reversed.
 *
 * Deliberately separate from `lib/priceLock.ts`: that module is the pure
 * fingerprint rule and the authoritative twin of the web copy, so it
 * must stay free of Supabase. Everything here touches the database and
 * therefore exists on the Worker only.
 *
 * Freeze/release points, all in `routes/orders.ts`:
 *   - `POST /:id/confirm`          → {@link freezeOrderPrices}
 *   - `POST /:id/unconfirm`        → {@link clearOrderPriceLocks}
 *   - `POST /:id/status` reverting below awaiting_payment → clear
 *   - an ACCEPTED cancellation request (order returns to `sent`) → clear
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { pricingFingerprint, type PriceLock, type PriceLockInput } from './priceLock';

/**
 * The catalog snapshot a locked item keeps.
 *
 * A frozen price must not be re-published beside re-fetched rates: if a
 * material went from $25 to $30/m² after confirmation, showing the new
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
 * which is every item on an order that has never been confirmed, and
 * every item on one whose confirmation was reversed.
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
 * Freezes every line item of an order at the price it currently carries.
 *
 * Called when an order is confirmed. The frozen figure is the CALCULATED
 * price — `base_unit_price` while an override is in effect, otherwise
 * `unit_price` — because the override is re-applied on every save and
 * freezing the overridden figure would apply it twice.
 *
 * @returns an error message, or null on success. A failure must fail the
 *          confirmation: an order that reached `awaiting_payment` with
 *          no locks would keep silently re-pricing itself on save, which
 *          is the exact bug the lock exists to prevent.
 */
export async function freezeOrderPrices(
  sb: SupabaseClient,
  orderId: string
): Promise<string | null> {
  const { data, error } = await sb.from('line_items').select('*').eq('order_id', orderId);
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
 * Releases an order's price locks, returning every item to live pricing.
 *
 * Called whenever a confirmation is reversed. Re-confirming freezes
 * again, at whatever the prices are THEN — which is the point: an order
 * pulled back to `sent` is an estimate again, and an estimate is priced
 * from today's catalog.
 *
 * Best-effort by design: the status change it accompanies has already
 * been persisted, and a stale lock is harmless until the order is
 * confirmed again (which re-writes both columns anyway).
 */
export async function clearOrderPriceLocks(sb: SupabaseClient, orderId: string): Promise<void> {
  const columns: LockColumns = { locked_base_price: null, locked_inputs_fingerprint: null };
  await sb.from('line_items').update(columns).eq('order_id', orderId);
}
