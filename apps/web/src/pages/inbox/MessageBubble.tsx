// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * One email as a chat bubble: the other party on the left (white card),
 * the shop on the right (brand blue), with sender and time above.
 *
 * Shows `reply_text` (quoted history already trimmed by the Worker) as
 * plain text: line breaks kept, http(s) URLs turned into links that open
 * in a new tab with `noopener noreferrer`. No email HTML is ever
 * rendered. When the Worker trimmed something, a small "···" button
 * reveals it underneath, muted. Attachments are listed by name and size
 * only; the files stay in Titan.
 */

import { useState } from 'react';
import { format } from 'date-fns';
import type { EmailMessage } from '../../types';
import { formatBytes, hiddenHistory, linkify, senderLabel } from './inboxText';

/** Plain text with http(s) links; React escapes every text node. */
function LinkifiedText({ text, linkClass }: { text: string; linkClass: string }) {
  return (
    <>
      {linkify(text).map((segment, i) =>
        segment.kind === 'link' ? (
          <a key={i} href={segment.href} target="_blank" rel="noopener noreferrer" className={linkClass}>
            {segment.text}
          </a>
        ) : (
          <span key={i}>{segment.text}</span>
        )
      )}
    </>
  );
}

/** Renders one message of a conversation. */
export default function MessageBubble({ message }: { message: EmailMessage }) {
  const [showHistory, setShowHistory] = useState(false);
  const mine = message.direction === 'out';
  const history = hiddenHistory(message);
  const linkClass = mine ? 'underline decoration-white/60 break-all' : 'text-brand-700 underline break-all';

  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex max-w-[85%] flex-col gap-1 sm:max-w-[75%] ${mine ? 'items-end' : 'items-start'}`}>
        <div className="flex items-baseline gap-2 px-1 text-[12px] text-text-muted">
          <span className="font-semibold text-text-secondary">{senderLabel(message)}</span>
          <time dateTime={message.sent_at}>{format(new Date(message.sent_at), 'MMM d, h:mm a')}</time>
        </div>

        <div
          className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-[14px] leading-5 shadow-sm ${
            mine
              ? 'rounded-br-md bg-brand-600 text-white'
              : 'rounded-bl-md border border-border-light bg-surface text-text-primary'
          }`}
        >
          <LinkifiedText text={message.reply_text} linkClass={linkClass} />
          {history && (
            <>
              <button
                type="button"
                onClick={() => setShowHistory((v) => !v)}
                aria-expanded={showHistory}
                aria-label={showHistory ? 'Hide earlier messages' : 'Show earlier messages'}
                className={`mt-1 block rounded px-1.5 text-[13px] font-bold leading-4 ${
                  mine ? 'bg-white/20 hover:bg-white/30' : 'bg-surface-sunken text-text-secondary hover:bg-border-light'
                }`}
              >
                ···
              </button>
              {showHistory && (
                <div className={`mt-2 border-t pt-2 text-[13px] ${mine ? 'border-white/30 text-white/80' : 'border-border-light text-text-muted'}`}>
                  <LinkifiedText text={history} linkClass={linkClass} />
                </div>
              )}
            </>
          )}
        </div>

        {message.attachments.length > 0 && (
          <ul className="flex flex-col gap-0.5 px-1 text-[12px] text-text-muted">
            {message.attachments.map((a, i) => (
              <li key={i}>
                Attachment: {a.filename} · {formatBytes(a.size)}
              </li>
            ))}
            <li className="italic">Open the email in Titan to download attachments.</li>
          </ul>
        )}
      </div>
    </div>
  );
}
