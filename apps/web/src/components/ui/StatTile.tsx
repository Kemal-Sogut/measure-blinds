// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Single-metric tile: a hued circular icon, a large value, and a label.
 *
 * This is the redesign's summary unit — a row of them gives a section
 * its state at a glance before any list is read. The accent is
 * semantic, not decorative: a tile counting orders awaiting payment is
 * `warning` because that is what amber means everywhere else in the
 * app.
 *
 * Passing `to` renders the tile as a router link, making it a filter
 * shortcut into the list below; omitting it renders inert markup. The
 * value uses the mono family so a row of tiles keeps its digits
 * aligned.
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { CardAccent } from './Card';

const ACCENTS: Record<CardAccent, string> = {
  brand: 'bg-info-tint text-info',
  success: 'bg-success-tint text-success',
  warning: 'bg-warning-tint text-warning',
  danger: 'bg-danger-tint text-danger',
  scheduled: 'bg-scheduled-tint text-scheduled',
  neutral: 'bg-surface-sunken text-text-secondary',
};

export default function StatTile({
  label,
  value,
  icon,
  accent = 'brand',
  to,
}: {
  label: string;
  /** Pre-formatted — the tile never formats numbers or currency itself. */
  value: string;
  icon: ReactNode;
  accent?: CardAccent;
  /** Makes the tile a filter shortcut into the list below. */
  to?: string;
}) {
  const body = (
    <>
      <span
        aria-hidden="true"
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-pill ${ACCENTS[accent]}`}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-mono text-xl font-semibold leading-7 text-text-primary">
          {value}
        </span>
        <span className="block truncate text-[13px] leading-[18px] text-text-muted">
          {label}
        </span>
      </span>
    </>
  );

  const shell =
    'flex items-center gap-3 rounded-xl border border-border-light bg-surface px-4 py-3.5 shadow-sm';

  return to ? (
    <Link to={to} className={`${shell} transition-shadow hover:shadow-md`}>
      {body}
    </Link>
  ) : (
    <div className={shell}>{body}</div>
  );
}
