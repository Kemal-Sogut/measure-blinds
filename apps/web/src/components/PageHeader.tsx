// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Shared page header per the redesign: white bar with a bottom
 * hairline, a 44px back chevron, the title, and an optional right
 * slot (status badge, meta text). Used by settings sub-pages,
 * customer pages, and the estimate editor.
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
    <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-surface px-2 py-2">
      <Link
        to={backTo}
        aria-label="Back"
        className="flex h-11 w-11 items-center justify-center rounded-sm text-text-primary hover:bg-surface-sunken"
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
      {right && <div className="pr-2">{right}</div>}
    </header>
  );
}
