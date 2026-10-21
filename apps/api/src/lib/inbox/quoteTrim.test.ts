// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins how a reply's quoted history is cut off for the bubble view:
 * "On … wrote:" / "… said:" attribution lines (also when wrapped over
 * two lines), "-----Original Message-----", Outlook header blocks and
 * trailing ">" runs are cut; forwards, interleaved replies and ordinary
 * sentences ending in "said:" are kept; an empty result falls back to
 * the full text.
 */

import { describe, expect, it } from 'vitest';
import { trimQuotedReply } from './quoteTrim';

describe('trimQuotedReply', () => {
  it('cuts a Gmail attribution and quote', () => {
    const text =
      'Sounds good, see you Tuesday.\n\nOn Mon, Oct 20, 2026 at 3:14 PM Blinds Nisa <info@blindsnisa.com> wrote:\n> Hi Jane,\n> Your estimate is ready.';
    expect(trimQuotedReply(text)).toBe('Sounds good, see you Tuesday.');
  });

  it('cuts an attribution wrapped over two lines', () => {
    const text =
      'Thanks!\n\nOn Mon, Oct 20, 2026 at 3:14 PM Blinds Nisa <\ninfo@blindsnisa.com> wrote:\n\n> Hi';
    expect(trimQuotedReply(text)).toBe('Thanks!');
  });

  it('cuts "<address> said:"', () => {
    expect(trimQuotedReply('Yes please.\n\ninfo@blindsnisa.com said:\nHi Jane, here is your quote')).toBe('Yes please.');
    expect(trimQuotedReply('Ok\n\nJane Doe <jane@example.com> said:\nold')).toBe('Ok');
  });

  it('keeps an ordinary sentence ending in "said:"', () => {
    const text = 'My husband said:\nlet us go with white.';
    expect(trimQuotedReply(text)).toBe(text);
  });

  it('cuts an Outlook header block and its separator', () => {
    const text =
      'Confirmed.\n\n________________________________\nFrom: Blinds Nisa <info@blindsnisa.com>\nSent: Monday, October 20, 2026 3:14 PM\nTo: Jane\nSubject: Your estimate\n\nHi Jane';
    expect(trimQuotedReply(text)).toBe('Confirmed.');
  });

  it('cuts at -----Original Message-----', () => {
    expect(trimQuotedReply('Ok\n-----Original Message-----\nFrom: x\nold')).toBe('Ok');
  });

  it('cuts an Apple Mail ">" run', () => {
    const text =
      'Great\n\n> On Oct 20, 2026, at 3:14 PM, Blinds Nisa <info@blindsnisa.com> wrote:\n> \n> Hi';
    expect(trimQuotedReply(text)).toBe('Great');
  });

  it('keeps interleaved replies', () => {
    const text = '> question 1\nanswer 1\n> question 2\nanswer 2';
    expect(trimQuotedReply(text)).toBe(text);
  });

  it('keeps a forwarded message', () => {
    const text =
      'FYI\n\n---------- Forwarded message ---------\nFrom: Supplier <s@supplier.com>\nDate: Mon, Oct 20, 2026 at 3:14 PM\nSubject: Shipment\nTo: <info@blindsnisa.com>\n\nYour order shipped.';
    expect(trimQuotedReply(text)).toBe(text);
  });

  it('falls back to the full text when everything would be cut', () => {
    const text = 'On Mon, Oct 20, 2026 at 3:14 PM Jane <j@x.com> wrote:\n> hi';
    expect(trimQuotedReply(text)).toBe(text);
  });

  it('drops a trailing signature separator and normalises CRLF', () => {
    expect(trimQuotedReply('Thanks\r\n--\r\n\r\nOn Mon, Oct 20, 2026 at 3:14 PM Jane <j@x.com> wrote:\r\n> hi')).toBe('Thanks');
  });
});
