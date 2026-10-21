// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * One conversation (`/inbox/:id`): the triage card, then every message as
 * a bubble, oldest at the top, scrolled to the newest on open — the
 * other party on the left, the shop (info@blindsnisa.com, read from
 * Titan's Sent folder) on the right. Back returns to the conversation's
 * category tab. Replies are written in Titan; they appear here after
 * the next 5-minute sync.
 */

import { useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import { ListSkeleton } from '../../components/Skeleton';
import { useInboxThread } from '../../hooks/useInbox';
import MessageBubble from './MessageBubble';
import ThreadControls from './ThreadControls';
import { threadTitle } from './inboxText';

/** The bubble view of one conversation. */
export default function InboxThreadPage() {
  const { id } = useParams();
  const { data: thread, isLoading, error } = useInboxThread(id);
  const endRef = useRef<HTMLDivElement>(null);
  const messageCount = thread?.messages.length ?? 0;

  useEffect(() => {
    if (messageCount > 0) endRef.current?.scrollIntoView({ block: 'end' });
  }, [messageCount]);

  return (
    <div className="min-h-screen bg-surface-muted pb-16">
      <PageHeader
        eyebrow="Inbox"
        title={thread ? threadTitle(thread) : 'Conversation'}
        subtitle={thread?.subject || undefined}
        backTo={thread && thread.category !== 'inquiry' ? `/inbox?category=${thread.category}` : '/inbox'}
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
              Reply from Titan. Your reply shows up here within about 5 minutes.
            </p>
            <div ref={endRef} />
          </>
        )}
      </div>
    </div>
  );
}
