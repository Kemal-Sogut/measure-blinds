// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pure threading rules for the Titan inbox: no I/O, so every case is a
 * unit test. The sync gathers the lookups (which stored threads contain
 * a message this one replies to, which stored threads reply to this one,
 * which thread has the same subject with the same other party) and asks
 * `chooseThread` what to do.
 *
 * Preference order: header matches and reverse header matches (a reply
 * that was stored before its parent) beat the subject fallback. When the
 * headers point at more than one thread they are the same conversation,
 * so the newer threads are merged into the oldest. The subject fallback
 * (same normalised subject + same counterpart, last message within
 * {@link SUBJECT_FALLBACK_DAYS}) covers clients that drop the headers and
 * replies to app-sent (Resend) mail whose ids we never stored.
 */

import type { EmailDirection, InboxFolder, Mailbox } from './types';

/** How far back the subject fallback looks for a conversation to join. */
export const SUBJECT_FALLBACK_DAYS = 60;

const SUBJECT_PREFIX = /^(?:(?:re|fw|fwd|aw|sv|wg|tr|antw|ré)\s*(?:\[\d+\]|\(\d+\))?\s*:|\[[^\]]{1,40}\])\s*/i;

/**
 * Lower-cased subject with reply/forward prefixes ("Re:", "Fwd:",
 * "AW:", "Re[2]:" …) and bracket tags ("[External]") repeatedly removed
 * and whitespace collapsed. '' stays '' (and never subject-matches).
 */
export function normalizeSubject(subject: string): string {
  let s = subject.replace(/\s+/g, ' ').trim();
  for (let previous = ''; previous !== s; ) {
    previous = s;
    s = s.replace(SUBJECT_PREFIX, '').trim();
  }
  return s.toLowerCase();
}

/**
 * `out` when the message was read from the Sent folder or was sent by the
 * shop mailbox (e.g. a copy to self in INBOX), else `in`. `mailbox` must
 * be lower-cased.
 */
export function directionOf(folder: InboxFolder, fromAddress: string, mailbox: string): EmailDirection {
  return folder === 'sent' || fromAddress === mailbox ? 'out' : 'in';
}

/**
 * The other party of a message: the sender of an incoming one; for an
 * outgoing one, the first To recipient that isn't the shop, else the
 * first such CC, else the shop itself (a note to self).
 */
export function counterpartOf(
  direction: EmailDirection,
  from: Mailbox,
  to: Mailbox[],
  cc: Mailbox[],
  mailbox: string
): Mailbox {
  if (direction === 'in') return from;
  return [...to, ...cc].find((m) => m.address && m.address !== mailbox) ?? { address: mailbox, name: '' };
}

/** A stored thread found by a lookup, with its creation time (merge keeps the oldest). */
export interface ThreadRef {
  threadId: string;
  createdAt: string;
}

/** What to do with a new message. `mergeThreadIds` fold into `threadId` first. */
export type ThreadDecision =
  | { kind: 'join'; threadId: string; mergeThreadIds: string[] }
  | { kind: 'new' };

/** Decides the thread for a message from the three lookups (see module comment). */
export function chooseThread(input: {
  headerMatches: ThreadRef[];
  reverseMatches: ThreadRef[];
  subjectMatch: string | null;
}): ThreadDecision {
  const byId = new Map<string, ThreadRef>();
  for (const ref of [...input.headerMatches, ...input.reverseMatches]) byId.set(ref.threadId, ref);
  if (byId.size > 0) {
    const ordered = [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { kind: 'join', threadId: ordered[0].threadId, mergeThreadIds: ordered.slice(1).map((r) => r.threadId) };
  }
  if (input.subjectMatch) return { kind: 'join', threadId: input.subjectMatch, mergeThreadIds: [] };
  return { kind: 'new' };
}

/**
 * True for message ids safe to pass to PostgREST `in` / `cs` filters:
 * non-empty, at most 250 characters, none of `, ( ) { } " \` or whitespace.
 * Unsafe ids are simply not used for lookups (the subject fallback still applies).
 */
export function isLookupSafeId(id: string): boolean {
  return id.length > 0 && id.length <= 250 && !/[\s,(){}"\\]/.test(id);
}

/** ISO timestamp {@link SUBJECT_FALLBACK_DAYS} before `now`. */
export function subjectFallbackSince(now: Date): string {
  return new Date(now.getTime() - SUBJECT_FALLBACK_DAYS * 86_400_000).toISOString();
}
