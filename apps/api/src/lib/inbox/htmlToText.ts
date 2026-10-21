// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * HTML → plain text for emails that arrive with no text/plain part.
 *
 * Deliberately small and DOM-free (Workers have no DOMParser, and vitest
 * runs in Node): a tokenizer that turns block-level tags into line
 * breaks, decodes common entities, drops <head>/<style>/<script>, and —
 * the one thing quote trimming needs — prefixes every line inside a
 * <blockquote> with ">" per nesting level. Gmail, Apple Mail and Outlook
 * all wrap quoted history in blockquotes or attribution lines, so the
 * text-based trimmer (`quoteTrim.ts`) then handles HTML-only mail the
 * same way as plain-text mail. The output is never rendered as HTML.
 */

const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'br', 'dd', 'div', 'dl', 'dt', 'fieldset',
  'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table',
  'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
]);

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Decodes named (`&amp;` …) and numeric (`&#39;`, `&#x2014;`) entities; unknown ones are kept. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    const lower = body.toLowerCase();
    if (lower.startsWith('#')) {
      const code = lower.startsWith('#x') ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[lower] ?? whole;
  });
}

/**
 * Converts an email's HTML to plain text with quoted (blockquote) lines
 * prefixed by ">" (">>" when nested).
 *
 * Line rules: a block tag ends the current line (never adding an empty
 * one, so nested <div>s don't stack blank lines); <br> always ends a
 * line, so <br><br> keeps a blank line; <p> and the outermost
 * <blockquote> start a new paragraph (one blank line). At most one blank
 * line in a row; result trimmed.
 */
export function htmlToText(html: string): string {
  const source = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(head|style|script|title)\b[\s\S]*?<\/\1\s*>/gi, '');

  const lines: string[] = [];
  let current = '';
  let depth = 0;
  let currentDepth = 0;

  const endLine = (force = false) => {
    const text = current.trim();
    if (text) lines.push(`${currentDepth > 0 ? `${'>'.repeat(currentDepth)} ` : ''}${text}`);
    else if (force) lines.push('');
    current = '';
    currentDepth = depth;
  };
  const paragraphBreak = () => {
    endLine();
    if (lines.length && lines[lines.length - 1] !== '') lines.push('');
  };

  for (const token of source.match(/<[^>]*>|[^<]+/g) ?? []) {
    if (token.startsWith('<')) {
      const tag = /^<\s*(\/)?\s*([a-z0-9]+)/i.exec(token);
      if (!tag) continue;
      const closing = Boolean(tag[1]);
      const name = tag[2].toLowerCase();
      if (name === 'blockquote') {
        if (!closing && depth === 0) paragraphBreak();
        else endLine();
        depth = Math.max(0, depth + (closing ? -1 : 1));
        currentDepth = depth;
      } else if (name === 'br') {
        endLine(true);
      } else if (name === 'p') {
        paragraphBreak();
      } else if (BLOCK_TAGS.has(name)) {
        endLine();
      }
      continue;
    }
    const text = decodeEntities(token).replace(/\s+/g, ' ');
    if (!current.trim()) {
      currentDepth = depth;
      current = text.trimStart();
    } else {
      current += text;
    }
  }
  endLine();

  return lines
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
