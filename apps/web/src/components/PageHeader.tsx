// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Shared page header per the redesign: white bar with a bottom
 * hairline, a 44px back chevron, the title, and an optional right
 * slot (status badge, meta text). Used by settings sub-pages,
 * customer pages, and the estimate editor.
 *
 * The bar itself is full-bleed (the hairline spans the screen) but its
 * ROW is constrained to the same `max-w-lg` + 16px gutter every page
 * body uses, so the back chevron, the title and the right slot line up
 * with the card edges below instead of sitting closer to the screen
 * edge. The chevron's 44px tap target is pulled left with a negative
 * margin so the glyph — not the invisible padding — is what aligns.
 * The right slot never shrinks; the title truncates instead.
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export default function PageHeader({
  title,
  backTo,
  right,
}: {
  title: string;
  backTo: string;
  right?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-surface">
      <div className="mx-auto flex w-full max-w-lg items-center gap-2 px-4 py-2 lg:max-w-none lg:px-6">
        <Link
          to={backTo}
          aria-label="Back"
          className="-ml-2.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-text-primary hover:bg-surface-sunken"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M15 18l-6-6 6-6"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-text-primary lg:text-lg">
          {title}
        </h1>
        {right && <div className="shrink-0">{right}</div>}
      </div>
    </header>
  );
}
