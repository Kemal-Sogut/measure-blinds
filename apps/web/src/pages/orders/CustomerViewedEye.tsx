// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Small eye icon shown beside the order number in the order header:
 * grey once the estimate has been sent, green once the customer opened
 * their public order page. Hover (or a screen reader) gives the detail,
 * including when it was opened. The rule lives in `customerViewed.ts`.
 *
 * It reports page opens (`orders.customer_viewed_at`), not email opens:
 * the page view is recorded server-side when the customer's browser
 * loads `/customer/:token`, so it is not fooled by mail clients that
 * pre-load images.
 */

import type { Order } from '../../types';
import { customerViewState } from './customerViewed';

/** Renders the eye for `order`, or nothing when it has not been sent. */
export default function CustomerViewedEye({
  order,
}: {
  order: Pick<Order, 'sent_at' | 'customer_viewed_at'> | null | undefined;
}) {
  const state = customerViewState(order);
  if (state.kind === 'hidden') return null;
  const opened = state.kind === 'opened';
  return (
    <span
      role="img"
      aria-label={state.label}
      title={state.label}
      className={`inline-flex shrink-0 items-center ${opened ? 'text-success-strong' : 'text-text-muted'}`}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.9" />
      </svg>
    </span>
  );
}
