// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Shared types for the Titan inbox sync (`lib/inbox/*`). Kept in one
 * dependency-free module so the IMAP layer, the parser, the threading
 * and rule logic, the store and the sync orchestration can all agree on
 * shapes without importing each other.
 */

/**
 * Which Titan folder a message was read from. Also the primary key of
 * `email_sync_state` (one IMAP cursor per folder role).
 */
export type InboxFolder = 'inbox' | 'sent';

/**
 * `in` = written by the other party (left bubble); `out` = written by the
 * shop mailbox (right bubble). Decided by `threading.directionOf`.
 */
export type EmailDirection = 'in' | 'out';

/**
 * The fixed conversation categories, in Inbox tab order. Mirrors the
 * `email_threads.category` CHECK constraint in migration 45.
 */
export const EMAIL_CATEGORIES = ['inquiry', 'supplier', 'payment', 'other'] as const;

/** One of {@link EMAIL_CATEGORIES}. */
export type EmailCategory = (typeof EMAIL_CATEGORIES)[number];

/** One email address with its display name; `address` is lower-cased, `name` may be ''. */
export interface Mailbox {
  address: string;
  name: string;
}

/**
 * Attachment metadata as stored in `email_messages.attachments` (jsonb).
 * The file itself is never stored; staff open Titan for it.
 */
export interface AttachmentMeta {
  filename: string;
  mime_type: string;
  size: number;
}

/**
 * A message after MIME parsing (`parse.parseMessage`). `textBody` is the
 * full plain text (from the text part, or converted from HTML), capped at
 * 200 000 characters. Ids are stored without angle brackets.
 */
export interface ParsedMessage {
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  /** ISO 8601 UTC; the Date header, or the fetch time when it is missing/invalid. */
  sentAt: string;
  from: Mailbox;
  to: Mailbox[];
  cc: Mailbox[];
  subject: string;
  textBody: string;
  attachments: AttachmentMeta[];
}

/** One message as fetched from IMAP: its UID and raw RFC 5322 bytes. */
export interface RawMessage {
  uid: number;
  raw: Uint8Array;
}

/**
 * The stored position in one folder: the folder's UIDVALIDITY when the
 * cursor was saved, and the last UID already handled.
 */
export interface FolderCursor {
  uidValidity: number;
  afterUid: number;
}

/**
 * Result of reading one folder. `messages` is empty unless a usable
 * cursor with a matching UIDVALIDITY was passed. `scannedThroughUid` is
 * the highest UID the read looked at (fetched or vanished), or null when
 * nothing was scanned; the sync advances its cursor to it.
 */
export interface FolderRead {
  uidValidity: number;
  highestUid: number;
  scannedThroughUid: number | null;
  messages: RawMessage[];
}

/**
 * The mailbox as the sync sees it. Implemented over IMAP by
 * `mailSource.createMailSource`, and by in-memory fakes in tests.
 */
export interface MailSource {
  /** The Sent folder's name, or null when the server has none we recognise. */
  findSentFolder(): Promise<string | null>;
  /**
   * Opens `folderName` read-only and returns up to `limit` messages with a
   * UID above `cursor.afterUid`, in ascending UID order. With a null cursor
   * or a UIDVALIDITY mismatch it fetches nothing and only reports the
   * folder's current UIDVALIDITY and highest UID.
   */
  readFolder(folderName: string, cursor: FolderCursor | null, limit: number): Promise<FolderRead>;
  /** Logs out and closes the connection. Never throws. */
  close(): Promise<void>;
}
