// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Dashboard (redesign screen 02): date line + time-of-day greeting,
 * two live stat cards (active = draft+sent, awaiting payment), the
 * three most recent orders with status chips, and the primary "New
 * Order" action. Stats and the recent list come from the same orders
 * queries the list page uses.
 *
 * Sign-out lives on the Settings page per the design; the mobile
 * gear lives in the bottom nav and the desktop sidebar.
 */

import { Link, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { useCompanySettings } from '../hooks';
import { useOrderList } from '../hooks/useOrders';
import StatusBadge from '../components/StatusBadge';
import { Skeleton } from '../components/Skeleton';

/** Time-of-day greeting: morning / afternoon / evening. */
function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function Main() {
  const { data: company } = useCompanySettings();
  const activeQ = useOrderList('active', '');
  const awaitingQ = useOrderList('awaiting_payment', '');
  const navigate = useNavigate();

  const activeCount = activeQ.data?.length;
  const awaitingCount = awaitingQ.data?.length;

  // Three most recent orders across both lists (created_at desc).
  const recent = [...(activeQ.data ?? []), ...(awaitingQ.data ?? [])]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 3);

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col px-5 pt-6 lg:max-w-3xl lg:px-8 lg:pt-8">
      <p className="mb-0.5 text-[13px] text-text-muted">{format(new Date(), 'EEEE, MMMM d')}</p>
      <h1 className="mb-5 text-[22px] font-semibold text-text-primary">
        {greeting()}
        {company?.company_name ? `, ${company.company_name}` : ''}
      </h1>

      {/* Stat cards */}
      <div className="mb-6 flex gap-2.5">
        <div className="flex-1 rounded-sm border border-border bg-surface p-3.5">
          {activeCount === undefined ? (
            <Skeleton className="mb-1 h-7 w-10" />
          ) : (
            <p className="mb-1 font-mono text-[22px] font-semibold leading-7 text-text-primary">
              {activeCount}
            </p>
          )}
          <p className="text-xs text-text-muted">Active (draft / sent)</p>
        </div>
        <div className="flex-1 rounded-sm border border-border bg-surface p-3.5">
          {awaitingCount === undefined ? (
            <Skeleton className="mb-1 h-7 w-10" />
          ) : (
            <p className="mb-1 font-mono text-[22px] font-semibold leading-7 text-warning">
              {awaitingCount}
            </p>
          )}
          <p className="text-xs text-text-muted">Awaiting payment</p>
        </div>
      </div>

      {/* Recent orders */}
      <div className="mb-2.5 flex items-center justify-between">
        <p className="text-[13px] font-semibold text-text-primary">Recent orders</p>
        <Link to="/orders" className="flex min-h-11 items-center text-[13px] font-medium text-brand-600">
          View all
        </Link>
      </div>
      <div className="flex flex-col gap-2">
        {activeQ.isLoading && <Skeleton className="h-24 w-full" />}
        {recent.length === 0 && !activeQ.isLoading && (
          <p className="rounded-sm border border-border bg-surface p-4 text-sm text-text-muted">
            No orders yet — create the first one below.
          </p>
        )}
        {recent.map((order) => (
          <button
            key={order.id}
            onClick={() => navigate(`/orders/${order.id}`)}
            className="rounded-sm border border-border bg-surface px-3.5 py-3 text-left hover:bg-surface-muted"
          >
            <span className="mb-0.5 flex items-center justify-between">
              <span className="font-mono text-[13px] font-semibold text-text-primary">
                {order.order_number}
              </span>
              <StatusBadge status={order.status} />
            </span>
            <span className="block text-[13px] text-text-secondary">
              {order.customer ? `${order.customer.first_name} ${order.customer.last_name}` : '—'}
            </span>
            <span className="mt-0.5 block font-mono text-[13px] font-semibold text-text-primary">
              ${Number(order.total).toFixed(2)}
            </span>
          </button>
        ))}
      </div>

      {/* Primary action */}
      <div className="mt-6 pb-6">
        <Link
          to="/orders/new"
          className="flex h-12 w-full items-center justify-center gap-2 rounded-sm bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700 lg:max-w-xs"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 5v14M5 12h14" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
          </svg>
          New Order
        </Link>
      </div>
    </div>
  );
}
