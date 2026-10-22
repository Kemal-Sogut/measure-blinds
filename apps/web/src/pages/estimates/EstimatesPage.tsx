// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Estimates page — the app's home screen at `/` (spec 2026-10-20 rev.
 * 2026-10-22). Every estimate grouped under its customer
 * (`GET /api/orders/grouped`), customers ordered by the creation date of
 * their newest estimate so a new estimate always puts its customer on
 * top. Each customer is a collapsible `EstimateGroup`, collapsed by
 * default; while a search term is present every returned group is shown
 * open, because the search is what the consultant is looking for.
 *
 * Tabs: All · Active (draft + sent) · Confirmed · Expired — a tab filters
 * the estimates inside groups, and customers with nothing in the tab
 * drop out. 15 groups per page, client-side over the fetched result,
 * pager bottom-right (the Orders page's pattern). Changing tab or search
 * returns to page 1; the page index is clamped so a shrinking result can
 * never strand the view on an empty page.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import SidebarToggle from '../../components/SidebarToggle';
import { PAGE_CONTAINER } from '../../components/PageHeader';
import { ListSkeleton } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import EstimateGroup from './EstimateGroup';
import { useOrderGroups, type EstimateTab } from '../../hooks/useOrders';

/** Tab definitions in display order. */
const TABS: { key: EstimateTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'expired', label: 'Expired' },
];

/** Customer groups per page. */
const PAGE_SIZE = 15;

/** Shared look for the two pager buttons. */
const PAGER_BUTTON =
  'h-11 rounded-md border border-border-input bg-surface px-3 text-[13px] font-medium text-text-secondary hover:bg-surface-muted disabled:opacity-40';

export default function EstimatesPage() {
  const [tab, setTab] = useState<EstimateTab>('all');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  const { data: groups, isLoading, error } = useOrderGroups(tab, term);
  const searching = term.trim() !== '';

  // Derived, never stored — see the module header.
  const totalPages = Math.max(1, Math.ceil((groups?.length ?? 0) / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageGroups = groups
    ? groups.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
    : [];

  /** Opens or closes one customer's group. */
  function toggle(id: string) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="min-h-screen bg-surface-muted pb-8">
      <div className={`${PAGE_CONTAINER} py-4 md:py-6 lg:py-8`}>
        {/* Header row. Home screen: no back chevron, and below `md` the
            hamburger is the only route to the other sections. */}
        <div className="mb-5 flex items-center gap-2">
          <SidebarToggle />
          <h1 className="min-w-0 flex-1 truncate text-[22px] font-bold text-text-primary">
            Estimates
          </h1>
          <Link
            to="/orders/new"
            className="flex h-11 shrink-0 items-center gap-2 rounded-md bg-brand-600 px-4 text-[13px] font-semibold text-white shadow-sm hover:bg-brand-700"
          >
            + New Estimate
          </Link>
        </div>

        {/* Segmented tabs */}
        <div className="mb-3.5 flex max-w-xl overflow-x-auto rounded-md bg-surface-sunken p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setTab(t.key);
                setPage(1);
              }}
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

        <input
          type="search"
          aria-label="Search estimates"
          placeholder="Search order # or customer…"
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setPage(1);
          }}
          className="mb-3.5 h-11 w-full max-w-md rounded-md border border-border-input bg-surface px-3 text-[15px] text-text-primary placeholder:text-text-muted"
        />

        {isLoading && <ListSkeleton />}
        {error && <p className="text-danger">{error.message}</p>}
        {groups && groups.length === 0 && (
          <EmptyState
            title={searching ? 'No estimates match your search' : 'No estimates here yet'}
            hint={
              searching
                ? 'Try an order number or customer name.'
                : 'Create one with + New Estimate.'
            }
          />
        )}

        {pageGroups.length > 0 && (
          <ul className="flex flex-col gap-2.5">
            {pageGroups.map((g) => (
              <EstimateGroup
                key={g.customer.id}
                group={g}
                open={searching || openIds.has(g.customer.id)}
                onToggle={() => toggle(g.customer.id)}
              />
            ))}
          </ul>
        )}

        {/* Pager — hidden on a single page, where it could do nothing. */}
        {groups && totalPages > 1 && (
          <nav
            aria-label="Estimates pagination"
            className="mt-4 flex items-center justify-end gap-2"
          >
            <span className="mr-1 text-[13px] text-text-secondary">
              {(currentPage - 1) * PAGE_SIZE + 1}–
              {Math.min(currentPage * PAGE_SIZE, groups.length)} of {groups.length} customers
            </span>
            <button
              type="button"
              onClick={() => setPage(Math.max(1, currentPage - 1))}
              disabled={currentPage <= 1}
              aria-label="Previous page"
              className={PAGER_BUTTON}
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
              className={PAGER_BUTTON}
            >
              Next ›
            </button>
          </nav>
        )}
      </div>
    </div>
  );
}
