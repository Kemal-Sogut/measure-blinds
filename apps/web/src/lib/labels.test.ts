// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Unit tests for the web-side label field extraction. This suite is the
 * MIRROR of apps/api/src/lib/labels.test.ts — the two modules are twins
 * (the same convention as pricing.ts/totals.ts) and must be changed
 * together. Any case added here is added there.
 */

import { describe, it, expect } from 'vitest';
import { buildLabels, type LabelLineItem, type LabelOrder } from './labels';

/** An order carrying exactly the fields buildLabels reads. */
function order(overrides: Partial<LabelOrder> = {}): LabelOrder {
  return {
    order_number: 'T0408-126',
    customer: { first_name: 'Ada', last_name: 'Lovelace' },
    line_items: [],
    ...overrides,
  };
}

/** A blind line item with sensible defaults for the fields under test. */
function blind(overrides: Partial<LabelLineItem> = {}): LabelLineItem {
  return {
    item_type: 'blind',
    position: 0,
    room_name: 'Living Room',
    panels: [120, 90],
    height_cm: 210,
    material_name: 'Blackout White',
    color: 'Ivory',
    cassette_name: 'Standard',
    control_name: 'Chain Left',
    quantity: 1,
    ...overrides,
  };
}

describe('buildLabels', () => {
  it('produces one label per unit of quantity, not per panel', () => {
    const labels = buildLabels(order({ line_items: [blind({ quantity: 2 })] }));
    expect(labels).toHaveLength(2);
    expect(labels[0].dimensions).toBe('120 + 90 x 210 cm');
    expect(labels[1].dimensions).toBe('120 + 90 x 210 cm');
  });

  it('numbers labels across the whole order', () => {
    const labels = buildLabels(
      order({ line_items: [blind({ quantity: 2 }), blind({ position: 1, quantity: 1 })] })
    );
    expect(labels.map((l) => [l.index, l.total])).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it('orders by line-item position, not array order', () => {
    const labels = buildLabels(
      order({
        line_items: [
          blind({ position: 2, room_name: 'Study' }),
          blind({ position: 1, room_name: 'Kitchen' }),
        ],
      })
    );
    expect(labels.map((l) => l.room)).toEqual(['Kitchen', 'Study']);
  });

  it('skips preset and custom rows', () => {
    const labels = buildLabels(
      order({
        line_items: [
          { ...blind(), item_type: 'preset' },
          { ...blind(), item_type: 'custom', position: 1 },
          blind({ position: 2 }),
        ],
      })
    );
    expect(labels).toHaveLength(1);
    expect(labels[0].index).toBe(1);
  });

  it('returns an empty list for an order with no blinds', () => {
    expect(buildLabels(order())).toEqual([]);
    expect(buildLabels(order({ line_items: null }))).toEqual([]);
  });

  it('joins material and colour with a middle dot, dropping either side when blank', () => {
    const [both] = buildLabels(order({ line_items: [blind()] }));
    expect(both.material).toBe('Blackout White · Ivory');

    const [noColor] = buildLabels(order({ line_items: [blind({ color: '   ' })] }));
    expect(noColor.material).toBe('Blackout White');

    const [noMaterial] = buildLabels(order({ line_items: [blind({ material_name: null })] }));
    expect(noMaterial.material).toBe('Ivory');

    const [neither] = buildLabels(
      order({ line_items: [blind({ material_name: null, color: '' })] })
    );
    expect(neither.material).toBe('');
  });

  it('degrades the dimensions string when panels or drop are missing', () => {
    const [noHeight] = buildLabels(order({ line_items: [blind({ height_cm: null })] }));
    expect(noHeight.dimensions).toBe('120 + 90 cm');

    const [noPanels] = buildLabels(order({ line_items: [blind({ panels: [] })] }));
    expect(noPanels.dimensions).toBe('H 210 cm');

    const [neither] = buildLabels(
      order({ line_items: [blind({ panels: [], height_cm: null })] })
    );
    expect(neither.dimensions).toBe('');
  });

  it('trims text fields and tolerates a missing customer', () => {
    const [label] = buildLabels(
      order({ customer: null, line_items: [blind({ room_name: '  Den  ' })] })
    );
    expect(label.room).toBe('Den');
    expect(label.customer).toBe('');
    expect(label.orderNumber).toBe('T0408-126');
  });

  it('passes cassette and control through, blanking nulls', () => {
    const [full] = buildLabels(order({ line_items: [blind()] }));
    expect(full.cassette).toBe('Standard');
    expect(full.control).toBe('Chain Left');

    const [bare] = buildLabels(
      order({ line_items: [blind({ cassette_name: null, control_name: null })] })
    );
    expect(bare.cassette).toBe('');
    expect(bare.control).toBe('');
  });
});
