// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Shared page header: a sticky bar with a bottom hairline, a boxed back
 * chevron, the title, and an optional right slot (status badge, meta
 * text). Used by settings sub-pages, customer pages, and the estimate
 * editor.
 *
 * The bar itself is full-bleed (the hairline spans the screen) but its
 * ROW is constrained to the same `max-w-lg` + 16px gutter every page
 * body uses, so the back chevron, the title and the right slot line up
 * with the card edges below instead of sitting closer to the screen
 * edge. The chevron's 44px tap target is pulled left with a negative
 * margin so the glyph — not the invisible padding — is what aligns; the
 * visible box inside it is 40px, which keeps the tap area legal while
 * matching the 10px radius of the buttons beside it. The right slot
 * never shrinks; the title truncates instead.
 *
 * `eyebrow` and `subtitle` are optional and independent. The eyebrow is
 * brand-coloured and uppercase — it names the SECTION a detail page
 * belongs to, which is the redesign's answer to "where am I" on screens
 * that have no sidebar. The subtitle carries a record's secondary
 * identity (an order number, a date) so the title can stay short enough
 * to survive truncation on a phone.
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

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
      <div className="mx-auto flex w-full max-w-lg items-center gap-2 px-4 py-2 lg:max-w-none lg:px-6">
        <Link
          to={backTo}
          aria-label="Back"
          className="-ml-2.5 flex h-11 w-11 shrink-0 items-center justify-center text-text-primary"
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
        {right && <div className="shrink-0">{right}</div>}
      </div>
    </header>
  );
}
