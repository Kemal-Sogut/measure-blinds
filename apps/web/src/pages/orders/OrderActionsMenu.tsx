// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Below-xl home of the order's document actions (Send, Download, Customer
 * View, Duplicate, Delete): a "more" button in the page header that opens
 * a small dropdown.
 *
 * On xl+ these actions live in `OrderSectionRail`. Below xl there is no
 * left column, and five buttons in the header row would overflow a phone
 * — the failure that once made Delete silently unreachable (see the
 * `PageHeader` right-slot note). A menu holds any number of actions in a
 * 44px target. It takes the SAME `OrderNavAction` list the rail gets, so
 * the two forms cannot drift, and it keeps the rail's grouping: document
 * actions first, then a divider, then Duplicate and Delete.
 *
 * Closes on outside press, on Escape (returning focus to the trigger), and
 * after any action runs — an action that navigates away or opens a sheet
 * should not leave the menu floating over the result.
 */

import { useEffect, useId, useRef, useState } from 'react';
import type { OrderNavAction } from './OrderSectionNav';

interface OrderActionsMenuProps {
  /** Document actions, listed first. */
  topActions: OrderNavAction[];
  /** Copy / destructive actions, listed after a divider. */
  bottomActions: OrderNavAction[];
}

export default function OrderActionsMenu({ topActions, bottomActions }: OrderActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const item = (a: OrderNavAction) => (
    <button
      key={a.key}
      type="button"
      role="menuitem"
      onClick={() => {
        setOpen(false);
        a.onClick();
      }}
      disabled={a.disabled}
      title={a.title}
      className={`flex h-11 w-full items-center gap-2.5 px-3 text-left text-[14px] font-medium hover:bg-surface-sunken disabled:opacity-40 ${a.variant === 'danger' ? 'text-danger' : a.variant === 'primary' ? 'text-brand-600' : 'text-text-primary'
        }`}
    >
      {a.icon}
      <span className="truncate">{a.label}</span>
    </button>
  );

  return (
    <div ref={rootRef} className="relative xl:hidden">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label="Order actions"
        className="flex h-10 w-10 items-center justify-center rounded-md border border-border-light bg-surface text-text-primary hover:bg-surface-sunken"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          className="absolute right-0 top-full z-30 mt-1.5 w-56 overflow-hidden rounded-lg border border-border-light bg-surface py-1 shadow-lg"
        >
          {topActions.map(item)}
          {topActions.length > 0 && bottomActions.length > 0 && (
            <div role="separator" className="my-1 border-t border-border-light" />
          )}
          {bottomActions.map(item)}
        </div>
      )}
    </div>
  );
}
