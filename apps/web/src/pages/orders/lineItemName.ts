// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Display name of a line-item draft in the order editor, shared by the
 * row that shows it (`LineItemRow`) and the delete confirmation that
 * names it (`DeleteItemsDialog`, via `OrderDetail`) so the two can never
 * call the same item by different names.
 *
 * Lives outside `LineItemRow.tsx` because a component file that also
 * exports a plain function breaks React Fast Refresh for that file.
 */

import type { ItemDraft } from './lineItemDrafts';

/**
 * "Room — Type" for a blind, the description for a flat item, with a
 * positional fallback (`Blind 3`, `Item 3`) while the field is blank.
 *
 * `index` must be the item's 0-based position in the draft list; the
 * fallback is only stable for as long as that position is.
 */
export function lineItemName(item: ItemDraft, index: number): string {
  return item.item_type === 'blind'
    ? [item.room_name || `Blind ${index + 1}`, item.blinds_type].filter(Boolean).join(' — ')
    : item.description || `Item ${index + 1}`;
}
