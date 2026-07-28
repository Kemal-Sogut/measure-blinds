// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * TSPL rendering for production labels — the command stream the print
 * agent pipes straight to a LabelCreate 2410BT.
 *
 * STOCK: 3" x 1.5" direct thermal at 203 dpi = 609 x 304 dots. Every
 * coordinate below is in dots with the origin at the top-left, so the
 * layout is fixed and can be reasoned about without a printer present.
 *
 * FIXED ROWS: each field owns a y coordinate that never moves. A blind
 * with no cassette omits that line entirely rather than shifting the
 * rows beneath it, so an operator's eye finds the same fact in the same
 * place on every label in a batch.
 *
 * NO WRAPPING: an overlong value is truncated to what its font cell
 * fits. A wrapped line would push the layout past the label edge and
 * silently lose the rows below it.
 *
 * ENGINE NOTE: TSPL is a line-oriented command language, so text is
 * emitted with CRLF terminators and every interpolated value passes
 * through `stripControl` first — see its doc comment for why that is a
 * security control rather than formatting.
 */

import type { LabelFields } from './labels';

/* ── Geometry (dots) ────────────────────────────────────────────── */
const LEFT = 10;
const RIGHT_EDGE = 599; // 609 - LEFT
const USABLE = 589; // RIGHT_EDGE - LEFT

/** Bitmap font ids and their cell widths in dots (TSPL font table). */
const FONT_BIG = { id: '4', cell: 24 } as const; // 24x32
const FONT_MED = { id: '3', cell: 16 } as const; // 16x24
const FONT_SMALL = { id: '2', cell: 12 } as const; // 12x20

/**
 * Gap between die-cut labels, in inches. 0.12" (~3 mm) is the standard
 * for this stock and is the one value expected to need adjustment after
 * a physical calibration run with the real roll loaded.
 */
const GAP_INCHES = '0.12';

/**
 * Strips everything that could break out of a TSPL `TEXT` statement.
 *
 * SECURITY CONTROL, not formatting. TSPL commands are delimited by
 * newlines and arguments by double quotes, so a customer name or room
 * containing CR/LF could terminate the statement and have the rest of
 * the value executed as printer commands. Control characters and
 * backslashes are removed outright and double quotes are downgraded to
 * apostrophes — removal is used in preference to escaping because
 * backslash handling varies across TSPL firmware and an escape that the
 * printer does not honour is an injection.
 *
 * Same class of rule as `escapeHtml` for email bodies and the PostgREST
 * `or()` sanitizer (AI_GUIDELINES §2).
 */
export function stripControl(value: string): string {
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\\/g, '')
    .replace(/"/g, "'");
}

/**
 * Folds text to printable ASCII.
 *
 * TSPL internal bitmap fonts are codepage-limited: an accented or
 * non-Latin character renders as a blank or as garbage, which on a
 * production label is worse than a plain approximation. "Émile Şoğut"
 * becomes "Emile Sogut". Characters with no ASCII equivalent are
 * dropped. Only the TSPL path folds — the browser path renders the
 * original text as typed.
 *
 * Dotless "ı" and capital "İ" are mapped explicitly because U+0131 has
 * no Unicode decomposition for the NFD pass to strip. The middle dot is
 * mapped because `buildLabels` uses it to join material and colour, and
 * dropping it would run the two values together.
 */
export function foldAscii(value: string): string {
  return value
    .replace(/·/g, '-')
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'I')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\u0020-\u007e]/g, '');
}

/** Sanitizes, folds, and truncates one value to a font's cell width. */
function fit(value: string, cell: number): string {
  return foldAscii(stripControl(value)).slice(0, Math.floor(USABLE / cell));
}

/** One left-aligned TEXT command, or null when the value is empty. */
function row(y: number, font: { id: string; cell: number }, value: string): string | null {
  const content = fit(value, font.cell);
  return content ? `TEXT ${LEFT},${y},"${font.id}",0,1,1,"${content}"` : null;
}

/**
 * Renders every label as its own CLS…PRINT block and concatenates them
 * into one stream, so a whole order is a single job the agent writes in
 * one pass.
 *
 * @param labels Ordered labels from `buildLabels`, already filtered to
 *               what the caller wants printed.
 * @returns The complete TSPL stream, CRLF-terminated; `''` for no labels.
 */
export function renderLabelsTspl(labels: LabelFields[]): string {
  const lines: string[] = [];

  for (const label of labels) {
    const counter = fit(`${label.index} of ${label.total}`, FONT_SMALL.cell);
    const counterX = RIGHT_EDGE - counter.length * FONT_SMALL.cell;

    lines.push(
      `SIZE 3,1.50`,
      `GAP ${GAP_INCHES},0`,
      'DIRECTION 1',
      'DENSITY 8',
      'SPEED 4',
      'CLS'
    );

    const orderNumber = fit(label.orderNumber, FONT_BIG.cell);
    if (orderNumber) lines.push(`TEXT ${LEFT},6,"${FONT_BIG.id}",0,1,1,"${orderNumber}"`);
    if (counter) lines.push(`TEXT ${counterX},14,"${FONT_SMALL.id}",0,1,1,"${counter}"`);
    lines.push(`BAR ${LEFT},42,${USABLE},2`);

    for (const line of [
      row(50, FONT_MED, label.customer),
      row(78, FONT_MED, label.room),
      row(106, FONT_BIG, label.dimensions),
    ]) {
      if (line) lines.push(line);
    }

    lines.push(`BAR ${LEFT},142,${USABLE},2`);

    for (const line of [
      row(150, FONT_MED, label.material),
      row(178, FONT_MED, label.cassette),
      row(206, FONT_MED, label.control),
    ]) {
      if (line) lines.push(line);
    }

    lines.push('PRINT 1,1');
  }

  return lines.length ? `${lines.join('\r\n')}\r\n` : '';
}