// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Locks how a revision's staff copy becomes editor state on Restore:
 * items keep their `uid`, visibility and order; the three order fields
 * map across; no server-only money column survives into anything the
 * save payload is built from; and the price lock is carried only where
 * the order itself holds locks (Design decision 8).
 */

import { describe, expect, it } from 'vitest';
import type { LineItem, OrderStatus } from '../../types';
import type { RevisionSource } from '../../hooks/useOrders';
import { canRestoreRevision, draftsFromRevision } from './restoreRevision';

/** A stored blind row as `order_revisions.source` keeps it, lock included. */
const blind = {
  id: 'li1',
  order_id: 'o1',
  position: 0,
  uid: 'uid-blind',
  hidden: false,
  item_type: 'blind',
  room_name: 'Living Room',
  blinds_type: 'Roller',
  panels: [70, 70],
  height_cm: 200,
  material_id: 'mat-1',
  material_name: 'Blackout White',
  material_price_per_sqm: 25,
  cassette_id: 'cas-1',
  cassette_name: 'Standard',
  cassette_price_per_m: 20,
  cassette_price_basis: 'per_m',
  bottom_rail_id: null,
  bottom_rail_name: null,
  bottom_rail_price_per_m: null,
  bottom_rail_price_basis: null,
  control_id: null,
  control_name: null,
  control_price_per_item: null,
  control_price_basis: null,
  installation_id: null,
  installation_name: null,
  installation_price_per_item: null,
  installation_price_basis: null,
  description: '',
  note: 'Bay window',
  color: 'White',
  attributes: {},
  quantity: 2,
  unit_price: 98,
  line_total: 196,
  title: '',
  preset_id: null,
  base_unit_price: null,
  show_original_price: false,
  addons: [{ label: 'Rush', price: 40 }],
  locked_base_price: 98,
  locked_inputs_fingerprint: 'fp-rev1',
  quoted_base_price: 98,
  quoted_notice_ack_base: null,
} as unknown as LineItem;

/** A hidden custom row, after the blind. */
const hiddenCustom = {
  ...blind,
  id: 'li2',
  position: 1,
  uid: 'uid-custom',
  hidden: true,
  item_type: 'custom',
  title: 'Trim',
  description: 'Extra trim',
  quantity: 1,
  unit_price: 30,
  line_total: 30,
  addons: [],
  locked_base_price: 30,
  locked_inputs_fingerprint: 'fp-custom',
} as unknown as LineItem;

const SOURCE: RevisionSource = {
  order: { title: 'Front room', discount_type: 'percent', discount_value: 10 },
  line_items: [blind, hiddenCustom],
};

/** Columns only the Worker writes; none may reach the editor state. */
const SERVER_ONLY = [
  'id',
  'order_id',
  'position',
  'line_total',
  'base_unit_price',
  'material_name',
  'material_price_per_sqm',
  'cassette_price_per_m',
  'locked_base_price',
  'locked_inputs_fingerprint',
  'quoted_base_price',
  'quoted_notice_ack_base',
];

describe('draftsFromRevision', () => {
  it('keeps uid, hidden and the order of items', () => {
    const { items } = draftsFromRevision(SOURCE, true);
    expect(items.map((d) => [d.uid, d.hidden, d.item_type])).toEqual([
      ['uid-blind', false, 'blind'],
      ['uid-custom', true, 'custom'],
    ]);
    // Typed fields come across as the editor's strings.
    const first = items[0];
    expect(first.item_type === 'blind' && first.height_cm).toBe('200');
    expect(first.addons.map((a) => [a.label, a.price])).toEqual([['Rush', '40']]);
  });

  it('maps the order fields', () => {
    const out = draftsFromRevision(SOURCE, true);
    expect(out.title).toBe('Front room');
    expect(out.discount_type).toBe('percent');
    expect(out.discount_value).toBe(10);
  });

  it('keeps no server-only money fields in a shape OrderInput would send', () => {
    const out = draftsFromRevision(SOURCE, true);
    expect(Object.keys(out).sort()).toEqual(['discount_type', 'discount_value', 'items', 'title']);
    for (const draft of out.items) {
      for (const key of SERVER_ONLY) expect(draft).not.toHaveProperty(key);
    }
    // A blind's price is never an input: the Worker prices it.
    expect(out.items[0]).not.toHaveProperty('unit_price');
  });

  it('carries the revision’s lock while the order holds locks, not the old send stamp', () => {
    const [restored] = draftsFromRevision(SOURCE, true).items;
    expect(restored.lock).toEqual({ base: 98, fingerprint: 'fp-rev1' });
    expect(restored.previously_quoted).toBe(true);
    // The customer holds the LATEST revision; the save re-reads that stamp.
    expect(restored.quoted_base).toBeNull();
    expect(restored.notice_ack_base).toBeNull();
  });

  it('carries no lock on a draft, which prices at today’s catalog', () => {
    const [restored] = draftsFromRevision(SOURCE, false).items;
    expect(restored.lock).toBeNull();
    expect(restored.previously_quoted).toBe(false);
  });
});

describe('canRestoreRevision', () => {
  it('allows the estimate stages only, as the Worker does', () => {
    const estimate: OrderStatus[] = ['draft', 'sent', 'expired'];
    const confirmed: OrderStatus[] = ['awaiting_payment', 'in_progress', 'ready', 'installed'];
    expect(estimate.every(canRestoreRevision)).toBe(true);
    expect(confirmed.some(canRestoreRevision)).toBe(false);
  });
});
