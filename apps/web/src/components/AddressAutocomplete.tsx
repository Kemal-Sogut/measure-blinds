// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * AddressAutocomplete — a labelled Address-Line-1 text input used on
 * every customer-entry surface (the full `CustomerForm` page and the
 * quick `CustomerCreateModal`).
 *
 * BEHAVIOR: as the consultant types, the term is debounced (300 ms) and
 * sent to Photon (`lib/addressSearch`); picking a suggestion fires
 * `onSelect` with a normalised, form-ready address so the parent can
 * auto-fill line 1, city, province, and postal code in one tap.
 *
 * SELECTION LOCK: once a suggestion has been chosen, lookup goes dormant
 * — no debounce reaction, no request, no dropdown — until the consultant
 * edits the field again (any keystroke, including a deletion). Without
 * the lock the auto-filled line 1 is itself a search term, so the list
 * would re-open over a field the consultant has already finished with,
 * and a blur/refocus would bring it back. The lock is released inside the
 * input's own `onChange`, which fires for real edits only — a parent
 * re-rendering the filled value never releases it.
 *
 * In either mode the component behaves as a normal controlled input:
 * `onChange` mirrors each keystroke back to the parent's Address-Line-1
 * field, so manual entry (or editing after an auto-fill) always works.
 * Autocomplete is strictly additive — a network failure degrades to
 * plain typing, never an error state.
 *
 * Interaction while enabled: ↑/↓ move the highlight, Enter selects it,
 * Escape or a blur closes the list (blur is delayed so a mouse click on
 * a row still registers before the list unmounts).
 */

import { useEffect, useRef, useState } from 'react';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { searchAddresses, type AddressSuggestion } from '../lib/addressSearch';

const INPUT_CLS =
  'h-11 w-full rounded-sm border border-border-input bg-surface px-3 text-sm text-text-primary';

/**
 * Master switch for search-as-you-type address lookup.
 *
 * Disabled 2026-08-01 (Photon returned wrong or missing streets for real
 * service-area addresses), re-enabled 2026-08-20 at the operator's request
 * and now paired with the selection lock described in the module header, so
 * a completed address is never re-queried.
 *
 * Setting this back to `false` restores the plain-input fallback: no
 * debounce reaction, no `AbortController`, no Photon request, and `onSelect`
 * never fires. The query layer in `lib/addressSearch.ts` is independent of
 * this flag, so flipping it either way needs no other edit in the tree.
 */
const ADDRESS_SEARCH_ENABLED = true;

export default function AddressAutocomplete({
  label,
  value,
  onChange,
  onSelect,
  required = false,
  autoFocus = false,
}: {
  label: string;
  /** Current Address-Line-1 text (controlled by the parent form). */
  value: string;
  /** Mirrors raw keystrokes back to the parent's line-1 field. */
  onChange: (v: string) => void;
  /** Fired when a suggestion is chosen — carries all structured fields. */
  onSelect: (suggestion: AddressSuggestion) => void;
  required?: boolean;
  autoFocus?: boolean;
}) {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [loading, setLoading] = useState(false);

  // True from the moment a suggestion is applied until the consultant
  // edits the field again. While set, the debounce effect performs no
  // lookup, so an auto-filled address cannot re-open its own dropdown.
  const selectionLocked = useRef(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debounced = useDebouncedValue(value, 300);

  useEffect(() => {
    // Kill-switch: no debounce reaction, no AbortController, no Photon
    // request. Everything below this line is dormant while the switch is
    // off; the component renders as a plain input (see the early return
    // after the hooks).
    if (!ADDRESS_SEARCH_ENABLED) return;
    // Address already picked and untouched since — stay dormant.
    if (selectionLocked.current) return;
    const term = debounced.trim();
    if (term.length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    searchAddresses(term, controller.signal)
      .then((results) => {
        // Only a selection can take the lock while this request is in
        // flight, and it closes the list itself — re-check so a late
        // response cannot re-open it over the filled field.
        if (selectionLocked.current) return;
        setSuggestions(results);
        setOpen(results.length > 0);
        setHighlight(-1);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [debounced]);

  // Clear the pending blur-close timer on unmount.
  useEffect(() => () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
  }, []);

  /** Applies a chosen suggestion, closes the dropdown and takes the lock. */
  function choose(s: AddressSuggestion) {
    selectionLocked.current = true;
    onSelect(s);
    setOpen(false);
    setSuggestions([]);
    setHighlight(-1);
    setLoading(false);
  }

  /**
   * Handles a real edit of the field: releases the selection lock — the
   * consultant typed or deleted, so lookup is wanted again — and mirrors
   * the text to the parent's line-1 state.
   */
  function handleChange(next: string) {
    selectionLocked.current = false;
    onChange(next);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => (h + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter' && highlight >= 0) {
      e.preventDefault();
      choose(suggestions[highlight]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  // Kill-switch path: the bare labelled input, with none of the
  // dropdown markup, ARIA combobox roles, or blur timers below. Placed
  // after every hook so the hook order is identical in both branches.
  if (!ADDRESS_SEARCH_ENABLED) {
    return (
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-text-secondary">
          {label}
          {required && <span className="text-danger"> *</span>}
        </span>
        <input
          type="text"
          value={value}
          autoFocus={autoFocus}
          autoComplete="off"
          onChange={(e) => onChange(e.target.value)}
          className={INPUT_CLS}
        />
      </label>
    );
  }

  return (
    <label className="relative block">
      <span className="mb-1.5 block text-xs font-medium text-text-secondary">
        {label}
        {required && <span className="text-danger"> *</span>}
      </span>
      <input
        type="text"
        value={value}
        autoFocus={autoFocus}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => !selectionLocked.current && suggestions.length > 0 && setOpen(true)}
        onBlur={() => {
          // Delay so a click on a suggestion row registers first.
          blurTimer.current = setTimeout(() => setOpen(false), 150);
        }}
        className={INPUT_CLS}
      />
      {loading && open && (
        <span className="absolute right-3 top-9 text-[11px] text-text-muted">…</span>
      )}
      {open && suggestions.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-sm border border-border-input bg-surface shadow-md"
        >
          {suggestions.map((s, i) => (
            <li key={s.id} role="option" aria-selected={i === highlight}>
              <button
                type="button"
                // onMouseDown (not onClick) so it fires before the input's blur.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(s);
                }}
                className={`block w-full truncate px-3 py-2 text-left text-sm text-text-primary hover:bg-surface-muted ${
                  i === highlight ? 'bg-surface-muted' : ''
                }`}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </label>
  );
}
