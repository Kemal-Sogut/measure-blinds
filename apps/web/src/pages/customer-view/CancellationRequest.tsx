// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Cancellation-request block on the public order summary.
 *
 * Pure presentational: all network calls, error handling and the
 * eligibility decision live in `CustomerView.tsx`. This component owns
 * only the local draft of the customer's reason and which of its two
 * faces is showing.
 *
 * Two states:
 *   pending  → the customer has an open request and is waiting on an
 *              answer, with the option to withdraw it
 *   idle     → a quiet "Request cancellation" link that expands into a
 *              short form with an optional reason
 *
 * A confirmation can NEVER be undone by the customer — this only ASKS,
 * and the copy is written to make that unambiguous so nobody assumes
 * their order is already cancelled. The parent mounts this only while
 * the request is actually grantable (awaiting payment, nothing paid),
 * so the button is never offered when the server would refuse it.
 *
 * The block is styled neutrally on purpose. The red alarm treatment
 * belongs on the STAFF order page, where an open request is something to
 * act on; on the customer's own page red would read as an error.
 */

import { useState } from 'react';

/** Presentational contract — the parent owns every side effect. */
interface CancellationRequestProps {
  /** True once the customer has an open, unanswered request. */
  pending: boolean;
  /** Submits the request; the parent handles failure reporting. */
  onRequest: (note: string) => void;
  /** Withdraws an open request. */
  onWithdraw: () => void;
  /** Disables both actions while a call is in flight. */
  busy: boolean;
}

export default function CancellationRequest({
  pending,
  onRequest,
  onWithdraw,
  busy,
}: CancellationRequestProps) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');

  if (pending) {
    return (
      <section className="mb-4 rounded-2xl border border-warning/40 bg-surface-elevated p-4">
        <h2 className="mb-1 text-sm font-semibold text-text-primary">
          Cancellation requested
        </h2>
        <p className="mb-3 text-sm text-text-secondary">
          We&apos;ve received your request and will be in touch shortly. Your order is still
          confirmed until we&apos;ve reviewed it.
        </p>
        <button
          type="button"
          onClick={onWithdraw}
          disabled={busy}
          className="h-11 w-full rounded-xl border border-border bg-surface px-4 text-sm font-medium text-text-secondary hover:bg-surface-sunken disabled:opacity-50"
        >
          {busy ? 'Working…' : 'Never mind, keep my order'}
        </button>
      </section>
    );
  }

  if (!open) {
    return (
      <div className="mb-4 text-center">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs text-text-muted underline underline-offset-2 hover:text-text-secondary"
        >
          Need to cancel this order?
        </button>
      </div>
    );
  }

  return (
    <section className="mb-4 rounded-2xl border border-border bg-surface-elevated p-4">
      <h2 className="mb-1 text-sm font-semibold text-text-primary">Request a cancellation</h2>
      <p className="mb-3 text-sm text-text-secondary">
        This sends us a request — it doesn&apos;t cancel the order on its own. We&apos;ll review
        it and get back to you.
      </p>
      <label htmlFor="cancel-reason" className="mb-1 block text-xs font-medium text-text-muted">
        Reason (optional)
      </label>
      <textarea
        id="cancel-reason"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={500}
        rows={3}
        placeholder="Let us know why, if you'd like."
        className="mb-3 w-full rounded-xl border border-border bg-surface p-3 text-sm text-text-primary placeholder:text-text-muted focus:border-brand-600 focus:outline-none"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setNote('');
          }}
          disabled={busy}
          className="h-11 flex-1 rounded-xl border border-border bg-surface text-sm font-medium text-text-secondary hover:bg-surface-sunken disabled:opacity-50"
        >
          Never mind
        </button>
        <button
          type="button"
          onClick={() => onRequest(note.trim())}
          disabled={busy}
          className="h-11 flex-1 rounded-xl bg-danger text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Sending…' : 'Send request'}
        </button>
      </div>
    </section>
  );
}
