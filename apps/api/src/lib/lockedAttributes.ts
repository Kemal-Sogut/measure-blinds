// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

import type { BlindAttributes } from './blindTypes/base';

/**
 * The attributes blob a price-LOCKED blind line is written back with.
 *
 * A locked line keeps its stored attributes verbatim — pricing inputs and
 * the Worker's catalog snapshots stay frozen, which is the whole point of
 * the lock. The one exception is a type's display-only keys (Dual Shades'
 * `back_color`): they are printed, never priced, and are excluded from the
 * lock fingerprint, so editing one leaves the fingerprint equal and the
 * lock held. Without this carry-through the edit would be silently
 * dropped while the front `color` (a plain column) is taken from the
 * payload, putting a stale colour on the PDF and manufacturer copy.
 *
 * Result: the stored blob minus every display-only key, plus only those
 * display-only keys PRESENT in the (already schema-validated) payload
 * blob. A cleared colour is therefore absent from the payload and drops
 * out of the row. For a type with no display-only keys the stored blob is
 * returned untouched, so every other type's locked save is unchanged.
 *
 * Called by `resolveLineItems` in `routes/orders.ts`; pure, so it is unit
 * tested on its own.
 *
 * @param stored - the locked row's stored attributes (snapshot included).
 * @param payload - the payload attributes, already parsed through the
 *   blind type's `attributeSchema`.
 * @param displayOnlyKeys - the type's `displayOnlyKeys`.
 */
export function carryDisplayOnlyAttributes(
  stored: BlindAttributes,
  payload: BlindAttributes,
  displayOnlyKeys: readonly string[]
): BlindAttributes {
  if (displayOnlyKeys.length === 0) return stored;
  const out: BlindAttributes = {};
  for (const [key, value] of Object.entries(stored)) {
    if (!displayOnlyKeys.includes(key)) out[key] = value;
  }
  for (const key of displayOnlyKeys) {
    if (payload[key] !== undefined) out[key] = payload[key];
  }
  return out;
}
