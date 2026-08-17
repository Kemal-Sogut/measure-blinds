// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Unit tests for the web-side label field extraction. This is the only
 * implementation — printing is browser-only, so there is no server-side
 * twin to keep in step (the api copy went with the print-agent removal).
 */

import { describe, it, expect } from 'vitest';
import { buildLabels, type LabelLineItem, type LabelOrder } from './labels';

/** An order carrying exactly the fields buildLabels reads. */
function order(overrides: Partial<LabelOrder> = {}): LabelOrder {
  return {
    order_number: 'T0408-126',
    order_date: '2026-07-21',
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
    cassette_name: 'Regular Cassette',
    bottom_rail_name: 'Regular',
    control_name: 'Chain Control',
    // Null on everything but a curtain: only a blind type with an
    // installation option scoped to it carries one.
    installation_name: null,
    quantity: 1,
    hidden: false,
    ...overrides,
  };
}

describe('buildLabels', () => {
  it('skips hidden items and counts only visible ones in "n of m"', () => {
    // A hidden item is not manufactured, so it gets no label — and the
    // count on the labels that ARE printed has to agree, because a bench
    // worker uses "n of m" to know the bundle is complete.
    const labels = buildLabels(
      order({
        line_items: [
          blind({ position: 0, room_name: 'Living Room' }),
          blind({ position: 1, room_name: 'Cellar', hidden: true }),
          blind({ position: 2, room_name: 'Kitchen' }),
        ],
      })
    );
    expect(labels.map((l) => l.room)).toEqual(['Living Room', 'Kitchen']);
    expect(labels.map((l) => [l.index, l.total])).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

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

  it('joins material and colour with an em dash, dropping either side when blank', () => {
    const [both] = buildLabels(order({ line_items: [blind()] }));
    expect(both.material).toBe('Blackout White — Ivory');

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

  it('prints the order date as month and day, with no year', () => {
    const [label] = buildLabels(order({ line_items: [blind()] }));
    expect(label.orderDate).toBe('Jul 21');
  });

  it('reads the order date as local, not UTC, and blanks a malformed one', () => {
    // Parsed as a string this would be UTC midnight and render as Dec 31
    // in every North American zone.
    const [newYear] = buildLabels(order({ order_date: '2026-01-01', line_items: [blind()] }));
    expect(newYear.orderDate).toBe('Jan 1');

    const [missing] = buildLabels(order({ order_date: '', line_items: [blind()] }));
    expect(missing.orderDate).toBe('');

    const [junk] = buildLabels(order({ order_date: 'not-a-date', line_items: [blind()] }));
    expect(junk.orderDate).toBe('');
  });

  it('captions the hardware row and codes every live catalog name', () => {
    const [full] = buildLabels(order({ line_items: [blind()] }));
    expect(full.hardware).toBe('Cassette: R · Bottom Rail: R · Control: R');

    /** Every name currently in the catalog, with the code it must print. */
    const cassettes: [string, string][] = [
      ['Regular Cassette', 'R'],
      ['Fabric Wrapped', 'W'],
      ['Square Cassette', 'S'],
      ['No Cassette', '-'],
    ];
    for (const [name, code] of cassettes) {
      const [label] = buildLabels(order({ line_items: [blind({ cassette_name: name })] }));
      expect(label.hardware).toBe(`Cassette: ${code} · Bottom Rail: R · Control: R`);
    }

    const rails: [string, string][] = [
      ['Regular', 'R'],
      ['Pear', 'P'],
    ];
    for (const [name, code] of rails) {
      const [label] = buildLabels(order({ line_items: [blind({ bottom_rail_name: name })] }));
      expect(label.hardware).toBe(`Cassette: R · Bottom Rail: ${code} · Control: R`);
    }

    const controls: [string, string][] = [
      ['Chain Control', 'R'],
      ['Cordless', 'C'],
      ['Safety-Wand Control', 'SW'],
      ['Motorized (Bluetooth)', 'MB'],
      // The name contains "Bluetooth", so only pattern order keeps this M.
      ['Motorized (Non-Bluetooth)', 'M'],
    ];
    for (const [name, code] of controls) {
      const [label] = buildLabels(order({ line_items: [blind({ control_name: name })] }));
      expect(label.hardware).toBe(`Cassette: R · Bottom Rail: R · Control: ${code}`);
    }
  });

  it('appends the installation segment when the row carries one', () => {
    // A curtain: no cassette and no bottom rail scoped to it, a rod
    // instead. Installation is the fourth hardware slot since migration 35.
    const [curtain] = buildLabels(
      order({
        line_items: [
          blind({ cassette_name: null, bottom_rail_name: null, installation_name: 'Rod' }),
        ],
      })
    );
    expect(curtain.hardware).toBe('Control: R · Installation: R');

    const [track] = buildLabels(
      order({ line_items: [blind({ installation_name: 'Track' })] })
    );
    expect(track.hardware).toBe('Cassette: R · Bottom Rail: R · Control: R · Installation: T');
  });

  it('drops the segment of any part the row does not carry', () => {
    const [noRail] = buildLabels(order({ line_items: [blind({ bottom_rail_name: null })] }));
    expect(noRail.hardware).toBe('Cassette: R · Control: R');

    const [bare] = buildLabels(
      order({
        line_items: [
          blind({ cassette_name: null, bottom_rail_name: null, control_name: null }),
        ],
      })
    );
    expect(bare.hardware).toBe('');
  });

  it('trims a padded catalog name and codes an unmapped one by its initial', () => {
    const [padded] = buildLabels(
      order({ line_items: [blind({ bottom_rail_name: '  Pear  ' })] })
    );
    expect(padded.hardware).toBe('Cassette: R · Bottom Rail: P · Control: R');

    // An option added in Settings after the code table was written.
    const [novel] = buildLabels(
      order({ line_items: [blind({ control_name: 'Tilt Rod' })] })
    );
    expect(novel.hardware).toBe('Cassette: R · Bottom Rail: R · Control: T');
  });
});
