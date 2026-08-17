// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Unit tests for the order-duplication mapping.
 *
 * A stored line-item row must map back into something the ordinary
 * create path accepts, which above all means dropping the catalog
 * SNAPSHOT keys the strict attribute schemas refuse, keeping the one
 * price a formula cannot reproduce (a hand-entered override), and
 * leaving every other figure to the Worker.
 */

import { describe, it, expect } from 'vitest';
import { stripCatalogSnapshots, toDuplicateInput } from './orderDuplicate';

describe('stripCatalogSnapshots', () => {
  it('drops the name/value snapshot keys and keeps the id', () => {
    const out = stripCatalogSnapshots('Curtains', {
      pleat_type_id: '66666666-6666-4666-8666-666666666666',
      pleat_name: 'Pinch',
      pleat_multiplier: 2.5,
    });
    expect(out).toEqual({ pleat_type_id: '66666666-6666-4666-8666-666666666666' });
  });

  it('leaves a type with no catalog refs untouched', () => {
    const attrs = { anything: 'kept' };
    expect(stripCatalogSnapshots('Roller', attrs)).toEqual(attrs);
  });
});

describe('toDuplicateInput', () => {
  /** The order-level fields every case below shares. */
  function order(lineItems: Record<string, unknown>[]): Record<string, unknown> {
    return {
      customer_id: '44444444-4444-4444-8444-444444444444',
      discount_type: 'percent',
      discount_value: 10,
      line_items: lineItems,
    };
  }

  it('carries customer, discount, items and hidden flags, and no uids', () => {
    const input = toDuplicateInput(
      order([
        {
          item_type: 'blind',
          position: 0,
          uid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
          room_name: 'Living Room',
          blinds_type: 'Roller',
          panels: [70, 70],
          height_cm: 200,
          material_id: '11111111-1111-4111-8111-111111111111',
          cassette_id: '22222222-2222-4222-8222-222222222222',
          bottom_rail_id: '55555555-5555-4555-8555-555555555555',
          control_id: '33333333-3333-4333-8333-333333333333',
          installation_id: null,
          color: 'White',
          note: '',
          attributes: {},
          quantity: 2,
          hidden: true,
          unit_price: 182,
          base_unit_price: null,
          show_original_price: true,
          addons: [],
        },
      ])
    ) as Record<string, any>;
    expect(input.customer_id).toBe('44444444-4444-4444-8444-444444444444');
    expect(input.discount_value).toBe(10);
    expect(input.line_items[0].hidden).toBe(true);
    expect(input.line_items[0].quantity).toBe(2);
    // A duplicate's items are NEW rows: carrying the source uid would
    // give two orders items claiming one identity.
    expect(input.line_items[0].uid).toBeUndefined();
    // No money crosses over — the Worker re-prices from the catalog.
    expect(input.line_items[0].unit_price).toBeUndefined();
  });

  it('orders items by position, not by however they arrived', () => {
    const item = (position: number, room: string) => ({
      item_type: 'blind',
      position,
      room_name: room,
      blinds_type: 'Roller',
      panels: [70],
      height_cm: 200,
      material_id: '11111111-1111-4111-8111-111111111111',
      cassette_id: null,
      bottom_rail_id: null,
      control_id: null,
      installation_id: null,
      color: '',
      note: '',
      attributes: {},
      quantity: 1,
      hidden: false,
      unit_price: 100,
      base_unit_price: null,
      show_original_price: true,
      addons: [],
    });
    const input = toDuplicateInput(
      order([item(1, 'Second'), item(0, 'First')])
    ) as Record<string, any>;
    expect(input.line_items.map((li: { room_name: string }) => li.room_name)).toEqual([
      'First',
      'Second',
    ]);
  });

  it('preserves an override and its add-ons', () => {
    const input = toDuplicateInput(
      order([
        {
          item_type: 'preset',
          position: 0,
          preset_id: '77777777-7777-4777-8777-777777777777',
          title: 'Installation',
          description: '',
          quantity: 1,
          hidden: false,
          unit_price: 30,
          base_unit_price: 25,
          show_original_price: false,
          addons: [{ label: 'Rush', price: 15 }],
        },
      ])
    ) as Record<string, any>;
    // `base_unit_price` set means the 30 charged was hand-entered — that
    // IS the override, and it is the one figure a duplicate must keep.
    expect(input.line_items[0].unit_price_override).toBe(30);
    expect(input.line_items[0].show_original_price).toBe(false);
    expect(input.line_items[0].addons).toEqual([{ label: 'Rush', price: 15 }]);
    // Priced from the catalog on save, so no figure travels.
    expect(input.line_items[0].unit_price).toBeUndefined();
  });

  it('sends a legacy preset its stored price and no override', () => {
    const input = toDuplicateInput(
      order([
        {
          item_type: 'preset',
          position: 0,
          preset_id: null,
          title: '',
          description: 'Old install line',
          quantity: 1,
          hidden: false,
          unit_price: 25,
          base_unit_price: null,
          show_original_price: true,
          addons: [],
        },
      ])
    ) as Record<string, any>;
    expect(input.line_items[0].unit_price).toBe(25);
    expect(input.line_items[0].unit_price_override).toBeUndefined();
  });

  it('never sends a custom item an override, which the create path rejects', () => {
    const input = toDuplicateInput(
      order([
        {
          item_type: 'custom',
          position: 0,
          title: 'Site visit',
          description: '',
          quantity: 1,
          hidden: false,
          unit_price: 40,
          base_unit_price: null,
          show_original_price: true,
          addons: [],
        },
      ])
    ) as Record<string, any>;
    expect(input.line_items[0].unit_price).toBe(40);
    expect(input.line_items[0].unit_price_override).toBeUndefined();
  });

  it('strips the catalog snapshots off a blind attribute blob', () => {
    const input = toDuplicateInput(
      order([
        {
          item_type: 'blind',
          position: 0,
          room_name: 'Lounge',
          blinds_type: 'Curtains',
          panels: [200],
          height_cm: 240,
          material_id: '11111111-1111-4111-8111-111111111111',
          cassette_id: null,
          bottom_rail_id: null,
          control_id: '33333333-3333-4333-8333-333333333333',
          installation_id: '77777777-7777-4777-8777-777777777777',
          color: '',
          note: '',
          attributes: {
            pleat_type_id: '66666666-6666-4666-8666-666666666666',
            pleat_name: 'Pinch',
            pleat_multiplier: 2.5,
          },
          quantity: 1,
          hidden: false,
          unit_price: 500,
          base_unit_price: null,
          show_original_price: true,
          addons: [],
        },
      ])
    ) as Record<string, any>;
    expect(input.line_items[0].attributes).toEqual({
      pleat_type_id: '66666666-6666-4666-8666-666666666666',
    });
  });
});
