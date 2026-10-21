// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * End-to-end tests of one sync run with real parsing (postal-mime) but
 * an in-memory mail source and store. Pins: first run only sets cursors;
 * replies from Sent land in the customer's thread as `out`; date order
 * across folders; reverse matching and merges; subject fallback window;
 * ignore rules; dedupe across folders; reopen on incoming only; the
 * 50-per-folder cap; UIDVALIDITY reset; a missing Sent folder; a store
 * failure holding the cursor; and the unreadable-message placeholder.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { FETCH_LIMIT_PER_FOLDER, syncInbox, UNREADABLE_TEXT } from './sync';
import { eml, type EmlOptions } from './testEml';
import type { CursorUpdate, InboxStore, NewMessage, NewThread, SyncCursor } from './store';
import type { EmailRule } from './rules';
import type { ThreadRef } from './threading';
import type { InboxFolder, MailSource, RawMessage } from './types';

const SHOP = 'info@blindsnisa.com';
const NOW = new Date('2026-10-21T12:00:00Z');

interface MemThread extends NewThread {
  id: string;
  createdAt: string;
  status: 'new' | 'handled';
  lastMessageAt: string;
  lastDirection: 'in' | 'out';
}

/** In-memory InboxStore with the same semantics as the Supabase one. */
class MemoryStore implements InboxStore {
  cursors = new Map<InboxFolder, CursorUpdate>();
  errors: Array<[InboxFolder, string]> = [];
  threads: MemThread[] = [];
  messages: NewMessage[] = [];
  rules: EmailRule[] = [];
  customers = new Map<string, string>();
  failInsertFor = new Set<string>();
  notifications: Array<{ threadId: string; senderName: string; subject: string }> = [];
  private seq = 0;

  async getCursor(folder: InboxFolder): Promise<SyncCursor | null> {
    const c = this.cursors.get(folder);
    return c ? { folderName: c.folderName, uidValidity: c.uidValidity, lastUid: c.lastUid } : null;
  }
  async saveCursor(folder: InboxFolder, update: CursorUpdate) {
    this.cursors.set(folder, update);
  }
  async recordError(folder: InboxFolder, message: string) {
    this.errors.push([folder, message]);
  }
  async messageExists(id: string) {
    return this.messages.some((m) => m.messageId === id);
  }
  async threadsByMessageIds(ids: string[]) {
    return this.refs(this.messages.filter((m) => ids.includes(m.messageId)).map((m) => m.threadId));
  }
  async threadsReferencing(id: string) {
    return this.refs(
      this.messages.filter((m) => m.inReplyTo === id || m.referenceIds.includes(id)).map((m) => m.threadId)
    );
  }
  async threadBySubject(counterpart: string, normalizedSubject: string, sinceIso: string) {
    const hit = this.threads
      .filter((t) => t.counterpartAddress === counterpart && t.normalizedSubject === normalizedSubject && t.lastMessageAt >= sinceIso)
      .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))[0];
    return hit?.id ?? null;
  }
  async enabledRules() {
    return this.rules.filter((r) => r.enabled);
  }
  async customerIdByEmail(email: string) {
    return this.customers.get(email) ?? null;
  }
  async createThread(t: NewThread) {
    const id = `t${++this.seq}`;
    this.threads.push({
      ...t,
      id,
      createdAt: new Date(Date.UTC(2026, 0, 1) + this.seq * 1000).toISOString(),
      status: 'new',
      lastMessageAt: t.firstMessageAt,
      lastDirection: 'in',
    });
    return id;
  }
  async insertMessage(m: NewMessage) {
    if (this.failInsertFor.has(m.messageId)) throw new Error('db down');
    if (this.messages.some((x) => x.messageId === m.messageId)) return 'duplicate' as const;
    this.messages.push({ ...m });
    return 'inserted' as const;
  }
  async mergeThreads(keepId: string, dropIds: string[]) {
    for (const m of this.messages) if (dropIds.includes(m.threadId)) m.threadId = keepId;
    this.threads = this.threads.filter((t) => !dropIds.includes(t.id));
  }
  async notifyIncomingEmail(n: { threadId: string; senderName: string; subject: string }) {
    this.notifications.push(n);
  }
  async refreshThread(threadId: string, reopen: boolean) {
    const t = this.threads.find((x) => x.id === threadId);
    if (!t) return;
    const msgs = this.messages.filter((m) => m.threadId === threadId);
    if (msgs.length === 0) {
      this.threads = this.threads.filter((x) => x.id !== threadId);
      return;
    }
    const last = [...msgs].sort((a, b) => a.sentAt.localeCompare(b.sentAt)).at(-1)!;
    t.lastMessageAt = last.sentAt;
    t.lastDirection = last.direction;
    if (reopen) t.status = 'new';
  }
  private refs(threadIds: string[]): ThreadRef[] {
    return [...new Set(threadIds)]
      .map((id) => this.threads.find((t) => t.id === id))
      .filter((t): t is MemThread => Boolean(t))
      .map((t) => ({ threadId: t.id, createdAt: t.createdAt }));
  }
  messagesOf(threadId: string) {
    return this.messages.filter((m) => m.threadId === threadId);
  }
}

type Folders = Record<string, { uidValidity: number; messages: RawMessage[] }>;

/** In-memory MailSource with the same cursor semantics as the IMAP one. */
function fakeSource(folders: Folders, sentName: string | null = 'Sent'): MailSource {
  return {
    async findSentFolder() {
      return sentName;
    },
    async readFolder(name, cursor, limit) {
      const f = folders[name] ?? { uidValidity: 1, messages: [] };
      const highestUid = f.messages.reduce((max, m) => Math.max(max, m.uid), 0);
      if (!cursor || cursor.uidValidity !== f.uidValidity || highestUid <= cursor.afterUid) {
        return { uidValidity: f.uidValidity, highestUid, scannedThroughUid: null, messages: [] };
      }
      const messages = f.messages
        .filter((m) => m.uid > cursor.afterUid)
        .sort((a, b) => a.uid - b.uid)
        .slice(0, limit);
      return { uidValidity: f.uidValidity, highestUid, scannedThroughUid: messages.at(-1)?.uid ?? null, messages };
    },
    async close() {},
  };
}

/** A customer message to the shop, as raw bytes at `uid`. */
function incoming(uid: number, o: Partial<EmlOptions> & { id: string }): RawMessage {
  return {
    uid,
    raw: eml({
      from: 'Jane Doe <jane@example.com>',
      to: `Blinds Nisa <${SHOP}>`,
      subject: 'Quote for kitchen',
      date: 'Mon, 20 Oct 2026 10:00:00 -0400',
      body: 'Hello, can I get a quote?',
      ...o,
    }),
  };
}

/** A shop reply to Jane, as raw bytes at `uid`. */
function outgoing(uid: number, o: Partial<EmlOptions> & { id: string }): RawMessage {
  return {
    uid,
    raw: eml({
      from: `Blinds Nisa <${SHOP}>`,
      to: 'Jane Doe <jane@example.com>',
      subject: 'Re: Quote for kitchen',
      date: 'Mon, 20 Oct 2026 11:00:00 -0400',
      body: 'Sure, Tuesday works.\n\nOn Mon, Oct 20, 2026 at 10:00 AM Jane Doe <jane@example.com> wrote:\n> Hello, can I get a quote?',
      ...o,
    }),
  };
}

let store: MemoryStore;

/** Cursors as if a previous run had seen both folders empty. */
function primeCursors() {
  store.cursors.set('inbox', { folderName: 'INBOX', uidValidity: 1, lastUid: 0, error: null });
  store.cursors.set('sent', { folderName: 'Sent', uidValidity: 1, lastUid: 0, error: null });
}

function run(folders: Folders, sentName: string | null = 'Sent') {
  return syncInbox({ source: fakeSource(folders, sentName), store, mailbox: SHOP, now: () => NOW });
}

beforeEach(() => {
  store = new MemoryStore();
});

describe('syncInbox', () => {
  it('first run only records cursors at the highest UID', async () => {
    const report = await run({
      INBOX: { uidValidity: 1, messages: [incoming(7, { id: 'a@x' })] },
      Sent: { uidValidity: 4, messages: [] },
    });
    expect(report.imported).toBe(0);
    expect(store.cursors.get('inbox')).toMatchObject({ folderName: 'INBOX', uidValidity: 1, lastUid: 7 });
    expect(store.cursors.get('sent')).toMatchObject({ folderName: 'Sent', uidValidity: 4, lastUid: 0 });
  });

  it('creates a categorised, customer-linked thread for a new inbound message', async () => {
    primeCursors();
    store.rules = [{ id: 'r', position: 0, field: 'subject', match_type: 'contains', value: 'quote', action: 'inquiry', enabled: true }];
    store.customers.set('jane@example.com', 'cust-1');
    await run({ INBOX: { uidValidity: 1, messages: [incoming(1, { id: 'a@x' })] }, Sent: { uidValidity: 1, messages: [] } });
    expect(store.threads).toHaveLength(1);
    expect(store.threads[0]).toMatchObject({
      counterpartAddress: 'jane@example.com',
      counterpartName: 'Jane Doe',
      category: 'inquiry',
      customerId: 'cust-1',
      normalizedSubject: 'quote for kitchen',
    });
    expect(store.cursors.get('inbox')).toMatchObject({ lastUid: 1, error: null });
  });

  it('puts a Sent reply in the same thread as out, ordered by date across folders', async () => {
    primeCursors();
    await run({
      INBOX: { uidValidity: 1, messages: [incoming(1, { id: 'a@x' })] },
      Sent: { uidValidity: 1, messages: [outgoing(1, { id: 'b@x', inReplyTo: 'a@x' })] },
    });
    expect(store.threads).toHaveLength(1);
    const msgs = store.messagesOf(store.threads[0].id);
    expect(msgs.map((m) => [m.direction, m.replyText])).toEqual([
      ['in', 'Hello, can I get a quote?'],
      ['out', 'Sure, Tuesday works.'],
    ]);
    expect(store.threads[0].lastDirection).toBe('out');
  });

  it('adds one notification per stored incoming email, none for replies or duplicates', async () => {
    primeCursors();
    const self = { id: 'dup@x', subject: 'Twice' };
    await run({
      INBOX: { uidValidity: 1, messages: [incoming(1, { id: 'a@x' }), incoming(2, self)] },
      Sent: { uidValidity: 1, messages: [outgoing(1, { id: 'b@x', inReplyTo: 'a@x' }), incoming(2, self)] },
    });
    expect(store.notifications).toEqual([
      { threadId: store.threads[0].id, senderName: 'Jane Doe', subject: 'Quote for kitchen' },
      { threadId: store.threads[1].id, senderName: 'Jane Doe', subject: 'Twice' },
    ]);
  });

  it('notifies nothing for an ignored conversation', async () => {
    primeCursors();
    store.rules = [{ id: 'r', position: 0, field: 'domain', match_type: 'equals', value: 'example.com', action: 'ignore', enabled: true }];
    await run({ INBOX: { uidValidity: 1, messages: [incoming(1, { id: 'a@x' })] }, Sent: { uidValidity: 1, messages: [] } });
    expect(store.notifications).toEqual([]);
  });

  it('reopens a handled thread on an incoming reply but not on an outgoing one', async () => {
    primeCursors();
    const inbox: RawMessage[] = [incoming(1, { id: 'a@x' })];
    const sent: RawMessage[] = [];
    const folders = { INBOX: { uidValidity: 1, messages: inbox }, Sent: { uidValidity: 1, messages: sent } };
    await run(folders);
    store.threads[0].status = 'handled';

    sent.push(outgoing(1, { id: 'b@x', inReplyTo: 'a@x' }));
    await run(folders);
    expect(store.threads[0].status).toBe('handled');

    inbox.push(incoming(2, { id: 'c@x', inReplyTo: 'b@x', subject: 'Re: Quote for kitchen', date: 'Tue, 21 Oct 2026 09:00:00 -0400' }));
    await run(folders);
    expect(store.threads[0].status).toBe('new');
  });

  it('joins a parent that arrives after its reply (reverse match)', async () => {
    primeCursors();
    const inbox: RawMessage[] = [];
    const sent: RawMessage[] = [outgoing(1, { id: 'b@x', inReplyTo: 'a@x', subject: 'Different subject' })];
    const folders = { INBOX: { uidValidity: 1, messages: inbox }, Sent: { uidValidity: 1, messages: sent } };
    await run(folders);
    inbox.push(incoming(1, { id: 'a@x' }));
    await run(folders);
    expect(store.threads).toHaveLength(1);
    expect(store.messagesOf(store.threads[0].id)).toHaveLength(2);
  });

  it('merges two threads proven to be one conversation', async () => {
    primeCursors();
    const inbox: RawMessage[] = [
      incoming(1, { id: 'a@x', subject: 'One' }),
      incoming(2, { id: 'b@x', subject: 'Two', date: 'Mon, 20 Oct 2026 10:30:00 -0400' }),
    ];
    const folders = { INBOX: { uidValidity: 1, messages: inbox }, Sent: { uidValidity: 1, messages: [] } };
    await run(folders);
    expect(store.threads).toHaveLength(2);
    inbox.push(incoming(3, { id: 'c@x', subject: 'Re: One', references: '<a@x> <b@x>', date: 'Mon, 20 Oct 2026 12:00:00 -0400' }));
    await run(folders);
    expect(store.threads.map((t) => t.id)).toEqual(['t1']);
    expect(store.messagesOf('t1')).toHaveLength(3);
  });

  it('falls back to subject + counterpart within 60 days only', async () => {
    primeCursors();
    const inbox: RawMessage[] = [incoming(1, { id: 'a@x', date: 'Mon, 20 Oct 2026 10:00:00 -0400' })];
    const folders = { INBOX: { uidValidity: 1, messages: inbox }, Sent: { uidValidity: 1, messages: [] } };
    await run(folders);
    inbox.push(incoming(2, { id: 'b@x', subject: 'RE: Quote for kitchen', date: 'Tue, 21 Oct 2026 08:00:00 -0400' }));
    await run(folders);
    expect(store.threads).toHaveLength(1);

    store.threads[0].lastMessageAt = '2026-06-01T00:00:00.000Z';
    inbox.push(incoming(3, { id: 'c@x', subject: 'Re: Quote for kitchen', date: 'Tue, 21 Oct 2026 09:00:00 -0400' }));
    await run(folders);
    expect(store.threads).toHaveLength(2);
  });

  it('stores nothing for an ignored conversation but advances the cursor', async () => {
    primeCursors();
    store.rules = [{ id: 'r', position: 0, field: 'domain', match_type: 'equals', value: 'example.com', action: 'ignore', enabled: true }];
    const report = await run({ INBOX: { uidValidity: 1, messages: [incoming(1, { id: 'a@x' })] }, Sent: { uidValidity: 1, messages: [] } });
    expect(report.ignored).toBe(1);
    expect(store.threads).toHaveLength(0);
    expect(store.cursors.get('inbox')?.lastUid).toBe(1);
  });

  it('stores a message seen in both folders once', async () => {
    primeCursors();
    const self = { id: 'self@x', from: `Blinds Nisa <${SHOP}>`, to: SHOP, subject: 'Note' };
    const report = await run({
      INBOX: { uidValidity: 1, messages: [incoming(1, self)] },
      Sent: { uidValidity: 1, messages: [incoming(1, self)] },
    });
    expect(store.messages).toHaveLength(1);
    expect(store.messages[0].direction).toBe('out');
    expect(report.duplicates).toBe(1);
  });

  it('takes at most 50 messages per folder per run', async () => {
    primeCursors();
    const many = Array.from({ length: 60 }, (_, i) => incoming(i + 1, { id: `m${i}@x`, subject: `S${i}` }));
    await run({ INBOX: { uidValidity: 1, messages: many }, Sent: { uidValidity: 1, messages: [] } });
    expect(store.messages).toHaveLength(FETCH_LIMIT_PER_FOLDER);
    expect(store.cursors.get('inbox')?.lastUid).toBe(50);
  });

  it('resets the cursor without importing when UIDVALIDITY changes', async () => {
    primeCursors();
    await run({ INBOX: { uidValidity: 2, messages: [incoming(9, { id: 'a@x' })] }, Sent: { uidValidity: 1, messages: [] } });
    expect(store.messages).toHaveLength(0);
    expect(store.cursors.get('inbox')).toMatchObject({ uidValidity: 2, lastUid: 9 });
  });

  it('still syncs INBOX when there is no Sent folder', async () => {
    primeCursors();
    const report = await run({ INBOX: { uidValidity: 1, messages: [incoming(1, { id: 'a@x' })] } }, null);
    expect(store.messages).toHaveLength(1);
    expect(store.errors[0][0]).toBe('sent');
    expect(report.errors).toHaveLength(1);
  });

  it('holds the cursor before a message the store failed to save', async () => {
    primeCursors();
    store.failInsertFor.add('b@x');
    const report = await run({
      INBOX: {
        uidValidity: 1,
        messages: [
          incoming(1, { id: 'a@x', subject: 'A' }),
          incoming(2, { id: 'b@x', subject: 'B', date: 'Mon, 20 Oct 2026 10:10:00 -0400' }),
          incoming(3, { id: 'c@x', subject: 'C', date: 'Mon, 20 Oct 2026 10:20:00 -0400' }),
        ],
      },
      Sent: { uidValidity: 1, messages: [] },
    });
    expect(report.failed).toBe(1);
    expect(store.cursors.get('inbox')).toMatchObject({ lastUid: 1 });
    expect(store.cursors.get('inbox')?.error).toContain('UID 2');
  });

  it('stores an unreadable message as a placeholder bubble', async () => {
    primeCursors();
    await syncInbox({
      source: fakeSource({ INBOX: { uidValidity: 1, messages: [{ uid: 1, raw: new Uint8Array([1]) }] }, Sent: { uidValidity: 1, messages: [] } }),
      store,
      mailbox: SHOP,
      now: () => NOW,
      parse: async () => {
        throw new Error('bad mime');
      },
    });
    expect(store.messages[0]).toMatchObject({ messageId: 'uid:inbox:1:1', replyText: UNREADABLE_TEXT });
    expect(store.threads[0].category).toBe('other');
  });
});
