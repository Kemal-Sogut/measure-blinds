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
 * Instructions, plus ONE optional figure — the amount to transfer now,
 * carrying its own caption and lead-in line (`amountDue`). Two figures use
 * that slot, one at a time: the up-front 50% deposit while the order
 * awaits its first payment, and the remaining balance once the order is
 * installed and money is still owed. Both are computed by the Worker
 * (`deposit_due` / `balance`) and handed in — this component NEVER derives
 * money (AI_GUIDELINES rule 1).
 *
 * The receipt history and paid-to-date live only in the totals block on
 * the customer page, so they are never stated twice. The balance is the
 * single figure shown in two places, and deliberately: the totals block
 * carries the running "Balance due", while an installed customer also
 * needs that amount right here, next to the e-Transfer address they must
 * send it to. The deposit, by contrast, appears nowhere else.
 *
 * The caller decides when to mount it — the rule is "confirmed, still
 * owing, and the customer actually has a transfer to make now": while the
 * 50% deposit is outstanding, or, once production is finished, when the
 * order is installed and a balance remains. Between those windows (the
 * deposit is in, the order is in production or ready) nothing is expected
 * from the customer, so the caller does not mount this at all. The caller
 * also decides which figure (`amountDue`) to quote, or none — a partial
 * deposit that has not yet reached 50% is a "how to pay" with no headline
 * figure. This renders unconditionally EXCEPT when no e-Transfer address
 * is configured, in which case it renders nothing rather than showing an
 * empty box the customer cannot act on.
 *
 * Colour: the whole block is amber (`warning` / `warning-tint`), not the
 * neutral surface the other cards use. That is the design system's own
 * meaning for this token — "awaiting payment, action needed"
 * (`index.css`) — and this section EXISTS only while money is owed, so
 * the warning hue is a property of the block, not a state it toggles
 * into. Amber rather than red on purpose: `danger` is reserved for
 * expired/overdue/destructive, and a customer who confirmed an hour ago
 * is not late.
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
   * The single figure to transfer now, with its own caption and lead-in
   * line — or omitted when no headline figure applies (e.g. a partial
   * deposit is in but the order is not yet installed). `amount` is ALWAYS
   * a server-computed figure the caller selected (`deposit_due` for the
   * up-front deposit, `balance` for the final balance); this component
   * never computes money itself (AI_GUIDELINES rule 1).
   */
  amountDue?: {
    /** Dollar figure to display, already computed by the Worker. */
    amount: number;
    /** Caption above the figure, e.g. "Deposit due now (50% of total)". */
    caption: string;
    /** Lead-in sentence shown above the e-Transfer address. */
    instruction: string;
  };
}

export default function PaymentSection({
  payToEmail,
  instructions,
  orderNumber,
  amountDue,
}: PaymentSectionProps) {
  if (!payToEmail) return null;

  return (
    <section className="mb-4 rounded-xl border border-warning/30 bg-warning-tint p-4 text-left shadow-md">
      <h2 className="mb-2 text-xs font-semibold text-warning">⚠ HOW TO PAY</h2>
      {amountDue && (
        <div className="mb-3 rounded-xl border border-warning/40 bg-surface px-3 py-2.5 text-center">
          <p className="text-xs font-medium text-warning">{amountDue.caption}</p>
          <p className="font-mono text-xl font-semibold text-warning">
            ${amountDue.amount.toFixed(2)}
          </p>
        </div>
      )}
      <p className="mb-3 text-sm text-text-secondary">
        {amountDue ? amountDue.instruction : 'Please send your payment by Interac e-Transfer to:'}
      </p>
      {/*
        White, not `surface-sunken`: a sunken grey reads as recessed on
        the amber tint, and this line is the one thing the customer has
        to copy.
      */}
      <p className="mb-3 rounded-xl border border-warning/20 bg-surface px-3 py-2.5 text-center font-medium break-all text-text-primary">
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
