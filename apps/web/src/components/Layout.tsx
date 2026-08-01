// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Responsive shell for authenticated pages:
 *   - lg+  → fixed 248px Sidebar; content shifts right, no bottom nav
 *   - <lg  → BottomNav for section-level pages (`nav` prop, default
 *            true); form/detail pages pass nav={false} because their
 *            own sticky action bars occupy the same screen region.
 *
 * Every authenticated route wraps in Layout so desktop always shows
 * the sidebar; `nav` only controls the mobile bottom bar.
 *
 * The `lg:pl-[248px]` offset MUST stay equal to Sidebar's width — they
 * are one measurement expressed in two files, and a mismatch either
 * overlaps the rail or opens a dead gutter beside it.
 */

import type { ReactNode } from 'react';
import BottomNav from './BottomNav';
import Sidebar from './Sidebar';

export default function Layout({
  children,
  nav = true,
}: {
  children: ReactNode;
  nav?: boolean;
}) {
  return (
    <div className="min-h-screen bg-surface-muted">
      <Sidebar />
      <div className={`lg:pl-[248px] ${nav ? 'pb-20 lg:pb-0' : ''}`}>{children}</div>
      {nav && (
        <div className="lg:hidden">
          <BottomNav />
        </div>
      )}
    </div>
  );
}
