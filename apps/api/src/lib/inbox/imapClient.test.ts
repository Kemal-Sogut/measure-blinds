// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins the minimal IMAP client against a scripted fake server built from
 * web streams: greeting check, SASL-IR PLAIN auth (and that a failure
 * message never echoes the credentials), LIST/EXAMINE/SEARCH parsing,
 * byte-exact literal reads for FETCH, and CRLF detection across chunk
 * boundaries.
 */

import { describe, expect, it } from 'vitest';
import { ByteReader, ImapClient, ImapError, parseListResponse } from './imapClient';

const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * Fake IMAP server: answers each command line with `respond(tag, command)`.
 * Records every command the client sent.
 */
function fakeServer(respond: (tag: string, command: string) => string, greeting = '* OK IMAP ready\r\n') {
  let push!: (s: string) => void;
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      push = (s) => controller.enqueue(enc.encode(s));
    },
  });
  const sent: string[] = [];
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      const line = dec.decode(chunk).replace(/\r\n$/, '');
      sent.push(line);
      const sp = line.indexOf(' ');
      push(respond(line.slice(0, sp), line.slice(sp + 1)));
    },
  });
  push(greeting);
  return { readable, writable, sent };
}

describe('ImapClient.open', () => {
  it('rejects a server that does not greet with OK', async () => {
    const s = fakeServer(() => '', '* BYE go away\r\n');
    await expect(ImapClient.open(s.readable, s.writable)).rejects.toBeInstanceOf(ImapError);
  });
});

describe('authenticatePlain', () => {
  it('sends SASL-IR PLAIN in one line', async () => {
    const s = fakeServer((tag) => `${tag} OK authenticated\r\n`);
    const client = await ImapClient.open(s.readable, s.writable);
    await client.authenticatePlain('info@blindsnisa.com', 'pässword');
    const b64 = s.sent[0].split(' ')[3];
    const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    expect(s.sent[0].startsWith('a1 AUTHENTICATE PLAIN ')).toBe(true);
    expect(dec.decode(bytes)).toBe('\u0000info@blindsnisa.com\u0000pässword');
  });

  it('fails without leaking the credentials', async () => {
    const s = fakeServer((tag) => `${tag} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n`);
    const client = await ImapClient.open(s.readable, s.writable);
    const err = await client.authenticatePlain('info@blindsnisa.com', 'secret').catch((e: Error) => e);
    expect(err).toBeInstanceOf(ImapError);
    expect((err as Error).message).toContain('AUTHENTICATE failed');
    expect((err as Error).message).not.toContain('secret');
    expect((err as Error).message).not.toContain(btoa('\u0000info@blindsnisa.com\u0000secret'));
  });
});

describe('list / examine / uidSearch', () => {
  it('parses LIST flags and quoted names', async () => {
    const s = fakeServer(
      (tag) =>
        '* LIST (\\HasNoChildren) "/" "INBOX"\r\n' +
        '* LIST (\\HasNoChildren \\Sent) "/" "Sent Items"\r\n' +
        '* LIST (\\HasNoChildren) "." INBOX.Archive\r\n' +
        `${tag} OK LIST completed\r\n`
    );
    const client = await ImapClient.open(s.readable, s.writable);
    expect(await client.list()).toEqual([
      { name: 'INBOX', flags: ['\\HasNoChildren'] },
      { name: 'Sent Items', flags: ['\\HasNoChildren', '\\Sent'] },
      { name: 'INBOX.Archive', flags: ['\\HasNoChildren'] },
    ]);
    expect(s.sent[0]).toBe('a1 LIST "" "*"');
  });

  it('EXAMINEs (never SELECTs) and reads UIDVALIDITY and EXISTS', async () => {
    const s = fakeServer(
      (tag) =>
        '* FLAGS (\\Seen)\r\n* 12 EXISTS\r\n* 0 RECENT\r\n' +
        '* OK [UIDVALIDITY 1700000001] UIDs valid\r\n* OK [UIDNEXT 345] next\r\n' +
        `${tag} OK [READ-ONLY] EXAMINE completed\r\n`
    );
    const client = await ImapClient.open(s.readable, s.writable);
    expect(await client.examine('Sent Items')).toEqual({ uidValidity: 1700000001, exists: 12 });
    expect(s.sent[0]).toBe('a1 EXAMINE "Sent Items"');
  });

  it('returns sorted UIDs from UID SEARCH', async () => {
    const s = fakeServer((tag) => `* SEARCH 9 3 7\r\n${tag} OK SEARCH completed\r\n`);
    const client = await ImapClient.open(s.readable, s.writable);
    expect(await client.uidSearch('UID 3:*')).toEqual([3, 7, 9]);
  });

  it('returns [] for an empty SEARCH', async () => {
    const s = fakeServer((tag) => `* SEARCH\r\n${tag} OK SEARCH completed\r\n`);
    const client = await ImapClient.open(s.readable, s.writable);
    expect(await client.uidSearch('UID 3:*')).toEqual([]);
  });
});

describe('uidFetchRaw', () => {
  it('returns the literal byte-exact, CRLFs included', async () => {
    const body = 'Subject: Hi\r\n\r\nLine one\r\nLine two é\r\n';
    const size = enc.encode(body).length;
    const s = fakeServer(
      (tag) => `* 4 FETCH (UID 42 BODY[]<0> {${size}}\r\n${body})\r\n${tag} OK FETCH completed\r\n`
    );
    const client = await ImapClient.open(s.readable, s.writable);
    const raw = await client.uidFetchRaw(42, 5_000_000);
    expect(dec.decode(raw!)).toBe(body);
    expect(s.sent[0]).toBe('a1 UID FETCH 42 (UID BODY.PEEK[]<0.5000000>)');
  });

  it('returns null when the message vanished', async () => {
    const s = fakeServer((tag) => `${tag} OK FETCH completed\r\n`);
    const client = await ImapClient.open(s.readable, s.writable);
    expect(await client.uidFetchRaw(42, 1000)).toBeNull();
  });
});

describe('ByteReader', () => {
  it('finds a CRLF split across two chunks', async () => {
    const chunks = ['abc\r', '\ndef\r\n'].map((s) => enc.encode(s));
    const readable = new ReadableStream<Uint8Array>({
      start(c) {
        for (const ch of chunks) c.enqueue(ch);
        c.close();
      },
    });
    const reader = new ByteReader(readable.getReader());
    expect(await reader.readLine()).toBe('abc');
    expect(await reader.readLine()).toBe('def');
    await expect(reader.readLine()).rejects.toBeInstanceOf(ImapError);
  });
});

describe('parseListResponse', () => {
  it('ignores non-LIST lines', () => {
    expect(parseListResponse('* OK hello')).toBeNull();
  });

  it('unescapes quoted names', () => {
    expect(parseListResponse('* LIST () "/" "a \\"b\\""')).toEqual({ name: 'a "b"', flags: [] });
  });
});
