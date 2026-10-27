// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Restoring an earlier estimate revision into the order editor — the pure
 * half (Design decision 8). No JSX, no fetching.
 *
 * A restore is a normal save, not a rewind: Restore loads a revision's
 * staff copy (`RevisionSource`) into the editor as UNSAVED drafts; staff
 * review it and press Save, which sends the ordinary update with
 * `restore_from_revision`. Only the title, discount and line items are
 * replaced — customer, dates and terms keep their current values, so a
 * restore can never bring back an expiry date that has passed.
 *
 * Prices are the Worker's business (AI_GUIDELINES rule 1). It lays the
 * revision's own locks over the order's, so an untouched restored item
 * keeps the price it was quoted at. The drafts built here carry that same
 * lock purely so the live preview agrees with what the save will charge.
 */

import type { RevisionSource } from '../../hooks/useOrders';
import type { DiscountType, LineItem, OrderStatus } from '../../types';
import type { ItemDraft } from './lineItemDrafts';
import { draftsFromLineItems } from './lineItemHydration';

/**
 * Statuses on which a revision may be restored — the estimate stages,
 * mirroring `canRestoreRevision` in `apps/api/src/lib/orderRestore.ts`,
 * which answers anything else with a 409.
 */
const RESTORABLE: readonly OrderStatus[] = ['draft', 'sent', 'expired'];

/**
 * Whether the order editor offers Restore for an order in `status`. From
 * `awaiting_payment` on the customer has accepted a revision, and changes
 * go through edit requests instead.
 *
 * @param status The order's saved status.
 */
export function canRestoreRevision(status: OrderStatus): boolean {
  return RESTORABLE.includes(status);
}

/**
 * Turns a revision's staff copy into the editor state Restore replaces:
 * the three order fields and the line-item drafts.
 *
 * The items go through {@link draftsFromLineItems}, the same hydration
 * the editor runs on load, so a restored item keeps its `uid`, `hidden`
 * flag and position and carries no server-only money column into the
 * save payload. Two of the server-owned fields are adjusted first:
 *
 * - The revision's lock columns are kept only while the order holds
 *   locks (`pricesFrozen`). On a draft the Worker prices every item at
 *   today's catalog, so a carried lock would preview a price the save
 *   would not charge.
 * - The revision's quoted stamps are dropped. They record what was sent
 *   back then, while the customer now holds the LATEST revision; the save
 *   carries the current stamps by `uid`, and the editor re-reads them from
 *   the saved order afterwards.
 *
 * @param source The revision's staff copy, from `useRevisionSource`.
 * @param pricesFrozen The CURRENT order's `holdsPriceLock(status)`.
 * @returns The order fields and drafts to load into the editor.
 */
export function draftsFromRevision(
  source: RevisionSource,
  pricesFrozen: boolean,
): { title: string | null; discount_type: DiscountType; discount_value: number; items: ItemDraft[] } {
  const rows = source.line_items.map(
    (li): LineItem => ({
      ...li,
      quoted_base_price: null,
      quoted_notice_ack_base: null,
      ...(pricesFrozen ? {} : { locked_base_price: null, locked_inputs_fingerprint: null }),
    }),
  );
  return {
    title: source.order.title,
    discount_type: source.order.discount_type,
    discount_value: Number(source.order.discount_value),
    items: draftsFromLineItems(rows, pricesFrozen),
  };
}
