// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * When the Titan inbox sync runs.
 *
 * Cloudflare cron can't express "every minute in Toronto business hours,
 * every 10 minutes otherwise" (crons are UTC and Toronto shifts with
 * daylight saving), so the Worker gets a plain every-minute cron and this
 * pure function decides per tick: every minute from 08:00 to 21:59
 * America/Toronto, every 10th minute outside that. A skipped tick costs
 * one near-zero-CPU invocation (Free plan: 100k requests/day; this uses
 * 1,440). Kept free of `cloudflare:sockets` so it is unit-testable.
 */

/** The Worker cron that drives the sync; must match wrangler.toml. */
export const INBOX_SYNC_CRON = '* * * * *';

/** Business-hours window in shop-local time: [start, end) hours. */
const BUSY_START_HOUR = 8;
const BUSY_END_HOUR = 22;

/** Outside business hours, sync only on minutes divisible by this. */
const QUIET_INTERVAL_MINUTES = 10;

const SHOP_CLOCK = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Toronto',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
});

/** True when the cron tick at `at` (its scheduled time) should run a sync. */
export function isInboxSyncDue(at: Date): boolean {
  const parts = SHOP_CLOCK.formatToParts(at);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value);
  if (hour >= BUSY_START_HOUR && hour < BUSY_END_HOUR) return true;
  return minute % QUIET_INTERVAL_MINUTES === 0;
}
