// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Orders page (`/orders`) — confirmed orders only, awaiting payment
 * through installed (spec 2026-10-20 rev. 2026-10-22). Estimates live on
 * the Estimates page at `/`; an order is born by confirming one, so this
 * page has no create action. Segmented tabs (All = every confirmed stage
 * via `status=confirmed` / Awaiting Payment / In Progress / Ready /
 * Installed) and debounced search feed either stacked cards (<lg) or the
 * table (lg+). Rows/cards open the order at its canonical
 * `/<customer-slug>/<order-number>` URL. Every row carries two icon
 * actions overlaying its right edge — Duplicate and Delete
 * (`OrderRowActions`, shared with the Estimates page) — so neither
 * requires opening the order first.
 *
 * Every tab shows at most `PAGE_SIZE` orders at a time, with the pager
 * anchored bottom-right under the list. Paging is client-side over the
 * already-fetched tab result (`GET /api/orders` returns the tab's rows
 * in one capped response), so switching pages costs no request and the
 * summary tiles keep counting the WHOLE tab rather than the page.
 * Changing tab or search resets to page 1, and the rendered page is
 * clamped to the current page count so a shrinking result set (a
 * refetch, a status change) can never leave the list blank on a page
 * that no longer exists.
 *
 * The desktop summary tiles render ONLY on the unfiltered default view
 * (All tab, empty search). `useOrderList` filters server-side, so on any
 * other tab `orders` holds just that status and a count drawn from it
 * would describe the filter rather than the business — a number that
 * looks authoritative and is wrong. Restricting them to the one view
 * where `orders` IS every confirmed order keeps them honest.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import StatusBadge from '../../components/StatusBadge';
import SidebarToggle from '../../components/SidebarToggle';
import { PAGE_CONTAINER } from '../../components/PageHeader';
import { ListSkeleton } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import { Card, CardBody, StatTile } from '../../components/ui';
import { useOrderList, type OrderTab } from '../../hooks/useOrders';
import { orderPath } from '../../lib/orderPath';
import OrderRowActions from './OrderRowActions';
import { displayName } from '../../lib/customerName';
import type { Order, OrderStatus } from '../../types';
import type { CardAccent } from '../../components/ui';

/** Tab definitions in display order — confirmed stages only (Orders page). */
const TABS: { key: OrderTab; label: string }[] = [
  { key: 'confirmed', label: 'All' },
  { key: 'awaiting_payment', label: 'Awaiting Payment' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'ready', label: 'Ready' },
  { key: 'installed', label: 'Installed' },
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
    status: 'installed',
    label: 'Installed',
    accent: 'neutral',
    d: 'M3 21h18 M5 21V7l7-4 7 4v14 M9 21v-6h6v6',
  },
];

/**
 * Orders rendered per page, on every tab. Fifteen fills a desktop
 * viewport without scrolling the pager out of reach and keeps a phone's
 * card stack to a few flicks.
 */
const PAGE_SIZE = 15;

/** "Jul 1" style short date from an ISO date string. */
function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return format(new Date(y, m - 1, d), 'MMM d');
}

/**
 * Row label for an order's customer. Falls back through email and phone
 * for customers with no name (see `lib/customerName`); an order with no
 * customer at all still shows an em dash.
 */
function customerName(order: Order): string {
  return order.customer ? displayName(order.customer) : '—';
}

export default function OrderList() {
  const [tab, setTab] = useState<OrderTab>('confirmed');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const { data: orders, isLoading, error } = useOrderList(tab, term);
  const navigate = useNavigate();

  // Derived, never stored: the query can return fewer orders than the
  // page the user is standing on (a refetch, a status change that moves
  // a row off this tab), and a stale `page` would then render nothing.
  const totalPages = Math.max(1, Math.ceil((orders?.length ?? 0) / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageOrders = orders
    ? orders.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
    : [];

  /** Switch tab and return to the first page of the new result. */
  function selectTab(next: OrderTab) {
    setTab(next);
    setPage(1);
  }

  return (
    <div className="min-h-screen bg-surface-muted pb-8">
      <div className={`${PAGE_CONTAINER} py-4 md:py-6 lg:py-8`}>
        {/*
          Header row. A top-level section, so there is no back chevron —
          but below `md` the hamburger is the ONLY route to the other
          sections, so it must be here.
        */}
        <div className="mb-5 flex items-center gap-2">
          <SidebarToggle />
          <h1 className="min-w-0 flex-1 truncate text-[22px] font-bold text-text-primary">
            Orders
          </h1>
        </div>

        {/* Status summary — unfiltered view only; see the module header.
            Two-up from `sm` (where four tiles would each be ~140px and
            unreadable), four-up from `lg`. It used to be `lg:grid` only,
            so a tablet saw nothing at all. */}
        {orders && tab === 'confirmed' && !term.trim() && (
          <div className="mb-4 hidden grid-cols-2 gap-3 sm:grid lg:grid-cols-4">
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
              onClick={() => selectTab(t.key)}
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
            onChange={(e) => {
              setTerm(e.target.value);
              setPage(1);
            }}
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
                : tab === 'confirmed'
                  ? 'No orders yet'
                  : `No ${tab.replace('_', ' ')} orders`
            }
            hint={term ? 'Try an order number or customer name.' : 'Orders appear here once a customer confirms an estimate.'}
          />
        )}

        {/* Mobile cards */}
        {orders && orders.length > 0 && (
          <ul className="flex flex-col gap-2.5 lg:hidden">
            {pageOrders.map((order) => (
              // `relative` so the row actions can sit as a SIBLING
              // overlaying the card. The card itself is one big button,
              // and a button cannot legally contain another.
              <li key={order.id} className="relative">
                <button
                  onClick={() => navigate(orderPath(order))}
                  className="w-full rounded-xl border border-border-light bg-surface p-3.5 pr-24 text-left shadow-sm transition-shadow hover:shadow-md"
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
                <OrderRowActions
                  order={order}
                  wrapperClass="right-1.5 top-2.5"
                  buttonClass="h-11 w-11"
                />
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
                {pageOrders.map((order, i) => (
                  // Same sibling-overlay arrangement as the mobile card:
                  // the row is one button, so the actions cannot be
                  // nested inside it.
                  <div key={order.id} className="relative">
                  <button
                    onClick={() => navigate(orderPath(order))}
                    className={`grid w-full grid-cols-[1.2fr_1.6fr_1fr_1.1fr_0.6fr] items-center bg-surface px-4 py-3 pr-24 text-left transition-colors hover:bg-surface-sunken ${
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
                    <OrderRowActions
                      order={order}
                      wrapperClass="right-2 top-1/2 -translate-y-1/2"
                      buttonClass="h-9 w-9"
                    />
                  </div>
                ))}
              </CardBody>
            </Card>
          </div>
        )}

        {/* Pager — bottom right of the list, both layouts. Hidden on a
            single page: a "Page 1 of 1" control is noise that also
            invites a click that can do nothing. The range label counts
            the whole tab, so it says how much the tab holds, not how
            much this page shows. */}
        {orders && totalPages > 1 && (
          <nav
            aria-label="Orders pagination"
            className="mt-4 flex items-center justify-end gap-2"
          >
            <span className="mr-1 text-[13px] text-text-secondary">
              {(currentPage - 1) * PAGE_SIZE + 1}–
              {Math.min(currentPage * PAGE_SIZE, orders.length)} of {orders.length}
            </span>
            <button
              type="button"
              onClick={() => setPage(Math.max(1, currentPage - 1))}
              disabled={currentPage <= 1}
              aria-label="Previous page"
              className="h-9 rounded-md border border-border-input bg-surface px-3 text-[13px] font-medium text-text-secondary hover:bg-surface-muted disabled:opacity-40"
            >
              ‹ Previous
            </button>
            <span className="text-[13px] text-text-secondary" aria-current="page">
              Page {currentPage} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage >= totalPages}
              aria-label="Next page"
              className="h-9 rounded-md border border-border-input bg-surface px-3 text-[13px] font-medium text-text-secondary hover:bg-surface-muted disabled:opacity-40"
            >
              Next ›
            </button>
          </nav>
        )}
      </div>

    </div>
  );
}
