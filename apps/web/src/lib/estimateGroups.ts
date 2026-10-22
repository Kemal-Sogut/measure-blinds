// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Text helpers for the Estimates page's customer groups.
 *
 * `groupSummary` is the status line a COLLAPSED group shows, so a
 * consultant can see "2 active · 1 order" without opening it. "Active"
 * matches the page's Active tab (draft + sent); "order" is any confirmed
 * stage; zero counts are omitted. Counts only — no money is derived here.
 */

import type { Order } from '../types';
import { isConfirmedStatus } from './orderStatus';

/** "2 active · 1 order · 1 expired" for a group's estimates. */
export function groupSummary(orders: Array<Pick<Order, 'status'>>): string {
  let active = 0;
  let confirmed = 0;
  let expired = 0;
  for (const o of orders) {
    if (o.status === 'draft' || o.status === 'sent') active += 1;
    else if (o.status === 'expired') expired += 1;
    else if (isConfirmedStatus(o.status)) confirmed += 1;
  }
  const parts: string[] = [];
  if (active) parts.push(`${active} active`);
  if (confirmed) parts.push(`${confirmed} ${confirmed === 1 ? 'order' : 'orders'}`);
  if (expired) parts.push(`${expired} expired`);
  return parts.join(' · ');
}
