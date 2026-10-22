// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins what a customer link may show: live estimates and confirmed
 * orders only (never drafts, never lapsed estimates — even before the
 * cron flips them), with a server-computed balance and nothing else.
 */

import { describe, it, expect } from 'vitest';
import { isPortalVisible, toPortalItem } from './customerPortal';

const TODAY = '2026-10-22';
const row = (over: Record<string, unknown> = {}) => ({
  id: 'o1', order_number: 'M2010-126', title: null, status: 'sent',
  order_date: '2026-10-20', expiry_date: '2026-11-03', total: '113.00',
  public_token: 'tok', payments: [] as Array<{ amount: number | string }>, ...over,
});

describe('isPortalVisible', () => {
  it('shows a sent estimate up to and including its expiry date', () => {
    expect(isPortalVisible(row(), TODAY)).toBe(true);
    expect(isPortalVisible(row({ expiry_date: TODAY }), TODAY)).toBe(true);
  });
  it('hides a sent estimate past expiry', () => {
    expect(isPortalVisible(row({ expiry_date: '2026-10-21' }), TODAY)).toBe(false);
  });
  it('hides drafts and expired', () => {
    expect(isPortalVisible(row({ status: 'draft' }), TODAY)).toBe(false);
    expect(isPortalVisible(row({ status: 'expired' }), TODAY)).toBe(false);
  });
  it('shows every confirmed stage regardless of expiry', () => {
    for (const s of ['awaiting_payment', 'in_progress', 'ready', 'installed']) {
      expect(isPortalVisible(row({ status: s, expiry_date: '2020-01-01' }), TODAY)).toBe(true);
    }
  });
});

describe('toPortalItem', () => {
  it('computes the balance from the ledger and drops the id', () => {
    const item = toPortalItem(
      row({ status: 'awaiting_payment', payments: [{ amount: '50' }, { amount: 13.5 }] }) as never,
      'tok'
    );
    expect(item.total).toBe(113);
    expect(item.balance).toBe(49.5);
    expect(item).not.toHaveProperty('id');
    expect(item).not.toHaveProperty('payments');
    expect(Object.keys(item).sort()).toEqual(
      ['balance', 'expiry_date', 'order_date', 'order_number', 'public_token', 'status', 'title', 'total']
    );
  });
});
