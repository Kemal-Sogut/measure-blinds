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
 *
 * `applyPanelEdit` and `insertPanelSeparator` are the two UI-free "what
 * should happen" decisions behind the two ways a `+` can get INTO one of
 * these fields: `applyPanelEdit` is what `PanelWidths` (the single-item
 * form) runs on every keystroke, since typing `+` there works normally.
 * `insertPanelSeparator` backs the bulk-add row's small "+" button instead
 * — that field's `inputMode="decimal"` gives it no `+` key on iOS at all,
 * so a button has to insert the character on the user's behalf, at
 * whatever the current text selection is, same as any other text edit.
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

/**
 * Applies one panel-width input's new raw value into a `panels` array,
 * expanding `+` shorthand via `parsePanelInput` in place of the single
 * panel being edited, and reports which index — if any — a caller must
 * move keyboard focus to afterwards.
 *
 * Exists as a pure function, separate from the component that calls it
 * (`PanelWidths` in `blindForms/fields.tsx`), specifically so the FOCUS
 * decision can be unit-tested without a DOM/React-rendering harness this
 * repo does not have (no `@testing-library/react`, no jsdom environment —
 * see `panelInput.test.ts`'s own doc for what that lets this file's tests
 * pin down and what they cannot).
 *
 * The focus index matters because of a real corruption bug this function
 * exists to prevent: `PanelWidths` renders one `<input>` per panel keyed
 * by ARRAY INDEX. When a split inserts new panels, React reconciles the
 * index the user was typing into as the SAME DOM node (same key, no
 * unmount) and force-corrects its value down from the live keystroke
 * (e.g. `'118+'`) to the shorter split result (`'118'`) — but does nothing
 * to move focus. Left alone, the browser's caret and React's idea of
 * "which input has focus" both stay on that same node, so the very next
 * keystroke lands back in the FIRST panel instead of the new one the split
 * just created — `'118+118'` typed one character at a time would silently
 * produce panels `['118118', '']` instead of `['118', '118']`. The caller
 * MUST explicitly focus `focusIndex` (the first newly-created panel, i.e.
 * `index + 1` — always a real index, since `parsePanelInput` always splits
 * a `+`-containing value into 2 or more parts) once the new panel's input
 * has mounted, or this bug reappears.
 *
 * @param panels current panel-width strings, in display order
 * @param index which panel is being edited
 * @param value that panel input's new raw value (post-keystroke)
 * @returns `panels` with `index` updated (or expanded, if `value` contains
 *   `+`), and `focusIndex` — the panel index to focus next, or `null` when
 *   no split happened and the edited input should simply keep its own
 *   focus, which it already has and nothing needs to move it there
 */
export function applyPanelEdit(
  panels: string[],
  index: number,
  value: string
): { panels: string[]; focusIndex: number | null } {
  if (!value.includes('+')) {
    const next = panels.slice();
    next[index] = value;
    return { panels: next, focusIndex: null };
  }
  const next = panels.slice();
  next.splice(index, 1, ...parsePanelInput(value));
  return { panels: next, focusIndex: index + 1 };
}

/**
 * Inserts a `+` panel separator into `value`, REPLACING the
 * `[selectionStart, selectionEnd)` range rather than inserting blindly at
 * one point — the same thing every native text field does when a keystroke
 * lands on top of a selection. A COLLAPSED selection (`selectionStart ===
 * selectionEnd`, the ordinary case: no text highlighted, just a caret)
 * degrades to a plain insert at that one position, so a caller with no
 * live selection to report can simply pass the same value for both.
 *
 * Exists as a pure function, separate from the button that calls it
 * (`RowFields` in `BulkAddSectionCard.tsx`), for the same reason
 * `applyPanelEdit` above is pure and separate from `PanelWidths`: so the
 * actual decision — where the `+` lands and where the caret goes
 * afterwards — is unit-testable without a DOM/React-rendering harness this
 * repo does not have (no `@testing-library/react`, no jsdom environment).
 * Only the caller's `.focus()` / `.setSelectionRange()` calls that carry
 * the returned `caret` back onto the real input are left untested, for the
 * same reason `applyPanelEdit`'s own DOM-focus half is.
 *
 * Both bounds are clamped to `[0, value.length]` and reordered if given
 * reversed (`selectionStart > selectionEnd`) before use — defensive, since
 * `HTMLInputElement.selectionStart`/`selectionEnd` should never actually
 * violate either, but nothing at the type level enforces that on values
 * handed in from outside a real input (e.g. a test, or a future caller).
 *
 * @param value the field's current raw string
 * @param selectionStart one edge of the current selection — or the caret
 *   position itself, for a collapsed selection
 * @param selectionEnd the other edge (equal to `selectionStart` for a
 *   collapsed selection, i.e. a plain caret with nothing highlighted)
 * @returns `value` with the selected range replaced by `+`, and `caret` —
 *   the offset immediately after the inserted `+`, where the caller must
 *   move focus afterwards (see `RowFields`'s own doc for why)
 */
export function insertPanelSeparator(
  value: string,
  selectionStart: number,
  selectionEnd: number
): { value: string; caret: number } {
  const length = value.length;
  const a = Math.min(Math.max(selectionStart, 0), length);
  const b = Math.min(Math.max(selectionEnd, 0), length);
  const start = Math.min(a, b);
  const end = Math.max(a, b);
  return { value: value.slice(0, start) + '+' + value.slice(end), caret: start + 1 };
}
