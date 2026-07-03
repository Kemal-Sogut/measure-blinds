// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Estimate list page — three status tabs (Waiting = draft+sent,
 * Confirmed, Expired) with debounced search by order number or
 * customer name. Cards show order number, customer, dates, total,
 * and a colored status badge; tapping opens the editor.
 */

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import { ListSkeleton } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import { useEstimateList, type EstimateTab } from '../../hooks/useEstimates';
import type { EstimateStatus } from '../../types';

/** Tab definitions in display order. */
const TABS: { key: EstimateTab; label: string }[] = [
  { key: 'waiting', label: 'Waiting' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'expired', label: 'Expired' },
];

/** Badge styling per estimate status. */
const BADGE: Record<EstimateStatus, string> = {
  draft: 'bg-surface-muted text-text-secondary',
  sent: 'bg-brand-100 text-brand-800',
  confirmed: 'bg-green-100 text-green-800',
  expired: 'bg-red-100 text-red-700',
};

export default function EstimateList() {
  const [tab, setTab] = useState<EstimateTab>('waiting');
  const [term, setTerm] = useState('');
  const { data: estimates, isLoading, error } = useEstimateList(tab, term);
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-surface-muted pb-36">
      <PageHeader title="Estimates" backTo="/" />
      <div className="mx-auto max-w-lg p-4">
        {/* Status tabs */}
        <div className="mb-3 flex rounded-xl bg-surface-elevated p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`h-11 flex-1 rounded-lg text-sm font-medium ${
                tab === t.key ? 'bg-brand-600 text-white' : 'text-text-secondary'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <input
          type="search"
          placeholder="Search order # or customer…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          className="mb-4 h-12 w-full rounded-xl border border-border bg-surface-elevated px-4 text-base text-text-primary"
        />

        {isLoading && <ListSkeleton />}
        {error && <p className="text-danger">{error.message}</p>}

        {estimates && estimates.length === 0 && (
          <EmptyState
            title={term ? 'No estimates match your search' : `No ${tab} estimates`}
            hint={term ? 'Try an order number or customer name.' : 'Create one below.'}
          />
        )}

        <ul className="flex flex-col gap-2">
          {estimates?.map((est) => (
            <li key={est.id}>
              <button
                onClick={() => navigate(`/estimates/${est.id}`)}
                className="w-full rounded-xl border border-border bg-surface-elevated p-4 text-left hover:bg-surface"
              >
                <span className="flex items-center justify-between">
                  <span className="font-semibold text-text-primary">{est.order_number}</span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${BADGE[est.status]}`}
                  >
                    {est.status}
                  </span>
                </span>
                <span className="block text-sm text-text-secondary">
                  {est.customer
                    ? `${est.customer.first_name} ${est.customer.last_name}`
                    : 'Unknown customer'}
                </span>
                <span className="mt-1 flex items-center justify-between text-sm">
                  <span className="text-text-muted">
                    {est.estimate_date} → {est.expiry_date}
                  </span>
                  <span className="font-semibold text-text-primary">
                    ${Number(est.total).toFixed(2)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Sticky new-estimate action — sits above the bottom nav */}
      <div className="fixed inset-x-0 bottom-14 z-10 bg-surface-muted p-3 pb-2">
        <Link
          to="/estimates/new"
          className="mx-auto flex h-12 max-w-lg items-center justify-center rounded-xl bg-brand-600 font-semibold text-white hover:bg-brand-700"
        >
          + New Estimate
        </Link>
      </div>
    </div>
  );
}
