// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins when the every-minute cron actually syncs: every minute from
 * 08:00 to 21:59 Toronto time, every 10th minute otherwise — in both
 * daylight time (UTC−4) and standard time (UTC−5).
 */

import { describe, expect, it } from 'vitest';
import { INBOX_SYNC_CRON, isInboxSyncDue } from './schedule';

const at = (iso: string) => new Date(iso);

describe('isInboxSyncDue', () => {
  it('runs on a one-minute cron', () => {
    expect(INBOX_SYNC_CRON).toBe('* * * * *');
  });

  it('syncs every minute during business hours (EDT)', () => {
    expect(isInboxSyncDue(at('2026-10-21T12:00:00Z'))).toBe(true); // 08:00
    expect(isInboxSyncDue(at('2026-10-21T17:47:00Z'))).toBe(true); // 13:47
    expect(isInboxSyncDue(at('2026-10-22T01:59:00Z'))).toBe(true); // 21:59
  });

  it('syncs every 10th minute outside business hours (EDT)', () => {
    expect(isInboxSyncDue(at('2026-10-21T11:59:00Z'))).toBe(false); // 07:59
    expect(isInboxSyncDue(at('2026-10-21T11:50:00Z'))).toBe(true); // 07:50
    expect(isInboxSyncDue(at('2026-10-22T02:00:00Z'))).toBe(true); // 22:00
    expect(isInboxSyncDue(at('2026-10-22T02:01:00Z'))).toBe(false); // 22:01
    expect(isInboxSyncDue(at('2026-10-22T07:30:00Z'))).toBe(true); // 03:30
  });

  it('follows standard time in winter (EST)', () => {
    expect(isInboxSyncDue(at('2026-12-15T12:31:00Z'))).toBe(false); // 07:31
    expect(isInboxSyncDue(at('2026-12-15T13:01:00Z'))).toBe(true); // 08:01
    expect(isInboxSyncDue(at('2026-12-16T02:59:00Z'))).toBe(true); // 21:59
    expect(isInboxSyncDue(at('2026-12-16T03:01:00Z'))).toBe(false); // 22:01
  });
});
