// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Designed empty state for lists with no data — a soft icon circle,
 * a title, and an optional hint line. Keeps "nothing here yet"
 * screens intentional rather than blank (plan Phase 10 item 5,
 * introduced with the shell so later pages can adopt it directly).
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
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-elevated text-text-muted">
        {icon ?? (
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9 10h.01M15 10h.01M9.5 15a3.5 3.5 0 005 0"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        )}
      </div>
      <p className="font-medium text-text-primary">{title}</p>
      {hint && <p className="max-w-xs text-sm text-text-muted">{hint}</p>}
    </div>
  );
}
