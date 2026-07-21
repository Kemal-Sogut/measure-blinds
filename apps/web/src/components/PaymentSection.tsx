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
 * Money is display-only here: `balance` is computed server-side from the
 * order total minus the payments ledger and passed straight through.
 * This component never derives an amount (AI_GUIDELINES rule 1).
 *
 * The caller decides when to mount it — the rule is "confirmed, and
 * still owing" — so this renders unconditionally EXCEPT when no
 * e-Transfer address is configured, in which case it renders nothing
 * rather than showing an empty box the customer cannot act on.
 *
 * Online card payment is out of scope; when it lands, this is the single
 * place to add it without touching the confirmation flow.
 */

interface PaymentSectionProps {
  /** Outstanding balance, server-computed (total − payments). */
  balance: number;
  /** Total already received, server-computed. Shown once non-zero. */
  amountPaid: number;
  /** e-Transfer recipient from company settings; empty hides the block. */
  payToEmail: string;
  /** Optional extra instructions from company settings. */
  instructions?: string;
  /** Shown so the customer can quote it in the transfer message. */
  orderNumber: string;
}

export default function PaymentSection({
  balance,
  amountPaid,
  payToEmail,
  instructions,
  orderNumber,
}: PaymentSectionProps) {
  if (!payToEmail) return null;

  return (
    <section className="mb-4 rounded-2xl bg-surface-elevated p-4 text-left">
      <h2 className="mb-2 text-xs font-semibold text-text-muted">HOW TO PAY</h2>
      <p className="mb-3 text-sm text-text-secondary">
        Please send your payment by Interac e-Transfer to:
      </p>
      <p className="mb-3 rounded-xl bg-surface-sunken px-3 py-2.5 text-center font-medium break-all text-text-primary">
        {payToEmail}
      </p>

      <div className="mb-3 text-sm">
        {amountPaid > 0 && (
          <div className="flex justify-between text-text-secondary">
            <span>Paid to date</span>
            <span className="font-mono">${amountPaid.toFixed(2)}</span>
          </div>
        )}
        <div className="flex justify-between font-semibold text-text-primary">
          <span>Balance due</span>
          <span className="font-mono">${balance.toFixed(2)}</span>
        </div>
      </div>

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
