// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * The sync's view of the Titan mailbox, built on the minimal IMAP client.
 *
 * Owns two decisions: which folder is "Sent" (Titan does not advertise
 * SPECIAL-USE before login, so a `\Sent` flag is preferred but common
 * names are the fallback), and how a folder is read against the stored
 * cursor (no fetch unless the cursor's UIDVALIDITY still matches; only
 * UIDs above it; at most `limit` per run).
 *
 * Messages are fetched one at a time and capped at {@link MAX_MESSAGE_BYTES}
 * so a huge attachment cannot exhaust the Worker's memory; headers and
 * body text come first in practice, so only the attachment list of such
 * a message can be incomplete.
 */

import type { ImapClient, MailboxListing } from './imapClient';
import type { FolderCursor, FolderRead, MailSource, RawMessage } from './types';

/** Per-message fetch cap (first 5 MB of the raw source). */
export const MAX_MESSAGE_BYTES = 5_000_000;

/** Folder names tried, in order, when no folder carries the `\Sent` flag. */
const SENT_FOLDER_NAMES = ['sent', 'sent items', 'sent messages', 'sent mail', 'inbox.sent', 'inbox/sent'];

/**
 * The IMAP commands the source needs. A structural subset of
 * {@link ImapClient}, so tests can pass a plain object.
 */
export type ImapCommands = Pick<ImapClient, 'list' | 'examine' | 'uidSearch' | 'uidFetchRaw' | 'logout'>;

/**
 * Chooses the Sent folder: the first mailbox flagged `\Sent`, else the
 * first whose name matches a common Sent name (case-insensitive), else null.
 */
export function pickSentFolder(list: MailboxListing[]): string | null {
  const flagged = list.find((m) => m.flags.some((f) => f.toLowerCase() === '\\sent'));
  if (flagged) return flagged.name;
  for (const candidate of SENT_FOLDER_NAMES) {
    const hit = list.find((m) => m.name.toLowerCase() === candidate);
    if (hit) return hit.name;
  }
  return null;
}

/**
 * Wraps an authenticated IMAP session as a {@link MailSource}.
 * `closeTransport` closes the underlying socket after LOGOUT.
 */
export function createMailSource(
  imap: ImapCommands,
  closeTransport: () => Promise<void>
): MailSource {
  return {
    async findSentFolder() {
      return pickSentFolder(await imap.list());
    },

    async readFolder(folderName: string, cursor: FolderCursor | null, limit: number): Promise<FolderRead> {
      const box = await imap.examine(folderName);
      let highestUid = 0;
      if (box.exists > 0) {
        const last = await imap.uidSearch('UID *');
        highestUid = last.length ? last[last.length - 1] : 0;
      }
      const read: FolderRead = {
        uidValidity: box.uidValidity,
        highestUid,
        scannedThroughUid: null,
        messages: [],
      };
      if (!cursor || cursor.uidValidity !== box.uidValidity || highestUid <= cursor.afterUid) {
        return read;
      }

      const uids = (await imap.uidSearch(`UID ${cursor.afterUid + 1}:*`))
        .filter((uid) => uid > cursor.afterUid)
        .slice(0, limit);
      const messages: RawMessage[] = [];
      for (const uid of uids) {
        const raw = await imap.uidFetchRaw(uid, MAX_MESSAGE_BYTES);
        if (raw) messages.push({ uid, raw });
      }
      read.messages = messages;
      read.scannedThroughUid = uids.length ? uids[uids.length - 1] : null;
      return read;
    },

    async close() {
      await imap.logout();
      await closeTransport().catch(() => undefined);
    },
  };
}
