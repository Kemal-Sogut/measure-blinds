// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Shell for every authenticated page: the navigation rail plus the
 * content column it offsets.
 *
 *   < 768px   no rail in the layout; `Sidebar` opens full-screen from
 *             the header hamburger. Content offset 0.
 *   >= 768px  fixed rail, collapsible between 72px and 248px. Content
 *             offset tracks it.
 *
 * The offset is `padding-inline-start: var(--sidebar-w)` applied by the
 * `.app-shell-main` class, and the rail's own width is `var(--sidebar-w)`
 * too (`.app-shell-rail`). Both resolve from the `data-rail` attribute
 * stamped below — see the App Shell block in `index.css`. This replaced
 * a hard-coded `lg:pl-[248px]` here that had to be kept equal to
 * `Sidebar`'s `w-[248px]` by hand; there is now one number in one file.
 *
 * `Layout` takes no `nav` prop. It used to, to suppress a bottom tab bar
 * on detail/form pages whose own sticky action bars occupied the same
 * strip of screen — which is exactly why tablets and every detail page
 * ended up with no navigation at all. The bottom bar is gone and the
 * hamburger is always available, so there is nothing left to suppress.
 *
 * While the phone overlay is open the content column is marked `inert`:
 * a full-screen menu that Tab can escape behind is not modal, and
 * `inert` is the one mechanism that removes the background from both
 * the tab order and the accessibility tree.
 *
 * `MaintenanceBanner` is mounted here for the same reason: the switch
 * it reports closes only the CUSTOMER surfaces, so no authenticated page
 * would otherwise look any different while customers are being turned
 * away. It renders nothing unless the flag is on.
 *
 * `PullToRefresh` is mounted here rather than per page because the
 * installed home-screen app has no reload affordance anywhere: no
 * address bar, no reload button, and no native overscroll gesture. One
 * mount on the shell gives every authenticated page the same refresh.
 * It renders a `fixed` indicator only and never wraps `children` — see
 * the file's own header for why the content column must not be
 * transformed.
 */

import type { ReactNode } from 'react';
import Sidebar from './Sidebar';
import PullToRefresh from './PullToRefresh';
import MaintenanceBanner from './MaintenanceBanner';
import { useSidebar } from '../hooks/useSidebar';

export default function Layout({ children }: { children: ReactNode }) {
  const collapsed = useSidebar((s) => s.collapsed);
  const mobileOpen = useSidebar((s) => s.mobileOpen);

  return (
    <div
      className="app-shell min-h-screen bg-surface-muted"
      data-rail={collapsed ? 'icons' : 'expanded'}
    >
      <Sidebar />
      <PullToRefresh />
      <div className="app-shell-main min-w-0" inert={mobileOpen}>
        <MaintenanceBanner />
        {children}
      </div>
    </div>
  );
}
