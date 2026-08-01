// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Interac e-Transfer payment details on the public order summary.
 *
 * Pure presentational. The recipient address and instructions come from
 * the `company_settings` singleton (served through
 * `/public/estimate/:token`) — they used to be a literal in this file,
 * which meant changing where customers send money required a redeploy.
 *
 * Instructions, plus ONE optional figure: the up-front deposit to send
 * now. The receipt history, paid-to-date and balance due all live in the
 * totals block on the customer page so they stay visible once an order
 * is paid in full (at which point this section is unmounted), and so no
 * figure is stated in two places. `depositDue` is not an exception to
 * that — it is the amount to transfer, which appears nowhere else, and
 * it is computed by the Worker (`deposit_due`), never here.
 *
 * The caller decides when to mount it — the rule is "confirmed, and
 * still owing" — and separately decides whether the deposit applies (the
 * order is awaiting payment and nothing has been received yet). This
 * renders unconditionally EXCEPT when no e-Transfer address is
 * configured, in which case it renders nothing rather than showing an
 * empty box the customer cannot act on.
 *
 * Online card payment is out of scope; when it lands, this is the single
 * place to add it without touching the confirmation flow.
 */

interface PaymentSectionProps {
  /** e-Transfer recipient from company settings; empty hides the block. */
  payToEmail: string;
  /** Optional extra instructions from company settings. */
  instructions?: string;
  /** Shown so the customer can quote it in the transfer message. */
  orderNumber: string;
  /**
   * Server-computed 50% deposit (`deposit_due`). Passed only while the
   * order is awaiting its first payment; omitted afterwards, when the
   * amount to send is the balance shown in the totals block instead.
   */
  depositDue?: number;
}

export default function PaymentSection({
  payToEmail,
  instructions,
  orderNumber,
  depositDue,
}: PaymentSectionProps) {
  if (!payToEmail) return null;

  return (
    <section className="mb-4 rounded-xl border border-border-light bg-surface p-4 text-left shadow-md">
      <h2 className="mb-2 text-xs font-semibold text-text-muted">HOW TO PAY</h2>
      {depositDue !== undefined && (
        <div className="mb-3 rounded-xl bg-brand-100 px-3 py-2.5 text-center">
          <p className="text-xs font-medium text-brand-700">Deposit due now (50% of total)</p>
          <p className="font-mono text-xl font-semibold text-text-primary">
            ${depositDue.toFixed(2)}
          </p>
        </div>
      )}
      <p className="mb-3 text-sm text-text-secondary">
        {depositDue !== undefined
          ? 'Please send this deposit by Interac e-Transfer to:'
          : 'Please send your payment by Interac e-Transfer to:'}
      </p>
      <p className="mb-3 rounded-xl bg-surface-sunken px-3 py-2.5 text-center font-medium break-all text-text-primary">
        {payToEmail}
      </p>

      {instructions?.trim() && (
        <p className="mb-2 whitespace-pre-wrap text-xs text-text-secondary">
          {instructions.trim()}
        </p>
      )}
      <p className="text-xs text-text-muted">
        Please include your order number{' '}
        <span className="font-mono text-text-secondary">{orderNumber}</span> in the transfer
        message. We&apos;ll confirm receipt by email.
      </p>
    </section>
  );
}
