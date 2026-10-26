// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Unit tests for `buildPublicQuote` / `toPublicLines` — the pure
 * customer-visible quote shape shared by the public estimate route and
 * the revision snapshot. Covers hidden-item filtering, `uid` handling,
 * the never-forward-raw-columns guarantee and numeric coercion.
 */

import { describe, it, expect } from 'vitest';
import { buildPublicQuote, toPublicLines } from './publicQuote';

/** A minimal order row as PostgREST returns it with `line_items(*)` embedded. */
function orderRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'Option A',
    order_date: '2026-10-01',
    expiry_date: '2026-11-01',
    subtotal: 1000,
    discount_amount: 0,
    taxable_amount: 1000,
    tax_rate: 13,
    tax_amount: 130,
    total: 1130,
    terms_snapshot: 'Net 30',
    line_items: [
      {
        uid: 'u1',
        item_type: 'blind',
        room_name: 'Kitchen',
        blinds_type: 'roller',
        panels: 1,
        height_cm: 150,
        material_name: 'Fabric',
        quantity: 2,
        unit_price: 500,
        line_total: 1000,
        base_unit_price: 600,
        show_original_price: false,
        attributes: { secret: 'internal' },
        addons: [{ label: 'Motor', price: 50 }],
        hidden: false,
      },
      {
        uid: 'u2',
        item_type: 'blind',
        room_name: 'Hall',
        blinds_type: 'roller',
        quantity: 1,
        unit_price: 10,
        line_total: 10,
        hidden: true,
      },
    ],
    ...overrides,
  };
}

describe('buildPublicQuote', () => {
  it('drops hidden items', () => {
    const q = buildPublicQuote(orderRow());
    expect(q.line_items.length).toBe(1);
    expect(q.line_items[0].room_name).toBe('Kitchen');
  });

  it('keeps uid on the quote and strips it for the public shape', () => {
    const q = buildPublicQuote(orderRow());
    expect(q.line_items[0].uid).toBe('u1');
    expect('uid' in toPublicLines(q.line_items)[0]).toBe(false);
  });

  it('never forwards raw attributes or base_unit_price', () => {
    const line = buildPublicQuote(orderRow()).line_items[0];
    const keys = Object.keys(line);
    expect(keys).not.toContain('attributes');
    expect(keys).not.toContain('base_unit_price');
  });

  it('coerces numeric strings to numbers', () => {
    const q = buildPublicQuote(
      orderRow({ total: '1234.50', subtotal: '1000.00', tax_rate: '13' })
    );
    expect(q.total).toBe(1234.5);
    expect(q.subtotal).toBe(1000);
    expect(q.tax_rate).toBe(13);
    const line = buildPublicQuote(
      orderRow({ line_items: [{ uid: 'u1', quantity: '2', unit_price: '5.5', line_total: '11.00' }] })
    ).line_items[0];
    expect(line.quantity).toBe(2);
    expect(line.unit_price).toBe(5.5);
    expect(line.line_total).toBe(11);
  });

  it('uses terms_snapshot, empty string when null', () => {
    expect(buildPublicQuote(orderRow()).terms).toBe('Net 30');
    expect(buildPublicQuote(orderRow({ terms_snapshot: null })).terms).toBe('');
  });

  it('maps a null title to null and tolerates missing line_items', () => {
    const q = buildPublicQuote(orderRow({ title: undefined, line_items: undefined }));
    expect(q.title).toBeNull();
    expect(q.line_items).toEqual([]);
  });
});
