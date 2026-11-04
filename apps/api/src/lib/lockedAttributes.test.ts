// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

import { describe, expect, it } from 'vitest';
import { carryDisplayOnlyAttributes } from './lockedAttributes';

const stored = {
  back_material_id: 'b1',
  back_material_name: 'Linen',
  back_material_price_per_sqm: 45,
  back_color: 'Grey',
};

describe('carryDisplayOnlyAttributes', () => {
  it('writes a changed display-only key and keeps the frozen keys', () => {
    expect(
      carryDisplayOnlyAttributes(stored, { back_material_id: 'other', back_color: 'Blue' }, ['back_color'])
    ).toEqual({
      back_material_id: 'b1',
      back_material_name: 'Linen',
      back_material_price_per_sqm: 45,
      back_color: 'Blue',
    });
  });

  it('drops a display-only key the payload no longer carries', () => {
    const out = carryDisplayOnlyAttributes(stored, { back_material_id: 'b1' }, ['back_color']);
    expect(out).not.toHaveProperty('back_color');
    expect(out.back_material_name).toBe('Linen');
  });

  it('returns the stored blob untouched for a type with no display-only keys', () => {
    expect(carryDisplayOnlyAttributes(stored, { back_color: 'Blue' }, [])).toBe(stored);
  });
});
