// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * LineItemList — renders the order's line-item rows inside the "Line items
 * summary table" `<section>` on `OrderDetail.tsx`.
 *
 * Extracted verbatim from `OrderDetail.tsx` (the `items.length === 0` empty
 * state and the `<ul className="divide-y divide-border-light">` rows block)
 * as a pure move: no visual or behavioral change from what `OrderDetail.tsx`
 * rendered inline before this file existed. `OrderDetail.tsx` still owns the
 * `<section>` wrapper, the bulk-select toolbar above these rows, and the
 * "Add" buttons below them — only the per-item rows themselves live here.
 *
 * This split exists because two upcoming tasks rework these rows heavily (a
 * 3-dot menu, expandable detail panels, drag-and-drop reordering); doing
 * that inside the already-oversized `OrderDetail.tsx` would grow it further,
 * so the rows move out first, unchanged, to keep the next diff readable.
 *
 * Each row reads its price and attribute line from the in-progress DRAFT
 * (`ItemDraft`), not the persisted `LineItem`, because this list shows
 * unsaved edits — `blindDraftPrice`/`flatDraftPrice` and
 * `parseDraftAttributes` all operate on drafts for the same reason.
 */

import type { ReactNode } from 'react';
import { getBlindType } from '../../lib/blindTypes';
import {
  blindDraftPrice,
  flatDraftPrice,
  parseDraftAttributes,
  type ItemDraft,
  type Catalogs,
} from './lineItemDrafts';

/**
 * Props for {@link LineItemList}. All mutation is via callbacks — this
 * component holds no state of its own and never touches drafts directly, so
 * `OrderDetail.tsx` (or any future caller) remains the single source of
 * truth for the item list and selection set.
 */
export interface LineItemListProps {
  /** Draft line items to render, in display order. */
  items: ItemDraft[];
  /** Material/hardware catalogs, needed to price blind drafts. */
  catalogs: Catalogs;
  /** When true, hides the checkbox and the show/hide/edit/duplicate/delete
   *  action buttons — matches `OrderDetail.tsx`'s `const readOnly = false`
   *  (currently always editable; the prop exists for a future read-only
   *  view of a confirmed/archived order). */
  readOnly: boolean;
  /** Whether the order has passed the point where the Worker refuses
   *  visibility changes (see `POST_CONFIRM` in `OrderDetail.tsx`). Disables
   *  the show/hide button and swaps in an explanatory `title`. */
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
}

/**
 * Renders the order's line items as either an empty-state message (no items
 * yet) or a divided list of rows, one per item.
 *
 * Each row shows: a select checkbox, a type badge (Blind/Preset/Custom), an
 * optional "Hidden" pill, the item's name and (for blinds) its attribute
 * summary, its price with an amber dot marking an overridden price, and —
 * unless `readOnly` — show/hide, edit, duplicate and delete controls.
 *
 * Purely presentational: every state change (selection, visibility, edit,
 * duplicate, delete) is delegated to the corresponding callback prop: this
 * component never calls a hook or mutates a draft itself.
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
}: LineItemListProps): ReactNode {
  return (
    <>
      {/* Item rows */}
      {items.length === 0 ? (
        <p className="p-4 text-[13px] text-text-muted">No items yet — add one below.</p>
      ) : (
        <ul className="divide-y divide-border-light">
          {items.map((it, i) => {
            const price =
              it.item_type === 'blind'
                ? blindDraftPrice(it, catalogs)
                : flatDraftPrice(it);
            const typeBadge =
              it.item_type === 'blind'
                ? 'Blind'
                : it.item_type === 'preset'
                  ? 'Preset'
                  : 'Custom';
            const name =
              it.item_type === 'blind'
                ? [it.room_name || `Blind ${i + 1}`, it.blinds_type]
                  .filter(Boolean)
                  .join(' — ')
                : it.description || `Item ${i + 1}`;
            const attrLine =
              it.item_type === 'blind'
                ? getBlindType(it.blinds_type)
                  .describeAttributes(parseDraftAttributes(it) ?? {})
                  .map((a) => `${a.label}: ${a.value}`)
                  .join(' · ')
                : '';

            return (
              <li
                key={it.key}
                className={`flex min-w-0 flex-col gap-1.5 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-2${it.hidden ? ' opacity-55' : ''}`}
              >
                {/*
                  Line 1 on phones: checkbox, badge, name.

                  Alignment is start on phones and centre at `sm+`.
                  On a phone the name routinely wraps to several
                  lines, and a centred checkbox/badge would float
                  beside the middle of that block instead of its
                  first line. At `sm+` the row is one line whose
                  height is set by the 32px action buttons, so
                  start-alignment left the text visibly above the
                  row's centre — hence the switch.
                */}
                <div className="flex min-w-0 flex-1 items-start gap-2 sm:items-center">
                  {/* Checkbox — hidden in read-only */}
                  {!readOnly && (
                    <input
                      type="checkbox"
                      checked={selected.has(it.key)}
                      onChange={() => onToggleSelect(it.key)}
                      aria-label={`Select ${name}`}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded-sm accent-brand-600 sm:mt-0"
                    />
                  )}

                  {/* Type badge */}
                  <span className="mt-0.5 w-12 shrink-0 rounded-sm bg-surface-sunken px-1.5 py-0.5 text-center text-[10px] font-semibold uppercase tracking-wide text-text-muted sm:mt-0">
                    {typeBadge}
                  </span>

                  {/* Says out loud what the muted row and the
                      struck price only imply: this line is on
                      no document and in no total. */}
                  {it.hidden && (
                    <span className="mt-0.5 shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted sm:mt-0">
                      Hidden
                    </span>
                  )}

                  {/*
                    Name WRAPS; it does not truncate. A custom
                    item's description is free text and is
                    routinely longer than a phone is wide, and
                    truncating it hid the one field that tells
                    two similar lines apart.

                    `wrap-anywhere` (overflow-wrap: anywhere),
                    not `break-words`: `break-words` only
                    breaks INSIDE an over-long word, and — the
                    part that matters here — leaves the box's
                    min-content width equal to that word. A
                    60-character unbroken description would
                    still have forced the row, the card and
                    the grid wider than the viewport. `anywhere`
                    lets the intrinsic width collapse, so the
                    card can never exceed its column.
                  */}
                  <span className="min-w-0 flex-1 wrap-anywhere text-[13px] text-text-primary">
                    {name}
                    {/*
                      The blind type's own inputs, formatted by
                      the type itself so this row, the PDF, the
                      manufacturer copy and the customer page
                      cannot disagree about labels. Read from the
                      DRAFT, not the persisted item, because this
                      list shows unsaved edits.

                      Nested INSIDE the name span as a block, not
                      beside it in a flex column. Wrapping the two
                      in `flex flex-col` was measured to break the
                      name's wrapping outright — a 120-character
                      unbroken name went from 238px over 5 lines
                      to 1252px on one, dragging the row to
                      1356px inside a 375px viewport. Inheriting
                      this span's `wrap-anywhere` and `min-w-0`
                      keeps the original intrinsic-width
                      behaviour, and renders byte-identical
                      markup while no type declares attributes.
                    */}
                    {attrLine && (
                      <span className="mt-0.5 block text-xs text-text-muted">
                        {attrLine}
                      </span>
                    )}
                  </span>
                </div>

                {/* Line 2 on phones: price left, actions right. On
                    `sm+` this collapses back into the single row. */}
                <div className="flex shrink-0 items-center justify-between gap-2 sm:justify-end">
                  {/*
                    Total, with an amber dot marking a price the
                    consultant overrode. Staff-only: the
                    customer's signal is the struck-through
                    original on the documents, not this.
                  */}
                  <span
                    className={`flex shrink-0 items-center gap-1.5 font-mono text-[13px] text-text-primary${it.hidden ? ' line-through' : ''}`}
                  >
                    {price ? `$${price.total.toFixed(2)}` : '—'}
                    {price && price.unit !== price.base && (
                      <span
                        title="Price overridden"
                        aria-label="Price overridden"
                        className="h-2 w-2 shrink-0 rounded-full bg-amber-500"
                      />
                    )}
                  </span>

                  {/* Show-hide / Edit / Duplicate / Delete — hidden
                      in read-only. 44px targets on the two-line
                      layout, where there is room; back to 32px
                      inline at `sm+`. */}
                  {!readOnly && (
                    <span className="flex shrink-0 items-center gap-1">
                      {/* Visibility. Disabled once the order is
                          confirmed: the customer has been quoted a
                          total, and hiding a line would move it
                          under them. The Worker refuses the save
                          too — this button only says so earlier. */}
                      <button
                        type="button"
                        onClick={() => onToggleHidden(it.key)}
                        disabled={postConfirm}
                        title={
                          postConfirm
                            ? 'Visibility can only be changed before the order is confirmed'
                            : it.hidden
                              ? `Show ${name} on documents`
                              : `Hide ${name} from documents`
                        }
                        aria-label={it.hidden ? `Show ${name}` : `Hide ${name}`}
                        aria-pressed={it.hidden}
                        className="flex h-11 w-11 items-center justify-center rounded-sm text-text-muted hover:bg-surface-sunken hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-muted sm:h-8 sm:w-8"
                      >
                        {it.hidden ? (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="sm:h-3.5 sm:w-3.5">
                            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19M6.61 6.61A18.15 18.15 0 0 0 2 12s3 8 10 8a9.7 9.7 0 0 0 5.39-1.61" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24M2 2l20 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        ) : (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="sm:h-3.5 sm:w-3.5">
                            <path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8-10-8-10-8Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => onEdit(it.key)}
                        title={`Edit ${name}`}
                        aria-label={`Edit ${name}`}
                        className="flex h-11 w-11 items-center justify-center rounded-sm text-text-muted hover:bg-surface-sunken hover:text-brand-600 sm:h-8 sm:w-8"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="sm:h-3.5 sm:w-3.5">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => onDuplicate(it.key)}
                        title={`Duplicate ${name}`}
                        aria-label={`Duplicate ${name}`}
                        className="flex h-11 w-11 items-center justify-center rounded-sm text-text-muted hover:bg-surface-sunken hover:text-brand-600 sm:h-8 sm:w-8"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="sm:h-3.5 sm:w-3.5">
                          <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(it.key)}
                        title={`Delete ${name}`}
                        aria-label={`Delete ${name}`}
                        className="flex h-11 w-11 items-center justify-center rounded-sm text-text-muted hover:bg-surface-sunken hover:text-danger sm:h-8 sm:w-8"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="sm:h-3.5 sm:w-3.5">
                          <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6h12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
