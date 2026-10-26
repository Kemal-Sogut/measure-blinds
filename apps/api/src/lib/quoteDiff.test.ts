// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Unit tests for `diffQuotes` / `describeChange` / `itemLabel` — the
 * readable "what changed since the last sent version" list. Quotes are
 * built through `buildPublicQuote` so the tests exercise the same shape
 * the revision snapshot stores.
 */

import { describe, it, expect } from 'vitest';
import { buildPublicQuote } from './publicQuote';
import { describeChange, diffQuotes, itemLabel } from './quoteDiff';

/** A line-item row as PostgREST returns it. */
function lineRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uid: 'u1',
    item_type: 'blind',
    room_name: 'Bedroom',
    blinds_type: 'Roller',
    panels: [120],
    height_cm: 150,
    material_name: 'Linen',
    quantity: 1,
    unit_price: 312,
    line_total: 312,
    show_original_price: false,
    addons: [],
    hidden: false,
    ...overrides,
  };
}

/** An order row with the given line rows and order-level overrides. */
function orderRow(
  lines: Record<string, unknown>[] = [lineRow()],
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    title: 'Option A',
    order_date: '2026-10-01',
    expiry_date: '2026-11-01',
    subtotal: 1000,
    discount_amount: 0,
    taxable_amount: 1000,
    tax_rate: 13,
    tax_amount: 130,
    total: 2140,
    terms_snapshot: 'Net 30',
    line_items: lines,
    ...overrides,
  };
}

/** Builds a quote from rows, as the revision writer and the route do. */
const quote = (lines?: Record<string, unknown>[], overrides?: Record<string, unknown>) =>
  buildPublicQuote(orderRow(lines, overrides));

describe('diffQuotes', () => {
  it('returns [] for identical quotes', () => {
    expect(diffQuotes(quote(), quote())).toEqual([]);
  });

  it('reports an added and a removed item by uid', () => {
    const sent = quote([lineRow({ uid: 'a', room_name: 'Bedroom', blinds_type: 'Zebra' })]);
    const live = quote([lineRow({ uid: 'b', room_name: 'Kitchen', blinds_type: 'Roller' })]);
    expect(diffQuotes(sent, live)).toEqual([
      { kind: 'item_added', item: 'Kitchen — Roller' },
      { kind: 'item_removed', item: 'Bedroom — Zebra' },
    ]);
  });

  it('treats an item hidden after send as removed', () => {
    const sent = quote([lineRow()]);
    const live = quote([lineRow({ hidden: true })]);
    expect(diffQuotes(sent, live)).toEqual([{ kind: 'item_removed', item: 'Bedroom — Roller' }]);
  });

  it('treats an item un-hidden after send as added', () => {
    const sent = quote([lineRow({ hidden: true })]);
    const live = quote([lineRow()]);
    expect(diffQuotes(sent, live)).toEqual([{ kind: 'item_added', item: 'Bedroom — Roller' }]);
  });

  it('reports field changes with formatted values', () => {
    const sent = quote([lineRow()]);
    const live = quote([lineRow({ height_cm: 160, line_total: 340 })]);
    expect(diffQuotes(sent, live).map(describeChange)).toEqual([
      'Bedroom — Roller: Height 150 cm → 160 cm',
      'Bedroom — Roller: Line total $312.00 → $340.00',
    ]);
  });

  it('formats widths, add-ons and empty values', () => {
    const sent = quote([lineRow({ panels: [120], note: null })]);
    const live = quote([
      lineRow({ panels: [120, 80], note: 'Left side', addons: [{ label: 'Motor', price: 50 }] }),
    ]);
    expect(diffQuotes(sent, live).map(describeChange)).toEqual([
      'Bedroom — Roller: Width 120 cm → 120 + 80 cm',
      'Bedroom — Roller: Note — → Left side',
      'Bedroom — Roller: Add-ons — → Motor $50.00',
    ]);
  });

  it('reports total and title on the order', () => {
    const sent = quote();
    const live = quote([lineRow()], { title: 'Option B', total: 2005 });
    expect(diffQuotes(sent, live).map(describeChange)).toEqual([
      'Title Option A → Option B',
      'Total $2,140.00 → $2,005.00',
    ]);
  });

  it('puts order changes first, then items in live order, then removed items', () => {
    const sent = quote([lineRow({ uid: 'a', room_name: 'Old' }), lineRow({ uid: 'b', room_name: 'Same' })]);
    const live = quote(
      [lineRow({ uid: 'b', room_name: 'Same', quantity: 2 }), lineRow({ uid: 'c', room_name: 'New' })],
      { total: 1 }
    );
    expect(diffQuotes(sent, live).map(describeChange)).toEqual([
      'Total $2,140.00 → $1.00',
      'Same — Roller: Qty 1 → 2',
      'Added: New — Roller',
      'Removed: Old — Roller',
    ]);
  });

  it('says terms updated without quoting them', () => {
    const changes = diffQuotes(quote(), quote([lineRow()], { terms_snapshot: 'Net 15, no refunds' }));
    expect(changes).toHaveLength(1);
    expect(describeChange(changes[0])).toBe('Terms updated');
    expect(JSON.stringify(changes)).not.toContain('Net');
  });

  it('ignores a reordering of the same items', () => {
    const a = lineRow({ uid: 'a', room_name: 'A' });
    const b = lineRow({ uid: 'b', room_name: 'B' });
    expect(diffQuotes(quote([a, b]), quote([b, a]))).toEqual([]);
  });

  it('matches uid-less lines by position among the uid-less lines', () => {
    const sent = quote([lineRow({ uid: null, room_name: 'A' }), lineRow({ uid: null, room_name: 'B' })]);
    const live = quote([
      lineRow({ uid: null, room_name: 'A' }),
      lineRow({ uid: null, room_name: 'B', quantity: 3 }),
    ]);
    expect(diffQuotes(sent, live).map(describeChange)).toEqual(['B — Roller: Qty 1 → 3']);
  });
});

describe('itemLabel', () => {
  const line = (o: Record<string, unknown>) => quote([lineRow(o)]).line_items[0];

  it('prefers room name, then title, then description, then the position', () => {
    expect(itemLabel(line({ room_name: 'Kitchen', title: 'T' }), 0)).toBe('Kitchen — Roller');
    expect(itemLabel(line({ room_name: '', title: 'Window 1' }), 0)).toBe('Window 1 — Roller');
    expect(itemLabel(line({ room_name: null, title: null, description: 'Bay' }), 0)).toBe('Bay — Roller');
    expect(itemLabel(line({ room_name: null, title: null, description: null }), 2)).toBe('Item 3 — Roller');
  });

  it('omits the type suffix when no type is set', () => {
    expect(itemLabel(line({ blinds_type: null }), 0)).toBe('Bedroom');
  });
});
