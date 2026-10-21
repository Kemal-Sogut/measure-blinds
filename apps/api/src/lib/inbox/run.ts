// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Cron entry for the Titan inbox sync. `index.ts` runs it on the
 * every-minute cron when `schedule.isInboxSyncDue` says so (every minute
 * 08:00–22:00 Toronto, every 10 minutes otherwise). Wires the real pieces — the TLS
 * socket to Titan, the Supabase store — around `syncInbox`.
 *
 * Skips quietly (one log line) until TITAN_IMAP_USER and
 * TITAN_IMAP_PASSWORD are set, so deploying the code before the secrets
 * is harmless. A run is capped at 50 seconds so a stalled server cannot
 * overlap runs; on any connection-level failure the error is
 * written to both folders' sync state (shown in Settings) and the
 * cursors stay where they were. Never logs the password: IMAP errors
 * carry only the command verb.
 */

import { createSupabaseAdmin } from '../supabase';
import { createSupabaseInboxStore } from './store';
import { syncInbox } from './sync';
import { openTitanSource } from './titanConnect';
import type { Env } from '../../index';
import type { MailSource } from './types';

/**
 * Hard cap for one run: under the one-minute cron interval, so runs never
 * pile up (an overlap would be harmless anyway — message ids are UNIQUE).
 */
const SYNC_TIMEOUT_MS = 50 * 1000;

/** Runs one inbox sync with production wiring. Never throws. */
export async function runInboxSync(env: Env): Promise<void> {
  const user = env.TITAN_IMAP_USER?.trim();
  const password = env.TITAN_IMAP_PASSWORD;
  if (!user || !password) {
    console.log('Inbox sync skipped: TITAN_IMAP_USER / TITAN_IMAP_PASSWORD are not set.');
    return;
  }

  const store = createSupabaseInboxStore(createSupabaseAdmin(env));
  let source: MailSource | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const work = (async () => {
      source = await openTitanSource({
        host: env.TITAN_IMAP_HOST || 'imap.titan.email',
        port: Number(env.TITAN_IMAP_PORT || 993),
        user,
        password,
      });
      return syncInbox({ source, store, mailbox: user, now: () => new Date() });
    })();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Inbox sync timed out after 50 seconds')), SYNC_TIMEOUT_MS);
    });
    const report = await Promise.race([work, timeout]);
    console.log(
      `Inbox sync: ${report.imported} imported, ${report.ignored} ignored, ` +
        `${report.duplicates} duplicate(s), ${report.failed} failed`
    );
    for (const problem of report.errors) console.warn(`Inbox sync: ${problem}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Inbox sync failed: ${message}`);
    await Promise.allSettled([store.recordError('inbox', message), store.recordError('sent', message)]);
  } finally {
    clearTimeout(timer);
    // Assigned inside the closure above, which TS's flow analysis can't see.
    await (source as MailSource | null)?.close().catch(() => undefined);
  }
}
