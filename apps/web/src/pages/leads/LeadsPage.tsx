// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * LeadsPage: the sidebar's Leads destination (`/leads`). It lists the
 * requests that came in through the website's "Free Estimate" form
 * (`apps/web/public/embed/lead-form.js` → `POST /intake/lead`), newest
 * first, 20 per page.
 *
 * Every lead is already linked to a customer when it arrives (created, or
 * matched by email), so this page is a work queue, not a conversion step.
 * Staff propose an in-home estimate visit (one dialog: day, time, send; the
 * lead is then handled), or call and tick it Handled, or delete spam and
 * duplicates, all from the icons at the right of each card. New / Handled
 * match the Inbox.
 *
 * The filter (`?status=`, default New) and the page (`?page=`) live in the
 * URL, as on the Notifications page, so opening a customer and pressing
 * Back returns to the same view. The New chip carries the backlog count
 * from the same response. The list polls every minute, so a lead that
 * arrives while the page is open shows up on its own.
 */

import { useSearchParams } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import { ListSkeleton } from '../../components/Skeleton';
import { useLeads, type LeadFilter } from '../../hooks/useLeads';
import LeadCard from './LeadCard';
import { LEAD_FILTERS, LEAD_STATUS_LABELS, filterFromParam } from './leadText';

/** Reads `?page=` as a positive integer, defaulting to 1. */
function pageFromParams(params: URLSearchParams): number {
  const n = Number(params.get('page'));
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** What the list says when a filter has nothing in it. */
const EMPTY_TEXT: Record<LeadFilter, string> = {
  new: 'No new leads. Requests from the website form show up here.',
  handled: 'No handled leads.',
  all: 'No leads yet. Requests from the website form show up here.',
};

export default function LeadsPage() {
  const [params, setParams] = useSearchParams();
  const status = filterFromParam(params.get('status'));
  const page = pageFromParams(params);
  const { data, isLoading, error, isPlaceholderData } = useLeads(status, page);

  const leads = data?.data ?? [];
  const totalPages = data?.total_pages ?? 1;
  const newCount = data?.new_count ?? 0;

  /** Changes filter or page; the defaults (New, page 1) keep a clean URL. */
  function go(next: { status?: LeadFilter; page?: number }) {
    const s = next.status ?? status;
    const p = next.page ?? page;
    const q: Record<string, string> = {};
    if (s !== 'new') q.status = s;
    if (p > 1) q.page = String(p);
    setParams(q);
    window.scrollTo({ top: 0 });
  }

  const segment = (active: boolean) =>
    `min-h-9 flex-1 whitespace-nowrap rounded-md px-3 text-[13px] font-semibold ${
      active ? 'bg-surface text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'
    }`;
  const pagerButton =
    'h-9 rounded-md border border-border-input bg-surface px-3 text-[13px] font-medium text-text-secondary hover:bg-surface-muted disabled:opacity-40';

  return (
    <div className="min-h-screen bg-surface-muted pb-16">
      <PageHeader title="Leads" backTo="/" />

      <div className="page-container flex flex-col gap-4 py-4 md:py-6 lg:py-8 [--page-max:56rem]">
        <div aria-label="Status" className="flex gap-1 overflow-x-auto rounded-lg bg-surface-sunken p-1">
          {LEAD_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={f === status}
              className={segment(f === status)}
              onClick={() => go({ status: f, page: 1 })}
            >
              {f === 'all' ? 'All' : LEAD_STATUS_LABELS[f]}
              {f === 'new' && newCount > 0 && <span className="ml-1 tabular-nums text-warning">{newCount}</span>}
            </button>
          ))}
        </div>

        {isLoading && <ListSkeleton />}
        {/* A failed background refresh keeps showing the last good page. */}
        {error && !data && <p className="text-danger">{error.message}</p>}

        {data && (
          <>
            {leads.length === 0 ? (
              <p className="rounded-xl border border-border-light bg-surface p-6 text-center text-[13px] text-text-muted shadow-sm">
                {page > 1 ? 'No leads on this page.' : EMPTY_TEXT[status]}
              </p>
            ) : (
              <div className={`flex flex-col gap-2 transition-opacity ${isPlaceholderData ? 'opacity-60' : ''}`}>
                {leads.map((lead) => (
                  <LeadCard key={lead.id} lead={lead} defaultOpen={leads.length === 1} />
                ))}
              </div>
            )}

            {(totalPages > 1 || page > 1) && (
              <div className="mt-2 flex items-center justify-between gap-2">
                <button type="button" onClick={() => go({ page: page - 1 })} disabled={page <= 1} className={pagerButton}>
                  ‹ Previous
                </button>
                <span className="text-[13px] text-text-secondary">
                  Page {page} of {totalPages}
                </span>
                <button type="button" onClick={() => go({ page: page + 1 })} disabled={page >= totalPages} className={pagerButton}>
                  Next ›
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
