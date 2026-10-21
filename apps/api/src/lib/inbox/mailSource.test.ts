// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins how the mail source picks the Sent folder and how it reads a
 * folder against a cursor: no fetch on first run or after a UIDVALIDITY
 * change, only UIDs above the cursor, the per-run limit, and the IMAP
 * quirk where `UID n:*` returns the last message even when n is past it.
 */

import { describe, expect, it } from 'vitest';
import { createMailSource, pickSentFolder, type ImapCommands } from './mailSource';

/** In-memory stand-in for the IMAP commands the source uses. */
function fakeImap(uidValidity: number, uids: number[]) {
  const fetched: number[] = [];
  const imap: ImapCommands = {
    async list() {
      return [];
    },
    async examine() {
      return { uidValidity, exists: uids.length };
    },
    async uidSearch(criteria: string) {
      if (criteria === 'UID *') return uids.length ? [Math.max(...uids)] : [];
      const from = Number(/^UID (\d+):\*$/.exec(criteria)![1]);
      const hits = uids.filter((u) => u >= from);
      // Real servers answer "n:*" with the last message when n is past it.
      return hits.length ? hits : uids.length ? [Math.max(...uids)] : [];
    },
    async uidFetchRaw(uid: number) {
      fetched.push(uid);
      return uid === 13 ? null : new TextEncoder().encode(`message ${uid}`);
    },
    async logout() {},
  };
  return { imap, fetched };
}

describe('pickSentFolder', () => {
  it('prefers the \\Sent flag', () => {
    expect(
      pickSentFolder([
        { name: 'Sent', flags: [] },
        { name: 'Sent Items', flags: ['\\Sent'] },
      ])
    ).toBe('Sent Items');
  });

  it('falls back to a known name, case-insensitively', () => {
    expect(pickSentFolder([{ name: 'INBOX', flags: [] }, { name: 'SENT', flags: [] }])).toBe('SENT');
    expect(pickSentFolder([{ name: 'INBOX.Sent', flags: [] }])).toBe('INBOX.Sent');
  });

  it('returns null when nothing matches', () => {
    expect(pickSentFolder([{ name: 'INBOX', flags: [] }])).toBeNull();
  });
});

describe('readFolder', () => {
  it('fetches nothing on the first run (no cursor)', async () => {
    const { imap, fetched } = fakeImap(7, [3, 5, 9]);
    const read = await createMailSource(imap, async () => {}).readFolder('INBOX', null, 50);
    expect(read).toEqual({ uidValidity: 7, highestUid: 9, scannedThroughUid: null, messages: [] });
    expect(fetched).toEqual([]);
  });

  it('fetches nothing when UIDVALIDITY changed', async () => {
    const { imap, fetched } = fakeImap(8, [3, 5, 9]);
    const read = await createMailSource(imap, async () => {}).readFolder('INBOX', { uidValidity: 7, afterUid: 3 }, 50);
    expect(read.messages).toEqual([]);
    expect(read.uidValidity).toBe(8);
    expect(fetched).toEqual([]);
  });

  it('fetches only UIDs above the cursor, up to the limit', async () => {
    const { imap, fetched } = fakeImap(7, [3, 5, 9, 11, 12]);
    const read = await createMailSource(imap, async () => {}).readFolder('INBOX', { uidValidity: 7, afterUid: 3 }, 3);
    expect(fetched).toEqual([5, 9, 11]);
    expect(read.messages.map((m) => m.uid)).toEqual([5, 9, 11]);
    expect(read.scannedThroughUid).toBe(11);
  });

  it('ignores the n:* quirk when nothing is new', async () => {
    const { imap, fetched } = fakeImap(7, [3, 5]);
    const read = await createMailSource(imap, async () => {}).readFolder('INBOX', { uidValidity: 7, afterUid: 5 }, 50);
    expect(fetched).toEqual([]);
    expect(read).toMatchObject({ highestUid: 5, scannedThroughUid: null, messages: [] });
  });

  it('skips a message that vanished but still scans past it', async () => {
    const { imap } = fakeImap(7, [12, 13]);
    const read = await createMailSource(imap, async () => {}).readFolder('INBOX', { uidValidity: 7, afterUid: 11 }, 50);
    expect(read.messages.map((m) => m.uid)).toEqual([12]);
    expect(read.scannedThroughUid).toBe(13);
  });

  it('reports highestUid 0 for an empty folder', async () => {
    const { imap } = fakeImap(7, []);
    const read = await createMailSource(imap, async () => {}).readFolder('Sent', null, 50);
    expect(read.highestUid).toBe(0);
  });
});
