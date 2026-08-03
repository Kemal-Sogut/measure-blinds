// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * AddressAutocomplete — a labelled Address-Line-1 text input used on
 * every customer-entry surface (the full `CustomerForm` page and the
 * quick `CustomerCreateModal`).
 *
 * CURRENT BEHAVIOR: the search-as-you-type dropdown is switched OFF via
 * `ADDRESS_SEARCH_ENABLED` (see below) — the component renders a plain
 * controlled input and `onSelect` never fires. Callers keep passing
 * `onSelect` so that re-enabling the switch needs no call-site change.
 *
 * WHEN ENABLED: as the consultant types, it debounces the term and
 * queries Photon (`lib/addressSearch`); picking a suggestion fires
 * `onSelect` with a normalised, form-ready address so the parent can
 * auto-fill line 1, city, province, and postal code in one tap.
 *
 * In either mode the component behaves as a normal controlled input:
 * `onChange` mirrors every keystroke back to the parent's
 * Address-Line-1 field, so manual entry (or editing after an auto-fill)
 * always works. Autocomplete is strictly additive — a network failure
 * degrades to plain typing, never an error state.
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
 * Disabled 2026-08-01: the Photon results proved unreliable in the field
 * (wrong or missing streets for real service-area addresses), so the
 * dropdown is off and this component behaves as a plain controlled text
 * input. `onSelect` therefore never fires while this is false.
 *
 * The query layer in `lib/addressSearch.ts` is deliberately left intact
 * and still correct — flipping this to `true` restores the full
 * autocomplete with no other edit anywhere in the tree.
 */
const ADDRESS_SEARCH_ENABLED = false;

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

  // Suppress the search that would otherwise fire from the onChange a
  // selection triggers (auto-filling line 1 should not re-open the list).
  const skipNextSearch = useRef(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debounced = useDebouncedValue(value, 300);

  useEffect(() => {
    // Kill-switch: no debounce reaction, no AbortController, no Photon
    // request. Everything below this line is dormant while the switch is
    // off; the component renders as a plain input (see the early return
    // after the hooks).
    if (!ADDRESS_SEARCH_ENABLED) return;
    if (skipNextSearch.current) {
      skipNextSearch.current = false;
      return;
    }
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

  /** Applies a chosen suggestion and closes the dropdown. */
  function choose(s: AddressSuggestion) {
    skipNextSearch.current = true;
    onSelect(s);
    setOpen(false);
    setSuggestions([]);
    setHighlight(-1);
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
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
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
