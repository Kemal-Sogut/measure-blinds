// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Desktop sidebar navigation: a fixed 248px white rail carrying the
 * brand mark, the four sections — Orders (the home screen at "/"),
 * Customers, Calendar, Settings — and the signed-in user pinned to the
 * bottom. Rendered by Layout on lg+ screens only; mobile keeps the
 * bottom nav.
 *
 * The active section is a filled brand pill rather than the previous
 * tint-plus-left-border: at a glance across a wide screen a solid shape
 * is found faster than an edge marker, and it matches the redesign's
 * rule that brand blue marks the current context. Layout's `lg:pl-`
 * offset MUST equal this rail's width — the two are a pair.
 */

import { NavLink } from 'react-router-dom';
import { useAuth, useCompanySettings } from '../hooks';

/** Nav destinations; `end` forces exact matching for Orders at "/". */
const ITEMS = [
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

export default function Sidebar() {
  const { data: company } = useCompanySettings();
  const email = useAuth((s) => s.session?.user.email);

  return (
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-[248px] flex-col border-r border-border-light bg-surface p-3 lg:flex">
      <div className="flex items-center gap-2.5 px-2 pb-5 pt-2">
        {company?.logo_url ? (
          <img
            src={company.logo_url}
            alt=""
            className="h-9 w-9 rounded-md border border-border-light object-contain"
          />
        ) : (
          <div className="h-9 w-9 rounded-md bg-brand-600" />
        )}
        <span className="truncate text-[15px] font-bold text-text-primary">
          {company?.company_name || 'Blinds Nisa'}
        </span>
      </div>

      <nav className="flex flex-col gap-1">
        {ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex min-h-11 items-center gap-3 rounded-md px-3 text-sm transition-colors ${
                isActive
                  ? 'bg-brand-600 font-bold text-white shadow-sm'
                  : 'font-medium text-text-secondary hover:bg-surface-sunken'
              }`
            }
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              {item.d.split(' M').map((seg, i) => (
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
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto flex items-center gap-2.5 rounded-md bg-surface-sunken p-2.5">
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-pill bg-brand-100 text-[13px] font-bold text-brand-700"
        >
          {(email?.[0] ?? '?').toUpperCase()}
        </span>
        <span className="truncate text-[13px] text-text-secondary">{email ?? 'Signed in'}</span>
      </div>
    </aside>
  );
}
