// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Panel-width shorthand parser.
 *
 * A blind can have several panels, each with its own width in cm. The
 * entry forms used to require tapping "+ Panel" to add a second width
 * input; this module lets a consultant instead type `118.5+118` into ONE
 * field to mean two panels. `parsePanelInput` / `formatPanelInput` are a
 * pure, framework-free pair — no React, no store, no validation — so they
 * can be unit-tested in isolation and reused by both the single-item form
 * and the bulk-add rows (a later task wires them into the `panels` field
 * inputs; this file is intentionally UI-free).
 */

/**
 * Splits a single typed panel-width entry on `+` into one trimmed width
 * string per panel.
 *
 * Behaviour by design:
 * - `''` → `['']` (ONE blank panel, not zero). A blank measurement row
 *   must stay a blank row with one empty input — collapsing it to an
 *   empty panel list would make the row disappear out from under the
 *   consultant while they are still filling it in.
 * - A trailing (or leading) `+` — the state of the field mid-typing, e.g.
 *   right after tapping `+` before the next digit — produces a trailing
 *   (or leading) `''` entry rather than throwing or dropping the digits
 *   already typed. `String.prototype.split` never throws here; there is
 *   no failure mode to guard against.
 * - Surrounding whitespace around `+` (e.g. `'118.5 + 118'`, easy to type
 *   by mistake on a phone keyboard) is trimmed away per panel.
 *
 * Deliberately does NOT validate that each resulting string is a valid
 * positive number. `parsePositive` (`lineItemDrafts.ts`) already owns
 * numeric validation for a panel width, and the save-time rules own
 * completeness (every panel must end up non-blank and positive). This
 * function only owns the SPLIT. If it "corrected" or rejected a panel
 * value — e.g. bouncing `'12.'` or a stray `'abc'` — it would be rewriting
 * or fighting the user's input on every keystroke, since this runs on
 * each `onChange` while the field is still mid-edit; a half-typed decimal
 * like `12.` (about to become `12.5`) has to survive completely untouched
 * or the cursor and the digit the user is mid-typing get clobbered. A
 * future maintainer adding "helpful" number-cleanup here would silently
 * break typing for every panel-width field in the app — leave validation
 * to `parsePositive` and the save-time checks, which run at points where
 * the user has stopped typing.
 *
 * @param value the raw content of one panel-width input field
 * @returns one trimmed string per panel, always at least one entry
 */
export function parsePanelInput(value: string): string[] {
  return value.split('+').map((part) => part.trim());
}

/**
 * Renders an array of panel widths back into the single `+`-joined string
 * the UI shows in one input field — the inverse of `parsePanelInput`.
 *
 * Used wherever an existing `draft.panels` array (however it was built —
 * typed as shorthand, added one at a time via "+ Panel", or loaded from a
 * saved line item) needs to be displayed back as one editable field. Does
 * no numeric formatting or validation for the same reason `parsePanelInput`
 * does not: these are draft strings that may be blank or mid-typed, and
 * this function must not "clean up" a value the user has not finished
 * entering.
 *
 * Round-trips with `parsePanelInput` for values without incidental
 * whitespace: `formatPanelInput(parsePanelInput(v)) === v`, and
 * `parsePanelInput(formatPanelInput(panels))` restores `panels`.
 *
 * @param panels panel-width strings, in display order
 * @returns the panels joined with `+`; `''` for an empty array or a
 *   single blank panel, matching what `parsePanelInput('')` produces
 */
export function formatPanelInput(panels: string[]): string {
  return panels.join('+');
}
