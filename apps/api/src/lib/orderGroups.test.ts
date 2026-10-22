// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins the Estimates page grouping: one group per customer, customers
 * ordered by their NEWEST estimate's creation time (a new estimate puts
 * its customer on top; edits to old ones do not), estimates inside a
 * group newest-created first.
 */

import { describe, it, expect } from 'vitest';
import { groupOrdersByCustomer } from './orderGroups';

const row = (id: string, customer_id: string, created_at: string, first_name = customer_id) => ({
  id, customer_id, created_at,
  customer: { id: customer_id, first_name, last_name: '', email: '', phone: '' },
});

describe('groupOrdersByCustomer', () => {
  it('orders customers by their newest estimate, newest first', () => {
    const groups = groupOrdersByCustomer([
      row('o1', 'alice', '2026-10-01T10:00:00Z'),
      row('o2', 'bob', '2026-10-05T10:00:00Z'),
      row('o3', 'alice', '2026-10-03T10:00:00Z'),
    ]);
    expect(groups.map((g) => g.customer.id)).toEqual(['bob', 'alice']);
    expect(groups[1].newest_created_at).toBe('2026-10-03T10:00:00Z');
  });

  it("lists a customer's estimates newest-created first, regardless of input order", () => {
    const [alice] = groupOrdersByCustomer([
      row('old', 'alice', '2026-09-01T00:00:00Z'),
      row('new', 'alice', '2026-10-01T00:00:00Z'),
    ]);
    expect(alice.orders.map((o) => o.id)).toEqual(['new', 'old']);
  });

  it('fills a placeholder customer when the join is missing', () => {
    const [g] = groupOrdersByCustomer([{ id: 'x', customer_id: 'c9', created_at: '2026-10-01T00:00:00Z', customer: null }]);
    expect(g.customer).toEqual({ id: 'c9', first_name: '', last_name: '', email: '', phone: '' });
  });

  it('returns no groups for no rows', () => {
    expect(groupOrdersByCustomer([])).toEqual([]);
  });
});
