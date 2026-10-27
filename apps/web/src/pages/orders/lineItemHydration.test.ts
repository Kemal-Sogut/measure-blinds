// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins the hydration helpers in `lineItemHydration.ts`: `applyServerFields`
 * refreshes only the server-owned half of a draft (and returns the same
 * array when nothing moved, so a refetch costs no re-render), and
 * `finiteOrNull` turns an absent or non-numeric PostgREST figure into
 * "nothing to report" rather than `NaN`. The restore path through
 * `draftsFromLineItems` is covered in `restoreRevision.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import type { BlindDraft } from './lineItemDrafts';
import { applyServerFields, finiteOrNull } from './lineItemHydration';

/** A complete blind draft at neutral server fields; each case mutates it. */
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
    room_name: 'Living Room',
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

describe('applyServerFields', () => {
  it('leaves typed fields untouched while refreshing the server ones', () => {
    const edited = draft({ uid: 'u1', room_name: 'Nursery', height_cm: '240', quantity: '3' });
    const [synced] = applyServerFields(
      [edited],
      new Map([
        ['u1', { lock: null, previously_quoted: true, quoted_base: 99, notice_ack_base: 12 }],
      ])
    );
    expect(synced).toMatchObject({ room_name: 'Nursery', height_cm: '240', quantity: '3' });
    expect(synced.previously_quoted).toBe(true);
    expect(synced.quoted_base).toBe(99);
    expect(synced.notice_ack_base).toBe(12);
  });

  it('returns the very same array when the server says nothing new', () => {
    // An ordinary refetch (a window refocus, say) must cost no re-render.
    const items = [draft({ uid: 'u1', previously_quoted: true, quoted_base: 120 })];
    const same = applyServerFields(
      items,
      new Map([
        ['u1', { lock: null, previously_quoted: true, quoted_base: 120, notice_ack_base: null }],
      ])
    );
    expect(same).toBe(items);
  });

  it('leaves alone a draft with no uid and one the order does not have', () => {
    const items = [draft(), draft({ uid: 'u9', previously_quoted: true })];
    const out = applyServerFields(
      items,
      new Map([
        ['u1', { lock: null, previously_quoted: true, quoted_base: 120, notice_ack_base: null }],
      ])
    );
    expect(out).toBe(items);
  });
});

describe('finiteOrNull', () => {
  it('passes numbers through and turns absent or non-numeric figures into null', () => {
    expect(finiteOrNull(120.4)).toBe(120.4);
    expect(finiteOrNull(null)).toBeNull();
    expect(finiteOrNull(undefined)).toBeNull();
    expect(finiteOrNull(Number.NaN)).toBeNull();
  });
});
