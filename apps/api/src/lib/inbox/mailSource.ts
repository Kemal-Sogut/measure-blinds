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
 * Sized for the Workers FREE plan, where a cron run gets 10 ms of CPU
 * (network waits don't count, parsing does — measured ~0.6 ms for a plain
 * email, ~7 ms per MB of raw message). So each message is fetched one at a
 * time and only its first {@link MAX_MESSAGE_BYTES} are read (headers and
 * body text come first in practice; only the attachment list of a larger
 * message can be incomplete — the files stay in Titan anyway), and a run
 * stops fetching once {@link RUN_BYTE_BUDGET} bytes are in hand. Whatever
 * is left is picked up by the next run a minute later.
 */

import type { ImapClient, MailboxListing } from './imapClient';
import type { FolderCursor, FolderRead, MailSource, RawMessage } from './types';

/** Per-message fetch cap: the first 256 KB of the raw source (~2 ms to parse). */
export const MAX_MESSAGE_BYTES = 262_144;

/** Stop fetching more messages in one run once this many bytes were read. */
export const RUN_BYTE_BUDGET = 2 * MAX_MESSAGE_BYTES;

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
      let bytes = 0;
      for (const uid of uids) {
        const raw = await imap.uidFetchRaw(uid, MAX_MESSAGE_BYTES);
        read.scannedThroughUid = uid;
        if (raw) {
          messages.push({ uid, raw });
          bytes += raw.length;
        }
        if (bytes >= RUN_BYTE_BUDGET) break;
      }
      read.messages = messages;
      return read;
    },

    async close() {
      await imap.logout();
      await closeTransport().catch(() => undefined);
    },
  };
}
