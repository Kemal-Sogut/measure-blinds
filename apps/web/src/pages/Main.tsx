// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Main dashboard — the consultant's landing screen.
 *
 * Three large tap-friendly section buttons (Customers, Estimates,
 * Tools) with a gear icon in the top-right for Settings, per the plan.
 * Tools has no functionality yet (no phase defines it), so it renders
 * as a visibly disabled "coming soon" card rather than a dead link.
 * Also offers sign-out, since the shell has no other place for it.
 */

import { Link } from 'react-router-dom';
import { useAuth, useCompanySettings } from '../hooks';

/** Reusable big navigation card used for the three main actions. */
function BigButton({
  to,
  title,
  hint,
  disabled,
}: {
  to: string;
  title: string;
  hint: string;
  disabled?: boolean;
}) {
  const cls =
    'block rounded-2xl border border-border bg-surface-elevated p-6 shadow-sm transition-colors';
  if (disabled) {
    return (
      <div className={`${cls} opacity-50`} aria-disabled="true">
        <span className="block text-xl font-semibold text-text-primary">{title}</span>
        <span className="block text-sm text-text-muted">{hint}</span>
      </div>
    );
  }
  return (
    <Link to={to} className={`${cls} hover:bg-surface active:bg-surface-muted`}>
      <span className="block text-xl font-semibold text-text-primary">{title}</span>
      <span className="block text-sm text-text-muted">{hint}</span>
    </Link>
  );
}

export default function Main() {
  const { data: company } = useCompanySettings();
  const signOut = useAuth((s) => s.signOut);

  return (
    <div className="mx-auto max-w-lg">
      {/* Header with company identity + settings gear */}
      <header className="flex items-center justify-between px-4 pb-2 pt-6">
        <div className="flex items-center gap-3">
          {company?.logo_url && (
            <img
              src={company.logo_url}
              alt=""
              className="h-10 w-10 rounded-lg border border-border-light object-contain"
            />
          )}
          <h1 className="text-2xl font-bold text-text-primary">
            {company?.company_name || 'Blinds Nisa'}
          </h1>
        </div>
        <Link
          to="/settings"
          aria-label="Settings"
          className="flex h-11 w-11 items-center justify-center rounded-full text-text-secondary hover:bg-surface-elevated"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 15a3 3 0 100-6 3 3 0 000 6z"
              stroke="currentColor"
              strokeWidth="1.8"
            />
            <path
              d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33 1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82 1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Link>
      </header>

      {/* Section buttons */}
      <div className="flex flex-col gap-3 p-4">
        <BigButton to="/customers" title="Customers" hint="Search, add, and edit customers" />
        <BigButton to="/estimates" title="Estimates" hint="Create and track estimates" />
        <BigButton to="/tools" title="Tools" hint="Coming soon" disabled />
      </div>

      <div className="px-4 pt-4">
        <button
          onClick={() => void signOut()}
          className="h-11 w-full rounded-xl text-sm font-medium text-text-muted hover:bg-surface-elevated"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
