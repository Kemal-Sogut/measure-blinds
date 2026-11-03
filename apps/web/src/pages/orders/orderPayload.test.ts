// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * `buildOrderPayload`: blanks are allowed on a draft, typed garbage never,
 * and a non-draft order is held to completeness client-side with the
 * same message the Worker would return.
 */

import { describe, it, expect } from 'vitest';
import { buildOrderPayload, type OrderPayloadState } from './orderPayload';
import type { BlindItemInput } from '../../hooks/useOrders';
import type { BlindDraft, Catalogs } from './lineItemDrafts';

/**
 * A complete, valid blind draft — the baseline each case mutates. The
 * adjustment fields sit at their neutral values (no override, no
 * add-ons), so a case that does not mention them prices from the formula
 * alone.
 */
function draft(overrides: Partial<BlindDraft> = {}): BlindDraft {
  return {
    unit_price_override: '',
    show_original_price: true,
    addons: [],
    lock: null,
    previously_quoted: false,
    quoted_base: null,
    notice_ack_base: null,
    key: 'd1',
    uid: null,
    hidden: false,
    item_type: 'blind',
    room_name: '',
    blinds_type: 'Roller',
    panels: ['120'],
    height_cm: '210',
    material_id: 'm1',
    cassette_id: 'c1',
    bottom_rail_id: 'b1',
    control_id: 'ct1',
    installation_id: '',
    color: 'White',
    note: '',
    quantity: '1',
    attributes: {},
    ...overrides,
  };
}

const ROLLER = { id: 'bt-roller', name: 'Roller', active: true, sort_order: 0 };
const CURTAINS = { id: 'bt-curtains', name: 'Curtains', active: true, sort_order: 1 };
/** Curtains declares `pleat_type_id` as a uuid, so the fixture needs one. */
const PLEAT_ID = '66666666-6666-4666-8666-666666666666';

/**
 * Catalogs scoped the way migration 35's backfill leaves them: Roller
 * takes a cassette, a rail and a control; Curtains takes a control and
 * an installation option. `cas-off` is linked to Roller but INACTIVE,
 * and `ins-free` is a second, zero-priced installation option used to
 * isolate the charge.
 */
function catalogs(overrides: Partial<Catalogs> = {}): Catalogs {
  return {
    blindTypes: [ROLLER, CURTAINS],
    materials: [
      {
        id: 'm1',
        name: 'Blackout',
        price_per_sqm: 50,
        active: true,
        sort_order: 0,
        width_cm: null,
        blind_type_ids: [ROLLER.id, CURTAINS.id],
      },
    ],
    cassettes: [
      { id: 'c1', name: 'Standard', price: 20, price_basis: 'per_m', active: true, sort_order: 0, blind_type_ids: [ROLLER.id] },
      { id: 'cas-off', name: 'Retired', price: 5, price_basis: 'per_m', active: false, sort_order: 1, blind_type_ids: [ROLLER.id] },
    ],
    bottomRails: [
      { id: 'b1', name: 'Regular', price: 0, price_basis: 'per_m', active: true, sort_order: 0, blind_type_ids: [ROLLER.id] },
    ],
    controls: [
      { id: 'ct1', name: 'Chain', price: 0, price_basis: 'per_panel', active: true, sort_order: 0, blind_type_ids: [ROLLER.id, CURTAINS.id] },
    ],
    pleatTypes: [{ id: PLEAT_ID, name: 'Pinch', multiplier: 2, active: true, sort_order: 0 }],
    defaults: [],
    installationOptions: [
      { id: 'ins-1', name: 'Rod', price: 45, price_basis: 'per_unit', active: true, sort_order: 0, blind_type_ids: [CURTAINS.id] },
      { id: 'ins-free', name: 'None', price: 0, price_basis: 'per_unit', active: true, sort_order: 1, blind_type_ids: [CURTAINS.id] },
    ],
    ...overrides,
  };
}


const CUSTOMER = { id: '44444444-4444-4444-8444-444444444444' } as OrderPayloadState['customer'];

function state(over: Partial<OrderPayloadState> = {}): OrderPayloadState {
  return {
    customer: CUSTOMER,
    orderDate: new Date(2026, 10, 2),
    expiryDate: new Date(2026, 10, 16),
    title: '',
    discountType: 'fixed',
    discountValue: '',
    items: [],
    catalogs: catalogs(),
    status: 'draft',
    ...over,
  };
}

describe('buildOrderPayload', () => {
  it('sends blanks as null on a draft', () => {
    const d = draft({ blinds_type: '', panels: ['', '80'], height_cm: '', material_id: '', cassette_id: '', bottom_rail_id: '', control_id: '' });
    const out = buildOrderPayload(state({ items: [d] }));
    expect(typeof out).toBe('object');
    const blind = (out as { line_items: BlindItemInput[] }).line_items[0];
    expect(blind).toMatchObject({ panels: [null, 80], height_cm: null, material_id: null, cassette_id: null });
  });

  it('rejects a typed garbage width or height', () => {
    expect(buildOrderPayload(state({ items: [draft({ panels: ['12a'] })] }))).toBe('Item 1: enter every panel width.');
    expect(buildOrderPayload(state({ items: [draft({ height_cm: '-5' })] }))).toBe('Item 1: enter a height.');
  });

  it('holds a sent order to completeness with the Worker message', () => {
    const d = draft({ blinds_type: 'Roller', panels: ['100'], height_cm: '200', room_name: 'Kitchen', control_id: '' });
    expect(buildOrderPayload(state({ items: [d], status: 'sent' }))).toBe('Item 1 (Kitchen): choose a control option.');
    expect(typeof buildOrderPayload(state({ items: [d], status: 'draft' }))).toBe('object');
  });

  it('does not demand a slot added since the send of an already-quoted item, but does of a new one', () => {
    // Roller now scopes a control; neither item carries one. The quoted item
    // (a uid on a price-locked order, with no lock — a pre-lock row) is
    // grandfathered exactly as the Worker's `prior` does; the line added
    // since the send (no uid) must satisfy today's rule.
    const quoted = draft({ uid: 'u1', previously_quoted: true, room_name: 'Kitchen', control_id: '' });
    const fresh = draft({ room_name: 'Hall', control_id: '' });
    expect(typeof buildOrderPayload(state({ items: [quoted], status: 'sent' }))).toBe('object');
    expect(buildOrderPayload(state({ items: [quoted, fresh], status: 'sent' }))).toBe(
      'Item 2 (Hall): choose a control option.'
    );
  });

  it('drops an id for a slot the type no longer uses, unless the item is already quoted', () => {
    // `ins-1` is scoped to Curtains only, so Roller does not use it.
    const stale = draft({ installation_id: 'ins-1' });
    const dropped = buildOrderPayload(state({ items: [stale] })) as { line_items: BlindItemInput[] };
    expect(dropped.line_items[0].installation_id).toBeNull();

    const quoted = draft({ uid: 'u1', previously_quoted: true, installation_id: 'ins-1' });
    const kept = buildOrderPayload(state({ items: [quoted], status: 'sent' })) as { line_items: BlindItemInput[] };
    expect(kept.line_items[0].installation_id).toBe('ins-1');
  });

  it('still requires a customer and an expiry date', () => {
    expect(buildOrderPayload(state({ customer: null }))).toBe('Select a customer first.');
    expect(buildOrderPayload(state({ expiryDate: null }))).toBe('Pick an expiry date.');
  });
});
