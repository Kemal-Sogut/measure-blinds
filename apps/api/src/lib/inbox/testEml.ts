// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * TEST-ONLY helper: builds a small RFC 5322 message as bytes, so parser
 * and sync tests run real messages through postal-mime instead of
 * hand-made ParsedMessage objects. Not imported by any runtime module
 * (the Worker bundle tree-shakes it away).
 */

/** Header and body inputs for {@link eml}. Ids are given WITHOUT angle brackets. */
export interface EmlOptions {
  from: string;
  to: string;
  cc?: string;
  subject: string;
  /** RFC 2822 date, e.g. 'Mon, 20 Oct 2026 10:00:00 -0400'. */
  date: string;
  id?: string;
  inReplyTo?: string;
  /** Raw References header value, e.g. '<a@x> <b@x>'. */
  references?: string;
  body: string;
  /** Defaults to text/plain; pass 'text/html' for an HTML-only message. */
  contentType?: string;
}

/** Encodes the message with CRLF line endings. */
export function eml(o: EmlOptions): Uint8Array {
  const lines = [
    `From: ${o.from}`,
    `To: ${o.to}`,
    ...(o.cc ? [`Cc: ${o.cc}`] : []),
    `Subject: ${o.subject}`,
    `Date: ${o.date}`,
    ...(o.id ? [`Message-ID: <${o.id}>`] : []),
    ...(o.inReplyTo ? [`In-Reply-To: <${o.inReplyTo}>`] : []),
    ...(o.references ? [`References: ${o.references}`] : []),
    'MIME-Version: 1.0',
    `Content-Type: ${o.contentType ?? 'text/plain'}; charset=utf-8`,
    'Content-Transfer-Encoding: 8bit',
    '',
    o.body.replace(/\r?\n/g, '\r\n'),
  ];
  return new TextEncoder().encode(lines.join('\r\n'));
}
