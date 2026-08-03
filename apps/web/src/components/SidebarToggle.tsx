// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * The phone hamburger that opens `Sidebar`'s full-screen navigation
 * overlay. Hidden from `md` up, where the rail is permanently on screen
 * and carries its own collapse control — two visible menu buttons would
 * be two answers to the same question.
 *
 * It is rendered by page headers rather than floated over the page by
 * `Layout`, so it sits in the header's own flow and cannot overlap a
 * page's title or actions at any width. `PageHeader` renders it for the
 * 17 pages that use it; `OrderList`, which hand-rolls its header, places
 * it itself.
 *
 * 44px tap target per the app's touch-target floor, with the glyph
 * optically centred inside it.
 */

import { useSidebar } from '../hooks/useSidebar';

export default function SidebarToggle({ className = '' }: { className?: string }) {
  const openMobile = useSidebar((s) => s.openMobile);

  return (
    <button
      type="button"
      onClick={openMobile}
      aria-label="Open navigation menu"
      aria-haspopup="dialog"
      className={`-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-text-primary hover:bg-surface-sunken md:hidden ${className}`}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M3 5h18M3 12h18M3 19h18"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
