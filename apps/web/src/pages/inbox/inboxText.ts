// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pure display rules for the Inbox and Settings → Email Rules: labels,
 * URL-param state for the list, row text, timestamps, link detection in
 * bubble text, the "···" history split, and small formatters. No React,
 * so every rule is unit-tested (`inboxText.test.ts`).
 *
 * Link detection is deliberately strict: only `http://` and `https://`
 * URLs become links (never `javascript:` or bare domains), and trailing
 * punctuation stays text. Rendering stays plain text through React's
 * escaping; this module only splits strings.
 */

import { format, formatDistanceStrict, isSameDay, isSameYear } from 'date-fns';
import type {
  EmailCategory,
  EmailMessage,
  EmailRule,
  EmailRuleAction,
  EmailRuleField,
  EmailRuleMatch,
  EmailThreadStatus,
  EmailThreadSummary,
  InboxSyncState,
  InboxTab,
} from '../../types';

/** The categories, in tab and select order. */
export const CATEGORY_ORDER: EmailCategory[] = ['inquiry', 'supplier', 'payment', 'other'];

/** Tab order on the Inbox page: All first (the default), then each category. */
export const TAB_ORDER: InboxTab[] = ['all', ...CATEGORY_ORDER];

/** Tab and select labels. */
export const CATEGORY_LABELS: Record<EmailCategory, string> = {
  inquiry: 'Inquiry',
  supplier: 'Supplier',
  payment: 'Payment',
  other: 'Other',
};

/** Inbox tab labels: All plus the category labels. */
export const TAB_LABELS: Record<InboxTab, string> = { all: 'All', ...CATEGORY_LABELS };

/** Rule field names as staff read them. */
export const RULE_FIELD_LABELS: Record<EmailRuleField, string> = {
  address: 'Email address',
  domain: 'Email domain',
  subject: 'Subject',
  body: 'Message text',
};

/** Rule comparison names as staff read them. */
export const RULE_MATCH_LABELS: Record<EmailRuleMatch, string> = {
  contains: 'contains',
  equals: 'is exactly',
  ends_with: 'ends with',
};

/** Rule outcomes as staff read them. */
export const RULE_ACTION_LABELS: Record<EmailRuleAction, string> = {
  ...CATEGORY_LABELS,
  ignore: 'Ignore (don’t import)',
};

/** The Inbox list's URL state. */
export interface InboxParams {
  category: InboxTab;
  status: EmailThreadStatus;
  page: number;
}

/** Reads `?category=&status=&page=`; anything unknown falls back to All / New / 1. */
export function parseInboxParams(params: URLSearchParams): InboxParams {
  const category = params.get('category');
  const status = params.get('status');
  const page = Number(params.get('page'));
  return {
    category: TAB_ORDER.includes(category as InboxTab) ? (category as InboxTab) : 'all',
    status: status === 'handled' ? 'handled' : 'new',
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

/** The inverse of {@link parseInboxParams}, omitting defaults for clean URLs. */
export function inboxParamsToSearch(p: InboxParams): Record<string, string> {
  const out: Record<string, string> = {};
  if (p.category !== 'all') out.category = p.category;
  if (p.status !== 'new') out.status = p.status;
  if (p.page > 1) out.page = String(p.page);
  return out;
}

/** The other party's name, else address, else a placeholder. */
export function threadTitle(t: Pick<EmailThreadSummary, 'counterpart_name' | 'counterpart_address'>): string {
  return t.counterpart_name.trim() || t.counterpart_address.trim() || 'Unknown sender';
}

/** The row's preview line; "You: " when the shop sent the last message. */
export function snippetLine(t: Pick<EmailThreadSummary, 'last_direction' | 'last_snippet'>): string {
  return `${t.last_direction === 'out' ? 'You: ' : ''}${t.last_snippet}`;
}

/** "9:05 AM" today, "Mar 4" this year, "Mar 4, 2025" before. */
export function formatThreadTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (isSameDay(date, now)) return format(date, 'h:mm a');
  if (isSameYear(date, now)) return format(date, 'MMM d');
  return format(date, 'MMM d, yyyy');
}

/** A piece of bubble text: plain text, or an http(s) link. */
export type TextSegment = { kind: 'text'; text: string } | { kind: 'link'; text: string; href: string };

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/;

/** Splits text into text and http(s) link segments (see module comment). */
export function linkify(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    const url = match[0].replace(TRAILING_PUNCTUATION, '');
    if (start > last) segments.push({ kind: 'text', text: text.slice(last, start) });
    segments.push({ kind: 'link', text: url, href: url });
    last = start + url.length;
  }
  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) });
  return segments.length ? segments : [{ kind: 'text', text }];
}

/**
 * What "···" reveals: the part of the full text after the shown reply,
 * the whole full text when the reply isn't its prefix, or null when
 * nothing was trimmed (no "···" button).
 */
export function hiddenHistory(m: Pick<EmailMessage, 'reply_text' | 'text_body'>): string | null {
  const full = m.text_body.trim();
  const reply = m.reply_text.trim();
  if (!full || full === reply) return null;
  if (full.startsWith(reply)) return full.slice(reply.length).trim() || null;
  return full;
}

/** "You" for the shop's messages, else the sender's name or address. */
export function senderLabel(m: Pick<EmailMessage, 'direction' | 'from_name' | 'from_address'>): string {
  if (m.direction === 'out') return 'You';
  return m.from_name.trim() || m.from_address || 'Unknown sender';
}

/** 512 B, 2 KB, 3.3 MB. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 'Email domain ends with “acme.com” → Supplier'. */
export function describeRule(r: Pick<EmailRule, 'field' | 'match_type' | 'value' | 'action'>): string {
  return `${RULE_FIELD_LABELS[r.field]} ${RULE_MATCH_LABELS[r.match_type]} “${r.value}” → ${RULE_ACTION_LABELS[r.action]}`;
}

const FOLDER_LABELS: Record<InboxSyncState['folder'], string> = { inbox: 'Inbox', sent: 'Sent' };

/** One status line per folder: the error if any, else time since last success. */
export function syncStatusLine(s: InboxSyncState, now: Date = new Date()): string {
  const label = FOLDER_LABELS[s.folder];
  if (s.last_error) return `${label}: error — ${s.last_error}`;
  if (s.last_success_at) {
    return `${label}: last synced ${formatDistanceStrict(new Date(s.last_success_at), now)} ago`;
  }
  return `${label}: not synced yet`;
}

/** A copy of `ids` with item `index` moved by `delta` (unchanged when out of range). */
export function moveId(ids: string[], index: number, delta: -1 | 1): string[] {
  const target = index + delta;
  if (target < 0 || target >= ids.length) return ids;
  const next = [...ids];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
