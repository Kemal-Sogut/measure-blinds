// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * One run of the Titan inbox sync, independent of sockets and Supabase
 * (both are injected), so the whole pipeline is tested in memory.
 *
 * Per run:
 *   1. Resolve the Sent folder (missing → recorded error, INBOX still syncs).
 *   2. For each folder (INBOX first, so a customer's email is normally
 *      stored before the shop's reply to it; reverse header matching
 *      covers the other order), read up to {@link FETCH_LIMIT_PER_FOLDER}
 *      messages after its cursor. No usable cursor, a different folder
 *      name, or a changed UIDVALIDITY → move the cursor to the folder's
 *      highest UID and import nothing (start "from now", never re-import).
 *   3. Parse each message in UID order (unparseable → placeholder).
 *   4. Per message: skip known ids; thread it (headers, reverse headers,
 *      subject fallback; merge when headers prove two threads are one);
 *      a message that starts a thread is classified by the rules
 *      (ignore → not stored) and auto-linked to a customer; insert; refresh
 *      the thread summary (incoming mail reopens a handled thread and marks
 *      it unread) and, for incoming mail, add a Notifications entry.
 *   5. Save the folder's cursor after EVERY stored message, so a run cut
 *      short (the Free plan's 10 ms CPU cap) never redoes finished work. On
 *      a store failure the folder stops there and the cursor stays just
 *      before that message, which is retried next run.
 */

import { parseMessage } from './parse';
import { trimQuotedReply } from './quoteTrim';
import { classify, type Classification, type EmailRule } from './rules';
import {
  chooseThread,
  counterpartOf,
  directionOf,
  isLookupSafeId,
  normalizeSubject,
  subjectFallbackSince,
  type ThreadDecision,
} from './threading';
import type { InboxStore } from './store';
import type { InboxFolder, MailSource, ParsedMessage } from './types';

/**
 * Messages read per folder per run. Small on purpose: the cron runs every
 * minute in business hours and the Workers Free plan allows 10 ms of CPU
 * per run, so a backlog drains over a few runs instead of one long one.
 */
export const FETCH_LIMIT_PER_FOLDER = 5;

/** Bubble text for a message postal-mime could not parse. */
export const UNREADABLE_TEXT = '(This message could not be read. Open it in Titan to see it.)';

/** What a run needs. `mailbox` is the shop address; `parse` is injectable for tests. */
export interface SyncDeps {
  source: MailSource;
  store: InboxStore;
  mailbox: string;
  now: () => Date;
  parse?: (raw: Uint8Array, receivedAt: Date) => Promise<ParsedMessage>;
}

/** Counts and human-readable problems from one run (logged by `run.ts`). */
export interface SyncReport {
  imported: number;
  ignored: number;
  duplicates: number;
  failed: number;
  errors: string[];
}

type Outcome = 'imported' | 'ignored' | 'duplicates';

interface Pending {
  folder: InboxFolder;
  uidValidity: number;
  uid: number;
  message: ParsedMessage;
  unreadable: boolean;
}

interface ImportContext {
  store: InboxStore;
  mailbox: string;
  now: () => Date;
  loadRules: () => Promise<EmailRule[]>;
}

/** The ParsedMessage stand-in for bytes postal-mime rejected. */
function unreadableMessage(receivedAt: Date): ParsedMessage {
  return {
    messageId: null,
    inReplyTo: null,
    references: [],
    sentAt: receivedAt.toISOString(),
    from: { address: '', name: '' },
    to: [],
    cc: [],
    subject: '(unreadable message)',
    textBody: '',
    attachments: [],
  };
}

/** Gathers the three lookups and lets `chooseThread` decide. */
async function decideThread(
  ctx: ImportContext,
  msg: ParsedMessage,
  counterpart: string,
  normalizedSubject: string
): Promise<ThreadDecision> {
  const lookupIds = [...new Set([msg.inReplyTo, ...msg.references])].filter(
    (id): id is string => typeof id === 'string' && isLookupSafeId(id)
  );
  const headerMatches = lookupIds.length ? await ctx.store.threadsByMessageIds(lookupIds) : [];
  const reverseMatches =
    msg.messageId && isLookupSafeId(msg.messageId) ? await ctx.store.threadsReferencing(msg.messageId) : [];
  const subjectMatch =
    headerMatches.length || reverseMatches.length || !normalizedSubject || !counterpart
      ? null
      : await ctx.store.threadBySubject(counterpart, normalizedSubject, subjectFallbackSince(ctx.now()));
  return chooseThread({ headerMatches, reverseMatches, subjectMatch });
}

/** Imports one parsed message; throws only on a store failure. */
async function importOne(p: Pending, ctx: ImportContext): Promise<Outcome> {
  const { store, mailbox } = ctx;
  const msg = p.message;
  const messageId = msg.messageId ?? `uid:${p.folder}:${p.uidValidity}:${p.uid}`;
  if (await store.messageExists(messageId)) return 'duplicates';

  const direction = directionOf(p.folder, msg.from.address, mailbox);
  const counterpart = counterpartOf(direction, msg.from, msg.to, msg.cc, mailbox);
  const replyText = p.unreadable ? UNREADABLE_TEXT : trimQuotedReply(msg.textBody);
  const normalizedSubject = normalizeSubject(msg.subject);

  const decision: ThreadDecision = p.unreadable
    ? { kind: 'new' }
    : await decideThread(ctx, msg, counterpart.address, normalizedSubject);

  let threadId: string;
  if (decision.kind === 'join') {
    threadId = decision.threadId;
    if (decision.mergeThreadIds.length) await store.mergeThreads(threadId, decision.mergeThreadIds);
  } else {
    const verdict: Classification = p.unreadable
      ? { action: 'category', category: 'other' }
      : classify({ counterpart: counterpart.address, subject: msg.subject, body: replyText }, await ctx.loadRules());
    if (verdict.action === 'ignore') return 'ignored';
    threadId = await store.createThread({
      subject: msg.subject,
      normalizedSubject,
      counterpartAddress: counterpart.address,
      counterpartName: counterpart.name,
      category: verdict.category,
      customerId: counterpart.address ? await store.customerIdByEmail(counterpart.address) : null,
      firstMessageAt: msg.sentAt,
    });
  }

  let inserted: 'inserted' | 'duplicate';
  try {
    inserted = await store.insertMessage({
    threadId,
    messageId,
    inReplyTo: msg.inReplyTo,
    referenceIds: msg.references,
    direction,
    folder: p.folder,
    imapUid: p.uid,
    uidValidity: p.uidValidity,
    sentAt: msg.sentAt,
    fromAddress: msg.from.address,
    fromName: msg.from.name,
    toAddresses: msg.to.map((m) => m.address),
    ccAddresses: msg.cc.map((m) => m.address),
    subject: msg.subject,
    textBody: msg.textBody,
    replyText,
    attachments: msg.attachments,
    });
  } catch (error) {
    // Don't leave a just-created conversation with no messages behind.
    if (decision.kind === 'new') await store.refreshThread(threadId, false).catch(() => undefined);
    throw error;
  }
  // Also run after a lost dedupe race: it deletes a just-created empty thread.
  const incoming = inserted === 'inserted' && direction === 'in';
  await store.refreshThread(threadId, incoming);
  if (incoming) {
    await store.notifyIncomingEmail({
      threadId,
      senderName: msg.from.name || msg.from.address,
      subject: msg.subject,
    });
  }
  return inserted === 'inserted' ? 'imported' : 'duplicates';
}

/** Runs one sync (see the module comment for the steps). */
export async function syncInbox(deps: SyncDeps): Promise<SyncReport> {
  const { source, store, now } = deps;
  const parse = deps.parse ?? parseMessage;
  const mailbox = deps.mailbox.trim().toLowerCase();
  const report: SyncReport = { imported: 0, ignored: 0, duplicates: 0, failed: 0, errors: [] };

  const folders: Array<{ folder: InboxFolder; name: string }> = [{ folder: 'inbox', name: 'INBOX' }];
  const sentName = await source.findSentFolder();
  if (sentName) {
    folders.push({ folder: 'sent', name: sentName });
  } else {
    const message = 'No Sent folder found on the mail server, so replies will not appear.';
    report.errors.push(message);
    await store.recordError('sent', message);
  }

  let rules: EmailRule[] | null = null;
  const ctx: ImportContext = { store, mailbox, now, loadRules: async () => (rules ??= await store.enabledRules()) };

  for (const { folder, name } of folders) {
    const cursor = await store.getCursor(folder);
    const usable =
      cursor && cursor.folderName === name && cursor.uidValidity !== null && cursor.lastUid !== null
        ? { uidValidity: cursor.uidValidity, afterUid: cursor.lastUid }
        : null;
    const read = await source.readFolder(name, usable, FETCH_LIMIT_PER_FOLDER);
    if (!usable || usable.uidValidity !== read.uidValidity) {
      await store.saveCursor(folder, { folderName: name, uidValidity: read.uidValidity, lastUid: read.highestUid, error: null });
      continue;
    }

    const save = (lastUid: number, error: string | null) =>
      store.saveCursor(folder, { folderName: name, uidValidity: read.uidValidity, lastUid, error });

    let done = usable.afterUid;
    let failedUid: number | null = null;
    for (const raw of read.messages) {
      const receivedAt = now();
      let pending: Pending;
      try {
        pending = { folder, uidValidity: read.uidValidity, uid: raw.uid, message: await parse(raw.raw, receivedAt), unreadable: false };
      } catch {
        pending = { folder, uidValidity: read.uidValidity, uid: raw.uid, message: unreadableMessage(receivedAt), unreadable: true };
      }
      try {
        report[await importOne(pending, ctx)] += 1;
      } catch (error) {
        report.failed += 1;
        report.errors.push(`${folder} UID ${raw.uid}: ${error instanceof Error ? error.message : String(error)}`);
        failedUid = raw.uid;
        break;
      }
      done = raw.uid;
      // Progress survives a run that is cut short (Free-plan CPU cap).
      await save(done, null);
    }

    if (failedUid !== null) {
      await save(done, `Could not save message UID ${failedUid}; it will be retried.`);
    } else {
      await save(Math.max(done, read.scannedThroughUid ?? done), null);
    }
  }
  return report;
}
