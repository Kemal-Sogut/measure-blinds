// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Which order statuses count as CONFIRMED — the point at which an
 * estimate has become an order (awaiting payment → installed). Mirrors
 * `CONFIRMED` in `apps/api/src/routes/orders.ts`; the Estimates page's
 * group summary relies on it to tell orders apart from live estimates.
 */

import type { OrderStatus } from '../types';

/** Statuses at which an estimate has become an order. */
export const CONFIRMED_STATUSES: readonly OrderStatus[] = [
  'awaiting_payment',
  'in_progress',
  'ready',
  'installed',
];

/** True for a confirmed stage. */
export function isConfirmedStatus(s: OrderStatus): boolean {
  return CONFIRMED_STATUSES.includes(s);
}
