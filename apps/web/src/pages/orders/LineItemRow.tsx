// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * One line-item row for `LineItemList.tsx`, plus its 3-dot action menu.
 *
 * Split out of `LineItemList.tsx` (Task 11) because the row grew a menu,
 * an expandable detail panel and move controls on top of what it already
 * did — keeping all of that inline would have pushed the list file well
 * past this codebase's file-length comfort zone. `LineItemList` still owns
 * the `<ul>`, the empty state, and the `expanded` key set; this file owns
 * everything about rendering ONE row.
 *
 * Task 12 added a drag handle (`@dnd-kit`) as a new leading control in the
 * row. This file calls `useSortable` itself — each row needs its OWN id and
 * transform, which `LineItemList`'s shared `DndContext`/`SortableContext`
 * cannot supply per row — and attaches the resulting `listeners`/
 * `attributes` to the handle button ONLY, never to the row or its
 * name/body button, so dragging can never fight the row's existing tap
 * targets (expand, checkbox, Edit, Delete, the 3-dot menu).
 *
 * Every row reads its price and attribute line from the in-progress DRAFT
 * (`ItemDraft`), not the persisted `LineItem`, for the same reason
 * `LineItemList` does: this list shows unsaved edits.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getBlindType } from '../../lib/blindTypes';
import {
  blindDraftPrice,
  flatDraftPrice,
  parseDraftAttributes,
  slotsForType,
  type BlindDraft,
  type FlatDraft,
  type ItemDraft,
  type Catalogs,
} from './lineItemDrafts';

/**
 * Builds the expanded-panel lines for a blind draft: panel widths ×
 * height, material, colour, one line per hardware slot the SELECTED TYPE
 * actually uses (skipping any slot the type doesn't scope, same rule
 * `slotsForType` gives the form and the price preview), the type's own
 * attributes (via `describeAttributes`, so this panel can never disagree
 * with the PDF or the customer page about a label), a note, and quantity
 * × unit price.
 *
 * Every entry that would be empty is dropped rather than shown blank —
 * an unfinished draft (no material picked yet, say) still opens to
 * *something* useful instead of a wall of colons.
 */
function blindDetailLines(item: BlindDraft, catalogs: Catalogs): string[] {
  const uses = slotsForType(catalogs, item.blinds_type);
  const material = catalogs.materials.find((m) => m.id === item.material_id);
  const cassette = catalogs.cassettes.find((c) => c.id === item.cassette_id);
  const bottomRail = catalogs.bottomRails.find((b) => b.id === item.bottom_rail_id);
  const control = catalogs.controls.find((c) => c.id === item.control_id);
  const installation = catalogs.installationOptions.find((o) => o.id === item.installation_id);
  const panelsText = item.panels.map((p) => p.trim()).filter(Boolean).join(' + ');
  const price = blindDraftPrice(item, catalogs);

  return [
    panelsText && item.height_cm.trim()
      ? `Panels: ${panelsText} cm × ${item.height_cm.trim()} cm`
      : '',
    material ? `Material: ${material.name}` : '',
    item.color.trim() ? `Color: ${item.color.trim()}` : '',
    uses.has('cassette') && cassette ? `Cassette: ${cassette.name}` : '',
    uses.has('bottom_rail') && bottomRail ? `Bottom rail: ${bottomRail.name}` : '',
    uses.has('control') && control ? `Control: ${control.name}` : '',
    uses.has('installation') && installation ? `Installation: ${installation.name}` : '',
    ...getBlindType(item.blinds_type)
      .describeAttributes(parseDraftAttributes(item) ?? {})
      .map((a) => `${a.label}: ${a.value}`),
    item.note.trim() ? `Note: ${item.note.trim()}` : '',
    price
      ? `Qty: ${item.quantity} × $${price.unit.toFixed(2)}`
      : item.quantity.trim()
        ? `Qty: ${item.quantity.trim()}`
        : '',
  ].filter(Boolean);
}

/**
 * Builds the expanded-panel lines for a preset/custom draft: title (the
 * row's own header shows the description, not the title — see
 * `LineItemList`'s `name` — so this is the only place the title itself is
 * visible), each non-blank description line, quantity and unit price.
 */
function flatDetailLines(item: FlatDraft): string[] {
  const price = flatDraftPrice(item);
  const descLines = item.description
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return [
    item.title.trim() ? `Title: ${item.title.trim()}` : '',
    ...descLines,
    item.quantity.trim() ? `Qty: ${item.quantity.trim()}` : '',
    price
      ? `Unit price: $${price.unit.toFixed(2)}`
      : item.unit_price.trim()
        ? `Unit price: $${item.unit_price.trim()}`
        : '',
  ].filter(Boolean);
}

/** Props for the internal {@link RowMenu} popover — see it for behaviour. */
interface RowMenuProps {
  /** Item name, for the trigger's `aria-label` ("More actions for …"). */
  name: string;
  hidden: boolean;
  postConfirm: boolean;
  isFirst: boolean;
  isLast: boolean;
  onToggleHidden: () => void;
  onDuplicate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

/**
 * The row's 3-dot menu: every action on a line item OTHER than Edit and
 * Delete, which stay as their own icon buttons because they are the two
 * most frequent actions and burying them a tap deeper would cost more
 * than the menu saves in row width. Holds, in order: Show/Hide, Duplicate,
 * Move up, Move down.
 *
 * Rendered through a PORTAL into `document.body`, not as a plain
 * `absolute` child of the trigger: the row lives inside the line-items
 * `<section>`, which is `overflow-hidden` (it clips content to the
 * card's rounded corners). A popover positioned relative to the last row
 * would be sliced off by that clip the moment it needed to open
 * downward — which is exactly the row most likely to need it, since nothing
 * is below it to push the menu open upward instead. Escaping to `body`
 * with `position: fixed` coordinates taken from the trigger's own
 * `getBoundingClientRect()` sidesteps every ancestor's overflow, at the
 * cost of needing to close the menu on scroll/resize (below) rather than
 * track the trigger's position live — acceptable for a popover this
 * short-lived.
 *
 * Closes on: choosing an item, a `pointerdown` outside both the trigger
 * and the portaled panel, `Escape`, or the page scrolling/resizing under
 * it. `aria-haspopup="menu"` / `aria-expanded` on the trigger and
 * `role="menu"` / `role="menuitem"` on the panel identify it to
 * assistive tech.
 */
function RowMenu({
  name,
  hidden,
  postConfirm,
  isFirst,
  isLast,
  onToggleHidden,
  onDuplicate,
  onMoveUp,
  onMoveDown,
}: RowMenuProps): ReactNode {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, right: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    // The panel's `position: fixed` coordinates are captured once, at
    // open time — cheaper than tracking the trigger live, and the menu
    // is short-lived enough that a scroll/resize closing it outright
    // (rather than re-following the trigger) is not disruptive.
    function onViewportChange() {
      setOpen(false);
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onViewportChange, true);
    window.addEventListener('resize', onViewportChange);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onViewportChange, true);
      window.removeEventListener('resize', onViewportChange);
    };
  }, [open]);

  function openMenu() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setCoords({ top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) });
    }
    setOpen(true);
  }

  /** Runs one action then closes the menu — every menu item goes through this. */
  function choose(action: () => void) {
    action();
    setOpen(false);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More actions for ${name}`}
        title="More actions"
        className="flex h-11 w-11 items-center justify-center rounded-sm text-text-muted hover:bg-surface-sunken hover:text-brand-600 sm:h-8 sm:w-8"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="sm:h-3.5 sm:w-3.5">
          <circle cx="12" cy="5" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="19" r="2" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            style={{ top: coords.top, right: coords.right }}
            className="fixed z-20 w-44 rounded-md border border-border-light bg-surface py-1 shadow-md"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => choose(onToggleHidden)}
              disabled={postConfirm}
              title={postConfirm ? 'Visibility can only be changed before the order is confirmed' : undefined}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-text-primary hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
            >
              {hidden ? 'Show' : 'Hide'}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => choose(onDuplicate)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-text-primary hover:bg-surface-muted"
            >
              Duplicate
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => choose(onMoveUp)}
              disabled={isFirst}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-text-primary hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
            >
              Move up
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => choose(onMoveDown)}
              disabled={isLast}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-text-primary hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
            >
              Move down
            </button>
          </div>,
          document.body
        )}
    </>
  );
}

/** Props for {@link LineItemRow}. See `LineItemListProps` for the shared conventions — this mirrors it one item at a time. */
export interface LineItemRowProps {
  /** The draft this row renders. */
  item: ItemDraft;
  /** Position in the list — feeds the "Blind N" / "Item N" fallback name and nothing else (move enablement uses `isFirst`/`isLast` instead, so this component never needs the list's length). */
  index: number;
  /** True for the first row — disables "Move up" in the menu. */
  isFirst: boolean;
  /** True for the last row — disables "Move down" in the menu. */
  isLast: boolean;
  /** Material/hardware catalogs, needed to price a blind draft and to
   *  resolve the hardware ids shown in the detail panel to their names. */
  catalogs: Catalogs;
  /** Hides the checkbox and every action control, per `LineItemListProps.readOnly`. */
  readOnly: boolean;
  /** Disables the Show/Hide menu item, per `LineItemListProps.postConfirm`. */
  postConfirm: boolean;
  /** Whether this row is checkbox-selected. */
  selected: boolean;
  /** Whether this row's detail panel is open. */
  expanded: boolean;
  /** Toggles this row's membership in the caller's `selected` set. */
  onToggleSelect: () => void;
  /** Toggles the detail panel — bound to the name/body button. */
  onToggleExpand: () => void;
  /** Toggles this item's `hidden` flag — bound to the menu's Show/Hide item. */
  onToggleHidden: () => void;
  /** Opens the edit sheet for this item. */
  onEdit: () => void;
  /** Duplicates this item in place — bound to the menu's Duplicate item. */
  onDuplicate: () => void;
  /** Removes this item from the draft list. */
  onDelete: () => void;
  /** Moves this row one position up (-1) or down (+1); the caller no-ops at the edges, so this component only needs to know NOT to offer a move that would no-op (`isFirst`/`isLast`). */
  onMove: (dir: -1 | 1) => void;
}

/**
 * Renders one line-item row: a drag handle, checkbox, an optional "Hidden"
 * pill, a name/body button that expands a detail panel, the price (with its
 * amber override dot), and — unless `readOnly` — Edit, Delete and the
 * 3-dot {@link RowMenu} (Show/Hide, Duplicate, Move up, Move down).
 *
 * No type badge: Task 11 removes it, since the name line already reads
 * as "Room — Type" for a blind and the flat item's description already
 * distinguishes preset/custom rows well enough on its own for staff use.
 *
 * Purely presentational, like `LineItemList`: every state change is a
 * callback prop, and this component never mutates a draft or reaches
 * into a hook that owns application state (only `RowMenu`'s own
 * open/closed flag and `useSortable`'s internal drag state are local).
 * `onMove` and the list's drag-and-drop `onReorder` are two independent
 * ways to reach the same end (a new item order) — this component only
 * ever calls `onMove`; the drag path goes straight from the handle's
 * `listeners` through `LineItemList`'s `DndContext` to `onReorder` in
 * `OrderDetail.tsx`, never through this component's own props.
 */
export default function LineItemRow({
  item,
  index,
  isFirst,
  isLast,
  catalogs,
  readOnly,
  postConfirm,
  selected,
  expanded,
  onToggleSelect,
  onToggleExpand,
  onToggleHidden,
  onEdit,
  onDuplicate,
  onDelete,
  onMove,
}: LineItemRowProps): ReactNode {
  const price = item.item_type === 'blind' ? blindDraftPrice(item, catalogs) : flatDraftPrice(item);
  const name =
    item.item_type === 'blind'
      ? [item.room_name || `Blind ${index + 1}`, item.blinds_type].filter(Boolean).join(' — ')
      : item.description || `Item ${index + 1}`;
  const attrLine =
    item.item_type === 'blind'
      ? getBlindType(item.blinds_type)
          .describeAttributes(parseDraftAttributes(item) ?? {})
          .map((a) => `${a.label}: ${a.value}`)
          .join(' · ')
      : '';
  const detailLines = item.item_type === 'blind' ? blindDetailLines(item, catalogs) : flatDetailLines(item);
  const detailsId = `line-item-details-${item.key}`;

  // `useSortable` is called here, per-row, rather than lifted to
  // `LineItemList`, because it needs THIS row's own id and returns THIS
  // row's own transform — `LineItemList` only owns the list-level
  // `DndContext`/`SortableContext`/sensors (see its file header). Disabled
  // in read-only: with no handle rendered (below) there would be nothing
  // to attach `listeners`/`attributes` to anyway, but disabling here also
  // stops `useSortable` from registering this row as a drop target while
  // the list otherwise looks and behaves the same as any other read-only
  // row.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.key,
    disabled: readOnly,
  });
  const sortableStyle = { transform: CSS.Transform.toString(transform), transition };

  return (
    <li
      ref={setNodeRef}
      style={sortableStyle}
      className={`flex min-w-0 flex-col gap-1.5 px-3 py-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2${item.hidden ? ' opacity-55' : ''}${isDragging ? ' relative z-10 bg-surface opacity-90 shadow-md' : ''}`}
    >
      {/*
        Line 1 on phones: handle, checkbox, name.

        Alignment is start on phones and centre at `sm+`.
        On a phone the name routinely wraps to several
        lines, and a centred checkbox would float
        beside the middle of that block instead of its
        first line. At `sm+` the row is one line whose
        height is set by the 32px action buttons, so
        start-alignment left the text visibly above the
        row's centre — hence the switch.
      */}
      <div className="flex min-w-0 flex-1 items-start gap-2 sm:items-center">
        {/*
          Drag handle — hidden in read-only, same as the checkbox and
          every other action control below. `{...listeners}
          {...attributes}` are attached ONLY here, never on the row or
          its name/body button: the body is already a tap target that
          expands the detail panel, and the row also holds a checkbox,
          two icon buttons and a menu trigger — if drag listeners landed
          on any of that, a tap to expand or press a button would race a
          drag-start on a touch screen and the row would become
          unreliable to use one-handed at a customer's house. `touch-none`
          stops the browser's own touch-scroll gesture from competing
          with `PointerSensor`'s drag once a touch lands on the handle;
          `cursor-grab` is a desktop-only affordance (irrelevant to touch,
          harmless to leave in).
        */}
        {!readOnly && (
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Reorder ${name}`}
            className="flex h-11 w-11 shrink-0 touch-none cursor-grab items-center justify-center rounded-sm text-text-muted hover:bg-surface-sunken hover:text-brand-600 sm:h-8 sm:w-8"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="sm:h-3.5 sm:w-3.5">
              <circle cx="9" cy="6" r="1.6" />
              <circle cx="15" cy="6" r="1.6" />
              <circle cx="9" cy="12" r="1.6" />
              <circle cx="15" cy="12" r="1.6" />
              <circle cx="9" cy="18" r="1.6" />
              <circle cx="15" cy="18" r="1.6" />
            </svg>
          </button>
        )}

        {/* Checkbox — hidden in read-only */}
        {!readOnly && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            aria-label={`Select ${name}`}
            className="mt-0.5 h-4 w-4 shrink-0 rounded-sm accent-brand-600 sm:mt-0"
          />
        )}

        {/* Says out loud what the muted row and the
            struck price only imply: this line is on
            no document and in no total. */}
        {item.hidden && (
          <span className="mt-0.5 shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted sm:mt-0">
            Hidden
          </span>
        )}

        {/*
          Name/body area is a BUTTON that toggles the detail panel
          below the row. It wraps the exact same span structure the
          plain `<div>` used to — a flex container with a shrunk
          chevron and a `min-w-0 flex-1` name span — because the
          intrinsic-width behaviour those comments describe is a
          property of the FLEX LAYOUT, not of the tag: swapping `div`
          for `button` (with an explicit `flex` class, since a bare
          `<button>` defaults to `inline-block`) changes nothing about
          how the browser measures it.
        */}
        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          aria-controls={detailsId}
          className="flex min-w-0 flex-1 items-start gap-1.5 text-left sm:items-center"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            className={`mt-1 shrink-0 text-text-muted transition-transform duration-150 sm:mt-0 ${expanded ? 'rotate-90' : ''}`}
          >
            <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
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
            {attrLine && <span className="mt-0.5 block text-xs text-text-muted">{attrLine}</span>}
          </span>
        </button>
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
          className={`flex shrink-0 items-center gap-1.5 font-mono text-[13px] text-text-primary${item.hidden ? ' line-through' : ''}`}
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

        {/* Edit / Delete / more-actions menu — hidden in
            read-only. 44px targets on the two-line
            layout, where there is room; back to 32px
            inline at `sm+`. Show/Hide and Duplicate moved
            into the menu (RowMenu) — see it for why. */}
        {!readOnly && (
          <span className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={onEdit}
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
              onClick={onDelete}
              title={`Delete ${name}`}
              aria-label={`Delete ${name}`}
              className="flex h-11 w-11 items-center justify-center rounded-sm text-text-muted hover:bg-surface-sunken hover:text-danger sm:h-8 sm:w-8"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="sm:h-3.5 sm:w-3.5">
                <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6h12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <RowMenu
              name={name}
              hidden={item.hidden}
              postConfirm={postConfirm}
              isFirst={isFirst}
              isLast={isLast}
              onToggleHidden={onToggleHidden}
              onDuplicate={onDuplicate}
              onMoveUp={() => onMove(-1)}
              onMoveDown={() => onMove(1)}
            />
          </span>
        )}
      </div>

      {/* Detail panel — modelled on the customer-facing
          `LineItemRow` in `customer-view/CustomerView.tsx`
          (chevron + indented muted lines), so the two read
          consistently. Plain block markup, not a flex
          container: Tailwind's `.flex` utility (author CSS)
          outranks the UA stylesheet's `[hidden] { display:
          none }`, so a `hidden` element with `flex` in its
          className would still render — the same trap
          `CustomerView`'s panel avoids the same way. */}
      <div id={detailsId} hidden={!expanded} className="w-full pl-6 sm:basis-full">
        {detailLines.map((line, i) => (
          <p key={i} className="text-xs text-text-muted">
            {line}
          </p>
        ))}
      </div>
    </li>
  );
}
