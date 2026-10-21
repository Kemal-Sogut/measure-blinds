// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Locks the Inbox's pure display rules: URL params ↔ tab state, row
 * titles and "You:" snippets, list timestamps, link detection in bubble
 * text, the hidden-history split behind "···", sender labels, byte
 * sizes, rule sentences, sync status lines and rule reordering.
 */

import { describe, expect, it } from 'vitest';
import {
  describeRule,
  formatBytes,
  formatThreadTime,
  hiddenHistory,
  inboxParamsToSearch,
  linkify,
  moveId,
  parseInboxParams,
  senderLabel,
  snippetLine,
  syncStatusLine,
  threadTitle,
} from './inboxText';

describe('parseInboxParams / inboxParamsToSearch', () => {
  it('defaults to All / New / page 1', () => {
    expect(parseInboxParams(new URLSearchParams())).toEqual({ category: 'all', status: 'new', page: 1 });
  });

  it('ignores unknown values', () => {
    expect(parseInboxParams(new URLSearchParams('category=spam&status=x&page=-2'))).toEqual({
      category: 'all',
      status: 'new',
      page: 1,
    });
  });

  it('round-trips and omits defaults', () => {
    const p = { category: 'supplier' as const, status: 'handled' as const, page: 3 };
    expect(parseInboxParams(new URLSearchParams(inboxParamsToSearch(p)))).toEqual(p);
    expect(inboxParamsToSearch({ category: 'all', status: 'new', page: 1 })).toEqual({});
    expect(inboxParamsToSearch({ category: 'inquiry', status: 'new', page: 1 })).toEqual({ category: 'inquiry' });
  });
});

describe('threadTitle / snippetLine', () => {
  it('prefers the name, then the address', () => {
    expect(threadTitle({ counterpart_name: 'Jane', counterpart_address: 'j@x.com' })).toBe('Jane');
    expect(threadTitle({ counterpart_name: '', counterpart_address: 'j@x.com' })).toBe('j@x.com');
    expect(threadTitle({ counterpart_name: '', counterpart_address: '' })).toBe('Unknown sender');
  });

  it('prefixes our own last message with "You:"', () => {
    expect(snippetLine({ last_direction: 'out', last_snippet: 'Tuesday works' })).toBe('You: Tuesday works');
    expect(snippetLine({ last_direction: 'in', last_snippet: 'Hi' })).toBe('Hi');
  });
});

describe('formatThreadTime', () => {
  const now = new Date(2026, 9, 21, 15, 0);
  it('shows the time today, the date this year, the full date otherwise', () => {
    expect(formatThreadTime(new Date(2026, 9, 21, 9, 5).toISOString(), now)).toBe('9:05 AM');
    expect(formatThreadTime(new Date(2026, 2, 4, 9, 5).toISOString(), now)).toBe('Mar 4');
    expect(formatThreadTime(new Date(2025, 2, 4, 9, 5).toISOString(), now)).toBe('Mar 4, 2025');
  });
});

describe('linkify', () => {
  it('splits URLs out and leaves trailing punctuation as text', () => {
    expect(linkify('See https://blindsnisa.com/a?b=1. Thanks')).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'link', text: 'https://blindsnisa.com/a?b=1', href: 'https://blindsnisa.com/a?b=1' },
      { kind: 'text', text: '. Thanks' },
    ]);
  });

  it('does not link javascript: or bare text', () => {
    expect(linkify('javascript:alert(1) and www.x.com')).toEqual([{ kind: 'text', text: 'javascript:alert(1) and www.x.com' }]);
  });
});

describe('hiddenHistory', () => {
  it('returns what was trimmed after the reply', () => {
    expect(hiddenHistory({ reply_text: 'Yes', text_body: 'Yes\n\nOn Mon … wrote:\n> old' })).toBe('On Mon … wrote:\n> old');
  });

  it('returns null when nothing was trimmed', () => {
    expect(hiddenHistory({ reply_text: 'Yes', text_body: 'Yes\n' })).toBeNull();
  });

  it('returns the whole body when the reply is not its prefix', () => {
    expect(hiddenHistory({ reply_text: '(unreadable)', text_body: '' })).toBeNull();
    expect(hiddenHistory({ reply_text: 'B', text_body: 'A B' })).toBe('A B');
  });
});

describe('senderLabel / formatBytes / describeRule / moveId', () => {
  it('labels senders', () => {
    expect(senderLabel({ direction: 'out', from_name: 'Blinds Nisa', from_address: 'info@blindsnisa.com' })).toBe('You');
    expect(senderLabel({ direction: 'in', from_name: '', from_address: 'j@x.com' })).toBe('j@x.com');
  });

  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3_500_000)).toBe('3.3 MB');
  });

  it('describes a rule as a sentence', () => {
    expect(describeRule({ field: 'domain', match_type: 'ends_with', value: 'acme.com', action: 'supplier' })).toBe(
      'Email domain ends with “acme.com” → Supplier'
    );
  });

  it('moves an id up or down and ignores out-of-range moves', () => {
    expect(moveId(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moveId(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
  });
});

describe('syncStatusLine', () => {
  const now = new Date('2026-10-21T12:00:00Z');
  it('shows the error first, then the last success, then never', () => {
    expect(syncStatusLine({ folder: 'inbox', folder_name: 'INBOX', last_run_at: null, last_success_at: null, last_error: 'AUTHENTICATE failed' }, now)).toBe(
      'Inbox: error — AUTHENTICATE failed'
    );
    expect(syncStatusLine({ folder: 'sent', folder_name: 'Sent', last_run_at: null, last_success_at: '2026-10-21T11:57:00Z', last_error: null }, now)).toBe(
      'Sent: last synced 3 minutes ago'
    );
    expect(syncStatusLine({ folder: 'inbox', folder_name: '', last_run_at: null, last_success_at: null, last_error: null }, now)).toBe(
      'Inbox: not synced yet'
    );
  });
});
