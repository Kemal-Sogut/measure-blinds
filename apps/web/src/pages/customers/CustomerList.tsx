// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Customer list — search-as-you-type across name, email, phone, and
 * address. Follows the redesign's data patterns: stacked cards below
 * lg, the table pattern (screen 07) on desktop, with the primary
 * action in the header on desktop and a sticky bar on mobile.
 */

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import { ListSkeleton } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import { useCustomerSearch } from '../../hooks/useCustomers';

export default function CustomerList() {
  const [term, setTerm] = useState('');
  const { data: customers, isLoading, error } = useCustomerSearch(term);
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-surface-muted pb-24 lg:pb-8">
      <div className="lg:hidden">
        <PageHeader title="Customers" backTo="/" />
      </div>

      <div className="mx-auto max-w-lg p-4 lg:max-w-5xl lg:p-8">
        {/* Desktop header row */}
        <div className="mb-5 hidden items-center justify-between lg:flex">
          <h1 className="text-[22px] font-semibold text-text-primary">Customers</h1>
          <Link
            to="/customers/new"
            className="flex h-10 items-center gap-2 rounded-sm bg-brand-600 px-4 text-[13px] font-semibold text-white hover:bg-brand-700"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 5v14M5 12h14" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
            </svg>
            New Customer
          </Link>
        </div>

        {/* Search */}
        <div className="relative mb-3.5 max-w-md">
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
          >
            <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.9" />
            <path d="m21 21-4.3-4.3" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            placeholder="Search name, phone, email, address…"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            className="h-11 w-full rounded-sm border border-border bg-surface pl-9 pr-3 text-sm text-text-primary"
          />
        </div>

        {isLoading && <ListSkeleton />}
        {error && <p className="text-danger">{error.message}</p>}
        {customers && customers.length === 0 && (
          <EmptyState
            title={term ? 'No customers match your search' : 'No customers yet'}
            hint={term ? 'Try a different name, phone, or address.' : 'Add your first customer below.'}
          />
        )}

        {/* Mobile cards */}
        {customers && customers.length > 0 && (
          <ul className="flex flex-col gap-2 lg:hidden">
            {customers.map((cust) => (
              <li key={cust.id}>
                <button
                  onClick={() => navigate(`/customers/${cust.id}`)}
                  className="w-full rounded-sm border border-border bg-surface p-3.5 text-left hover:bg-surface-muted"
                >
                  <span className="block text-sm font-medium text-text-primary">
                    {cust.first_name} {cust.last_name}
                  </span>
                  <span className="block text-[13px] text-text-secondary">
                    {[cust.phone, cust.email].filter(Boolean).join(' · ') || 'No contact info'}
                  </span>
                  {cust.shipping_city && (
                    <span className="block text-[13px] text-text-muted">{cust.shipping_city}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Desktop table */}
        {customers && customers.length > 0 && (
          <div className="hidden overflow-hidden rounded-sm border border-border lg:block">
            <div className="grid grid-cols-[1.4fr_1fr_1.4fr_1fr] border-b border-border bg-surface-muted px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
              <span>Name</span>
              <span>Phone</span>
              <span>Email</span>
              <span>City</span>
            </div>
            {customers.map((cust, i) => (
              <button
                key={cust.id}
                onClick={() => navigate(`/customers/${cust.id}`)}
                className={`grid w-full grid-cols-[1.4fr_1fr_1.4fr_1fr] items-center bg-surface px-4 py-3 text-left hover:bg-surface-muted ${
                  i > 0 ? 'border-t border-border-light' : ''
                }`}
              >
                <span className="text-[13px] font-medium text-text-primary">
                  {cust.first_name} {cust.last_name}
                </span>
                <span className="font-mono text-[13px] text-text-secondary">{cust.phone || '—'}</span>
                <span className="truncate text-[13px] text-text-secondary">{cust.email || '—'}</span>
                <span className="text-[13px] text-text-secondary">{cust.shipping_city || '—'}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Mobile sticky new-customer action */}
      <div className="fixed inset-x-0 bottom-14 z-10 bg-surface-muted p-3 pb-2 lg:hidden">
        <Link
          to="/customers/new"
          className="mx-auto flex h-[46px] max-w-lg items-center justify-center rounded-sm bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700"
        >
          + New Customer
        </Link>
      </div>
    </div>
  );
}
