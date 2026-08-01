// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Order list — the app's home screen, mounted at "/" with the "All"
 * tab selected. Segmented status tabs (All / Active / Awaiting Payment
 * / In Progress / Ready / Installed / Expired) and debounced search
 * feed either stacked cards (<lg) or the table (lg+). Rows/cards open
 * the editor; the primary "+ New Order" action is a sticky bar on
 * mobile and lives in the header on desktop.
 *
 * The desktop summary tiles render ONLY on the unfiltered default view
 * (`all` tab, empty search). `useOrderList` filters server-side, so on
 * any other tab `orders` holds just that status and a count drawn from
 * it would describe the filter rather than the business — a number that
 * looks authoritative and is wrong. Restricting them to the one view
 * where `orders` IS every order keeps them honest.
 */

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import StatusBadge from '../../components/StatusBadge';
import { ListSkeleton } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import { Card, CardBody, StatTile } from '../../components/ui';
import { useOrderList, type OrderTab } from '../../hooks/useOrders';
import type { Order, OrderStatus } from '../../types';
import type { CardAccent } from '../../components/ui';

/** Tab definitions in display order. */
const TABS: { key: OrderTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'awaiting_payment', label: 'Awaiting Payment' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'ready', label: 'Ready' },
  { key: 'installed', label: 'Installed' },
  { key: 'expired', label: 'Expired' },
];

/**
 * The four states worth summarizing above the list, in the order work
 * moves through them. Accents match the semantic palette exactly, so a
 * tile and the status pill on a row below it are never two different
 * colours for the same state.
 */
const SUMMARY: { status: OrderStatus; label: string; accent: CardAccent; d: string }[] = [
  {
    status: 'awaiting_payment',
    label: 'Awaiting payment',
    accent: 'warning',
    d: 'M12 6v6l4 2 M12 22a10 10 0 100-20 10 10 0 000 20z',
  },
  {
    status: 'in_progress',
    label: 'In progress',
    accent: 'scheduled',
    d: 'M3 12a9 9 0 019-9 9 9 0 016.4 2.6L21 8 M21 3v5h-5 M21 12a9 9 0 01-9 9 9 9 0 01-6.4-2.6L3 16 M3 21v-5h5',
  },
  {
    status: 'ready',
    label: 'Ready',
    accent: 'success',
    d: 'M20 6L9 17l-5-5',
  },
  {
    status: 'draft',
    label: 'Drafts',
    accent: 'neutral',
    d: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z M14 2v6h6',
  },
];

/** "Jul 1" style short date from an ISO date string. */
function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return format(new Date(y, m - 1, d), 'MMM d');
}

function customerName(order: Order): string {
  return order.customer ? `${order.customer.first_name} ${order.customer.last_name}` : '—';
}

export default function OrderList() {
  const [tab, setTab] = useState<OrderTab>('all');
  const [term, setTerm] = useState('');
  const { data: orders, isLoading, error } = useOrderList(tab, term);
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-surface-muted pb-24 lg:pb-8">
      <div className="mx-auto max-w-lg p-4 lg:max-w-5xl lg:p-8">
        {/* Mobile title — no back chevron; this is the home screen */}
        <h1 className="mb-4 text-[22px] font-bold text-text-primary lg:hidden">Orders</h1>

        {/* Desktop header row */}
        <div className="mb-5 hidden items-center justify-between lg:flex">
          <h1 className="text-[22px] font-bold text-text-primary">Orders</h1>
          <Link
            to="/orders/new"
            className="flex h-11 items-center gap-2 rounded-md bg-brand-600 px-4 text-[13px] font-semibold text-white shadow-sm hover:bg-brand-700"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 5v14M5 12h14" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
            </svg>
            New Order
          </Link>
        </div>

        {/* Desktop summary — unfiltered view only; see the module header */}
        {orders && tab === 'all' && !term.trim() && (
          <div className="mb-4 hidden grid-cols-4 gap-3 lg:grid">
            {SUMMARY.map((s) => (
              <StatTile
                key={s.status}
                label={s.label}
                accent={s.accent}
                value={String(orders.filter((o) => o.status === s.status).length)}
                icon={
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    {s.d.split(' M').map((seg, i) => (
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
                }
              />
            ))}
          </div>
        )}

        {/* Segmented tabs */}
        <div className="mb-3.5 flex max-w-2xl overflow-x-auto rounded-md bg-surface-sunken p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`min-h-10 flex-1 whitespace-nowrap rounded-md px-3 py-2 text-[13px] transition-colors ${
                tab === t.key
                  ? 'bg-surface font-bold text-text-primary shadow-sm'
                  : 'font-medium text-text-muted hover:text-text-secondary'
              }`}
            >
              {t.label}
            </button>
          ))}
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
            placeholder="Search order # or customer…"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            className="h-11 w-full rounded-md border border-border-input bg-surface pl-9 pr-3 text-[15px] text-text-primary placeholder:text-text-muted"
          />
        </div>

        {isLoading && <ListSkeleton />}
        {error && <p className="text-danger">{error.message}</p>}
        {orders && orders.length === 0 && (
          <EmptyState
            title={
              term
                ? 'No orders match your search'
                : tab === 'all'
                  ? 'No orders yet'
                  : `No ${tab.replace('_', ' ')} orders`
            }
            hint={term ? 'Try an order number or customer name.' : 'Create one below.'}
          />
        )}

        {/* Mobile cards */}
        {orders && orders.length > 0 && (
          <ul className="flex flex-col gap-2.5 lg:hidden">
            {orders.map((order) => (
              <li key={order.id}>
                <button
                  onClick={() => navigate(`/orders/${order.id}`)}
                  className="w-full rounded-xl border border-border-light bg-surface p-3.5 text-left shadow-sm transition-shadow hover:shadow-md"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-[15px] font-bold text-text-primary">
                      {customerName(order)}
                    </span>
                    <StatusBadge status={order.status} />
                  </span>
                  <span className="mt-0.5 block font-mono text-[13px] text-text-muted">
                    {order.order_number}
                  </span>
                  <span className="mt-2 flex items-center justify-between">
                    <span className="text-xs text-text-muted">{shortDate(order.order_date)}</span>
                    <span className="font-mono text-[15px] font-semibold text-text-primary">
                      ${Number(order.total).toFixed(2)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Desktop table */}
        {orders && orders.length > 0 && (
          <div className="hidden lg:block">
            <Card className="overflow-hidden">
              <CardBody flush>
                <div className="grid grid-cols-[1.2fr_1.6fr_1fr_1.1fr_0.6fr] border-b border-border-light bg-surface-sunken px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-text-muted">
                  <span>Order #</span>
                  <span>Customer</span>
                  <span>Date</span>
                  <span>Status</span>
                  <span className="text-right">Total</span>
                </div>
                {orders.map((order, i) => (
                  <button
                    key={order.id}
                    onClick={() => navigate(`/orders/${order.id}`)}
                    className={`grid w-full grid-cols-[1.2fr_1.6fr_1fr_1.1fr_0.6fr] items-center bg-surface px-4 py-3 text-left transition-colors hover:bg-surface-sunken ${
                      i > 0 ? 'border-t border-border-light' : ''
                    }`}
                  >
                    <span className="font-mono text-[13px] text-text-primary">
                      {order.order_number}
                    </span>
                    <span className="text-[13px] font-semibold text-text-primary">
                      {customerName(order)}
                    </span>
                    <span className="text-[13px] text-text-secondary">
                      {shortDate(order.order_date)}
                    </span>
                    <span>
                      <StatusBadge status={order.status} />
                    </span>
                    <span className="text-right font-mono text-[13px] font-semibold text-text-primary">
                      ${Number(order.total).toFixed(2)}
                    </span>
                  </button>
                ))}
              </CardBody>
            </Card>
          </div>
        )}
      </div>

      {/* Mobile sticky new-order action */}
      <div className="fixed inset-x-0 bottom-14 z-10 bg-surface-muted p-3 pb-2 lg:hidden">
        <Link
          to="/orders/new"
          className="mx-auto flex h-12 max-w-lg items-center justify-center rounded-md bg-brand-600 text-sm font-semibold text-white shadow-sm hover:bg-brand-700"
        >
          + New Order
        </Link>
      </div>
    </div>
  );
}
