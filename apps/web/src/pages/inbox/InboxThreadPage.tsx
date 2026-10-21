// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * One conversation (`/inbox/:id`): the triage card, then every message as
 * a bubble, oldest at the top, scrolled to the newest on open — the
 * other party on the left, the shop (info@blindsnisa.com, read from
 * Titan's Sent folder) on the right. Back returns to the list tab, status
 * and page it was opened from (router state from the Inbox list), else
 * to the All tab (e.g. when opened from a notification). Opening an unread conversation marks it read, which
 * clears its dot, its tab's dot and (when it was the last one) the
 * sidebar's. Replies are written in Titan; they appear here after
 * the next sync (every minute 8 AM–10 PM, every 10 minutes overnight); an
 * open conversation refreshes itself every minute.
 */

import { useEffect, useRef } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import { ListSkeleton } from '../../components/Skeleton';
import { useInboxThread, useMarkInboxThreadRead } from '../../hooks/useInbox';
import MessageBubble from './MessageBubble';
import ThreadControls from './ThreadControls';
import { threadTitle } from './inboxText';

/** The bubble view of one conversation. */
export default function InboxThreadPage() {
  const { id } = useParams();
  const inboxSearch = (useLocation().state as { inboxSearch?: string } | null)?.inboxSearch;
  const { data: thread, isLoading, error } = useInboxThread(id);
  const markRead = useMarkInboxThreadRead();
  const endRef = useRef<HTMLDivElement>(null);
  const messageCount = thread?.messages.length ?? 0;
  const unreadId = thread?.unread ? thread.id : null;
  const { mutate: markReadMutate } = markRead;

  // Opening the conversation reads it. Runs once per unread state: the
  // mutation refetches the thread, which comes back with unread = false.
  useEffect(() => {
    if (unreadId) markReadMutate(unreadId);
  }, [unreadId, markReadMutate]);

  useEffect(() => {
    if (messageCount > 0) endRef.current?.scrollIntoView({ block: 'end' });
  }, [messageCount]);

  return (
    <div className="min-h-screen bg-surface-muted pb-16">
      <PageHeader
        eyebrow="Inbox"
        title={thread ? threadTitle(thread) : 'Conversation'}
        subtitle={thread?.subject || undefined}
        backTo={inboxSearch ? `/inbox?${inboxSearch}` : '/inbox'}
      />
      <div className="page-container flex flex-col gap-4 py-4 md:py-6 [--page-max:56rem]">
        {isLoading && <ListSkeleton />}
        {error && !thread && <p className="text-danger">{error.message}</p>}
        {thread && (
          <>
            <ThreadControls thread={thread} />
            <div className="flex flex-col gap-4">
              {thread.messages.map((m) => (
                <MessageBubble key={m.id} message={m} />
              ))}
            </div>
            <p className="text-center text-[12px] text-text-muted">
              Reply from Titan. Your reply shows up here within a couple of minutes (up to 10 overnight).
            </p>
            <div ref={endRef} />
          </>
        )}
      </div>
    </div>
  );
}
