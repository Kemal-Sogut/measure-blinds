// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Shared page header: a sticky bar with a bottom hairline carrying the
 * phone hamburger, a boxed back chevron, the title, and an optional
 * right slot. Used by the settings sub-pages, customer pages, calendar
 * pages and the order editor.
 *
 * The bar is full-bleed (the hairline spans the content column) but its
 * ROW uses the shared page container — fluid up to 1600px with gutters
 * that step 16 → 24 → 32px — so the chevron, the title and the right
 * slot line up with the card edges below at EVERY width. It previously
 * pinned the row to `max-w-lg` (512px) below `lg` and released it to
 * full width above, which put the header on a different track from
 * every page body and left a ~128px dead gutter on a tablet.
 *
 * The right slot is `min-w-0` and may shrink, not `shrink-0`. Fixing it
 * meant a header whose actions could exceed the row and get silently
 * clipped by the page's `overflow-x-clip` guard; a slot that shrinks
 * lets its own contents decide how to degrade. Pages with more than two
 * or three actions should not use this slot at all — see the order
 * editor, which puts its document actions in a toolbar inside the page
 * body where they have the full content width and can wrap.
 *
 * `eyebrow` and `subtitle` are optional and independent. The eyebrow is
 * brand-coloured and uppercase — it names the SECTION a detail page
 * belongs to. The subtitle carries a record's secondary identity (an
 * order number, a date) so the title can stay short enough to survive
 * truncation on a phone.
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import SidebarToggle from './SidebarToggle';

/**
 * The app's shared page container (defined in `index.css`): fluid,
 * gutters stepping 16 → 24 → 32px, capped at `--page-max` (1600px by
 * default) and centred beyond it.
 *
 * Re-exported here because page bodies must sit on exactly the same
 * horizontal track as this header, and importing the name from the
 * component that defines the header is the shortest path from "my body
 * is misaligned" to the fix. A page that wants a narrower body sets
 * `[--page-max:48rem]` alongside it rather than adding a second
 * `max-w-*` utility, which would collide with this one.
 */
export const PAGE_CONTAINER = 'page-container';

export default function PageHeader({
  title,
  backTo,
  right,
  eyebrow,
  subtitle,
}: {
  title: string;
  backTo: string;
  right?: ReactNode;
  /** Section name, e.g. "Order" or "Settings". Uppercased on render. */
  eyebrow?: string;
  /** Secondary identity for the record, e.g. an order number. */
  subtitle?: string;
}) {
  return (
    <header className="sticky top-0 z-10 border-b border-border-light bg-surface">
      <div className={`${PAGE_CONTAINER} flex items-center gap-2 py-2`}>
        <SidebarToggle />
        {/* The chevron's negative pull applies only from `md` up. Below
            that the hamburger already claims the gutter edge, and both
            nudging left would overlap them. */}
        <Link
          to={backTo}
          aria-label="Back"
          className="flex h-11 w-11 shrink-0 items-center justify-center text-text-primary md:-ml-2.5"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-md border border-border-light bg-surface hover:bg-surface-sunken">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M15 18l-6-6 6-6"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </Link>
        <div className="min-w-0 flex-1">
          {eyebrow && (
            <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-brand-600">
              {eyebrow}
            </p>
          )}
          <h1 className="truncate text-lg font-bold text-text-primary lg:text-[22px]">
            {title}
          </h1>
          {subtitle && <p className="truncate text-[13px] text-text-muted">{subtitle}</p>}
        </div>
        {right && <div className="flex min-w-0 items-center justify-end">{right}</div>}
      </div>
    </header>
  );
}
