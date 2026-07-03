// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Settings index — navigation hub linking to every settings sub-page.
 * Large tap-friendly rows (≥44px) per the mobile-first requirement.
 */

import { Link } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';

/** Destinations shown on the settings hub, in display order. */
const SECTIONS = [
  { to: '/settings/company', label: 'Company Info', hint: 'Name, logo, contact, HST number' },
  { to: '/settings/fabrics', label: 'Fabrics', hint: 'Price per m²' },
  { to: '/settings/cassette', label: 'Cassette Options', hint: 'Price per meter of width' },
  { to: '/settings/controls', label: 'Control Options', hint: 'Price per panel' },
  { to: '/settings/presets', label: 'Preset Line Items', hint: 'Reusable services & add-ons' },
  { to: '/settings/terms', label: 'Terms & Conditions', hint: 'Shown on estimates and PDFs' },
];

export default function SettingsIndex() {
  return (
    <div className="min-h-screen bg-surface-muted">
      <PageHeader title="Settings" backTo="/" />
      <nav className="mx-auto max-w-lg p-4">
        <ul className="flex flex-col gap-2">
          {SECTIONS.map((s) => (
            <li key={s.to}>
              <Link
                to={s.to}
                className="flex items-center justify-between rounded-xl border border-border bg-surface-elevated p-4 hover:bg-surface"
              >
                <span>
                  <span className="block font-medium text-text-primary">{s.label}</span>
                  <span className="block text-sm text-text-muted">{s.hint}</span>
                </span>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M9 6l6 6-6 6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-text-muted"
                  />
                </svg>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
