// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Desktop sidebar navigation (design screen 07): fixed 220px rail
 * with the brand mark, the four sections (active item gets a brand
 * tint + 2px left border), and the signed-in user pinned to the
 * bottom. Rendered by Layout on lg+ screens only — mobile keeps the
 * bottom nav.
 */

import { NavLink } from 'react-router-dom';
import { useAuth, useCompanySettings } from '../hooks';

/** Nav destinations; `end` forces exact matching for Home. */
const ITEMS = [
  { to: '/', label: 'Home', end: true, d: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10' },
  {
    to: '/customers',
    label: 'Customers',
    d: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 100-8 4 4 0 000 8z M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  },
  {
    to: '/orders',
    label: 'Orders',
    d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M9 13h6 M9 17h6',
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
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-[220px] flex-col border-r border-border bg-surface-muted py-5 lg:flex">
      <div className="flex items-center gap-2 px-5 pb-5">
        {company?.logo_url ? (
          <img src={company.logo_url} alt="" className="h-6 w-6 rounded-sm object-contain" />
        ) : (
          <div className="h-6 w-6 rounded-sm bg-brand-600" />
        )}
        <span className="truncate text-sm font-semibold text-text-primary">
          {company?.company_name || 'Blinds Nisa'}
        </span>
      </div>

      <nav className="flex flex-col">
        {ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex min-h-11 items-center gap-2.5 border-l-2 px-5 py-2.5 text-sm ${
                isActive
                  ? 'border-brand-600 bg-brand-100 font-semibold text-brand-600'
                  : 'border-transparent text-text-muted hover:text-text-secondary'
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

      <div className="mt-auto flex items-center gap-2.5 border-t border-border px-5 pt-3.5">
        <div className="h-7 w-7 rounded-sm bg-border-input" />
        <span className="truncate text-[13px] text-text-secondary">{email ?? 'Signed in'}</span>
      </div>
    </aside>
  );
}
