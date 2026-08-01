// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Designed empty state for lists with no data — a soft icon circle, a
 * title, and an optional hint line. Keeps "nothing here yet" screens
 * intentional rather than blank.
 *
 * It sits inside a card rather than floating on the page so an empty
 * list still occupies the shape a populated one would: the section
 * reads as present-but-empty instead of as a rendering failure, which
 * matters on a field network where a blank area is ambiguous.
 */

import type { ReactNode } from 'react';

export default function EmptyState({
  title,
  hint,
  icon,
}: {
  title: string;
  hint?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-border-light bg-surface px-6 py-10 text-center shadow-sm">
      <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-pill bg-brand-50 text-brand-600">
        {icon ?? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9 10h.01M15 10h.01M9.5 15a3.5 3.5 0 005 0"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        )}
      </div>
      <p className="text-[17px] font-bold text-text-primary">{title}</p>
      {hint && <p className="max-w-xs text-sm text-text-muted">{hint}</p>}
    </div>
  );
}
