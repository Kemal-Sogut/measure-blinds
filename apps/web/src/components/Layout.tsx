// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Responsive shell for authenticated pages (redesign screens 02/07):
 *   - lg+  → fixed 220px Sidebar; content shifts right, no bottom nav
 *   - <lg  → BottomNav for section-level pages (`nav` prop, default
 *            true); form/detail pages pass nav={false} because their
 *            own sticky action bars occupy the same screen region.
 *
 * Every authenticated route wraps in Layout so desktop always shows
 * the sidebar; `nav` only controls the mobile bottom bar.
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
      <div className={`lg:pl-[220px] ${nav ? 'pb-20 lg:pb-0' : ''}`}>{children}</div>
      {nav && (
        <div className="lg:hidden">
          <BottomNav />
        </div>
      )}
    </div>
  );
}
