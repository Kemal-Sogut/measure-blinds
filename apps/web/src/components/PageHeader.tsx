// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Shared page header for secondary screens.
 *
 * Renders a 44px back button (chevron) plus the page title. Used by
 * every settings sub-page (and later by customer/estimate detail
 * pages) so navigation stays consistent and thumb-reachable.
 */

import { Link } from 'react-router-dom';

export default function PageHeader({ title, backTo }: { title: string; backTo: string }) {
  return (
    <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-surface-elevated px-2 py-2">
      <Link
        to={backTo}
        aria-label="Back"
        className="flex h-11 w-11 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-muted"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M15 18l-6-6 6-6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </Link>
      <h1 className="text-lg font-semibold text-text-primary">{title}</h1>
    </header>
  );
}
