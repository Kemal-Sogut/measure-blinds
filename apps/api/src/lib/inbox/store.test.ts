// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins the Supabase store's few non-trivial mappings: ILIKE escaping for
 * customer email matching, "exactly one customer" linking, and a 23505
 * unique violation on insert reported as a duplicate instead of thrown.
 */

import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseInboxStore, escapeLikeValue, type NewMessage } from './store';

/** Chainable fake whose terminal await resolves to `result`. Records calls. */
function fakeSb(result: { data?: unknown; error?: unknown }) {
  const calls: Array<[string, unknown[]]> = [];
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'insert', 'eq', 'ilike', 'is', 'limit']) {
    builder[m] = (...args: unknown[]) => {
      calls.push([m, args]);
      return builder;
    };
  }
  builder.then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
    Promise.resolve({ data: result.data ?? null, error: result.error ?? null }).then(onF, onR);
  const sb = { from: (table: string) => (calls.push(['from', [table]]), builder) } as unknown as SupabaseClient;
  return { sb, calls };
}

const message: NewMessage = {
  threadId: 't1', messageId: 'm1', inReplyTo: null, referenceIds: [], direction: 'in', folder: 'inbox',
  imapUid: 1, uidValidity: 1, sentAt: '2026-10-21T00:00:00Z', fromAddress: 'a@x.com', fromName: '',
  toAddresses: [], ccAddresses: [], subject: '', textBody: '', replyText: '', attachments: [],
};

describe('escapeLikeValue', () => {
  it('escapes LIKE wildcards and refuses PostgREST *', () => {
    expect(escapeLikeValue('first_last%@x.com')).toBe('first\\_last\\%@x.com');
    expect(escapeLikeValue('a*b@x.com')).toBeNull();
  });
});

describe('customerIdByEmail', () => {
  it('links exactly one live customer', async () => {
    const { sb, calls } = fakeSb({ data: [{ id: 'c1' }] });
    expect(await createSupabaseInboxStore(sb).customerIdByEmail('jane@example.com')).toBe('c1');
    expect(calls).toContainEqual(['is', ['deleted_at', null]]);
    expect(calls).toContainEqual(['ilike', ['email', 'jane@example.com']]);
  });

  it('links nothing when two customers share the address', async () => {
    const { sb } = fakeSb({ data: [{ id: 'c1' }, { id: 'c2' }] });
    expect(await createSupabaseInboxStore(sb).customerIdByEmail('jane@example.com')).toBeNull();
  });
});

describe('insertMessage', () => {
  it('maps a unique violation to duplicate', async () => {
    const { sb } = fakeSb({ error: { code: '23505', message: 'duplicate key' } });
    expect(await createSupabaseInboxStore(sb).insertMessage(message)).toBe('duplicate');
  });

  it('throws other errors', async () => {
    const { sb } = fakeSb({ error: { code: '500', message: 'boom' } });
    await expect(createSupabaseInboxStore(sb).insertMessage(message)).rejects.toThrow('boom');
  });
});
