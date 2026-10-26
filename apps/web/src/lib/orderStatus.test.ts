// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins the order-status predicates to the lists they mirror on the
 * Worker (`CONFIRMED` and `PRICE_LOCKED` in
 * `apps/api/src/routes/orders.ts`).
 *
 * `holdsPriceLock` is worth pinning in its own right: the editor exempts
 * an already-quoted item from hardware its blind type has only started
 * requiring since, and that exemption is gated on this answer. A status
 * wrongly reported as frozen would let a live quote skip a required
 * option; one wrongly reported as live would make every estimate already
 * sent on that type unsavable, and so unpresentable.
 */

import { describe, expect, it } from 'vitest';
import { holdsPriceLock, isConfirmedStatus } from './orderStatus';
import type { OrderStatus } from '../types';

const EVERY_STATUS: OrderStatus[] = [
  'draft',
  'sent',
  'expired',
  'awaiting_payment',
  'in_progress',
  'ready',
  'installed',
];

describe('isConfirmedStatus', () => {
  it('counts the four post-confirmation stages and nothing else', () => {
    expect(EVERY_STATUS.filter(isConfirmedStatus)).toEqual([
      'awaiting_payment',
      'in_progress',
      'ready',
      'installed',
    ]);
  });
});

describe('holdsPriceLock', () => {
  it('starts at `sent`, one stage before confirmation', () => {
    expect(holdsPriceLock('draft')).toBe(false);
    expect(holdsPriceLock('sent')).toBe(true);
  });

  it('includes `expired`, which is an estimate that WAS sent', () => {
    expect(holdsPriceLock('expired')).toBe(true);
  });

  it('holds for every confirmed stage', () => {
    expect(EVERY_STATUS.filter(isConfirmedStatus).every(holdsPriceLock)).toBe(true);
  });

  it('leaves `draft` as the only live-priced stage', () => {
    expect(EVERY_STATUS.filter((s) => !holdsPriceLock(s))).toEqual(['draft']);
  });
});
