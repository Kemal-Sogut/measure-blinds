// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * NotificationsPage — the sidebar's Notifications destination
 * (`/notifications`, bell icon between Calendar and Settings).
 *
 * Lists what happened while nobody was watching — a customer requesting
 * an edit, a customer confirming their order, a new e-Transfer payment —
 * newest first, 15 per page, with a pager at the bottom. Order alerts are
 * buttons into that order's page; e-Transfer alerts are plain rows and do
 * not navigate (rule in `notificationHref`).
 *
 * The page number lives in `?page=` rather than component state, so
 * opening an order from page 3 and pressing Back returns to page 3. A
 * missing or unusable value reads as page 1.
 */

import { useNavigate, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import PageHeader from '../../components/PageHeader';
import { ListSkeleton } from '../../components/Skeleton';
import { useNotifications } from '../../hooks/useNotifications';
import type { AppNotification, NotificationKind } from '../../types';
import { NOTIFICATION_TITLES, notificationDetail, notificationHref } from './notificationText';

/** Accent dot per kind: amber asks for work, green is good news. */
const KIND_DOT: Record<NotificationKind, string> = {
  edit_request: 'bg-warning',
  order_confirmed: 'bg-success',
  etransfer_received: 'bg-brand-600',
};

/** Reads `?page=` as a positive integer, defaulting to 1. */
function pageFromParams(params: URLSearchParams): number {
  const n = Number(params.get('page'));
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** Row contents shared by the clickable and the static form. */
function RowBody({ n }: { n: AppNotification }) {
  return (
    <>
      <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-pill ${KIND_DOT[n.kind]}`} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        {/* Wraps rather than truncating: on a phone the date drops under
            the heading instead of cutting "New e-Transfer payment" short. */}
        <span className="flex flex-wrap items-baseline justify-between gap-x-2">
          <span className="text-sm font-semibold text-text-primary">
            {NOTIFICATION_TITLES[n.kind]}
          </span>
          <time dateTime={n.created_at} className="shrink-0 text-[12px] text-text-muted">
            {format(new Date(n.created_at), 'MMM d, yyyy · h:mm a')}
          </time>
        </span>
        <span className="text-[13px] text-text-secondary">{notificationDetail(n)}</span>
      </span>
    </>
  );
}

/**
 * One alert. Rendered as a button when it links somewhere, otherwise as
 * a plain card with no hover state, so an e-Transfer row never looks
 * tappable.
 */
function NotificationRow({ n, onOpen }: { n: AppNotification; onOpen: (to: string) => void }) {
  const href = notificationHref(n);
  const base = 'flex w-full items-start gap-3 rounded-xl border border-border-light bg-surface p-3 text-left shadow-sm';
  if (!href) {
    return <div className={base}><RowBody n={n} /></div>;
  }
  return (
    <button type="button" onClick={() => onOpen(href)} className={`${base} hover:bg-surface-muted`}>
      <RowBody n={n} />
    </button>
  );
}

export default function NotificationsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const page = pageFromParams(params);
  const { data, isLoading, error, isPlaceholderData } = useNotifications(page);

  const totalPages = data?.total_pages ?? 1;
  const alerts = data?.data ?? [];

  /** Moves to another page; page 1 keeps a clean URL. */
  function goTo(next: number) {
    setParams(next <= 1 ? {} : { page: String(next) });
    window.scrollTo({ top: 0 });
  }

  const pagerButton =
    'h-9 rounded-md border border-border-input bg-surface px-3 text-[13px] font-medium text-text-secondary hover:bg-surface-muted disabled:opacity-40';

  return (
    <div className="min-h-screen bg-surface-muted pb-16">
      <PageHeader title="Notifications" backTo="/" />

      <div className="page-container flex flex-col gap-4 py-4 md:py-6 lg:py-8 [--page-max:56rem]">
        {isLoading && <ListSkeleton />}
        {error && <p className="text-danger">{error.message}</p>}

        {!isLoading && !error && (
          <>
            {alerts.length === 0 ? (
              <p className="rounded-xl border border-border-light bg-surface p-6 text-center text-[13px] text-text-muted shadow-sm">
                {page > 1 ? 'No notifications on this page.' : 'No notifications yet.'}
              </p>
            ) : (
              <div
                className={`flex flex-col gap-2 transition-opacity ${isPlaceholderData ? 'opacity-60' : ''}`}
              >
                {alerts.map((n) => (
                  <NotificationRow key={n.id} n={n} onOpen={(to) => navigate(to)} />
                ))}
              </div>
            )}

            {(totalPages > 1 || page > 1) && (
              <div className="mt-2 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => goTo(page - 1)}
                  disabled={page <= 1}
                  className={pagerButton}
                >
                  ‹ Previous
                </button>
                <span className="text-[13px] text-text-secondary">
                  Page {page} of {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => goTo(page + 1)}
                  disabled={page >= totalPages}
                  className={pagerButton}
                >
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
