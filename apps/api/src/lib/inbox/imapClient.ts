// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Minimal, read-only IMAP4rev1 client for the Titan inbox sync.
 *
 * Works over any web-stream pair (`ReadableStream`/`WritableStream` of
 * bytes), so the protocol logic is unit-tested against a fake server and
 * only `titanConnect.ts` touches real sockets. It speaks exactly the
 * commands the sync needs: AUTHENTICATE PLAIN (with SASL-IR, which Titan
 * advertises, so any password characters are safe), LIST, EXAMINE (the
 * read-only SELECT — the client never selects a folder writable), UID
 * SEARCH, UID FETCH with BODY.PEEK (never sets \Seen) and LOGOUT.
 *
 * Commands are sent one at a time and each response is read to its
 * tagged completion. Server literals (`{n}` + n raw bytes) are read
 * byte-exact and returned separately from the line text, which is how a
 * FETCH delivers a message's bytes.
 *
 * Error messages name the command verb only, never its arguments, so a
 * failed login can never put the credentials into a log line.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** A protocol or connection failure. Never carries command arguments. */
export class ImapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImapError';
  }
}

/**
 * Buffered reader over a byte stream that can return CRLF-terminated
 * lines and exact byte counts. Chunks are kept in a list rather than
 * re-concatenated on every read, so a multi-megabyte FETCH literal costs
 * one copy.
 */
export class ByteReader {
  private chunks: Uint8Array[] = [];
  private length = 0;

  constructor(private readonly source: ReadableStreamDefaultReader<Uint8Array>) {}

  /** Pulls one more chunk; throws when the server has closed the stream. */
  private async pull(): Promise<void> {
    const { value, done } = await this.source.read();
    if (done) throw new ImapError('IMAP connection closed by the server');
    if (value && value.length > 0) {
      this.chunks.push(value);
      this.length += value.length;
    }
  }

  /** Removes and returns the first `n` buffered bytes (n ≤ length). */
  private take(n: number): Uint8Array {
    const out = new Uint8Array(n);
    let offset = 0;
    while (offset < n) {
      const head = this.chunks[0];
      const need = n - offset;
      if (head.length <= need) {
        out.set(head, offset);
        offset += head.length;
        this.chunks.shift();
      } else {
        out.set(head.subarray(0, need), offset);
        this.chunks[0] = head.subarray(need);
        offset += need;
      }
    }
    this.length -= n;
    return out;
  }

  /** Index of the CR of the first CRLF in the buffer, or -1. */
  private findCrlf(): number {
    let position = 0;
    let previousWasCr = false;
    for (const chunk of this.chunks) {
      for (let i = 0; i < chunk.length; i++) {
        if (previousWasCr && chunk[i] === 10) return position + i - 1;
        previousWasCr = chunk[i] === 13;
      }
      position += chunk.length;
    }
    return -1;
  }

  /** Reads one line, without its CRLF, decoded as UTF-8. */
  async readLine(): Promise<string> {
    for (;;) {
      const crAt = this.findCrlf();
      if (crAt >= 0) {
        const bytes = this.take(crAt + 2);
        return decoder.decode(bytes.subarray(0, crAt));
      }
      await this.pull();
    }
  }

  /** Reads exactly `n` bytes (an IMAP literal). */
  async readBytes(n: number): Promise<Uint8Array> {
    while (this.length < n) await this.pull();
    return this.take(n);
  }
}

/**
 * One untagged response (`* …`). `text` is the line with every literal's
 * bytes removed (the `{n}` markers stay); `literals` holds those bytes in
 * order.
 */
export interface UntaggedResponse {
  text: string;
  literals: Uint8Array[];
}

/** The tagged completion of a command plus everything untagged before it. */
export interface TaggedResult {
  status: 'OK' | 'NO' | 'BAD';
  text: string;
  untagged: UntaggedResponse[];
}

/** One mailbox from LIST: its decoded name and its flags (e.g. `\Sent`). */
export interface MailboxListing {
  name: string;
  flags: string[];
}

const LITERAL_AT_END = /\{(\d+)\}$/;

/** The verb used in error messages: `UID FETCH`, `EXAMINE`, … — never arguments. */
function verbOf(command: string): string {
  const [first, second] = command.split(' ');
  return (first.toUpperCase() === 'UID' && second ? `UID ${second}` : first).toUpperCase();
}

/** IMAP quoted string with `\` and `"` escaped. */
function quoteString(value: string): string {
  return `"${value.replace(/[\\"]/g, (ch) => `\\${ch}`)}"`;
}

/** Base64 of a string's UTF-8 bytes (btoa alone only handles Latin-1). */
function base64Utf8(value: string): string {
  let binary = '';
  for (const byte of encoder.encode(value)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Parses one `* LIST (flags) "delim" name` line. Returns null for any
 * other line, and for the rare literal-encoded name (not used by Titan).
 */
export function parseListResponse(text: string): MailboxListing | null {
  const m = /^\* LIST \(([^)]*)\) (?:NIL|"(?:[^"\\]|\\.)*") (.+)$/i.exec(text);
  if (!m) return null;
  const raw = m[2].trim();
  if (LITERAL_AT_END.test(raw)) return null;
  const name =
    raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1).replace(/\\(.)/g, '$1') : raw;
  return { name, flags: m[1].split(/\s+/).filter(Boolean) };
}

/** The read-only IMAP session. Create with {@link ImapClient.open}. */
export class ImapClient {
  private tagSeq = 0;

  private constructor(
    private readonly reader: ByteReader,
    private readonly writer: WritableStreamDefaultWriter<Uint8Array>
  ) {}

  /**
   * Wraps an open byte-stream pair and checks the server greeting
   * (`* OK` or `* PREAUTH`). Throws {@link ImapError} on anything else.
   */
  static async open(
    readable: ReadableStream<Uint8Array>,
    writable: WritableStream<Uint8Array>
  ): Promise<ImapClient> {
    const client = new ImapClient(new ByteReader(readable.getReader()), writable.getWriter());
    const greeting = await client.reader.readLine();
    if (!/^\* (OK|PREAUTH)\b/i.test(greeting)) {
      throw new ImapError(`Unexpected IMAP greeting: ${greeting.slice(0, 120)}`);
    }
    return client;
  }

  /** Reads one untagged response, following any literals it contains. */
  private async readUntagged(firstLine: string): Promise<UntaggedResponse> {
    let text = firstLine;
    const literals: Uint8Array[] = [];
    for (;;) {
      const m = LITERAL_AT_END.exec(text);
      if (!m) return { text, literals };
      literals.push(await this.reader.readBytes(Number(m[1])));
      text += await this.reader.readLine();
    }
  }

  /** Reads responses until the line tagged `tag`. */
  private async readResponse(tag: string, verb: string): Promise<TaggedResult> {
    const untagged: UntaggedResponse[] = [];
    for (;;) {
      const line = await this.reader.readLine();
      if (line.startsWith(`${tag} `)) {
        const rest = line.slice(tag.length + 1);
        const sp = rest.indexOf(' ');
        const status = (sp === -1 ? rest : rest.slice(0, sp)).toUpperCase();
        if (status !== 'OK' && status !== 'NO' && status !== 'BAD') {
          throw new ImapError(`${verb}: malformed tagged response`);
        }
        return { status, text: sp === -1 ? '' : rest.slice(sp + 1), untagged };
      }
      if (line.startsWith('+')) throw new ImapError(`${verb}: unexpected continuation request`);
      untagged.push(await this.readUntagged(line));
    }
  }

  /** Sends one command and returns its full result, whatever the status. */
  private async command(command: string): Promise<TaggedResult> {
    const tag = `a${++this.tagSeq}`;
    await this.writer.write(encoder.encode(`${tag} ${command}\r\n`));
    return this.readResponse(tag, verbOf(command));
  }

  /** Sends one command and throws unless it completes OK. */
  private async ok(command: string): Promise<TaggedResult> {
    const result = await this.command(command);
    if (result.status !== 'OK') {
      throw new ImapError(`${verbOf(command)} failed: ${result.status} ${result.text}`.trim());
    }
    return result;
  }

  /** Logs in with SASL PLAIN in a single line (SASL-IR). */
  async authenticatePlain(user: string, password: string): Promise<void> {
    await this.ok(`AUTHENTICATE PLAIN ${base64Utf8(`\u0000${user}\u0000${password}`)}`);
  }

  /** Every mailbox on the account, with flags. */
  async list(): Promise<MailboxListing[]> {
    const result = await this.ok('LIST "" "*"');
    return result.untagged
      .map((u) => parseListResponse(u.text))
      .filter((m): m is MailboxListing => m !== null);
  }

  /** Opens `folder` read-only; returns its UIDVALIDITY and message count. */
  async examine(folder: string): Promise<{ uidValidity: number; exists: number }> {
    const result = await this.ok(`EXAMINE ${quoteString(folder)}`);
    let uidValidity: number | null = null;
    let exists = 0;
    for (const u of result.untagged) {
      const v = /\[UIDVALIDITY (\d+)\]/i.exec(u.text);
      if (v) uidValidity = Number(v[1]);
      const e = /^\* (\d+) EXISTS\b/i.exec(u.text);
      if (e) exists = Number(e[1]);
    }
    if (uidValidity === null) throw new ImapError('EXAMINE: server did not report UIDVALIDITY');
    return { uidValidity, exists };
  }

  /** `UID SEARCH <criteria>` in the examined folder; UIDs ascending. */
  async uidSearch(criteria: string): Promise<number[]> {
    const result = await this.ok(`UID SEARCH ${criteria}`);
    const uids: number[] = [];
    for (const u of result.untagged) {
      const m = /^\* SEARCH\b(.*)$/i.exec(u.text);
      if (!m) continue;
      for (const token of m[1].trim().split(/\s+/)) if (/^\d+$/.test(token)) uids.push(Number(token));
    }
    return uids.sort((a, b) => a - b);
  }

  /**
   * The first `maxBytes` of message `uid`'s raw source, without marking it
   * read (BODY.PEEK). Null when the message no longer exists.
   */
  async uidFetchRaw(uid: number, maxBytes: number): Promise<Uint8Array | null> {
    const result = await this.ok(`UID FETCH ${uid} (UID BODY.PEEK[]<0.${maxBytes}>)`);
    for (const u of result.untagged) {
      if (/^\* \d+ FETCH\b/i.test(u.text) && u.literals.length > 0) return u.literals[0];
    }
    return null;
  }

  /** Best-effort LOGOUT; the server may close the stream first. */
  async logout(): Promise<void> {
    try {
      await this.command('LOGOUT');
    } catch {
      /* already closed */
    }
  }
}
