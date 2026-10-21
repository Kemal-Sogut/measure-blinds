// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Raw RFC 5322 bytes → {@link ParsedMessage}, using postal-mime (pinned
 * at 2.7.6; it runs in Workers and in Node).
 *
 * Normalises what the threading and storage layers rely on: ids without
 * angle brackets, at most the last 20 References ids, lower-cased
 * addresses with groups flattened, an ISO date (falling back to when the
 * message was fetched), and one plain-text body — the text/plain part
 * when present, else the HTML converted by `htmlToText` (blockquotes
 * become ">" lines for the quote trimmer). The body is capped at
 * {@link MAX_TEXT_CHARS}. Attachments are reduced to name, type and
 * size; their bytes are dropped. Throws when postal-mime cannot parse
 * the input at all; the sync stores a placeholder in that case.
 */

import PostalMime from 'postal-mime';
import { htmlToText } from './htmlToText';
import type { AttachmentMeta, Mailbox, ParsedMessage } from './types';

/** Longest stored text body, in characters. */
export const MAX_TEXT_CHARS = 200_000;

/** References ids kept per message (the most recent ones). */
const MAX_REFERENCES = 20;

/** postal-mime's address shape: a mailbox, or a named group of mailboxes. */
interface PmAddress {
  name?: string;
  address?: string;
  group?: PmAddress[];
}

/** `<id@host>` or `id@host` → `id@host`; null when absent or containing whitespace. */
export function normalizeMessageId(value: string | null | undefined): string | null {
  if (!value) return null;
  const bracketed = /<([^>]+)>/.exec(value);
  const id = (bracketed ? bracketed[1] : value).trim();
  return id && !/\s/.test(id) ? id : null;
}

/** A References header → its ids in order, deduplicated, last {@link MAX_REFERENCES} kept. */
export function parseReferences(value: string | null | undefined): string[] {
  if (!value) return [];
  const bracketed = [...value.matchAll(/<([^>]+)>/g)].map((m) => m[1].trim()).filter(Boolean);
  const ids = bracketed.length ? bracketed : value.split(/\s+/).filter(Boolean);
  return [...new Set(ids)].slice(-MAX_REFERENCES);
}

/** Flattens postal-mime addresses (including groups) into lower-cased mailboxes. */
function flatten(list: PmAddress | PmAddress[] | undefined): Mailbox[] {
  const items = !list ? [] : Array.isArray(list) ? list : [list];
  return items.flatMap((a): Mailbox[] => {
    if (a.group) return flatten(a.group);
    const address = (a.address ?? '').trim().toLowerCase();
    return address ? [{ address, name: (a.name ?? '').trim() }] : [];
  });
}

/** Parses one message; `receivedAt` is used when the Date header is missing or invalid. */
export async function parseMessage(raw: Uint8Array, receivedAt: Date): Promise<ParsedMessage> {
  const email = await PostalMime.parse(raw);

  const date = email.date ? new Date(email.date) : null;
  const sentAt = date && !Number.isNaN(date.getTime()) ? date : receivedAt;

  const text = email.text && email.text.trim() ? email.text : email.html ? htmlToText(email.html) : '';

  const attachments: AttachmentMeta[] = (email.attachments ?? []).map((a) => ({
    filename: a.filename || '(unnamed)',
    mime_type: a.mimeType || 'application/octet-stream',
    size: typeof a.content === 'string' ? a.content.length : a.content.byteLength,
  }));

  return {
    messageId: normalizeMessageId(email.messageId),
    inReplyTo: normalizeMessageId(email.inReplyTo),
    references: parseReferences(email.references),
    sentAt: sentAt.toISOString(),
    from: flatten(email.from as PmAddress | undefined)[0] ?? { address: '', name: '' },
    to: flatten(email.to as PmAddress[] | undefined),
    cc: flatten(email.cc as PmAddress[] | undefined),
    subject: (email.subject ?? '').trim(),
    textBody: text.replace(/\r\n?/g, '\n').slice(0, MAX_TEXT_CHARS),
    attachments,
  };
}
