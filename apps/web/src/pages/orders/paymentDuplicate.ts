// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * The Record Payment sheet's "this payment may already be recorded"
 * question, kept out of `OrderDetail.tsx` (a standing >800-line file) so
 * the copy is one reviewable, testable place.
 *
 * When staff type a payment in by hand and the order already has an
 * e-Transfer payment of exactly that amount dated within 3 days of the
 * date being entered, the
 * Worker refuses it with 409 `possible_duplicate` and a sentence naming
 * the earlier payment (`apps/api/src/lib/paymentDuplicate.ts`
 * `manualDuplicateMessage`). The sheet shows that sentence in the app's
 * confirmation dialog; "Record it anyway" resends the SAME submit (same
 * `client_key`) with `confirm_duplicate: true`, so a retry of the
 * confirmed submit is still recorded once.
 *
 * Imports types only: this workspace's vitest runs in node, and
 * `lib/api.ts` (where `ApiError` lives) needs Supabase env at import.
 */

import type { ConfirmOptions } from '../../components/ui';

/** The machine-readable reason the Worker sends with this 409. */
export const POSSIBLE_DUPLICATE_CODE = 'possible_duplicate';

/**
 * Options for `askConfirm` when the Worker answered `possible_duplicate`.
 * Danger tone: the confirm button records money that is probably already
 * on the order, so it should not look like the routine choice.
 *
 * @param serverMessage The Worker's error text (names the earlier e-Transfer's amount and date)
 */
export function duplicatePaymentConfirm(serverMessage: string): ConfirmOptions {
  return {
    title: 'This payment may already be recorded',
    message: serverMessage,
    confirmLabel: 'Record it anyway',
    cancelLabel: 'Cancel',
    tone: 'danger',
  };
}
