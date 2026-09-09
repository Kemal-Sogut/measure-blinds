// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Aggregation tests for the internal Material usage report.
 *
 * The report is a reading of how much fabric an order consumes, so two
 * properties are load-bearing. It must count exactly the lines the order
 * itself counts — a hidden or unpriceable window is not fabric anyone
 * buys — and every figure it prints must be the BILLED quantity the
 * blind-type module reports, never a second calculation. Both are
 * asserted below, along with the tick-selection total, which must sum the
 * same per-window readings the rows are built from.
 */

import { describe, it, expect } from 'vitest';
import {
  summarizeMaterialUsage,
  selectedUsageTotals,
  allUsageLineKeys,
  materialRowKey,
} from './materialUsage';
import type { BlindDraft, Catalogs, FlatDraft, ItemDraft } from './lineItemDrafts';

const ROLLER = { id: 'bt-roller', name: 'Roller', active: true, sort_order: 0 };
const CURTAINS = { id: 'bt-curtains', name: 'Curtains', active: true, sort_order: 1 };

/**
 * Two m²-priced materials plus one shared with Curtains, so the mixed-unit
 * case has a material that legitimately appears under both rate units.
 */
function catalogs(overrides: Partial<Catalogs> = {}): Catalogs {
  return {
    blindTypes: [ROLLER, CURTAINS],
    materials: [
      { id: 'm1', name: 'Blackout Ivory', price_per_sqm: 50, active: true, sort_order: 0, width_cm: null, blind_type_ids: [ROLLER.id, CURTAINS.id] },
      { id: 'm2', name: 'Sunscreen Charcoal', price_per_sqm: 40, active: true, sort_order: 1, width_cm: null, blind_type_ids: [ROLLER.id] },
    ],
    cassettes: [
      { id: 'c1', name: 'Standard', price: 20, price_basis: 'per_m', active: true, sort_order: 0, blind_type_ids: [ROLLER.id] },
    ],
    bottomRails: [
      { id: 'b1', name: 'Regular', price: 0, price_basis: 'per_m', active: true, sort_order: 0, blind_type_ids: [ROLLER.id] },
    ],
    controls: [
      { id: 'ct1', name: 'Chain', price: 0, price_basis: 'per_panel', active: true, sort_order: 0, blind_type_ids: [ROLLER.id, CURTAINS.id] },
    ],
    pleatTypes: [],
    defaults: [],
    installationOptions: [],
    ...overrides,
  };
}

/** A complete, valid Roller draft: 140cm × 200cm = 2.80 m² billed, $50/m². */
function blind(overrides: Partial<BlindDraft> = {}): BlindDraft {
  return {
    unit_price_override: '',
    show_original_price: true,
    addons: [],
    lock: null,
    key: 'd1',
    uid: null,
    hidden: false,
    item_type: 'blind',
    room_name: 'Living Room',
    blinds_type: 'Roller',
    panels: ['140'],
    height_cm: '200',
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

/** A preset line — carries a price but no material. */
function flat(overrides: Partial<FlatDraft> = {}): FlatDraft {
  return {
    unit_price_override: '',
    show_original_price: true,
    addons: [],
    lock: null,
    key: 'f1',
    uid: null,
    hidden: false,
    item_type: 'preset',
    title: 'Motorisation',
    description: '',
    preset_id: 'p1',
    quantity: '1',
    unit_price: '250',
    ...overrides,
  };
}

describe('summarizeMaterialUsage', () => {
  it('reports one row per material, carrying the billed quantity', () => {
    const summary = summarizeMaterialUsage([blind()], catalogs());
    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0]).toMatchObject({
      materialId: 'm1',
      materialName: 'Blackout Ivory',
      unit: 'sqm',
      lineCount: 1,
    });
    expect(summary.rows[0].quantity).toBeCloseTo(2.8, 10);
  });

  it('reports quantity only — no rate and no money', () => {
    // The report is a fabric reading, not a pricing surface. Money lives
    // in the order's own totals, which are server-authoritative.
    const [row] = summarizeMaterialUsage([blind()], catalogs()).rows;
    expect(row).not.toHaveProperty('rate');
    expect(row).not.toHaveProperty('amount');
    expect(row.lines[0]).not.toHaveProperty('amount');
  });

  it('collapses two blinds of the same material into one row', () => {
    const summary = summarizeMaterialUsage(
      [blind({ key: 'a' }), blind({ key: 'b', panels: ['100'], height_cm: '200' })],
      catalogs()
    );
    expect(summary.rows).toHaveLength(1);
    // 2.80 + 2.00 m²
    expect(summary.rows[0].quantity).toBeCloseTo(4.8, 10);
    expect(summary.rows[0].lineCount).toBe(2);
  });

  it('multiplies the billed quantity by the line quantity', () => {
    const summary = summarizeMaterialUsage([blind({ quantity: '3' })], catalogs());
    expect(summary.rows[0].quantity).toBeCloseTo(8.4, 10);
  });

  it('excludes a hidden line entirely, matching the order total', () => {
    // A hidden line is excluded from the order total and every document,
    // so counting its fabric would be counting material nobody buys.
    const summary = summarizeMaterialUsage(
      [blind({ key: 'a' }), blind({ key: 'b', hidden: true })],
      catalogs()
    );
    expect(summary.rows[0].quantity).toBeCloseTo(2.8, 10);
    expect(summary.excludedCount).toBe(0);
  });

  it('counts preset and custom lines as excluded rather than pricing them', () => {
    const items: ItemDraft[] = [blind(), flat(), flat({ key: 'f2', item_type: 'custom', preset_id: null })];
    const summary = summarizeMaterialUsage(items, catalogs());
    expect(summary.rows).toHaveLength(1);
    expect(summary.excludedCount).toBe(2);
  });

  it('counts an incomplete blind as excluded rather than guessing its area', () => {
    const summary = summarizeMaterialUsage([blind(), blind({ key: 'b', height_cm: '' })], catalogs());
    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0].quantity).toBeCloseTo(2.8, 10);
    expect(summary.excludedCount).toBe(1);
  });

  it('does not count a hidden incomplete line as excluded', () => {
    // Hidden lines are gone before the completeness question is asked;
    // reporting them as "incomplete" would nag about a row the consultant
    // has already set aside.
    const summary = summarizeMaterialUsage(
      [blind(), blind({ key: 'b', height_cm: '', hidden: true })],
      catalogs()
    );
    expect(summary.excludedCount).toBe(0);
  });

  it('ignores a manual price override — a price is not a quantity', () => {
    // What a window was charged has no bearing on how much fabric it
    // consumes, and the panel must keep reporting the real figure.
    const summary = summarizeMaterialUsage([blind({ unit_price_override: '25' })], catalogs());
    expect(summary.rows[0].quantity).toBeCloseTo(2.8, 10);
  });

  it('keeps square metres and running metres in separate rows and totals', () => {
    const items: ItemDraft[] = [
      blind(),
      blind({ key: 'c', blinds_type: 'Curtains', panels: ['300'], cassette_id: '', bottom_rail_id: '' }),
    ];
    const summary = summarizeMaterialUsage(items, catalogs());
    expect(summary.rows).toHaveLength(2);
    expect(summary.rows.map((r) => r.unit).sort()).toEqual(['running_m', 'sqm']);
    // Curtains with no pleat attribute: fullness 1 → 3.0 m + 0.5 m hem.
    const curtainRow = summary.rows.find((r) => r.unit === 'running_m');
    expect(curtainRow?.quantity).toBeCloseTo(3.5, 10);
    expect(summary.totals.sqm).toBeCloseTo(2.8, 10);
    expect(summary.totals.running_m).toBeCloseTo(3.5, 10);
  });

  it('omits a unit from the totals when no line uses it', () => {
    const summary = summarizeMaterialUsage([blind()], catalogs());
    expect(summary.totals.sqm).toBeDefined();
    expect(summary.totals.running_m).toBeUndefined();
  });

  it('reports the BILLED quantity for an under-minimum blind', () => {
    // 60 × 80 cm measures 0.48 m² but bills — and therefore consumes —
    // 1.50 m² once the width and height minimums apply.
    const summary = summarizeMaterialUsage(
      [blind({ panels: ['60'], height_cm: '80' })],
      catalogs()
    );
    expect(summary.rows[0].quantity).toBeCloseTo(1.5, 10);
  });

  it('orders rows by descending quantity, biggest consumer first', () => {
    const items: ItemDraft[] = [
      blind({ key: 'a', material_id: 'm1' }),
      blind({ key: 'b', material_id: 'm2', panels: ['300'], height_cm: '300' }),
    ];
    const summary = summarizeMaterialUsage(items, catalogs());
    expect(summary.rows.map((r) => r.materialId)).toEqual(['m2', 'm1']);
  });

  it('breaks a quantity tie alphabetically rather than arbitrarily', () => {
    const items: ItemDraft[] = [
      blind({ key: 'a', material_id: 'm2' }),
      blind({ key: 'b', material_id: 'm1' }),
    ];
    const summary = summarizeMaterialUsage(items, catalogs());
    expect(summary.rows.map((r) => r.materialName)).toEqual([
      'Blackout Ivory',
      'Sunscreen Charcoal',
    ]);
  });

  it('breaks a row down into the windows that made it, in editor order', () => {
    const items: ItemDraft[] = [
      blind({ key: 'a', room_name: 'Living Room' }),
      blind({ key: 'b', room_name: 'Kitchen', panels: ['100'], height_cm: '200' }),
    ];
    const [row] = summarizeMaterialUsage(items, catalogs()).rows;
    expect(row.lines.map((l) => l.label)).toEqual(['Living Room', 'Kitchen']);
    expect(row.lines.map((l) => l.key)).toEqual(['a', 'b']);
    expect(row.lines[0].quantity).toBeCloseTo(2.8, 10);
    expect(row.lines[1].quantity).toBeCloseTo(2, 10);
  });

  it('sums its lines back to the row they sit under', () => {
    const items: ItemDraft[] = [
      blind({ key: 'a', quantity: '3' }),
      blind({ key: 'b', panels: ['60'], height_cm: '80' }),
    ];
    const [row] = summarizeMaterialUsage(items, catalogs()).rows;
    expect(row.lines).toHaveLength(row.lineCount);
    const sum = row.lines.reduce((a, l) => a + l.quantity, 0);
    expect(sum).toBeCloseTo(row.quantity, 10);
  });

  it('multiplies a line breakdown by that line quantity', () => {
    const [row] = summarizeMaterialUsage([blind({ quantity: '4' })], catalogs()).rows;
    expect(row.lines[0].itemQuantity).toBe(4);
    expect(row.lines[0].quantity).toBeCloseTo(11.2, 10);
  });

  it('reports a line breakdown in running metres for Curtains', () => {
    const items: ItemDraft[] = [
      blind({
        key: 'c',
        room_name: 'Master Bedroom',
        blinds_type: 'Curtains',
        panels: ['150', '150'],
        cassette_id: '',
        bottom_rail_id: '',
      }),
    ];
    const [row] = summarizeMaterialUsage(items, catalogs()).rows;
    expect(row.unit).toBe('running_m');
    // 3.0 m of finished width at fullness 1, plus 0.5 m of hem per panel.
    expect(row.lines[0].quantity).toBeCloseTo(4, 10);
    expect(row.lines[0]).toMatchObject({
      label: 'Master Bedroom',
      blindType: 'Curtains',
      widthCm: 300,
      itemQuantity: 1,
    });
  });

  it('carries the MEASURED dimensions, so a window stays findable', () => {
    const [row] = summarizeMaterialUsage(
      [blind({ panels: ['60', '20'], height_cm: '80' })],
      catalogs()
    ).rows;
    // Billed on the 100 × 150 minimums, but labelled with what was typed.
    expect(row.lines[0]).toMatchObject({ widthCm: 80, heightCm: 80 });
    expect(row.lines[0].quantity).toBeCloseTo(1.5, 10);
  });

  it('falls back to the editor line label when a room is blank', () => {
    const items: ItemDraft[] = [
      flat({ key: 'f' }),
      blind({ key: 'a', room_name: '' }),
    ];
    const [row] = summarizeMaterialUsage(items, catalogs()).rows;
    // Numbered by position in the full list, exactly as the item list is.
    expect(row.lines[0].label).toBe('Blind 2');
  });

  it('keeps an excluded line out of the breakdown as well as the row', () => {
    const items: ItemDraft[] = [
      blind({ key: 'a' }),
      blind({ key: 'h', hidden: true }),
      blind({ key: 'i', height_cm: '' }),
    ];
    const [row] = summarizeMaterialUsage(items, catalogs()).rows;
    expect(row.lines.map((l) => l.key)).toEqual(['a']);
  });

  it('returns an empty summary for an order with no lines', () => {
    const summary = summarizeMaterialUsage([], catalogs());
    expect(summary.rows).toEqual([]);
    expect(summary.totals).toEqual({});
    expect(summary.excludedCount).toBe(0);
  });
});

describe('selectedUsageTotals', () => {
  /** Two Rollers on one material, plus one Curtain on another unit. */
  function mixedOrder(): ItemDraft[] {
    return [
      blind({ key: 'a', room_name: 'Living Room' }),
      blind({ key: 'b', room_name: 'Kitchen', panels: ['100'], height_cm: '200' }),
      blind({
        key: 'c',
        room_name: 'Master Bedroom',
        blinds_type: 'Curtains',
        panels: ['300'],
        cassette_id: '',
        bottom_rail_id: '',
      }),
    ];
  }

  it('is empty when nothing is ticked, rather than a zero for every unit', () => {
    const summary = summarizeMaterialUsage(mixedOrder(), catalogs());
    expect(selectedUsageTotals(summary, new Set())).toEqual({});
  });

  it('sums the ticked windows and nothing else', () => {
    const summary = summarizeMaterialUsage(mixedOrder(), catalogs());
    // Living Room 2.80 m² only — Kitchen's 2.00 m² is not ticked.
    expect(selectedUsageTotals(summary, new Set(['a'])).sqm).toBeCloseTo(2.8, 10);
  });

  it('adds two ticked windows of the same unit together', () => {
    const summary = summarizeMaterialUsage(mixedOrder(), catalogs());
    expect(selectedUsageTotals(summary, new Set(['a', 'b'])).sqm).toBeCloseTo(4.8, 10);
  });

  it('keeps square metres and running metres apart in the selection too', () => {
    // Adding a running metre to a square metre would produce a figure
    // that describes nothing, so each unit is reported on its own.
    const summary = summarizeMaterialUsage(mixedOrder(), catalogs());
    const totals = selectedUsageTotals(summary, new Set(['a', 'c']));
    expect(totals.sqm).toBeCloseTo(2.8, 10);
    expect(totals.running_m).toBeCloseTo(3.5, 10);
  });

  it('reports only the units the ticked windows actually use', () => {
    const summary = summarizeMaterialUsage(mixedOrder(), catalogs());
    expect(selectedUsageTotals(summary, new Set(['c'])).sqm).toBeUndefined();
  });

  it('ignores a key no line carries, so a stale tick cannot linger', () => {
    // The dialog stays open while the order is edited: a window can be
    // deleted, or edited into an unpriceable state, after being ticked.
    const summary = summarizeMaterialUsage(mixedOrder(), catalogs());
    const totals = selectedUsageTotals(summary, new Set(['a', 'deleted-line']));
    expect(totals.sqm).toBeCloseTo(2.8, 10);
  });

  it('totals every window back to the order total when all are ticked', () => {
    const summary = summarizeMaterialUsage(mixedOrder(), catalogs());
    const totals = selectedUsageTotals(summary, new Set(allUsageLineKeys(summary)));
    expect(totals.sqm).toBeCloseTo(summary.totals.sqm ?? 0, 10);
    expect(totals.running_m).toBeCloseTo(summary.totals.running_m ?? 0, 10);
  });

  it('counts a ticked line at its full line quantity', () => {
    const summary = summarizeMaterialUsage([blind({ quantity: '3' })], catalogs());
    expect(selectedUsageTotals(summary, new Set(['d1'])).sqm).toBeCloseTo(8.4, 10);
  });
});

describe('allUsageLineKeys', () => {
  it('lists every reported window, in row-then-editor order', () => {
    const items: ItemDraft[] = [
      blind({ key: 'a', material_id: 'm2', panels: ['300'], height_cm: '300' }),
      blind({ key: 'b', material_id: 'm1', room_name: 'Kitchen' }),
      blind({ key: 'c', material_id: 'm1', room_name: 'Study', panels: ['100'] }),
    ];
    const summary = summarizeMaterialUsage(items, catalogs());
    // m2 leads on quantity; m1's two windows follow in editor order.
    expect(allUsageLineKeys(summary)).toEqual(['a', 'b', 'c']);
  });

  it('omits the lines the report itself excluded', () => {
    const items: ItemDraft[] = [
      blind({ key: 'a' }),
      blind({ key: 'h', hidden: true }),
      flat({ key: 'f' }),
    ];
    expect(allUsageLineKeys(summarizeMaterialUsage(items, catalogs()))).toEqual(['a']);
  });

  it('is empty for an order with no material lines', () => {
    expect(allUsageLineKeys(summarizeMaterialUsage([flat()], catalogs()))).toEqual([]);
  });
});

describe('materialRowKey', () => {
  it('separates the same material quoted in two different units', () => {
    // A material scoped to both Curtains and a m²-priced type is two
    // rows; one key would pool running metres into square metres.
    expect(materialRowKey('m1', 'sqm')).not.toBe(materialRowKey('m1', 'running_m'));
  });
});
