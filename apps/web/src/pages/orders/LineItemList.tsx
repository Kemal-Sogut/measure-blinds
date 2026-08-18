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
 * Task 12 added drag-and-drop reordering (`@dnd-kit`): this component owns
 * the `DndContext`/`SortableContext` and the pointer sensor, because both
 * need the full `items` array (for `SortableContext`'s id list) and the
 * single `onReorder` callback — list-level concerns, same as `expanded`.
 * Each `LineItemRow` calls `useSortable` itself (it needs its own id) and
 * renders the actual drag handle; see `LineItemRow.tsx` for why the drag
 * listeners are attached ONLY to that handle and not the row.
 *
 * Each row reads its price and attribute line from the in-progress DRAFT
 * (`ItemDraft`), not the persisted `LineItem`, because this list shows
 * unsaved edits — `blindDraftPrice`/`flatDraftPrice` and
 * `parseDraftAttributes` all operate on drafts for the same reason (see
 * `LineItemRow.tsx`).
 */

import { useEffect, useState, type ReactNode } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
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
  /** Moves the item identified by `activeKey` to the position of the item
   *  identified by `overKey`; called from this component's `DndContext`
   *  once a drag-handle drag lands on a different row than it started on.
   *  Persistence is implicit: the Worker derives each line item's saved
   *  `position` from its index in the save payload, so reordering the
   *  array here is the whole job — nothing else needs to write a
   *  position field. */
  onReorder: (activeKey: string, overKey: string) => void;
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
 * detail panel is open (pruned by an effect whenever an item is deleted, so
 * a stale key never lingers past the item it belonged to). It lives here
 * rather than in each row because nothing about it needs to survive a row's
 * own remount (a `key`-stable id, `it.key`, already keys the row) — it is
 * kept here simply because `LineItemList` is the natural, single owner of
 * "which rows in THIS list are expanded", the same way `OrderDetail.tsx`
 * owns `selected` for "which rows are checked". Every mutation of the ITEMS
 * themselves — including reordering, via drag-and-drop's `onReorder` — is
 * still delegated to the corresponding callback prop: this component never
 * mutates a draft itself.
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
  onReorder,
}: LineItemListProps): ReactNode {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Prune stale keys out of `expanded` whenever the item list's membership
  // changes (an item is deleted). Without this, a deleted item's key stays
  // in the set forever — harmless on its own (nothing reads it back out
  // for a key that no longer has a row), but it accumulates for the whole
  // page's lifetime, which is one thing not to leave in your pocket in a
  // long-lived editor session. `next` is built as `items ∩ prev`, so it can
  // never be LARGER than `prev`; equal size therefore means equal
  // membership, and the size check alone is enough to skip a no-op update.
  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set<string>();
      for (const it of items) {
        if (prev.has(it.key)) next.add(it.key);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [items]);

  function toggleExpanded(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /**
   * `DndContext`'s pointer sensor for the drag handle. `activationConstraint`
   * requires the pointer to move 6px before a drag starts, so a plain tap on
   * the handle (or anywhere else — listeners are handle-only, see
   * `LineItemRow`) is never misread as the start of a drag on a touch
   * screen, where a stationary "press" reads as a sequence of tiny
   * jittering pointer moves.
   */
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      onReorder(String(active.id), String(over.id));
    }
  }

  return (
    <>
      {/* Item rows */}
      {items.length === 0 ? (
        <p className="p-4 text-[13px] text-text-muted">No items yet — add one below.</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={items.map((it) => it.key)} strategy={verticalListSortingStrategy}>
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
          </SortableContext>
        </DndContext>
      )}
    </>
  );
}
