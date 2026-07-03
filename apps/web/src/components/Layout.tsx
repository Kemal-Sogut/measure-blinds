// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Shared layout for section-level pages (Main, Customers, Estimates,
 * Settings hub). Renders the page content with enough bottom padding
 * to clear the fixed BottomNav, then the nav itself.
 *
 * Detail and form pages are NOT wrapped in this layout — they use
 * their own sticky action bars in the same screen region, and nesting
 * both would stack two fixed bars.
 */

import type { ReactNode } from 'react';
import BottomNav from './BottomNav';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-surface-muted pb-20">
      {children}
      <BottomNav />
    </div>
  );
}
