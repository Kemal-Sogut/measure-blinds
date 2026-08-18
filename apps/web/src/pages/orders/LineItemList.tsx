// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * LineItemList — renders the order's line-item rows inside the "Line items
 * summary table" `<section>` on `OrderDetail.tsx`.
 *
 * Extracted from `OrderDetail.tsx` as a pure move (Task 10): no visual or
 * behavioral change from what `OrderDetail.tsx` rendered inline before this
 * file existed. `OrderDetail.tsx` still owns the `<section>` wrapper, the
 * bulk-select toolbar above these rows, and the "Add" buttons below them —
 * only the per-item rows themselves live here.
 *
 * Task 11 reworked how each row looks and behaves — a 3-dot menu, an
 * expandable detail panel, and move up/down controls — and moved the row's
 * own markup out to `LineItemRow.tsx` in the same pass, once the row grew
 * too large to stay inline here without pushing this file past this
 * codebase's file-length comfort zone. What stays HERE is list-level state
 * that only one row at a time doesn't own: which keys are expanded.
 *
 * Each row reads its price and attribute line from the in-progress DRAFT
 * (`ItemDraft`), not the persisted `LineItem`, because this list shows
 * unsaved edits — `blindDraftPrice`/`flatDraftPrice` and
 * `parseDraftAttributes` all operate on drafts for the same reason (see
 * `LineItemRow.tsx`).
 */

import { useState, type ReactNode } from 'react';
import LineItemRow from './LineItemRow';
import type { ItemDraft, Catalogs } from './lineItemDrafts';

/**
 * Props for {@link LineItemList}. All mutation is via callbacks — this
 * component holds no state of its own but the `expanded` detail-panel set
 * (which key's row is showing its detail panel), and never touches drafts
 * directly, so `OrderDetail.tsx` (or any future caller) remains the single
 * source of truth for the item list and selection set.
 */
export interface LineItemListProps {
  /** Draft line items to render, in display order. */
  items: ItemDraft[];
  /** Material/hardware catalogs, needed to price blind drafts. */
  catalogs: Catalogs;
  /** When true, hides the checkbox and every action control (edit,
   *  delete, and the 3-dot menu's show/hide/duplicate/move) — matches
   *  `OrderDetail.tsx`'s `const readOnly = false` (currently always
   *  editable; the prop exists for a future read-only view of a
   *  confirmed/archived order). */
  readOnly: boolean;
  /** Whether the order has passed the point where the Worker refuses
   *  visibility changes (see `POST_CONFIRM` in `OrderDetail.tsx`). Disables
   *  the menu's Show/Hide item and adds an explanatory `title`. */
  postConfirm: boolean;
  /** Keys of the currently checkbox-selected items, for the bulk toolbar
   *  above this list. */
  selected: Set<string>;
  /** Toggles one item's membership in `selected`. */
  onToggleSelect: (key: string) => void;
  /** Toggles one item's `hidden` flag (excludes/includes it from documents
   *  and totals without deleting it). */
  onToggleHidden: (key: string) => void;
  /** Opens the edit sheet for one item. */
  onEdit: (key: string) => void;
  /** Duplicates one item in place. */
  onDuplicate: (key: string) => void;
  /** Removes one item from the draft list. */
  onDelete: (key: string) => void;
  /** Moves one item one position up (-1) or down (+1) in display order;
   *  the implementation (in `OrderDetail.tsx`) no-ops at the edges, which
   *  is also why `LineItemRow`'s Move up/down are disabled at the first
   *  and last row rather than relying on the no-op alone — a disabled
   *  control reads better than a button that silently does nothing. */
  onMove: (key: string, dir: -1 | 1) => void;
}

/**
 * Renders the order's line items as either an empty-state message (no items
 * yet) or a divided list of {@link LineItemRow} rows, one per item.
 *
 * Each row shows: a select checkbox, an optional "Hidden" pill, the item's
 * name (and, for blinds, its attribute summary) as a button that expands a
 * detail panel, its price with an amber dot marking an overridden price,
 * and — unless `readOnly` — Edit, Delete and a 3-dot menu (Show/Hide,
 * Duplicate, Move up, Move down). See `LineItemRow.tsx` for the row itself.
 *
 * Owns exactly one piece of state: `expanded`, the set of item keys whose
 * detail panel is open. It lives here rather than in each row because nothing
 * about it needs to survive a row's own remount (a `key`-stable id, `it.key`,
 * already keys the row) — it is kept here simply because `LineItemList` is
 * the natural, single owner of "which rows in THIS list are expanded", the
 * same way `OrderDetail.tsx` owns `selected` for "which rows are checked".
 * Every mutation of the ITEMS themselves is still delegated to the
 * corresponding callback prop: this component never mutates a draft itself.
 */
export default function LineItemList({
  items,
  catalogs,
  readOnly,
  postConfirm,
  selected,
  onToggleSelect,
  onToggleHidden,
  onEdit,
  onDuplicate,
  onDelete,
  onMove,
}: LineItemListProps): ReactNode {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleExpanded(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <>
      {/* Item rows */}
      {items.length === 0 ? (
        <p className="p-4 text-[13px] text-text-muted">No items yet — add one below.</p>
      ) : (
        <ul className="divide-y divide-border-light">
          {items.map((it, i) => (
            <LineItemRow
              key={it.key}
              item={it}
              index={i}
              isFirst={i === 0}
              isLast={i === items.length - 1}
              catalogs={catalogs}
              readOnly={readOnly}
              postConfirm={postConfirm}
              selected={selected.has(it.key)}
              expanded={expanded.has(it.key)}
              onToggleSelect={() => onToggleSelect(it.key)}
              onToggleExpand={() => toggleExpanded(it.key)}
              onToggleHidden={() => onToggleHidden(it.key)}
              onEdit={() => onEdit(it.key)}
              onDuplicate={() => onDuplicate(it.key)}
              onDelete={() => onDelete(it.key)}
              onMove={(dir) => onMove(it.key, dir)}
            />
          ))}
        </ul>
      )}
    </>
  );
}
