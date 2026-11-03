// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Order-status predicates shared across the app, each the twin of a list
 * in `apps/api/src/routes/orders.ts`.
 *
 * CONFIRMED is the point at which an estimate has become an order
 * (awaiting payment → installed); the Estimates page's group summary
 * relies on it to tell orders apart from live estimates. PRICE_LOCKED
 * starts one stage earlier, at `sent`, because quoting a figure — not
 * confirming it — is what freezes it.
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

/**
 * Statuses whose line-item prices are FROZEN — everything from `sent`
 * onward. Mirrors `PRICE_LOCKED` in `apps/api/src/routes/orders.ts`.
 *
 * `expired` belongs here because a lapsed estimate is one that WAS sent;
 * only reviving it to `draft` returns it to live pricing.
 */
export const PRICE_LOCKED_STATUSES: readonly OrderStatus[] = [
  'sent',
  'expired',
  ...CONFIRMED_STATUSES,
];

/**
 * True when the order's prices are frozen, so its already-quoted items
 * are exempt from hardware requirements added to their blind type since
 * (see `buildPayload` in `pages/orders/OrderDetail.tsx`) and its
 * price-update notices may be shown.
 */
export function holdsPriceLock(s: OrderStatus): boolean {
  return PRICE_LOCKED_STATUSES.includes(s);
}
