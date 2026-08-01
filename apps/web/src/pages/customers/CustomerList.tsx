// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Customer list — search-as-you-type across name, email, phone, and
 * address. Follows the redesign's data patterns: stacked row cards
 * below lg, a table inside a card on desktop, with the primary action
 * in the header on desktop and a sticky bar on mobile.
 */

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import { ListSkeleton } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import { Card, CardBody } from '../../components/ui';
import { useCustomerSearch } from '../../hooks/useCustomers';
import { displayName } from '../../lib/customerName';
import type { Customer } from '../../types';

/**
 * Up to two initials for the row avatar. Falls back to a single letter
 * when only one name is recorded, then to the first character of the
 * customer's display name (email or phone) when no name exists at all,
 * and finally to "?" — so every record renders a stable circle rather
 * than collapsing the row's leading column.
 */
function initials(cust: Customer): string {
  const a = cust.first_name?.trim()[0] ?? '';
  const b = cust.last_name?.trim()[0] ?? '';
  const fromName = (a + b).toUpperCase();
  if (fromName) return fromName;
  // No name at all: take the first character of whatever identifies
  // them instead (email, then phone), so the avatar matches the label
  // beside it rather than showing a bare "?" next to "a@b.com".
  const fallback = displayName(cust).trim()[0] ?? '';
  return fallback.toUpperCase() || '?';
}

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
          <h1 className="text-[22px] font-bold text-text-primary">Customers</h1>
          <Link
            to="/customers/new"
            className="flex h-11 items-center gap-2 rounded-md bg-brand-600 px-4 text-[13px] font-semibold text-white shadow-sm hover:bg-brand-700"
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
            className="h-11 w-full rounded-md border border-border-input bg-surface pl-9 pr-3 text-[15px] text-text-primary placeholder:text-text-muted"
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
          <ul className="flex flex-col gap-2.5 lg:hidden">
            {customers.map((cust) => (
              <li key={cust.id}>
                <button
                  onClick={() => navigate(`/customers/${cust.id}`)}
                  className="flex w-full items-center gap-3 rounded-xl border border-border-light bg-surface p-3.5 text-left shadow-sm transition-shadow hover:shadow-md"
                >
                  <span
                    aria-hidden="true"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-brand-100 text-[13px] font-bold text-brand-700"
                  >
                    {initials(cust)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-bold text-text-primary">
                      {displayName(cust)}
                    </span>
                    <span className="block truncate text-[13px] text-text-secondary">
                      {[cust.phone, cust.email].filter(Boolean).join(' · ') || 'No contact info'}
                    </span>
                    {cust.shipping_city && (
                      <span className="block truncate text-[13px] text-text-muted">
                        {cust.shipping_city}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Desktop table */}
        {customers && customers.length > 0 && (
          <div className="hidden lg:block">
            <Card className="overflow-hidden">
              <CardBody flush>
                <div className="grid grid-cols-[1.4fr_1fr_1.4fr_1fr] border-b border-border-light bg-surface-sunken px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-text-muted">
                  <span>Name</span>
                  <span>Phone</span>
                  <span>Email</span>
                  <span>City</span>
                </div>
                {customers.map((cust, i) => (
                  <button
                    key={cust.id}
                    onClick={() => navigate(`/customers/${cust.id}`)}
                    className={`grid w-full grid-cols-[1.4fr_1fr_1.4fr_1fr] items-center bg-surface px-4 py-3 text-left transition-colors hover:bg-surface-sunken ${
                      i > 0 ? 'border-t border-border-light' : ''
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span
                        aria-hidden="true"
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-pill bg-brand-100 text-[11px] font-bold text-brand-700"
                      >
                        {initials(cust)}
                      </span>
                      <span className="truncate text-[13px] font-semibold text-text-primary">
                        {displayName(cust)}
                      </span>
                    </span>
                    <span className="font-mono text-[13px] text-text-secondary">
                      {cust.phone || '—'}
                    </span>
                    <span className="truncate text-[13px] text-text-secondary">
                      {cust.email || '—'}
                    </span>
                    <span className="text-[13px] text-text-secondary">
                      {cust.shipping_city || '—'}
                    </span>
                  </button>
                ))}
              </CardBody>
            </Card>
          </div>
        )}
      </div>

      {/* Mobile sticky new-customer action */}
      <div className="fixed inset-x-0 bottom-14 z-10 bg-surface-muted p-3 pb-2 lg:hidden">
        <Link
          to="/customers/new"
          className="mx-auto flex h-12 max-w-lg items-center justify-center rounded-md bg-brand-600 text-sm font-semibold text-white shadow-sm hover:bg-brand-700"
        >
          + New Customer
        </Link>
      </div>
    </div>
  );
}
