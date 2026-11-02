// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * The DB-facing completeness helpers, against a scripted fake client:
 * scoping rows for one Roller type that uses a control, and whatever
 * line items a test seeds.
 */

import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  annotateOrderCompleteness,
  attachIncompleteCounts,
  incompleteMessageFor,
  loadIncompleteMessage,
} from './orderCompleteness';

const ID = '11111111-1111-4111-8111-111111111111';
const ROLLER = { id: 'bt1', name: 'Roller' };

/** Fake supabase-js: every chain resolves to `rows[table]`. */
function fakeClient(
  rows: Record<string, unknown[]>,
  /** Optional per-table override, called with the call's range (if any). */
  pages?: Record<string, (range: [number, number] | null) => unknown[]>
): SupabaseClient {
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    let range: [number, number] | null = null;
    for (const m of ['select', 'eq', 'in', 'order']) b[m] = () => b;
    b.range = (from: number, to: number) => {
      range = [from, to];
      return b;
    };
    (b as { then: unknown }).then = (ok: (v: unknown) => unknown) =>
      Promise.resolve(ok({ data: pages?.[table] ? pages[table](range) : (rows[table] ?? []), error: null }));
    return b;
  };
  return { from: builder } as unknown as SupabaseClient;
}

const scoping = {
  blind_types: [ROLLER],
  control_options: [{ id: ID, active: true }],
  control_option_blind_types: [{ control_option_id: ID, blind_type_id: ROLLER.id }],
};
const complete = { item_type: 'blind', room_name: 'Hall', blinds_type: 'Roller', panels: [70], height_cm: 200, material_id: ID, control_id: ID, attributes: {} };
const open = { ...complete, room_name: 'Kitchen', control_id: null };

describe('incompleteMessageFor / loadIncompleteMessage', () => {
  it('names the first incomplete item', async () => {
    const sb = fakeClient(scoping);
    expect(await incompleteMessageFor(sb, [complete, open] as never)).toBe('Item 2 (Kitchen): choose a control option.');
  });

  it('is null for an order of complete or flat items, without a scoping query', async () => {
    const sb = fakeClient({});
    expect(await incompleteMessageFor(sb, [{ item_type: 'custom' }])).toBeNull();
  });

  it('loads the rows by order id', async () => {
    const sb = fakeClient({ ...scoping, line_items: [open] });
    expect(await loadIncompleteMessage(sb, 'o1')).toBe('Item 1 (Kitchen): choose a control option.');
  });
});

describe('annotateOrderCompleteness', () => {
  it('adds missing_fields per line and incomplete_items on a draft', async () => {
    const order = { status: 'draft', line_items: [{ ...complete }, { ...open }] } as Record<string, unknown>;
    await annotateOrderCompleteness(fakeClient(scoping), order);
    expect(order.incomplete_items).toBe(1);
    expect((order.line_items as Array<{ missing_fields: string[] }>).map((l) => l.missing_fields)).toEqual([[], ['control option']]);
  });

  it('reports nothing on a non-draft order, whatever the rows say', async () => {
    const order = { status: 'sent', line_items: [{ ...open }] } as Record<string, unknown>;
    await annotateOrderCompleteness(fakeClient(scoping), order);
    expect(order.incomplete_items).toBe(0);
    expect((order.line_items as Array<{ missing_fields: string[] }>)[0].missing_fields).toEqual([]);
  });
});

describe('attachIncompleteCounts', () => {
  it('counts per draft order and leaves others at 0', async () => {
    const sb = fakeClient({ ...scoping, line_items: [{ ...open, order_id: 'd1' }, { ...open, order_id: 'd1' }, { ...complete, order_id: 'd2' }] });
    const orders: Record<string, unknown>[] = [{ id: 'd1', status: 'draft' }, { id: 'd2', status: 'draft' }, { id: 's1', status: 'sent' }];
    await attachIncompleteCounts(sb, orders);
    expect(orders.map((o) => o.incomplete_items)).toEqual([2, 0, 0]);
  });

  it('pages past the 1000-row response cap and counts rows from every page', async () => {
    const ranges: Array<[number, number] | null> = [];
    const sb = fakeClient(scoping, {
      line_items: (range) => {
        ranges.push(range);
        // First page is full (1000 complete rows for d1); the second, short
        // page holds the only open row — a count that stopped at page one
        // would miss it.
        return ranges.length === 1
          ? Array.from({ length: 1000 }, () => ({ ...complete, order_id: 'd1' }))
          : [{ ...open, order_id: 'd1' }];
      },
    });
    const orders: Record<string, unknown>[] = [{ id: 'd1', status: 'draft' }];
    await attachIncompleteCounts(sb, orders);
    expect(ranges).toEqual([[0, 999], [1000, 1999]]);
    expect(orders[0].incomplete_items).toBe(1);
  });

  it('chunks draft ids into groups of at most 100', async () => {
    const calls: number[] = [];
    const base = fakeClient({});
    const sb = {
      from: (table: string) => {
        const b = (base as unknown as { from: (t: string) => Record<string, unknown> }).from(table);
        const inFn = (_col: string, ids: unknown[]) => {
          if (table === 'line_items') calls.push(ids.length);
          return b;
        };
        b.in = inFn;
        return b;
      },
    } as unknown as SupabaseClient;
    const orders: Record<string, unknown>[] = Array.from({ length: 250 }, (_, i) => ({ id: `d${i}`, status: 'draft' }));
    await attachIncompleteCounts(sb, orders);
    expect(calls).toEqual([100, 100, 50]);
  });
});
