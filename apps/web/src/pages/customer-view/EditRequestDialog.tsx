// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * "Request a change" dialog on the public order summary.
 *
 * Pure presentational, in the same split as `CancellationRequest.tsx`:
 * the parent (`CustomerView.tsx`) owns the POST, the error reporting and
 * the decision to offer the button at all. This component owns only the
 * draft message and the character budget.
 *
 * Built on the shared `ui/Modal` so the public page inherits the same
 * Escape-to-close, backdrop dismissal, scroll lock and focus handling as
 * the staff app, rather than reimplementing them on an unauthenticated
 * surface where they would go untested. The BODY markup is written in
 * the customer page's own idiom (plain Tailwind, 11-unit tap targets)
 * instead of `ui/Button`, matching every other control on this page.
 *
 * The copy is written to set expectations precisely: this SENDS A
 * MESSAGE, it does not change the estimate. The customer's figures are
 * exactly what they were until the shop issues a revision, and the
 * Confirm button deliberately stays available underneath — asking a
 * question is not a reason to be locked out of accepting the quote as it
 * stands.
 *
 * The draft is reset each time the dialog OPENS, so a message that was
 * already filed is never re-presented as if it had not been sent. A send
 * that FAILS leaves the dialog open with the text intact, so a customer
 * never loses what they typed to a dropped connection.
 */

import { useEffect, useState } from 'react';
import Modal from '../../components/ui/Modal';

/** Longest message the Worker stores; anything beyond it is truncated. */
const MAX_CHARS = 1000;

/** Point at which the counter appears — a budget nobody needs to watch is noise. */
const COUNTER_THRESHOLD = 800;

/** Presentational contract — the parent owns every side effect. */
interface EditRequestDialogProps {
  /** Whether the dialog is mounted and visible. */
  open: boolean;
  /** Dismisses without sending; also called after a successful send. */
  onClose: () => void;
  /**
   * Submits the trimmed message. The parent resolves the promise on a
   * successful POST and REJECTS on failure, which is what keeps a failed
   * send from clearing the customer's text.
   */
  onSubmit: (message: string) => Promise<void>;
  /** True while the parent's POST is in flight. */
  busy: boolean;
  /**
   * Renders the send action inert without claiming anything is in
   * flight. Set by the staff preview (`?preview=1`), where the page must
   * look exactly like the customer's but must not be able to file a real
   * request. Kept separate from `busy` for the same reason as in
   * `CancellationRequest`: `busy` also swaps the label to "Sending…",
   * which would read as a stuck request rather than a disabled one.
   */
  disabled?: boolean;
}

export default function EditRequestDialog({
  open,
  onClose,
  onSubmit,
  busy,
  disabled = false,
}: EditRequestDialogProps) {
  const [message, setMessage] = useState('');

  /**
   * Start every visit with an empty box.
   *
   * Reopening after a successful send must not re-present the message
   * that was just filed — a customer would reasonably read it as "not
   * sent yet" and send it twice. Reset on OPEN rather than on close so
   * the text survives the dialog being torn down by an unmount.
   */
  useEffect(() => {
    if (open) setMessage('');
  }, [open]);

  const trimmed = message.trim();
  const canSend = Boolean(trimmed) && !busy && !disabled;

  async function handleSend() {
    if (!canSend) return;
    try {
      await onSubmit(trimmed);
      onClose();
    } catch {
      // The parent has already surfaced the failure; keep the draft so
      // the customer can retry without retyping.
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Request a change"
      subtitle="Tell us what you'd like adjusted"
    >
      <p className="mb-3 text-sm text-text-secondary">
        This sends your note to us — it doesn&apos;t change the estimate on its own. Your prices
        stay exactly as quoted until we send you a revised version.
      </p>

      <label htmlFor="edit-request-message" className="mb-1 block text-xs font-medium text-text-muted">
        What would you like changed?
      </label>
      <textarea
        id="edit-request-message"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        maxLength={MAX_CHARS}
        rows={5}
        placeholder="For example: could the kitchen blind be cordless, and can we drop the bay window for now?"
        className="w-full rounded-xl border border-border bg-surface p-3 text-sm text-text-primary placeholder:text-text-muted focus:border-brand-600 focus:outline-none"
      />
      {message.length >= COUNTER_THRESHOLD && (
        <p className="mt-1 text-right text-xs text-text-muted">
          {MAX_CHARS - message.length} characters left
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onClose}
          className="h-11 flex-1 rounded-xl border border-border bg-surface px-4 text-sm font-medium text-text-secondary hover:bg-surface-sunken"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={!canSend}
          className="h-11 flex-[2] rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {busy && !disabled ? 'Sending…' : 'Send request'}
        </button>
      </div>
    </Modal>
  );
}
