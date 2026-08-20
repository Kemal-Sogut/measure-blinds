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
 *
 * `applyPanelEdit` gets its own `describe` below: it is the pure
 * state-transition half of `PanelWidths`' (`blindForms/fields.tsx`) live
 * split-on-`+` behaviour, pulled out specifically so it can be tested
 * without rendering — this repo has no `@testing-library/react` or jsdom
 * test environment to simulate real `onChange`/focus events against a
 * mounted component. Its cases simulate a live typing sequence as
 * SEPARATE calls (one per keystroke-driven `onChange`, exactly how
 * `PanelWidths` drives it), pinning the exact corruption a naive
 * index-keyed re-render causes when focus is not moved after a split: the
 * next keystroke landing back in the first panel instead of the new one.
 * `applyPanelEdit`'s `focusIndex` return value is what `PanelWidths` uses
 * to move focus — see that function's own JSDoc for why the DOM-focus half
 * of the fix (the `useEffect` + ref map in `PanelWidths`) is verified by
 * code-level reasoning rather than a test here.
 */

import { describe, it, expect } from 'vitest';
import { parsePanelInput, formatPanelInput, applyPanelEdit } from './panelInput';

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

describe('applyPanelEdit', () => {
  it('pins the corruption case: "118+118" typed as separate keystroke events into panel 0 must end up ["118","118"], not ["118118",""]', () => {
    // Simulates typing '118', then '+', then '118' as three separate
    // change events (the granularity that matters — the middle event is
    // the one where the split happens and focus must move). Each call
    // below plays the role of one onChange firing against whichever panel
    // currently holds focus, exactly as `PanelWidths` drives it.
    let panels = [''];

    // Typed '1', '11', '118' — ordinary typing, no '+' yet, same panel.
    let r = applyPanelEdit(panels, 0, '118');
    panels = r.panels;
    expect(panels).toEqual(['118']);
    expect(r.focusIndex).toBeNull(); // no split: nothing to refocus

    // Typed '+' — the split happens on THIS keystroke.
    r = applyPanelEdit(panels, 0, '118+');
    panels = r.panels;
    expect(panels).toEqual(['118', '']);
    // The trailing panel is ready and waiting — this is what a caller
    // (PanelWidths) must move focus to.
    expect(r.focusIndex).toBe(1);
    const focusIndex = r.focusIndex;
    if (focusIndex === null) throw new Error('expected a focus index after a split');

    // The bug this guards: if focus were NOT moved, the next keystroke
    // would still target panel 0, corrupting it to '1181'. Simulating the
    // CORRECT behaviour — typing lands in the panel `focusIndex` named —
    // proves panel 0 stays exactly '118', untouched by what comes next.
    r = applyPanelEdit(panels, focusIndex, '1');
    panels = r.panels;
    expect(panels).toEqual(['118', '1']);
    expect(panels[0]).toBe('118'); // must NOT have become '1181'

    r = applyPanelEdit(panels, 1, '11');
    panels = r.panels;
    r = applyPanelEdit(panels, 1, '118');
    panels = r.panels;
    expect(panels).toEqual(['118', '118']);
  });

  it('a plain value with no "+" updates only the edited panel and asks for no focus change', () => {
    const r = applyPanelEdit(['100', '200'], 1, '250');
    expect(r.panels).toEqual(['100', '250']);
    expect(r.focusIndex).toBeNull();
  });

  it('leaves every OTHER panel in the row untouched by a split', () => {
    const r = applyPanelEdit(['50', '', '200'], 1, '118.5+118');
    expect(r.panels).toEqual(['50', '118.5', '118', '200']);
  });

  it('reports the first newly-created index after a multi-way split, not the last', () => {
    const r = applyPanelEdit(['', '200'], 0, '100+120+140');
    expect(r.panels).toEqual(['100', '120', '140', '200']);
    expect(r.focusIndex).toBe(1);
  });
});
