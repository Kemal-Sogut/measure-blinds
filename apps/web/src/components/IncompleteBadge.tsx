// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Stands in for a draft's total in every order list while the draft
 * still has incomplete items (spec 2026-11-02). The stored total leaves
 * those items out at $0, so showing it would read as the order's price.
 * `count` comes from the Worker's `incomplete_items` and includes hidden
 * items — the badge means "cannot be sent yet".
 */

import type { ReactNode } from 'react';

/**
 * Amber "Incomplete" pill rendered in place of a draft's total in the
 * Estimates, Orders and appointment-wizard lists. Callers branch on
 * `incomplete_items > 0` and render this instead of the money value.
 * The pill is sized to sit where a total sits; the tooltip gives the
 * count ("1 item incomplete" / "2 items incomplete") for hover users.
 */
export default function IncompleteBadge({ count }: { count: number }): ReactNode {
  return (
    <span
      title={`${count} item${count === 1 ? '' : 's'} incomplete`}
      className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800"
    >
      Incomplete
    </span>
  );
}
