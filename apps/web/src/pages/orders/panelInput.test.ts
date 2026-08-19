// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * `parsePanelInput` / `formatPanelInput` tests.
 *
 * These two functions are the pure shorthand parser behind typing
 * `118.5+118` into a single panel-width field instead of tapping "+ Panel"
 * for a second input. `parsePanelInput` is the read direction (one typed
 * string → N panel-width strings); `formatPanelInput` is the write
 * direction, used by the UI to render an existing `draft.panels` array
 * back into the one field the consultant sees. The cases below pin down:
 *
 * - the empty-string special case: `''` must parse to `['']` (ONE blank
 *   panel), never `[]` — a blank row has to stay a blank row so the UI
 *   still renders a single empty input, not a panel list that vanished;
 * - mid-typing states must survive untouched: a trailing `+` (still typing
 *   the next panel) yields a trailing `''` entry rather than throwing or
 *   dropping what was already typed, and a half-typed number like `12.`
 *   is not reformatted or rejected — this parser does no numeric
 *   validation at all (see the JSDoc on `parsePanelInput` for why);
 * - whitespace around `+` is tolerated, since a phone keyboard makes it
 *   easy to leave a stray space either side of the delimiter;
 * - the round-trip property in both directions: parsing what `format`
 *   produced returns the original array, and formatting what `parse`
 *   produced (for inputs without incidental whitespace) returns the
 *   original string.
 */

import { describe, it, expect } from 'vitest';
import { parsePanelInput, formatPanelInput } from './panelInput';

describe('parsePanelInput', () => {
  it('splits a multi-panel entry on "+" into trimmed widths', () => {
    expect(parsePanelInput('118.5+118')).toEqual(['118.5', '118']);
  });

  it('returns a single-element array for a plain value', () => {
    expect(parsePanelInput('120')).toEqual(['120']);
  });

  it('returns one blank panel for an empty string, not zero panels', () => {
    expect(parsePanelInput('')).toEqual(['']);
  });

  it('tolerates surrounding spaces around "+"', () => {
    expect(parsePanelInput('118.5 + 118')).toEqual(['118.5', '118']);
  });

  it('keeps a trailing blank panel for a trailing "+" mid-typing, without throwing', () => {
    expect(() => parsePanelInput('118+')).not.toThrow();
    expect(parsePanelInput('118+')).toEqual(['118', '']);
  });

  it('keeps a leading blank panel for a leading "+"', () => {
    expect(parsePanelInput('+118')).toEqual(['', '118']);
  });

  it('does not reject or reformat a half-typed number like "12."', () => {
    expect(parsePanelInput('12.')).toEqual(['12.']);
    expect(parsePanelInput('12.+8')).toEqual(['12.', '8']);
  });

  it('collapses a lone "+" to two blank panels rather than throwing', () => {
    expect(parsePanelInput('+')).toEqual(['', '']);
  });

  it('splits three or more panels', () => {
    expect(parsePanelInput('100+120+140')).toEqual(['100', '120', '140']);
  });

  it('pins consecutive delimiters to a blank panel between them, not a collapse or a throw', () => {
    // '118++119' has no digits between the two '+'s — split still walks
    // every delimiter individually, so the middle field comes out blank
    // rather than the two panels either merging or being dropped.
    expect(parsePanelInput('118++119')).toEqual(['118', '', '119']);
  });

  it('passes non-numeric junk through untouched (no validation here)', () => {
    expect(parsePanelInput('abc+xyz')).toEqual(['abc', 'xyz']);
  });
});

describe('formatPanelInput', () => {
  it('joins panel widths with "+"', () => {
    expect(formatPanelInput(['118.5', '118'])).toBe('118.5+118');
  });

  it('returns a plain value unchanged for a single panel', () => {
    expect(formatPanelInput(['120'])).toBe('120');
  });

  it('formats an empty array as an empty string', () => {
    expect(formatPanelInput([])).toBe('');
  });

  it('formats a single blank panel as an empty string', () => {
    expect(formatPanelInput([''])).toBe('');
  });

  it('joins three or more panels', () => {
    expect(formatPanelInput(['100', '120', '140'])).toBe('100+120+140');
  });
});

describe('round-trip', () => {
  it('parse(format(panels)) restores the original panel array', () => {
    const cases = [['118.5', '118'], ['120'], [''], ['100', '120', '140'], ['118.5', '', '118']];
    for (const panels of cases) {
      expect(parsePanelInput(formatPanelInput(panels))).toEqual(panels);
    }
  });

  it('format(parse(value)) restores the original string for delimiter-clean input', () => {
    const cases = ['118.5+118', '120', '100+120+140'];
    for (const value of cases) {
      expect(formatPanelInput(parsePanelInput(value))).toBe(value);
    }
  });
});
