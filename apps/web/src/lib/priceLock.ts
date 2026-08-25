// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Per-line-item price lock — the rule that keeps a QUOTED price from
 * moving when the pricing formula or the catalog changes underneath it.
 *
 * Every save re-runs `resolveLineItems` over today's catalog, so before
 * migration 39 reopening an estimate and pressing Save was enough to
 * re-price it. The lock freezes each item's calculated base price
 * (`line_items.locked_base_price`) the moment the estimate reaches the
 * customer — `POST /:id/send` or `/mark-sent`, not confirmation, because
 * quoting the figure is the commitment and confirming only accepts one
 * already made — next to a FINGERPRINT of the inputs that produced it
 * (`line_items.locked_inputs_fingerprint`). Every later save compares
 * the fingerprint of what the client sent against the stored one:
 *
 *   - equal   → the frozen price is reused verbatim, together with the
 *               catalog snapshots that explain it (a frozen price must
 *               not sit beside a rate it was never computed from).
 *   - differs → the item's pricing inputs were genuinely edited, so it
 *               is re-priced with today's logic and re-locked at the new
 *               figure. This is the deliberate, documented door through
 *               which a formula change can still reach a sent estimate
 *               or an invoice: only for the item someone actually
 *               changed.
 *
 * The fingerprint covers ONLY what feeds the pricing formula. Quantity,
 * add-ons, the manual unit-price override, visibility, room name, colour
 * and notes are excluded on purpose — they keep applying live on top of
 * the frozen base, exactly as they do on an unlocked item.
 *
 * This module is the LIVE-PREVIEW MIRROR of the authoritative
 * `apps/api/src/lib/priceLock.ts`. The editor has to reach the same
 * verdict the Worker will: an item the save is about to keep frozen must
 * be previewed at its frozen price, or the consultant would watch a
 * number change on screen that never changes in the database. The two
 * modules, and their mirrored `priceLock.test.ts` suites, MUST stay in
 * sync.
 */

import { getBlindType } from './blindTypes/registry';

/** The pricing inputs of one blind, normalised for fingerprinting. */
export interface BlindLockInput {
  item_type: 'blind';
  blinds_type: string;
  panels: number[];
  height_cm: number;
  material_id: string | null;
  cassette_id: string | null;
  bottom_rail_id: string | null;
  control_id: string | null;
  installation_id: string | null;
  /** Raw type inputs; the Worker's own snapshot keys are stripped. */
  attributes: Record<string, unknown>;
}

/**
 * The pricing inputs of one preset/custom item.
 *
 * A preset with provenance is priced from `preset_id` alone, so its
 * `unit_price` is absent; a legacy preset and a custom item carry the
 * typed figure, and changing it is itself an input change.
 */
export interface FlatLockInput {
  item_type: 'preset' | 'custom';
  preset_id: string | null;
  unit_price: number | null;
}

/** Either item shape, as fingerprinted. */
export type PriceLockInput = BlindLockInput | FlatLockInput;

/** A frozen price and the inputs fingerprint it belongs to. */
export interface PriceLock {
  base: number;
  fingerprint: string;
}

/**
 * Canonical text for one number: 4 decimals of precision, no `-0`, no
 * exponent form. Measurements arrive as `100` from one side and `100.00`
 * from the other (Postgres numerics round-trip through strings), and a
 * fingerprint that told those apart would re-price every locked item on
 * its first save.
 */
function num(n: number): string {
  const r = Math.round(n * 10000) / 10000;
  return Object.is(r, -0) ? '0' : String(r);
}

/** Empty strings and `undefined` collapse to null — all mean "no id". */
function id(value: string | null | undefined): string | null {
  return value === undefined || value === null || value === '' ? null : value;
}

/**
 * Canonical text for one attribute value, TAGGED with its type so the
 * string `'2'` and the number `2` cannot fingerprint alike — a blind
 * type is free to declare either, and a silent collision would freeze a
 * price against inputs that never produced it.
 */
function attrValue(value: unknown): string {
  if (typeof value === 'number') return `n:${num(value)}`;
  if (typeof value === 'boolean') return `b:${value}`;
  if (value === null || value === undefined) return 'z:';
  return `s:${String(value)}`;
}

/**
 * The attribute keys a CLIENT supplies, with the Worker's own snapshot
 * keys removed.
 *
 * `line_items.attributes` holds both: the id the consultant chose
 * (`pleat_type_id`) and the name/value the Worker resolved it to
 * (`pleat_name`, `pleat_multiplier`). Only the id is an input — the
 * snapshots are output, and a catalog edit that moves a multiplier must
 * NOT count as the consultant having changed the item.
 */
function inputAttributes(
  blindsType: string,
  attributes: Record<string, unknown>
): [string, unknown][] {
  const snapshots = new Set(
    getBlindType(blindsType).catalogRefs.flatMap((ref) => [ref.nameKey, ref.valueKey])
  );
  return Object.entries(attributes)
    .filter(([key]) => !snapshots.has(key))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Canonical JSON of one item's pricing inputs — the value stored in
 * `locked_inputs_fingerprint` and re-derived on every save.
 *
 * Text rather than a hash on purpose: it is short at this scale, it
 * survives having its definition extended without a migration (an
 * unrecognised old fingerprint simply fails to match and re-prices that
 * item once), and a support question about why a price moved can be
 * answered by reading the column.
 *
 * Panel order is significant: reordering panels leaves the total width —
 * and therefore the price — untouched, but it IS an edit to the item, and
 * treating it as one keeps this function a plain field-by-field
 * comparison rather than a second, looser model of the formula.
 */
export function pricingFingerprint(input: PriceLockInput): string {
  if (input.item_type !== 'blind') {
    return JSON.stringify([
      input.item_type,
      id(input.preset_id),
      input.unit_price === null ? null : num(input.unit_price),
    ]);
  }
  return JSON.stringify([
    'blind',
    input.blinds_type.trim(),
    input.panels.map(num),
    num(input.height_cm),
    id(input.material_id),
    id(input.cassette_id),
    id(input.bottom_rail_id),
    id(input.control_id),
    id(input.installation_id),
    inputAttributes(input.blinds_type, input.attributes).map(([k, v]) => [k, attrValue(v)]),
  ]);
}

/**
 * Whether a stored lock still describes the item the client just sent.
 *
 * `lock` is null for every item of a DRAFT order, and the answer is then
 * no — nothing is frozen until the estimate goes out.
 */
export function lockApplies(lock: PriceLock | null | undefined, input: PriceLockInput): boolean {
  return !!lock && lock.fingerprint === pricingFingerprint(input);
}
