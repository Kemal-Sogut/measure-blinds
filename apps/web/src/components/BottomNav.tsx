// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Bottom navigation bar for top-level sections (mobile-first, per
 * IMPLEMENTATION.md §14: bottom nav preferred over hamburger menus).
 *
 * Four fixed tabs — Home, Customers, Estimates, Settings — each with
 * an icon + label and a ≥44px tap area. The active tab is derived
 * from the current location prefix. Rendered only by `Layout`, which
 * wraps section-level pages; detail/form pages omit it to maximize
 * space for their sticky action bars.
 */

import { NavLink } from 'react-router-dom';

/** One nav destination: path prefix drives active-state matching. */
interface Tab {
  to: string;
  label: string;
  /** SVG path data (24×24 viewBox, stroked) */
  d: string;
  /** Match exactly (home) instead of by prefix */
  end?: boolean;
}

const TABS: Tab[] = [
  { to: '/', label: 'Home', end: true, d: 'M3 10.5L12 3l9 7.5M5 9.5V21h5v-6h4v6h5V9.5' },
  {
    to: '/customers',
    label: 'Customers',
    d: 'M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM22 21v-2a4 4 0 00-3-3.87M15 3.13A4 4 0 0118 7a4 4 0 01-3 3.87',
  },
  {
    to: '/orders',
    label: 'Orders',
    d: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM14 2v6h6M9 13h6M9 17h6',
  },
  {
    to: '/settings',
    label: 'Settings',
    d: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33h0a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51h0a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v0a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z',
  },
];

export default function BottomNav() {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface-elevated pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex max-w-lg">
        {TABS.map((tab) => (
          <li key={tab.to} className="flex-1">
            <NavLink
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                `flex min-h-14 flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
                  isActive ? 'font-semibold text-brand-600' : 'text-text-muted'
                }`
              }
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d={tab.d}
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {tab.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
