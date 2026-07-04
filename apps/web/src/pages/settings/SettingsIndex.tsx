// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Settings hub (redesign screen 06): grouped list cards with section
 * headers, leading icons, and chevrons — BUSINESS (company info,
 * catalogs, terms) and ACCOUNT (sign out, danger-tinted). The design
 * omitted Control Options and Preset Line Items; they're included
 * here because the app manages both. Sign-out moved here from the
 * dashboard per the design.
 */

import { Link } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import { useAuth } from '../../hooks';

/** One settings row: icon path data (24×24 stroked), label, target. */
interface Row {
  to: string;
  label: string;
  d: string;
}

const BUSINESS: Row[] = [
  { to: '/settings/company', label: 'Company Info', d: 'M2 7h20v14H2z M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16' },
  { to: '/settings/fabrics', label: 'Fabrics', d: 'M12 2 2 7l10 5 10-5-10-5z M2 17l10 5 10-5 M2 12l10 5 10-5' },
  { to: '/settings/cassette', label: 'Cassette Options', d: 'M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z' },
  { to: '/settings/controls', label: 'Control Options', d: 'M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6' },
  { to: '/settings/presets', label: 'Preset Line Items', d: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01' },
  { to: '/settings/terms', label: 'Terms & Conditions', d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8' },
];

/** Renders one grouped row with icon + chevron. */
function SettingsRow({ row, last }: { row: Row; last: boolean }) {
  return (
    <Link
      to={row.to}
      className={`flex min-h-11 items-center gap-3 px-3.5 py-3 hover:bg-surface-muted ${
        last ? '' : 'border-b border-border-light'
      }`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        {row.d.split(' M').map((seg, i) => (
          <path
            key={i}
            d={(i === 0 ? '' : 'M') + seg}
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-text-secondary"
          />
        ))}
      </svg>
      <span className="flex-1 text-sm text-text-primary">{row.label}</span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="m9 18 6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-muted" />
      </svg>
    </Link>
  );
}

export default function SettingsIndex() {
  const signOut = useAuth((s) => s.signOut);

  return (
    <div className="min-h-screen bg-surface-muted">
      <div className="lg:hidden">
        <PageHeader title="Settings" backTo="/" />
      </div>
      <div className="mx-auto max-w-lg p-4 lg:max-w-2xl lg:p-8">
        <h1 className="mb-5 hidden text-[22px] font-semibold text-text-primary lg:block">Settings</h1>

        <div className="mb-3.5 rounded-sm border border-border bg-surface">
          <p className="border-b border-border-light px-3.5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            Business
          </p>
          {BUSINESS.map((row, i) => (
            <SettingsRow key={row.to} row={row} last={i === BUSINESS.length - 1} />
          ))}
        </div>

        <div className="rounded-sm border border-border bg-surface">
          <p className="border-b border-border-light px-3.5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            Account
          </p>
          <button
            onClick={() => void signOut()}
            className="flex min-h-11 w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-danger-tint"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-danger"
              />
            </svg>
            <span className="flex-1 text-sm text-danger">Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );
}
