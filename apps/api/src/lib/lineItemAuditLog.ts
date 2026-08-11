// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Turns a line-item price diff into activity-log sentences.
 *
 * An override and an add-on price are hand-typed money — the only figures
 * on an order that no formula can reconstruct afterwards. When a price is
 * disputed months later, the order's activity trail is the whole record
 * of who moved it and by how much, so every such change earns a line.
 *
 * Deliberately NOT part of `lineItemAdjustments.ts`: that module is a
 * byte-for-byte twin of its web counterpart, and log diffing has no
 * browser side. Adding an api-only export there would make the twin claim
 * in its header untrue and invite a diverging edit.
 *
 * Calculated prices moving on their own (a catalog rate rose) produce
 * nothing here — nobody typed those.
 */

import type { Addon } from './lineItemAdjustments';

/** The money shape `describePriceChanges` compares, before and after. */
export interface PricedSnapshot {
  unit_price: number;
  base_unit_price: number | null;
  addons: Addon[];
}

/** Formats money the way the activity log prints it. */
function logMoney(n: number): string {
  return `$${n.toFixed(2)}`;
}

/**
 * Human sentences describing every hand-entered money change between a
 * saved order's items and the ones about to replace them.
 *
 * Items are matched BY POSITION, which is how the editor presents them
 * and how they are renumbered on every save; reordering a list therefore
 * reads as a change on both moved rows. That is the honest reading — the
 * rows are deleted and reinserted wholesale, so there is no stable item
 * identity to match on instead.
 *
 * Only the rows that survive into `next` are described. Deletions are
 * covered by the "Order edited" entry the caller already writes.
 */
export function describePriceChanges(
  previous: PricedSnapshot[],
  next: PricedSnapshot[]
): string[] {
  const messages: string[] = [];
  for (const [i, after] of next.entries()) {
    const label = `Item ${i + 1}`;
    const before = previous[i];
    const wasOverridden = before?.base_unit_price != null;
    const isOverridden = after.base_unit_price != null;

    if (!wasOverridden && isOverridden) {
      messages.push(
        `${label} price overridden: ${logMoney(after.base_unit_price!)} → ${logMoney(after.unit_price)}`
      );
    } else if (wasOverridden && !isOverridden) {
      messages.push(`${label} price override removed (back to ${logMoney(after.unit_price)})`);
    } else if (wasOverridden && isOverridden && before.unit_price !== after.unit_price) {
      messages.push(
        `${label} price override changed: ${logMoney(before.unit_price)} → ${logMoney(after.unit_price)}`
      );
    }

    // Add-ons are compared as label+price pairs: repricing one reads as a
    // removal and an addition, which is what a reader auditing a disputed
    // figure needs to see.
    const key = (a: Addon) => `${a.label} ${a.price}`;
    const beforeKeys = new Set((before?.addons ?? []).map(key));
    const afterKeys = new Set(after.addons.map(key));
    for (const a of before?.addons ?? []) {
      if (!afterKeys.has(key(a))) {
        messages.push(`${label} add-on removed: ${a.label} ${logMoney(a.price)}`);
      }
    }
    for (const a of after.addons) {
      if (!beforeKeys.has(key(a))) {
        messages.push(`${label} add-on added: ${a.label} ${logMoney(a.price)}`);
      }
    }
  }
  return messages;
}
