// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Tests for the hand-entered-money diff that feeds the order activity
 * trail. Hand-typed prices are the one thing on an order no formula can
 * explain afterwards, so what this produces is the whole record of them.
 */

import { describe, it, expect } from 'vitest';
import { describePriceChanges } from './lineItemAuditLog';

describe('describePriceChanges', () => {
  const plain = { unit_price: 100, base_unit_price: null, addons: [] };

  it('says nothing when nothing changed', () => {
    expect(describePriceChanges([plain], [plain])).toEqual([]);
  });

  it('says nothing when only the calculated price moved', () => {
    // A catalog price rose; nobody typed anything. Not an audit event.
    const before = { unit_price: 100, base_unit_price: null, addons: [] };
    const after = { unit_price: 130, base_unit_price: null, addons: [] };
    expect(describePriceChanges([before], [after])).toEqual([]);
  });

  it('reports a new override with both figures', () => {
    const after = { unit_price: 95, base_unit_price: 120, addons: [] };
    expect(describePriceChanges([plain], [after])).toEqual([
      'Item 1 price overridden: $120.00 → $95.00',
    ]);
  });

  it('reports a changed override', () => {
    const before = { unit_price: 95, base_unit_price: 120, addons: [] };
    const after = { unit_price: 90, base_unit_price: 120, addons: [] };
    expect(describePriceChanges([before], [after])).toEqual([
      'Item 1 price override changed: $95.00 → $90.00',
    ]);
  });

  it('reports a removed override', () => {
    const before = { unit_price: 95, base_unit_price: 120, addons: [] };
    const after = { unit_price: 120, base_unit_price: null, addons: [] };
    expect(describePriceChanges([before], [after])).toEqual([
      'Item 1 price override removed (back to $120.00)',
    ]);
  });

  it('reports added and removed add-ons', () => {
    const before = { ...plain, addons: [{ label: 'Rush fee', price: 50 }] };
    const after = { ...plain, addons: [{ label: 'Site measure', price: 25 }] };
    expect(describePriceChanges([before], [after])).toEqual([
      'Item 1 add-on removed: Rush fee $50.00',
      'Item 1 add-on added: Site measure $25.00',
    ]);
  });

  it('reads a repriced add-on as one removal and one addition', () => {
    const before = { ...plain, addons: [{ label: 'Rush fee', price: 50 }] };
    const after = { ...plain, addons: [{ label: 'Rush fee', price: 75 }] };
    expect(describePriceChanges([before], [after])).toEqual([
      'Item 1 add-on removed: Rush fee $50.00',
      'Item 1 add-on added: Rush fee $75.00',
    ]);
  });

  it('numbers items by position and reports an added item', () => {
    const after = { unit_price: 80, base_unit_price: 100, addons: [] };
    expect(describePriceChanges([plain], [plain, after])).toEqual([
      'Item 2 price overridden: $100.00 → $80.00',
    ]);
  });

  it('ignores items that were deleted', () => {
    // Only the surviving rows are described; the order edit itself is
    // already logged separately.
    expect(describePriceChanges([plain, plain], [plain])).toEqual([]);
  });
});
