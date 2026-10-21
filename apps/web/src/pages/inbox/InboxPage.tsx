// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * The Inbox (`/inbox`, envelope icon in the sidebar): conversations from
 * the shop's Titan mailbox. The first tab, All (the default), lists every
 * conversation; the others show one category each (Inquiry, Supplier,
 * Payment, Other — sorted by the rules in Settings → Email Rules). New or
 * Handled, newest activity first, 15 per page.
 *
 * Tab, status and page live in the URL (`?category=&status=&page=`), so
 * opening a conversation and pressing Back returns to the same list (the
 * list's query string rides along in the router state).
 * Each row shows the other party, the subject, a preview of the latest
 * message ("You: …" when the shop wrote last), the time, the message
 * count, the linked customer and, on the All tab, the category. A blue
 * dot marks a conversation with an unopened incoming email, and a tab
 * gets the same dot while any of its conversations (New or Handled) is
 * unread — All while any conversation is.
 */

import { useNavigate, useSearchParams } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import { ListSkeleton } from '../../components/Skeleton';
import { useInboxThreads, useInboxUnread } from '../../hooks/useInbox';
import { displayName } from '../../lib/customerName';
import type { EmailThreadStatus, EmailThreadSummary } from '../../types';
import {
  CATEGORY_LABELS,
  TAB_LABELS,
  TAB_ORDER,
  formatThreadTime,
  inboxParamsToSearch,
  parseInboxParams,
  snippetLine,
  threadTitle,
  type InboxParams,
} from './inboxText';

/** The small blue "unread" dot used on rows and tabs. */
function UnreadDot() {
  return <span aria-hidden="true" className="inline-block h-2 w-2 shrink-0 rounded-pill bg-brand-600" />;
}

/**
 * One conversation row; a blue dot and bold name while it has an unopened
 * email. `showCategory` adds the category chip (the All tab mixes them).
 */
function ThreadRow({
  thread,
  showCategory,
  onOpen,
}: {
  thread: EmailThreadSummary;
  showCategory: boolean;
  onOpen: () => void;
}) {
  const unread = thread.unread;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-col gap-0.5 rounded-xl border border-border-light bg-surface p-3 text-left shadow-sm hover:bg-surface-muted"
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          {unread && <UnreadDot />}
          <span className={`truncate text-sm text-text-primary ${unread ? 'font-bold' : 'font-semibold'}`}>
            {threadTitle(thread)}
          </span>
          {unread && <span className="sr-only">(unread)</span>}
        </span>
        <time dateTime={thread.last_message_at} className="shrink-0 text-[12px] text-text-muted">
          {formatThreadTime(thread.last_message_at)}
        </time>
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate text-[13px] font-medium text-text-secondary">{thread.subject || '(no subject)'}</span>
        {thread.message_count > 1 && (
          <span className="shrink-0 rounded-pill bg-surface-sunken px-1.5 text-[11px] font-semibold text-text-secondary">
            {thread.message_count}
          </span>
        )}
      </span>
      <span className="truncate text-[13px] text-text-muted">{snippetLine(thread)}</span>
      {(showCategory || thread.customer) && (
        <span className="mt-1 flex flex-wrap gap-1.5">
          {showCategory && (
            <span className="rounded-pill bg-surface-sunken px-2 py-0.5 text-[11px] font-semibold text-text-secondary">
              {CATEGORY_LABELS[thread.category]}
            </span>
          )}
          {thread.customer && (
            <span className="rounded-pill bg-info-tint px-2 py-0.5 text-[11px] font-semibold text-info">
              {displayName(thread.customer)}
            </span>
          )}
        </span>
      )}
    </button>
  );
}

const STATUS_OPTIONS: Array<{ value: EmailThreadStatus; label: string }> = [
  { value: 'new', label: 'New' },
  { value: 'handled', label: 'Handled' },
];

/** The conversation list. */
export default function InboxPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const state = parseInboxParams(params);
  const { data, isLoading, error, isPlaceholderData } = useInboxThreads(state.category, state.status, state.page);
  const unreadCounts = useInboxUnread().data;
  const threads = data?.data ?? [];
  const totalPages = data?.total_pages ?? 1;

  function go(next: Partial<InboxParams>) {
    setParams(inboxParamsToSearch({ ...state, ...next }));
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
      <PageHeader title="Inbox" backTo="/" />
      <div className="page-container flex flex-col gap-4 py-4 md:py-6 lg:py-8 [--page-max:56rem]">
        <div role="tablist" aria-label="Category" className="flex gap-1 overflow-x-auto rounded-lg bg-surface-sunken p-1">
          {TAB_ORDER.map((c) => (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={c === state.category}
              className={segment(c === state.category)}
              onClick={() => go({ category: c, page: 1 })}
            >
              <span className="inline-flex items-center gap-1.5">
                {TAB_LABELS[c]}
                {(unreadCounts?.[c === 'all' ? 'total' : c] ?? 0) > 0 && (
                  <>
                    <UnreadDot />
                    <span className="sr-only">(unread)</span>
                  </>
                )}
              </span>
            </button>
          ))}
        </div>

        <div className="flex gap-1 self-start rounded-lg bg-surface-sunken p-1" aria-label="Status">
          {STATUS_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              aria-pressed={o.value === state.status}
              className={segment(o.value === state.status)}
              onClick={() => go({ status: o.value, page: 1 })}
            >
              {o.label}
            </button>
          ))}
        </div>

        {isLoading && <ListSkeleton />}
        {/* A failed background refresh (the list polls every minute) keeps
            showing the last good page; the error only replaces an empty one. */}
        {error && !data && <p className="text-danger">{error.message}</p>}

        {data && (
          <>
            {threads.length === 0 ? (
              <p className="rounded-xl border border-border-light bg-surface p-6 text-center text-[13px] text-text-muted shadow-sm">
                {state.page > 1
                  ? 'No conversations on this page.'
                  : `No ${state.status === 'new' ? 'new' : 'handled'} ${
                      state.category === 'all' ? '' : `${TAB_LABELS[state.category].toLowerCase()} `
                    }conversations.`}
              </p>
            ) : (
              <div className={`flex flex-col gap-2 transition-opacity ${isPlaceholderData ? 'opacity-60' : ''}`}>
                {threads.map((t) => (
                  <ThreadRow
                    key={t.id}
                    thread={t}
                    showCategory={state.category === 'all'}
                    onOpen={() => navigate(`/inbox/${t.id}`, { state: { inboxSearch: params.toString() } })}
                  />
                ))}
              </div>
            )}

            {(totalPages > 1 || state.page > 1) && (
              <div className="mt-2 flex items-center justify-between gap-2">
                <button type="button" className={pagerButton} disabled={state.page <= 1} onClick={() => go({ page: state.page - 1 })}>
                  ‹ Previous
                </button>
                <span className="text-[13px] text-text-secondary">
                  Page {state.page} of {totalPages}
                </span>
                <button type="button" className={pagerButton} disabled={state.page >= totalPages} onClick={() => go({ page: state.page + 1 })}>
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
