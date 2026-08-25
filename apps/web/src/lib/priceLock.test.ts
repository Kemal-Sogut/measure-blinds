// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Price-lock fingerprint tests (live-preview half).
 *
 * MIRRORED by `apps/api/src/lib/priceLock.test.ts`: both suites assert
 * the SAME fingerprint strings, so the live preview and the Worker can
 * never disagree about whether an item still carries its frozen price.
 * If you change a case here, change it there.
 */

import { describe, it, expect } from 'vitest';
import { pricingFingerprint, lockApplies, type BlindLockInput } from './priceLock';

/** A complete blind input; each test overrides just the field it probes. */
function blind(overrides: Partial<BlindLockInput> = {}): BlindLockInput {
  return {
    item_type: 'blind',
    blinds_type: 'Roller',
    panels: [120],
    height_cm: 200,
    material_id: '11111111-1111-1111-1111-111111111111',
    cassette_id: '22222222-2222-2222-2222-222222222222',
    bottom_rail_id: null,
    control_id: '33333333-3333-3333-3333-333333333333',
    installation_id: null,
    attributes: {},
    ...overrides,
  };
}

describe('pricingFingerprint — blinds', () => {
  /**
   * The exact wire format, pinned on BOTH sides.
   *
   * Every other case here is a relation (equal / not equal), which would
   * still hold if the two copies of this module drifted into different
   * encodings. This one would not: a fingerprint written by the Worker
   * has to be readable by the editor, and vice versa.
   */
  it('encodes the canonical shape', () => {
    expect(pricingFingerprint(blind())).toBe(
      '["blind","Roller",["120"],"200","11111111-1111-1111-1111-111111111111","22222222-2222-2222-2222-222222222222",null,"33333333-3333-3333-3333-333333333333",null,[]]'
    );
    expect(pricingFingerprint({ item_type: 'custom', preset_id: null, unit_price: 50 })).toBe(
      '["custom",null,"50"]'
    );
  });

  it('is stable across equal inputs', () => {
    expect(pricingFingerprint(blind())).toBe(pricingFingerprint(blind()));
  });

  it('ignores trailing-zero and string-numeric differences in measurements', () => {
    expect(pricingFingerprint(blind({ height_cm: 200.0 }))).toBe(
      pricingFingerprint(blind({ height_cm: 200 }))
    );
    expect(pricingFingerprint(blind({ panels: [120.0] }))).toBe(
      pricingFingerprint(blind({ panels: [120] }))
    );
  });

  it('changes when a measurement changes', () => {
    expect(pricingFingerprint(blind({ height_cm: 201 }))).not.toBe(pricingFingerprint(blind()));
    expect(pricingFingerprint(blind({ panels: [120, 60] }))).not.toBe(
      pricingFingerprint(blind())
    );
  });

  it('changes when a catalog id or the blind type changes', () => {
    expect(
      pricingFingerprint(blind({ material_id: '44444444-4444-4444-4444-444444444444' }))
    ).not.toBe(pricingFingerprint(blind()));
    expect(pricingFingerprint(blind({ blinds_type: 'Zebra' }))).not.toBe(
      pricingFingerprint(blind())
    );
  });

  it('treats an empty-string id as no id at all', () => {
    expect(pricingFingerprint(blind({ bottom_rail_id: '' }))).toBe(
      pricingFingerprint(blind({ bottom_rail_id: null }))
    );
  });

  it('is independent of attribute key order', () => {
    const a = blind({ blinds_type: 'Curtains', attributes: { pleat_type_id: 'p1', extra: 2 } });
    const b = blind({ blinds_type: 'Curtains', attributes: { extra: 2, pleat_type_id: 'p1' } });
    expect(pricingFingerprint(a)).toBe(pricingFingerprint(b));
  });

  it('tags attribute value types so a string and a number cannot collide', () => {
    expect(pricingFingerprint(blind({ attributes: { k: '2' } }))).not.toBe(
      pricingFingerprint(blind({ attributes: { k: 2 } }))
    );
  });

  it('ignores the snapshot keys the Worker writes back into attributes', () => {
    const stored = blind({
      blinds_type: 'Curtains',
      attributes: { pleat_type_id: 'p1', pleat_name: 'Pinch', pleat_multiplier: 2.5 },
    });
    const sent = blind({ blinds_type: 'Curtains', attributes: { pleat_type_id: 'p1' } });
    expect(pricingFingerprint(stored)).toBe(pricingFingerprint(sent));
  });

  it('changes when the chosen catalog-ref id changes', () => {
    const before = blind({ blinds_type: 'Curtains', attributes: { pleat_type_id: 'p1' } });
    const after = blind({ blinds_type: 'Curtains', attributes: { pleat_type_id: 'p2' } });
    expect(pricingFingerprint(before)).not.toBe(pricingFingerprint(after));
  });
});

describe('pricingFingerprint — preset and custom items', () => {
  it('is driven by the preset provenance', () => {
    const a = pricingFingerprint({ item_type: 'preset', preset_id: 'x', unit_price: null });
    const b = pricingFingerprint({ item_type: 'preset', preset_id: 'y', unit_price: null });
    expect(a).not.toBe(b);
  });

  it('follows a typed price on a legacy preset or custom item', () => {
    const a = pricingFingerprint({ item_type: 'custom', preset_id: null, unit_price: 50 });
    const b = pricingFingerprint({ item_type: 'custom', preset_id: null, unit_price: 60 });
    expect(a).not.toBe(b);
    expect(pricingFingerprint({ item_type: 'custom', preset_id: null, unit_price: 50.0 })).toBe(a);
  });

  it('separates a preset from a custom item with the same figures', () => {
    expect(pricingFingerprint({ item_type: 'preset', preset_id: null, unit_price: 50 })).not.toBe(
      pricingFingerprint({ item_type: 'custom', preset_id: null, unit_price: 50 })
    );
  });
});

describe('lockApplies', () => {
  it('is false without a lock — nothing is frozen before confirmation', () => {
    expect(lockApplies(null, blind())).toBe(false);
    expect(lockApplies(undefined, blind())).toBe(false);
  });

  it('holds while the inputs are untouched', () => {
    const lock = { base: 123.45, fingerprint: pricingFingerprint(blind()) };
    expect(lockApplies(lock, blind())).toBe(true);
  });

  it('releases as soon as a pricing input is edited', () => {
    const lock = { base: 123.45, fingerprint: pricingFingerprint(blind()) };
    expect(lockApplies(lock, blind({ height_cm: 210 }))).toBe(false);
  });
});
