// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Cuts quoted history off an email so a bubble shows only what the
 * sender actually wrote this time.
 *
 * Text-based on purpose: HTML-only mail is first converted by
 * `htmlToText`, which marks blockquotes with ">", so one rule set covers
 * both. The message is cut at the FIRST line that starts quoted history:
 *
 *   - an attribution line ending in "wrote:" or "said:" that starts with
 *     "On " or contains an email address or a clock time (so "My husband
 *     said:" is kept), also when a client wrapped it over two lines
 *   - "-----Original Message-----"
 *   - an Outlook-style header block: "From:" followed within 4 lines by
 *     "Sent:"/"Date:" and "Subject:", unless it belongs to a
 *     "Forwarded message" (a forward's quoted part IS the content)
 *   - a run of ">" lines that continues to the end of the message
 *     (a ">" line followed by unquoted text is an interleaved reply and
 *     is kept whole)
 *
 * Then trailing blank lines, a trailing "--" signature separator and
 * separator rules ("____", "----") are dropped. If nothing is left, the
 * full text is returned instead, so a bubble is never empty. The full
 * text is always kept in `email_messages.text_body` for the "···" reveal.
 */

/** Lines that introduce quoted history. Exported so tests and future tuning see one list. */
export const ATTRIBUTION_PATTERNS: RegExp[] = [
  /^\s*On\s.{1,300}\s(?:wrote|said):\s*$/i,
  /^.{0,300}(?:@|\b\d{1,2}:\d{2}\b).{0,300}\s(?:wrote|said):\s*$/i,
  /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/i,
];

const FROM_LINE = /^\s*\*?From:\*?\s+\S/i;
const SENT_OR_DATE_LINE = /^\s*\*?(?:Sent|Date):\*?\s/i;
const SUBJECT_LINE = /^\s*\*?Subject:\*?/i;
const QUOTED_LINE = /^\s*>/;
const FORWARD_MARKER = /forwarded message|begin forwarded message/i;
const TRAILING_JUNK = /^\s*(?:--|_{3,}|-{3,})\s*$/;

/** True when line `i` (alone, or joined with the next line) is an attribution. */
function isAttribution(lines: string[], i: number): boolean {
  const line = lines[i];
  if (ATTRIBUTION_PATTERNS.some((p) => p.test(line))) return true;
  if (/^\s*On\s/i.test(line) && i + 1 < lines.length) {
    const joined = `${line.trimEnd()} ${lines[i + 1].trim()}`;
    return ATTRIBUTION_PATTERNS.some((p) => p.test(joined));
  }
  return false;
}

/** True when an Outlook-style From/Sent/Subject header block starts at line `i`. */
function isOutlookHeader(lines: string[], i: number): boolean {
  if (!FROM_LINE.test(lines[i])) return false;
  const window = lines.slice(i + 1, i + 5);
  if (!window.some((l) => SENT_OR_DATE_LINE.test(l)) || !window.some((l) => SUBJECT_LINE.test(l))) {
    return false;
  }
  for (let j = i - 1; j >= 0; j--) {
    if (lines[j].trim() === '') continue;
    return !FORWARD_MARKER.test(lines[j]);
  }
  return true;
}

/** True when line `i` starts a ">" run that lasts to the end (blank lines allowed). */
function isTrailingQuoteRun(lines: string[], i: number): boolean {
  if (!QUOTED_LINE.test(lines[i])) return false;
  return lines.slice(i).every((l) => l.trim() === '' || QUOTED_LINE.test(l));
}

/** Index of the first line of quoted history, or -1. */
function findCut(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    if (isAttribution(lines, i) || isOutlookHeader(lines, i) || isTrailingQuoteRun(lines, i)) return i;
  }
  return -1;
}

/** The new part of a reply (see the module comment for the exact rules). */
export function trimQuotedReply(text: string): string {
  const normalized = text.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const cut = findCut(lines);
  const kept = cut === -1 ? lines : lines.slice(0, cut);
  while (kept.length && (kept[kept.length - 1].trim() === '' || TRAILING_JUNK.test(kept[kept.length - 1]))) {
    kept.pop();
  }
  return kept.join('\n').trim() || normalized.trim();
}
