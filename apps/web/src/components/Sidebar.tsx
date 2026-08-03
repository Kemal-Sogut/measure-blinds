// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Primary navigation for every authenticated page, rendered in one of
 * two forms decided purely by viewport width:
 *
 * - `md+` (>=768px) — a fixed rail on the inline-start edge, always on
 *   screen, collapsible between a 248px labelled form and a 72px
 *   icon-only form. Both tablets and desktops get the collapse control;
 *   only the DEFAULT differs (see `useSidebar`). The rail takes its
 *   width from `--sidebar-w`, the same variable that offsets page
 *   content, so the two can never disagree.
 * - `<md` — nothing is in the layout; the rail is off screen and the
 *   header's hamburger opens it as a full-screen overlay. A phone has
 *   no width to spare for a permanent rail, and a full-screen sheet
 *   gives every destination a comfortable tap target instead of the
 *   ~64px-wide tabs a bottom bar could afford.
 *
 * This component replaced the previous split of `Sidebar` (lg+ only)
 * plus `BottomNav` (<lg). That pairing left tablets — and every
 * detail/form page, which suppressed the bottom bar to make room for
 * its own action bar — with no navigation at all beyond a back arrow.
 * One component covering every width cannot reopen that gap.
 *
 * The collapsed rail relies on `title` + `aria-label` for its labels
 * rather than a hover-only tooltip, so the destination is announced to
 * screen readers and to touch users, who never hover.
 */

import { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth, useCompanySettings } from '../hooks';
import { useSidebar } from '../hooks/useSidebar';

/** One nav destination; `end` forces exact matching for Orders at "/". */
interface NavItem {
  to: string;
  label: string;
  /** SVG path data (24×24 viewBox, stroked). Space-`M`-separated subpaths. */
  d: string;
  end?: boolean;
}

/**
 * The four sections, in the order they appear in both the rail and the
 * phone overlay. Orders is the app's home screen and lives at "/".
 */
const ITEMS: NavItem[] = [
  {
    to: '/',
    label: 'Orders',
    end: true,
    d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M9 13h6 M9 17h6',
  },
  {
    to: '/customers',
    label: 'Customers',
    d: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 100-8 4 4 0 000 8z M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  },
  {
    to: '/calendar',
    label: 'Calendar',
    d: 'M3 10h18 M8 2v4M16 2v4 M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z',
  },
  {
    to: '/settings',
    label: 'Settings',
    d: 'M12 15a3 3 0 100-6 3 3 0 000 6z M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33 1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82 1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z',
  },
];

/**
 * Renders one item's glyph. The path data packs several subpaths into a
 * single string separated by " M"; splitting keeps `ITEMS` readable
 * without hand-writing a `<path>` per stroke.
 */
function NavIcon({ d, size = 20 }: { d: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      {d.split(' M').map((seg, i) => (
        <path
          key={i}
          d={(i === 0 ? '' : 'M') + seg}
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

/**
 * Brand mark + company name. The name is hidden (not unmounted) in the
 * collapsed rail so collapsing never re-runs the settings query or
 * reflows the logo.
 */
function Brand({ showName }: { showName: boolean }) {
  const { data: company } = useCompanySettings();
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {company?.logo_url ? (
        <img
          src={company.logo_url}
          alt=""
          className="h-9 w-9 shrink-0 rounded-md border border-border-light object-contain"
        />
      ) : (
        <div className="h-9 w-9 shrink-0 rounded-md bg-brand-600" />
      )}
      {showName && (
        <span className="truncate text-[15px] font-bold text-text-primary">
          {company?.company_name || 'Blinds Nisa'}
        </span>
      )}
    </div>
  );
}

/** Signed-in user chip pinned to the bottom of both nav forms. */
function UserChip({ showEmail }: { showEmail: boolean }) {
  const email = useAuth((s) => s.session?.user.email);
  return (
    <div
      className={`flex items-center gap-2.5 rounded-md bg-surface-sunken p-2.5 ${showEmail ? '' : 'justify-center'}`}
      title={showEmail ? undefined : (email ?? 'Signed in')}
    >
      <span
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-pill bg-brand-100 text-[13px] font-bold text-brand-700"
      >
        {(email?.[0] ?? '?').toUpperCase()}
      </span>
      {showEmail && (
        <span className="truncate text-[13px] text-text-secondary">{email ?? 'Signed in'}</span>
      )}
    </div>
  );
}

/**
 * The active section reads as a filled brand pill in both forms — at a
 * glance across a wide screen a solid shape is found faster than an
 * edge marker, and it matches the rule that brand blue marks the
 * current context.
 */
function itemClass(isActive: boolean, extra: string): string {
  return `flex items-center rounded-md transition-colors ${extra} ${
    isActive
      ? 'bg-brand-600 font-bold text-white shadow-sm'
      : 'font-medium text-text-secondary hover:bg-surface-sunken'
  }`;
}

export default function Sidebar() {
  const collapsed = useSidebar((s) => s.collapsed);
  const mobileOpen = useSidebar((s) => s.mobileOpen);
  const closeMobile = useSidebar((s) => s.closeMobile);
  const toggleCollapsed = useSidebar((s) => s.toggleCollapsed);
  const { pathname } = useLocation();

  // Navigating is the whole point of the overlay, so a route change
  // dismisses it. Keyed on pathname rather than on each NavLink's
  // onClick so that programmatic navigation closes it too.
  useEffect(() => {
    closeMobile();
  }, [pathname, closeMobile]);

  // Esc closes the overlay, and while it is open the page behind it
  // must not scroll — on iOS a scrollable background under a full-screen
  // sheet is the classic "the menu moved when I swiped" bug.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMobile();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [mobileOpen, closeMobile]);

  return (
    <>
      {/* ── md+ : persistent rail ── */}
      <aside
        aria-label="Primary"
        className="app-shell-rail fixed inset-y-0 left-0 z-20 hidden shrink-0 flex-col overflow-hidden border-r border-border-light bg-surface p-3 md:flex"
      >
        <div className={`flex items-center pb-5 pt-2 ${collapsed ? 'justify-center' : 'gap-2 px-1'}`}>
          {!collapsed && <Brand showName />}
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-sunken hover:text-text-primary ${collapsed ? '' : 'ml-auto'}`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M3 5h18M3 12h18M3 19h18"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <nav className="flex flex-col gap-1">
          {ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={collapsed ? item.label : undefined}
              aria-label={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                itemClass(
                  isActive,
                  collapsed
                    ? 'h-11 w-11 justify-center self-center'
                    : 'min-h-11 gap-3 px-3 text-sm'
                )
              }
            >
              <NavIcon d={item.d} size={collapsed ? 20 : 18} />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto">
          <UserChip showEmail={!collapsed} />
        </div>
      </aside>

      {/* ── <md : full-screen overlay ──
          `inset-0` + `dvh` so iOS's collapsing URL bar cannot leave the
          user chip stranded below the fold. Opened by the header
          hamburger (`SidebarToggle`). */}
      {mobileOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
          className="fixed inset-0 z-50 flex h-[100dvh] flex-col bg-surface md:hidden"
        >
          <div className="flex items-center gap-2 border-b border-border-light px-4 py-2.5">
            <Brand showName />
            <button
              type="button"
              autoFocus
              onClick={closeMobile}
              aria-label="Close navigation menu"
              className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-text-secondary hover:bg-surface-sunken"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M18 6 6 18M6 6l12 12"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>

          <nav
            aria-label="Primary"
            className="flex flex-1 flex-col gap-1.5 overflow-y-auto p-4"
          >
            {ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={closeMobile}
                className={({ isActive }) =>
                  itemClass(isActive, 'min-h-14 gap-3.5 px-4 text-[15px]')
                }
              >
                <NavIcon d={item.d} size={22} />
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="border-t border-border-light p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <UserChip showEmail />
          </div>
        </div>
      )}
    </>
  );
}
