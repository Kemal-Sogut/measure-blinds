// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Text size preference: which of the app's font scales this device uses.
 *
 * The choice is per DEVICE (localStorage), not per account: the same
 * consultant may want large text on a phone read outdoors and the
 * default on a desktop monitor. It is applied by stamping
 * `data-font-size` on `<html>`; `index.css` maps that attribute to
 * `--font-scale`, which every font-size token multiplies by. This file
 * knows only the option names — the multipliers live in the CSS alone.
 *
 * `initFontSize()` runs in `main.tsx` before React renders, so a saved
 * Large setting never flashes at the default size first.
 */

/** The selectable text sizes, smallest first. `default` is the design's own sizes. */
export const FONT_SIZES = ['default', 'large', 'xlarge'] as const;

/** One selectable text size; the value stamped as `<html data-font-size>`. */
export type FontSize = (typeof FONT_SIZES)[number];

/** User-facing names for each size, in the Settings control. */
export const FONT_SIZE_LABELS: Record<FontSize, string> = {
  default: 'Default',
  large: 'Large',
  xlarge: 'Extra large',
};

/** localStorage key holding this device's chosen size. */
const STORAGE_KEY = 'bn.fontSize';

/**
 * Turns a raw stored value into a known size. Anything unrecognised —
 * nothing stored yet, a value from a removed option, a hand-edited
 * string — falls back to `default` rather than leaving the app unscaled
 * by an attribute the CSS does not know.
 *
 * @param raw the `localStorage` value, or null when nothing is stored
 */
export function parseFontSize(raw: string | null): FontSize {
  return (FONT_SIZES as readonly string[]).includes(raw ?? '') ? (raw as FontSize) : 'default';
}

/**
 * Reads this device's saved size. Returns `default` when localStorage is
 * unavailable (private-mode Safari throws on access) so boot never fails
 * over a display preference.
 */
export function readStoredFontSize(): FontSize {
  try {
    return parseFontSize(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return 'default';
  }
}

/**
 * Applies a size to the page immediately by stamping `<html data-font-size>`.
 * Does not persist; see `saveFontSize`.
 */
export function applyFontSize(size: FontSize): void {
  document.documentElement.dataset.fontSize = size;
}

/**
 * Applies a size and remembers it on this device. A storage failure is
 * ignored: the size still applies for this session, it just does not
 * survive a reload.
 */
export function saveFontSize(size: FontSize): void {
  applyFontSize(size);
  try {
    window.localStorage.setItem(STORAGE_KEY, size);
  } catch {
    // Non-fatal: see above.
  }
}

/** Boot hook for `main.tsx`: applies the saved size before the first render. */
export function initFontSize(): void {
  applyFontSize(readStoredFontSize());
}
