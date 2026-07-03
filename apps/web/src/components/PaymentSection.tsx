// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Payment section stub (plan Phase 9 item 4).
 *
 * Shown on the post-confirmation screen with the 50% deposit amount
 * and e-Transfer instructions. Online payment (Stripe et al.) is out
 * of scope for v1 — when it lands, this component is the single place
 * to add it without touching the confirmation flow.
 */

export default function PaymentSection({
  depositAmount,
  payToEmail,
}: {
  depositAmount: number;
  payToEmail: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-elevated p-4 text-left">
      <h3 className="mb-2 font-semibold text-text-primary">Deposit</h3>
      <p className="mb-2 text-sm text-text-secondary">
        To get your order started, please send a <strong>50% deposit</strong> of{' '}
        <strong>${depositAmount.toFixed(2)}</strong> by Interac e-Transfer to:
      </p>
      <p className="mb-2 rounded-lg bg-surface px-3 py-2 text-center font-medium text-text-primary">
        {payToEmail}
      </p>
      <p className="text-xs text-text-muted">
        Please include your estimate number in the transfer message. We&apos;ll confirm receipt
        by email.
      </p>
    </div>
  );
}
