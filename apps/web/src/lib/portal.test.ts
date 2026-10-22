// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins the customer link's landing rule — exactly one visible item opens
 * straight into it, otherwise the list — and the Estimates / Your orders split.
 */

import { describe, it, expect } from 'vitest';
import { portalLanding, splitPortalItems, type PortalItem } from './portal';

const item = (order_number: string, status: PortalItem['status']): PortalItem => ({
  order_number,
  status,
  title: null,
  order_date: '2026-10-20',
  expiry_date: '2026-11-03',
  total: 100,
  balance: 100,
  public_token: `tok-${order_number}`,
});

describe('portalLanding', () => {
  it('is empty with no items', () => {
    expect(portalLanding([])).toEqual({ kind: 'empty' });
  });
  it('opens the only item directly', () => {
    const a = item('A', 'sent');
    expect(portalLanding([a])).toEqual({ kind: 'single', item: a });
  });
  it('lists two or more, even one estimate plus one order', () => {
    expect(portalLanding([item('A', 'sent'), item('B', 'installed')])).toEqual({ kind: 'list' });
  });
});

describe('splitPortalItems', () => {
  it('separates live estimates from confirmed orders, keeping order', () => {
    const s = splitPortalItems([item('A', 'sent'), item('B', 'ready'), item('C', 'sent')]);
    expect(s.estimates.map((i) => i.order_number)).toEqual(['A', 'C']);
    expect(s.orders.map((i) => i.order_number)).toEqual(['B']);
  });
});
