// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Persistence for the Titan inbox sync, behind an interface so
 * `sync.ts` is tested against an in-memory fake and only this file
 * knows table and column names.
 *
 * Every method throws on a database error (the sync then retries that
 * message next run) except `insertMessage`, which reports a 23505
 * unique violation on `message_id` as `'duplicate'` — the normal outcome
 * when two runs overlap — and `notifyIncomingEmail`, which is best effort
 * (`recordNotification` swallows its own errors). Thread summaries and merges run in SQL
 * (`refresh_email_thread`, `merge_email_threads`, migration 45) so they
 * are atomic. Customer linking matches the counterpart address against
 * live customers case-insensitively and links only when exactly one
 * matches.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { recordNotification } from '../notifications';
import type { EmailRule } from './rules';
import type { ThreadRef } from './threading';
import type { AttachmentMeta, EmailCategory, EmailDirection, InboxFolder } from './types';

/** A folder's stored cursor (nullable columns: a row may hold only an error). */
export interface SyncCursor {
  folderName: string;
  uidValidity: number | null;
  lastUid: number | null;
}

/** New cursor position after a run; `error` null marks the run successful. */
export interface CursorUpdate {
  folderName: string;
  uidValidity: number;
  lastUid: number;
  error: string | null;
}

/** A conversation created by its first stored message. */
export interface NewThread {
  subject: string;
  normalizedSubject: string;
  counterpartAddress: string;
  counterpartName: string;
  category: EmailCategory;
  customerId: string | null;
  firstMessageAt: string;
}

/** One `email_messages` row in camelCase. */
export interface NewMessage {
  threadId: string;
  messageId: string;
  inReplyTo: string | null;
  referenceIds: string[];
  direction: EmailDirection;
  folder: InboxFolder;
  imapUid: number;
  uidValidity: number;
  sentAt: string;
  fromAddress: string;
  fromName: string;
  toAddresses: string[];
  ccAddresses: string[];
  subject: string;
  textBody: string;
  replyText: string;
  attachments: AttachmentMeta[];
}

/** Everything the sync reads and writes. */
export interface InboxStore {
  getCursor(folder: InboxFolder): Promise<SyncCursor | null>;
  saveCursor(folder: InboxFolder, update: CursorUpdate): Promise<void>;
  /** Records a failed run for the Settings status line; leaves the cursor alone. */
  recordError(folder: InboxFolder, message: string): Promise<void>;
  messageExists(messageId: string): Promise<boolean>;
  /** Threads containing any of these message ids. */
  threadsByMessageIds(messageIds: string[]): Promise<ThreadRef[]>;
  /** Threads with a message whose In-Reply-To or References names `messageId`. */
  threadsReferencing(messageId: string): Promise<ThreadRef[]>;
  /** Most recent thread with this counterpart + normalised subject active since `sinceIso`. */
  threadBySubject(counterpart: string, normalizedSubject: string, sinceIso: string): Promise<string | null>;
  enabledRules(): Promise<EmailRule[]>;
  /** The one live customer with this email, else null. */
  customerIdByEmail(email: string): Promise<string | null>;
  createThread(thread: NewThread): Promise<string>;
  insertMessage(message: NewMessage): Promise<'inserted' | 'duplicate'>;
  mergeThreads(keepId: string, dropIds: string[]): Promise<void>;
  /**
   * Recomputes summary columns; `reopen` (an incoming message was stored)
   * moves a handled thread back to new and marks it unread.
   */
  refreshThread(threadId: string, reopen: boolean): Promise<void>;
  /**
   * Adds a "New email" entry to the Notifications page for one stored
   * incoming email. Best effort: never throws, so a failed alert can't
   * hold the sync cursor back.
   */
  notifyIncomingEmail(notice: { threadId: string; senderName: string; subject: string }): Promise<void>;
}

/**
 * Escapes `\`, `%` and `_` for an ILIKE exact match. Returns null for a
 * value containing `*`, which PostgREST treats as a wildcard and cannot
 * be escaped; such an address is simply not auto-linked.
 */
export function escapeLikeValue(value: string): string | null {
  if (value.includes('*')) return null;
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Wraps a PostgREST error with what was being done. */
function failure(what: string, error: { message: string }): Error {
  return new Error(`${what}: ${error.message}`);
}

/** The Supabase-backed store used by the cron (service-role client). */
export function createSupabaseInboxStore(sb: SupabaseClient): InboxStore {
  async function refs(threadIds: string[]): Promise<ThreadRef[]> {
    const unique = [...new Set(threadIds)];
    if (unique.length === 0) return [];
    const { data, error } = await sb.from('email_threads').select('id, created_at').in('id', unique);
    if (error) throw failure('Load threads', error);
    return (data ?? []).map((t) => ({ threadId: t.id as string, createdAt: t.created_at as string }));
  }

  return {
    async getCursor(folder) {
      const { data, error } = await sb
        .from('email_sync_state')
        .select('folder_name, uid_validity, last_uid')
        .eq('folder', folder)
        .maybeSingle();
      if (error) throw failure('Load sync cursor', error);
      if (!data) return null;
      return {
        folderName: data.folder_name as string,
        uidValidity: data.uid_validity === null ? null : Number(data.uid_validity),
        lastUid: data.last_uid === null ? null : Number(data.last_uid),
      };
    },

    async saveCursor(folder, u) {
      const now = new Date().toISOString();
      const { error } = await sb.from('email_sync_state').upsert(
        {
          folder,
          folder_name: u.folderName,
          uid_validity: u.uidValidity,
          last_uid: u.lastUid,
          last_run_at: now,
          last_error: u.error,
          ...(u.error === null ? { last_success_at: now } : {}),
        },
        { onConflict: 'folder' }
      );
      if (error) throw failure('Save sync cursor', error);
    },

    async recordError(folder, message) {
      const { error } = await sb
        .from('email_sync_state')
        .upsert(
          { folder, last_run_at: new Date().toISOString(), last_error: message.slice(0, 500) },
          { onConflict: 'folder' }
        );
      if (error) throw failure('Record sync error', error);
    },

    async messageExists(messageId) {
      const { data, error } = await sb.from('email_messages').select('id').eq('message_id', messageId).limit(1);
      if (error) throw failure('Check message', error);
      return (data ?? []).length > 0;
    },

    async threadsByMessageIds(messageIds) {
      const { data, error } = await sb.from('email_messages').select('thread_id').in('message_id', messageIds);
      if (error) throw failure('Find parent messages', error);
      return refs((data ?? []).map((r) => r.thread_id as string));
    },

    async threadsReferencing(messageId) {
      const [direct, listed] = await Promise.all([
        sb.from('email_messages').select('thread_id').eq('in_reply_to', messageId),
        sb.from('email_messages').select('thread_id').contains('reference_ids', [messageId]),
      ]);
      if (direct.error) throw failure('Find replies', direct.error);
      if (listed.error) throw failure('Find replies', listed.error);
      return refs([...(direct.data ?? []), ...(listed.data ?? [])].map((r) => r.thread_id as string));
    },

    async threadBySubject(counterpart, normalizedSubject, sinceIso) {
      const { data, error } = await sb
        .from('email_threads')
        .select('id')
        .eq('counterpart_address', counterpart)
        .eq('normalized_subject', normalizedSubject)
        .gte('last_message_at', sinceIso)
        .order('last_message_at', { ascending: false })
        .limit(1);
      if (error) throw failure('Find thread by subject', error);
      return (data?.[0]?.id as string | undefined) ?? null;
    },

    async enabledRules() {
      const { data, error } = await sb
        .from('email_rules')
        .select('id, position, field, match_type, value, action, enabled')
        .eq('enabled', true)
        .order('position', { ascending: true });
      if (error) throw failure('Load rules', error);
      return (data ?? []) as EmailRule[];
    },

    async customerIdByEmail(email) {
      const pattern = email ? escapeLikeValue(email) : null;
      if (!pattern) return null;
      const { data, error } = await sb
        .from('customers')
        .select('id')
        .ilike('email', pattern)
        .is('deleted_at', null)
        .limit(2);
      if (error) throw failure('Match customer', error);
      return data && data.length === 1 ? (data[0].id as string) : null;
    },

    async createThread(t) {
      const { data, error } = await sb
        .from('email_threads')
        .insert({
          subject: t.subject,
          normalized_subject: t.normalizedSubject,
          counterpart_address: t.counterpartAddress,
          counterpart_name: t.counterpartName,
          category: t.category,
          customer_id: t.customerId,
          last_message_at: t.firstMessageAt,
        })
        .select('id')
        .single();
      if (error) throw failure('Create thread', error);
      return data.id as string;
    },

    async insertMessage(m) {
      const { error } = await sb.from('email_messages').insert({
        thread_id: m.threadId,
        message_id: m.messageId,
        in_reply_to: m.inReplyTo,
        reference_ids: m.referenceIds,
        direction: m.direction,
        folder: m.folder,
        imap_uid: m.imapUid,
        uid_validity: m.uidValidity,
        sent_at: m.sentAt,
        from_address: m.fromAddress,
        from_name: m.fromName,
        to_addresses: m.toAddresses,
        cc_addresses: m.ccAddresses,
        subject: m.subject,
        text_body: m.textBody,
        reply_text: m.replyText,
        attachments: m.attachments,
      });
      if (!error) return 'inserted';
      if (error.code === '23505') return 'duplicate';
      throw failure('Insert message', error);
    },

    async mergeThreads(keepId, dropIds) {
      const { error } = await sb.rpc('merge_email_threads', { p_keep: keepId, p_drop: dropIds });
      if (error) throw failure('Merge threads', error);
    },

    async notifyIncomingEmail(notice) {
      await recordNotification(sb, {
        kind: 'email_received',
        emailThreadId: notice.threadId,
        customerName: notice.senderName,
        subject: notice.subject,
      });
    },

    async refreshThread(threadId, reopen) {
      const { error } = await sb.rpc('refresh_email_thread', { p_thread_id: threadId, p_reopen: reopen });
      if (error) throw failure('Refresh thread', error);
    },
  };
}
