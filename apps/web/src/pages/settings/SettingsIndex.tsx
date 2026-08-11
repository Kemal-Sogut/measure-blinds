// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Settings hub: a grid of destination tiles — BUSINESS (company info,
 * catalogs, terms) and ACCOUNT (sign out, danger-tinted). Blind types
 * are managed inside Materials (the Materials landing page lists them),
 * so there is no separate Blind Types row.
 *
 * The tiles replace the previous grouped rows because settings is the
 * one screen where a user arrives already knowing which destination
 * they want. A row list makes them read seven labels top to bottom; a
 * grid of distinctly-hued icon tiles lets them aim. Each destination
 * keeps its accent on its own page's card header, so the colour a user
 * tapped is the colour that greets them.
 */

import { Link } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import { useAuth } from '../../hooks';
import type { CardAccent } from '../../components/ui';

/**
 * One settings destination: icon path data (24×24 stroked), label, a
 * one-line description, the semantic accent it owns app-wide, and the
 * target route.
 */
interface Row {
  to: string;
  label: string;
  desc: string;
  accent: CardAccent;
  d: string;
}

const BUSINESS: Row[] = [
  {
    to: '/settings/company',
    label: 'Company Info',
    desc: 'Name, logo, contact details',
    accent: 'brand',
    d: 'M2 7h20v14H2z M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16',
  },
  {
    to: '/settings/materials',
    label: 'Materials',
    desc: 'Fabrics, colours and blind types',
    accent: 'scheduled',
    d: 'M12 2 2 7l10 5 10-5-10-5z M2 17l10 5 10-5 M2 12l10 5 10-5',
  },
  {
    to: '/settings/cassette',
    label: 'Cassette Options',
    desc: 'Headrail styles and pricing',
    accent: 'warning',
    d: 'M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z',
  },
  {
    to: '/settings/bottom-rail',
    label: 'Bottom Rail Options',
    desc: 'Rail profiles and pricing',
    accent: 'neutral',
    d: 'M3 4h18 M3 12h18 M3 20h18 M7 20v-4 M17 20v-4',
  },
  {
    to: '/settings/controls',
    label: 'Control Options',
    desc: 'Chain and motor choices',
    accent: 'success',
    d: 'M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6',
  },
  {
    // Pleat types are deliberately NOT listed here — they belong to
    // Curtains fabric and are reached from that type's Materials page.
    to: '/settings/installation',
    label: 'Installation Options',
    desc: 'Curtain rod and track pricing',
    accent: 'warning',
    d: 'M3 5h18 M6 5v14 M18 5v14 M9 9h6 M9 13h6',
  },
  {
    to: '/settings/presets',
    label: 'Preset Line Items',
    desc: 'Reusable non-blind charges',
    accent: 'brand',
    d: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01',
  },
  {
    to: '/settings/terms',
    label: 'Terms & Conditions',
    desc: 'Text frozen onto sent estimates',
    accent: 'neutral',
    d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8',
  },
];

/** Icon-badge tint + ink per accent, mirroring `ui/Card`'s CardHeader. */
const ACCENTS: Record<CardAccent, string> = {
  brand: 'bg-info-tint text-info',
  success: 'bg-success-tint text-success',
  warning: 'bg-warning-tint text-warning',
  danger: 'bg-danger-tint text-danger',
  scheduled: 'bg-scheduled-tint text-scheduled',
  neutral: 'bg-surface-sunken text-text-secondary',
};

/** One destination tile: hued icon badge, label, and description. */
function SettingsTile({ row }: { row: Row }) {
  return (
    <Link
      to={row.to}
      className="flex items-center gap-3 rounded-xl border border-border-light bg-surface p-4 shadow-sm transition-shadow hover:shadow-md"
    >
      <span
        aria-hidden="true"
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${ACCENTS[row.accent]}`}
      >
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
          {row.d.split(' M').map((seg, i) => (
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
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-bold text-text-primary">{row.label}</span>
        <span className="block truncate text-[13px] text-text-muted">{row.desc}</span>
      </span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="m9 18 6-6-6-6"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-text-muted"
        />
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
      <div className="page-container py-4 md:py-6 lg:py-8">
        <h1 className="mb-5 hidden text-[22px] font-bold text-text-primary lg:block">Settings</h1>

        <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-text-muted">
          Business
        </p>
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {BUSINESS.map((row) => (
            <SettingsTile key={row.to} row={row} />
          ))}
        </div>

        <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-text-muted">
          Account
        </p>
        <button
          onClick={() => void signOut()}
          className="flex w-full items-center gap-3 rounded-xl border border-border-light bg-surface p-4 text-left shadow-sm transition-colors hover:bg-danger-tint sm:max-w-sm"
        >
          <span
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-danger-tint text-danger"
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
              <path
                d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-bold text-danger">Sign Out</span>
            <span className="block text-[13px] text-text-muted">End this session on this device</span>
          </span>
        </button>
      </div>
    </div>
  );
}
