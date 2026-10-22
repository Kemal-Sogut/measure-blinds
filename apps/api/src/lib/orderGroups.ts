// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Groups order rows by customer for the staff Estimates page
 * (`GET /api/orders/grouped`, spec 2026-10-20 rev. 2026-10-22).
 *
 * Customers are ordered by the creation time of their NEWEST estimate,
 * newest first — so creating an estimate always puts its customer on
 * top, while editing, sending or confirming an older one does not move
 * anyone. `created_at` (not `order_date`, which staff can back-date) is
 * the key. Inside a group, estimates are newest-created first.
 *
 * Pure: no I/O, no money. The input is sorted defensively, so callers
 * may pass rows in any order.
 */

/** The customer fields a group header shows. */
export interface GroupCustomer {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
}

/** The minimum a row needs to be grouped. */
export interface GroupableRow {
  customer_id: string;
  created_at: string;
  customer?: Partial<GroupCustomer> | null;
}

/** One customer and their estimates. */
export interface OrderGroup<T> {
  customer: GroupCustomer;
  /** `created_at` of the newest row in this group. */
  newest_created_at: string;
  orders: T[];
}

/** Groups rows by `customer_id`; see the module header for the ordering rules. */
export function groupOrdersByCustomer<T extends GroupableRow>(rows: T[]): OrderGroup<T>[] {
  const sorted = [...rows].sort((a, b) =>
    a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0
  );
  const groups = new Map<string, OrderGroup<T>>();
  for (const row of sorted) {
    let group = groups.get(row.customer_id);
    if (!group) {
      const c = row.customer ?? {};
      group = {
        customer: {
          id: row.customer_id,
          first_name: c.first_name ?? '',
          last_name: c.last_name ?? '',
          email: c.email ?? '',
          phone: c.phone ?? '',
        },
        newest_created_at: row.created_at,
        orders: [],
      };
      groups.set(row.customer_id, group);
    }
    group.orders.push(row);
  }
  return [...groups.values()];
}
