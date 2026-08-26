// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Order list — the app's home screen, mounted at "/" with the "All"
 * tab selected. Segmented status tabs (All / Active / Awaiting Payment
 * / In Progress / Ready / Installed / Expired) and debounced search
 * feed either stacked cards (<lg) or the table (lg+). Rows/cards open
 * the editor; the primary "+ New Order" action is a sticky bar on
 * mobile and lives in the header on desktop. Every row carries two icon
 * actions overlaying its right edge — Duplicate and Delete — so neither
 * requires opening the order first; Delete confirms by order number and
 * calls the same guarded endpoint the order page does.
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
 * (`all` tab, empty search). `useOrderList` filters server-side, so on
 * any other tab `orders` holds just that status and a count drawn from
 * it would describe the filter rather than the business — a number that
 * looks authoritative and is wrong. Restricting them to the one view
 * where `orders` IS every order keeps them honest.
 */

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import StatusBadge from '../../components/StatusBadge';
import SidebarToggle from '../../components/SidebarToggle';
import { PAGE_CONTAINER } from '../../components/PageHeader';
import { ListSkeleton } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import { Card, CardBody, StatTile } from '../../components/ui';
import {
  useOrderList,
  useDuplicateOrder,
  useDeleteOrder,
  type OrderTab,
} from '../../hooks/useOrders';
import { displayName } from '../../lib/customerName';
import type { Order, OrderStatus } from '../../types';
import type { CardAccent } from '../../components/ui';

/** Geometry-free shape shared by the two per-row icon actions. */
const ROW_ACTION_CLASS =
  'flex items-center justify-center rounded-sm transition-colors disabled:opacity-40';

/**
 * The per-row "duplicate this order" action.
 *
 * Its own component because each row needs its OWN pending state — one
 * mutation lifted to the list would spin every row's icon at once — and
 * because rows are whole-row `<button>`s, so this has to be rendered as
 * an absolutely-positioned SIBLING rather than a child.
 *
 * The copy opens immediately: duplicating is nearly always the first
 * step of editing the copy.
 */
function DuplicateButton({ order, className }: { order: Order; className: string }) {
  const navigate = useNavigate();
  const duplicateMut = useDuplicateOrder();
  return (
    <button
      type="button"
      disabled={duplicateMut.isPending}
      onClick={async () => {
        try {
          const copy = await duplicateMut.mutateAsync(order.id);
          toast.success(`Duplicated to ${copy.order_number}.`);
          navigate(`/orders/${copy.id}`);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : 'Duplicate failed.');
        }
      }}
      title={`Duplicate ${order.order_number} into a new draft`}
      aria-label={`Duplicate ${order.order_number}`}
      className={`${ROW_ACTION_CLASS} text-text-muted hover:bg-surface-sunken hover:text-brand-600 ${className}`}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

/**
 * The per-row "delete this order" action.
 *
 * Deletion cascades to the order's line items and payments and cannot
 * be undone, so it is confirmed BY ORDER NUMBER — this icon sits right
 * beside Duplicate, whose worst case is a stray draft, and the row it
 * overlays is one click from opening the order. The wording matches the
 * Delete action on the order page, and both go through the same
 * `DELETE /api/orders/:id`: this is not a looser list-only path.
 *
 * Own mutation and own pending state, for the same reason Duplicate has
 * them — one mutation lifted to the list would disable every row's icon
 * while a single order is deleted. Nothing navigates on success: the
 * hook invalidates the list and the row simply leaves it.
 */
function DeleteButton({ order, className }: { order: Order; className: string }) {
  const deleteMut = useDeleteOrder();
  return (
    <button
      type="button"
      disabled={deleteMut.isPending}
      onClick={async () => {
        const ok = window.confirm(
          `Delete ${order.order_number} permanently? Its line items and payments are removed.`,
        );
        if (!ok) return;
        try {
          await deleteMut.mutateAsync(order.id);
          toast.success(`${order.order_number} deleted.`);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : 'Delete failed.');
        }
      }}
      title={`Delete ${order.order_number} permanently`}
      aria-label={`Delete ${order.order_number}`}
      className={`${ROW_ACTION_CLASS} text-text-muted hover:bg-surface-sunken hover:text-danger ${className}`}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M3 6h18" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        <path d="M10 11v6M14 11v6" />
      </svg>
    </button>
  );
}

/**
 * Duplicate + Delete as ONE absolutely-positioned sibling overlaying
 * the row. Both breakpoints render this same strip and differ only in
 * geometry, so the two actions cannot drift apart on one layout while
 * staying aligned on the other. Whatever renders it must reserve room
 * for it in its own right padding (`pr-24` on both the card and the
 * table row) — the strip overlays content, it does not push it.
 */
function RowActions({
  order,
  wrapperClass,
  buttonClass,
}: {
  order: Order;
  wrapperClass: string;
  buttonClass: string;
}) {
  return (
    <div className={`absolute flex items-center gap-0.5 ${wrapperClass}`}>
      <DuplicateButton order={order} className={buttonClass} />
      <DeleteButton order={order} className={buttonClass} />
    </div>
  );
}

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
  const [tab, setTab] = useState<OrderTab>('all');
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
    <div className="min-h-screen bg-surface-muted pb-24 sm:pb-8">
      <div className={`${PAGE_CONTAINER} py-4 md:py-6 lg:py-8`}>
        {/*
          Header row. This is the home screen, so there is no back
          chevron — but below `md` the hamburger is the ONLY route to
          the other sections now that the bottom tab bar is gone, so it
          must be here. One row at every width (the old split of a
          mobile-only <h1> plus a separate `lg:flex` desktop row meant
          the "New Order" button simply did not exist on a tablet).
        */}
        <div className="mb-5 flex items-center gap-2">
          <SidebarToggle />
          <h1 className="min-w-0 flex-1 truncate text-[22px] font-bold text-text-primary">
            Orders
          </h1>
          {/* Hidden below `sm`, where the sticky bottom bar carries the
              same action at full width. */}
          <Link
            to="/orders/new"
            className="hidden h-11 shrink-0 items-center gap-2 rounded-md bg-brand-600 px-4 text-[13px] font-semibold text-white shadow-sm hover:bg-brand-700 sm:flex"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 5v14M5 12h14" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
            </svg>
            New Order
          </Link>
        </div>

        {/* Status summary — unfiltered view only; see the module header.
            Two-up from `sm` (where four tiles would each be ~140px and
            unreadable), four-up from `lg`. It used to be `lg:grid` only,
            so a tablet saw nothing at all. */}
        {orders && tab === 'all' && !term.trim() && (
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
            {pageOrders.map((order) => (
              // `relative` so the row actions can sit as a SIBLING
              // overlaying the card. The card itself is one big button,
              // and a button cannot legally contain another.
              <li key={order.id} className="relative">
                <button
                  onClick={() => navigate(`/orders/${order.id}`)}
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
                <RowActions
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
                    onClick={() => navigate(`/orders/${order.id}`)}
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
                    <RowActions
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

      {/* Sticky new-order action, phones only — from `sm` up the same
          action sits in the header row. `bottom-0` (it used to be
          `bottom-14`, clearing the bottom tab bar that no longer
          exists) with the safe-area inset so it clears the iOS home
          indicator. `app-shell-main` is a no-op at this width but keeps
          it honest if the breakpoint ever moves above `md`. */}
      <div className="app-shell-main fixed inset-x-0 bottom-0 z-10 bg-surface-muted p-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:hidden">
        <Link
          to="/orders/new"
          className={`${PAGE_CONTAINER} flex h-12 items-center justify-center rounded-md bg-brand-600 text-sm font-semibold text-white shadow-sm hover:bg-brand-700`}
        >
          + New Order
        </Link>
      </div>
    </div>
  );
}
