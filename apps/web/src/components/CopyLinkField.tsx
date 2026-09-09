// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Read-only URL row with a copy-to-clipboard button.
 *
 * Exists so a consultant can hand the customer-facing page to someone
 * over a channel the app does not send itself — WhatsApp, SMS, a phone
 * call read-out — instead of being forced through the email send. The
 * field is deliberately a real (read-only) `<input>` rather than text:
 * a long capability URL then scrolls horizontally inside its own box,
 * stays selectable for a manual copy, and remains reachable by keyboard
 * on browsers where the Clipboard API is unavailable.
 *
 * Copying degrades in three steps because `navigator.clipboard` is
 * gated on a secure context and, on some in-app browsers, on a user
 * gesture the React handler has already consumed: the async API first,
 * then the legacy `document.execCommand('copy')` over the selected
 * input, and finally an on-screen instruction to press Ctrl/Cmd+C with
 * the text left selected. The button never silently does nothing.
 *
 * State is local and self-clearing (`COPIED_MS`); the parent owns only
 * the value, so the same component works for a link that is still being
 * minted (`value === null` renders the disabled loading state).
 */

import { useEffect, useRef, useState } from 'react';

/** How long the "Copied" confirmation stays up, in milliseconds. */
const COPIED_MS = 2000;

/** Outcome of the last copy attempt; drives the button label. */
type CopyState = 'idle' | 'copied' | 'manual';

export interface CopyLinkFieldProps {
  /** Field label rendered above the input. */
  label: string;
  /**
   * The absolute URL to display. `null` means "not resolved yet" — the
   * field renders a disabled placeholder instead of an empty box.
   */
  value: string | null;
  /** Optional helper line under the field explaining what the link is. */
  hint?: string;
  /** Message shown in place of the field when resolving the URL failed. */
  error?: string | null;
}

/**
 * Renders `value` in a read-only input beside a Copy button.
 *
 * @param props - See {@link CopyLinkFieldProps}.
 */
export default function CopyLinkField({ label, value, hint, error }: CopyLinkFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<CopyState>('idle');

  // Reset the confirmation whenever the link itself changes, so a stale
  // "Copied" from the previous order cannot describe a new URL.
  useEffect(() => setState('idle'), [value]);

  useEffect(() => {
    if (state === 'idle') return;
    const t = setTimeout(() => setState('idle'), COPIED_MS);
    return () => clearTimeout(t);
  }, [state]);

  /** Selects the whole URL so a manual copy needs one keystroke. */
  function selectAll() {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
    el.setSelectionRange(0, el.value.length);
  }

  async function handleCopy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
      return;
    } catch {
      // Falls through to the legacy path below.
    }
    selectAll();
    try {
      // `execCommand` is deprecated but remains the only copy path in a
      // non-secure context, which is where the async API just failed.
      if (document.execCommand('copy')) {
        setState('copied');
        return;
      }
    } catch {
      // Ignored — the manual instruction is the last resort.
    }
    setState('manual');
  }

  if (error) {
    return (
      <div>
        <span className="mb-1.5 block text-xs font-medium text-text-secondary">{label}</span>
        <p className="text-[13px] text-danger">{error}</p>
      </div>
    );
  }

  return (
    <div>
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-text-secondary">{label}</span>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            readOnly
            value={value ?? ''}
            placeholder="Preparing link…"
            onFocus={selectAll}
            className="h-11 min-w-0 flex-1 rounded-md border border-border-input bg-surface-muted px-3 text-[13px] text-text-secondary"
          />
          <button
            type="button"
            onClick={handleCopy}
            disabled={!value}
            aria-label={`Copy ${label.toLowerCase()}`}
            className="h-11 shrink-0 rounded-md border border-border-input bg-surface px-3 text-[13px] font-medium text-text-secondary hover:bg-surface-muted disabled:opacity-40"
          >
            {state === 'copied' ? 'Copied' : 'Copy'}
          </button>
        </div>
      </label>
      {state === 'manual' ? (
        <p className="mt-1.5 text-[12px] text-text-muted">
          Copying is blocked in this browser — the link is selected, press Ctrl/Cmd+C.
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-[12px] text-text-muted">{hint}</p>
      ) : null}
    </div>
  );
}
