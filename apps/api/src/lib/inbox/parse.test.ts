// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins MIME parsing into the sync's ParsedMessage: ids without brackets,
 * References split and capped, lower-cased addresses, Date fallback,
 * HTML-only bodies converted with quote markers, attachment metadata,
 * and the 200 000-character text cap.
 */

import { describe, expect, it } from 'vitest';
import { MAX_TEXT_CHARS, normalizeMessageId, parseMessage, parseReferences } from './parse';
import { eml } from './testEml';

const RECEIVED = new Date('2026-10-21T12:00:00Z');

describe('parseMessage', () => {
  it('reads headers and the text body', async () => {
    const msg = await parseMessage(
      eml({
        from: 'Jane Doe <Jane@Example.com>',
        to: 'Blinds Nisa <info@blindsnisa.com>',
        cc: 'bob@example.com',
        subject: 'Re: Quote',
        date: 'Mon, 20 Oct 2026 10:00:00 -0400',
        id: 'abc@mail.example.com',
        inReplyTo: 'orig@blindsnisa.com',
        references: '<root@blindsnisa.com> <orig@blindsnisa.com>',
        body: 'Sounds good.\n',
      }),
      RECEIVED
    );
    expect(msg).toMatchObject({
      messageId: 'abc@mail.example.com',
      inReplyTo: 'orig@blindsnisa.com',
      references: ['root@blindsnisa.com', 'orig@blindsnisa.com'],
      sentAt: '2026-10-20T14:00:00.000Z',
      from: { address: 'jane@example.com', name: 'Jane Doe' },
      to: [{ address: 'info@blindsnisa.com', name: 'Blinds Nisa' }],
      cc: [{ address: 'bob@example.com', name: '' }],
      subject: 'Re: Quote',
      attachments: [],
    });
    expect(msg.textBody.trim()).toBe('Sounds good.');
  });

  it('falls back to the receive time and null ids', async () => {
    const msg = await parseMessage(
      eml({ from: 'a@x.com', to: 'info@blindsnisa.com', subject: 'Hi', date: 'not a date', body: 'x' }),
      RECEIVED
    );
    expect(msg.sentAt).toBe(RECEIVED.toISOString());
    expect(msg.messageId).toBeNull();
    expect(msg.inReplyTo).toBeNull();
    expect(msg.references).toEqual([]);
  });

  it('converts an HTML-only body with quote markers', async () => {
    const msg = await parseMessage(
      eml({
        from: 'a@x.com',
        to: 'info@blindsnisa.com',
        subject: 'Hi',
        date: 'Mon, 20 Oct 2026 10:00:00 -0400',
        contentType: 'text/html',
        body: '<div>Yes</div><blockquote>old</blockquote>',
      }),
      RECEIVED
    );
    expect(msg.textBody).toBe('Yes\n\n> old');
  });

  it('caps the text body', async () => {
    const msg = await parseMessage(
      eml({ from: 'a@x.com', to: 'b@x.com', subject: 'Big', date: 'Mon, 20 Oct 2026 10:00:00 -0400', body: 'a'.repeat(MAX_TEXT_CHARS + 500) }),
      RECEIVED
    );
    expect(msg.textBody.length).toBe(MAX_TEXT_CHARS);
  });

  it('lists attachment names and sizes', async () => {
    const raw = new TextEncoder().encode(
      [
        'From: a@x.com',
        'To: info@blindsnisa.com',
        'Subject: Photo',
        'Date: Mon, 20 Oct 2026 10:00:00 -0400',
        'MIME-Version: 1.0',
        'Content-Type: multipart/mixed; boundary="b1"',
        '',
        '--b1',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'See attached.',
        '--b1',
        'Content-Type: image/png; name="window.png"',
        'Content-Disposition: attachment; filename="window.png"',
        'Content-Transfer-Encoding: base64',
        '',
        'iVBORw0KGgo=',
        '--b1--',
        '',
      ].join('\r\n')
    );
    const msg = await parseMessage(raw, RECEIVED);
    expect(msg.attachments).toEqual([{ filename: 'window.png', mime_type: 'image/png', size: 8 }]);
    expect(msg.textBody.trim()).toBe('See attached.');
  });
});

describe('normalizeMessageId / parseReferences', () => {
  it('strips angle brackets and rejects whitespace ids', () => {
    expect(normalizeMessageId('<a@b>')).toBe('a@b');
    expect(normalizeMessageId(' a@b ')).toBe('a@b');
    expect(normalizeMessageId('a b')).toBeNull();
    expect(normalizeMessageId(undefined)).toBeNull();
  });

  it('dedupes and keeps the last 20 references', () => {
    const many = Array.from({ length: 25 }, (_, i) => `<r${i}@x>`).join(' ');
    const refs = parseReferences(`${many} <r24@x>`);
    expect(refs).toHaveLength(20);
    expect(refs[0]).toBe('r5@x');
    expect(refs[19]).toBe('r24@x');
  });
});
