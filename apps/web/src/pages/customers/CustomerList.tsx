// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Customer list page — search-as-you-type across name, email, phone,
 * and address, with tap-friendly customer cards and a prominent
 * "New Customer" action. Cards navigate to the edit form.
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
    <div className="min-h-screen bg-surface-muted pb-36">
      <PageHeader title="Customers" backTo="/" />
      <div className="mx-auto max-w-lg p-4">
        <input
          type="search"
          placeholder="Search name, phone, email, address…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          className="mb-4 h-12 w-full rounded-xl border border-border bg-surface-elevated px-4 text-base text-text-primary"
        />

        {isLoading && <ListSkeleton />}
        {error && <p className="text-danger">{error.message}</p>}

        {customers && customers.length === 0 && (
          <EmptyState
            title={term ? 'No customers match your search' : 'No customers yet'}
            hint={term ? 'Try a different name, phone, or address.' : 'Add your first customer below.'}
          />
        )}

        <ul className="flex flex-col gap-2">
          {customers?.map((cust) => (
            <li key={cust.id}>
              <button
                onClick={() => navigate(`/customers/${cust.id}`)}
                className="w-full rounded-xl border border-border bg-surface-elevated p-4 text-left hover:bg-surface"
              >
                <span className="block font-medium text-text-primary">
                  {cust.first_name} {cust.last_name}
                </span>
                <span className="block text-sm text-text-secondary">
                  {[cust.phone, cust.email].filter(Boolean).join(' · ') || 'No contact info'}
                </span>
                {cust.shipping_city && (
                  <span className="block text-sm text-text-muted">{cust.shipping_city}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Sticky new-customer action — sits above the bottom nav */}
      <div className="fixed inset-x-0 bottom-14 z-10 bg-surface-muted p-3 pb-2">
        <Link
          to="/customers/new"
          className="mx-auto flex h-12 max-w-lg items-center justify-center rounded-xl bg-brand-600 font-semibold text-white hover:bg-brand-700"
        >
          + New Customer
        </Link>
      </div>
    </div>
  );
}
