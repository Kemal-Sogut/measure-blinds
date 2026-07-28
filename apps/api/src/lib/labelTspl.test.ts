// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Unit tests for TSPL label rendering. Asserts the emitted command
 * stream exactly — the same approach pdf.test.ts takes with itemContent
 * — because the printer is the only other consumer and it cannot be
 * exercised from CI.
 *
 * The stripControl cases are SECURITY tests, not formatting ones: TSPL
 * is newline-delimited, so an unescaped control character in a customer
 * name would let that name inject printer commands.
 */

import { describe, it, expect } from 'vitest';
import { renderLabelsTspl, stripControl, foldAscii } from './labelTspl';
import type { LabelFields } from './labels';

/** A fully-populated label; individual tests blank what they exercise. */
function label(overrides: Partial<LabelFields> = {}): LabelFields {
  return {
    orderNumber: 'T0408-126',
    index: 3,
    total: 7,
    customer: 'Ada Lovelace',
    room: 'Living Room',
    dimensions: '120 + 90 x 210 cm',
    material: 'Blackout White · Ivory',
    cassette: 'Standard',
    control: 'Chain Left',
    ...overrides,
  };
}

describe('stripControl', () => {
  it('removes characters that could close a TEXT statement', () => {
    expect(stripControl('Ada\r\nPRINT 9,9')).toBe('AdaPRINT 9,9');
    expect(stripControl('tab\there')).toBe('tabhere');
    expect(stripControl('null\u0000byte')).toBe('nullbyte');
  });

  it('removes backslashes and downgrades double quotes', () => {
    expect(stripControl('back\\slash')).toBe('backslash');
    expect(stripControl('say "hi"')).toBe("say 'hi'");
  });
});

describe('foldAscii', () => {
  it('folds accented and Turkish characters to their ASCII form', () => {
    expect(foldAscii('Émile Şoğut Çınar')).toBe('Emile Sogut Cinar');
    expect(foldAscii('Müller')).toBe('Muller');
  });

  it('drops characters with no ASCII equivalent', () => {
    expect(foldAscii('Ada 日本 Lovelace')).toBe('Ada  Lovelace');
  });

  it('leaves plain ASCII untouched', () => {
    expect(foldAscii('Blackout White')).toBe('Blackout White');
  });
});

describe('renderLabelsTspl', () => {
  it('renders one full label as an exact command stream', () => {
    expect(renderLabelsTspl([label()])).toBe(
      [
        'SIZE 3,1.50',
        'GAP 0.12,0',
        'DIRECTION 1',
        'DENSITY 8',
        'SPEED 4',
        'CLS',
        'TEXT 10,6,"4",0,1,1,"T0408-126"',
        'TEXT 527,14,"2",0,1,1,"3 of 7"',
        'BAR 10,42,589,2',
        'TEXT 10,50,"3",0,1,1,"Ada Lovelace"',
        'TEXT 10,78,"3",0,1,1,"Living Room"',
        'TEXT 10,106,"4",0,1,1,"120 + 90 x 210 cm"',
        'BAR 10,142,589,2',
        'TEXT 10,150,"3",0,1,1,"Blackout White - Ivory"',
        'TEXT 10,178,"3",0,1,1,"Standard"',
        'TEXT 10,206,"3",0,1,1,"Chain Left"',
        'PRINT 1,1',
        '',
      ].join('\r\n')
    );
  });

  it('emits one CLS/PRINT block per label', () => {
    const stream = renderLabelsTspl([label({ index: 1 }), label({ index: 2 })]);
    expect(stream.match(/^CLS$/gm)).toHaveLength(2);
    expect(stream.match(/^PRINT 1,1$/gm)).toHaveLength(2);
  });

  it('omits the line for an empty field without moving the rows below it', () => {
    const stream = renderLabelsTspl([label({ cassette: '', control: '' })]);
    expect(stream).not.toContain('TEXT 10,178');
    expect(stream).not.toContain('TEXT 10,206');
    // The material row keeps its fixed y.
    expect(stream).toContain('TEXT 10,150,"3",0,1,1,"Blackout White - Ivory"');
  });

  it('truncates per font cell width rather than wrapping', () => {
    // Font "3" is 16 dots wide: 589 / 16 = 36 characters.
    const stream = renderLabelsTspl([label({ room: 'R'.repeat(50) })]);
    expect(stream).toContain(`TEXT 10,78,"3",0,1,1,"${'R'.repeat(36)}"`);

    // Font "4" is 24 dots wide: 589 / 24 = 24 characters.
    const wide = renderLabelsTspl([label({ dimensions: 'D'.repeat(50) })]);
    expect(wide).toContain(`TEXT 10,106,"4",0,1,1,"${'D'.repeat(24)}"`);
  });

  it('right-aligns the counter against the label edge', () => {
    // "10 of 12" is 8 chars at 12 dots = 96; 599 - 96 = 503.
    const stream = renderLabelsTspl([label({ index: 10, total: 12 })]);
    expect(stream).toContain('TEXT 503,14,"2",0,1,1,"10 of 12"');
  });

  it('sanitizes and folds every interpolated field', () => {
    const stream = renderLabelsTspl([label({ customer: 'Şoğut\r\nPRINT 9,9', room: 'a"b' })]);
    expect(stream).toContain('TEXT 10,50,"3",0,1,1,"SogutPRINT 9,9"');
    expect(stream).toContain(`TEXT 10,78,"3",0,1,1,"a'b"`);
    expect(stream.match(/^PRINT 1,1$/gm)).toHaveLength(1);
  });

  it('returns an empty string for no labels', () => {
    expect(renderLabelsTspl([])).toBe('');
  });
});
