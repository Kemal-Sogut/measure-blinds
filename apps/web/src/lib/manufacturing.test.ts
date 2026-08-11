// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Unit tests for the manufacturing cut planner (`manufacturing.ts`).
 *
 * These lock the two packing algorithms and the whole-order plan against
 * the business rules described in the module header: aluminium is built
 * only for Roller/Zebra/Sunscreen-Solar and packed into 6 m bars; fabric
 * is packed into full-width strips whose height is set by the tallest
 * piece (the exact machine behaviour from the feature spec, including the
 * worked "150×150 + 100×130" example and its 50×150 / 100×20 offcuts).
 */

import { describe, it, expect } from 'vitest';
import {
  isAluminumType,
  planAluminumCuts,
  planFabricCuts,
  buildManufacturingPlan,
  resolveAluminumStockCm,
  ALUMINUM_STOCK_CM,
  DEFAULT_FABRIC_WIDTH_CM,
  type FabricPiece,
} from './manufacturing';
import type { LineItem } from '../types';

/** Builds a line item with sensible defaults; tests override what matters. */
function lineItem(overrides: Partial<LineItem> = {}): LineItem {
  return {
    id: 'li-1',
    order_id: 'o-1',
    item_type: 'blind',
    position: 0,
    room_name: 'Room',
    blinds_type: 'Roller',
    panels: [150],
    height_cm: 150,
    material_id: 'mat-1',
    material_name: 'Blackout White',
    material_price_per_sqm: 50,
    cassette_id: null,
    cassette_name: null,
    cassette_price_per_m: null,
    bottom_rail_id: null,
    bottom_rail_name: null,
    bottom_rail_price_per_m: null,
    control_id: null,
    control_name: null,
    control_price_per_item: null,
    description: '',
    note: '',
    color: '',
    attributes: {},
    quantity: 1,
    unit_price: 0,
    line_total: 0,
    title: '',
    preset_id: null,
    base_unit_price: null,
    show_original_price: true,
    addons: [],
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

describe('isAluminumType', () => {
  it('accepts the in-house aluminium types in any spelling', () => {
    for (const t of ['Roller', 'roller blind', 'Zebra', 'Sunscreen/Solar', 'Solar', 'Sunscreen']) {
      expect(isAluminumType(t)).toBe(true);
    }
  });
  it('rejects factory-ordered types and blanks', () => {
    for (const t of ['Roman', 'Honeycomb', 'Shutter', 'Curtains', '', null, undefined]) {
      expect(isAluminumType(t)).toBe(false);
    }
  });
});

describe('planAluminumCuts', () => {
  it('packs lengths into 6 m bars first-fit-decreasing', () => {
    const { bars, oversize } = planAluminumCuts([
      { length: 250, label: 'a' },
      { length: 300, label: 'b' },
      { length: 150, label: 'c' },
      { length: 100, label: 'd' },
    ]);
    expect(oversize).toHaveLength(0);
    expect(bars).toHaveLength(2);
    // Bar 1: 300 + 250 = 550 used, 50 leftover.
    expect(bars[0].cuts.map((c) => c.length)).toEqual([300, 250]);
    expect(bars[0].used).toBe(550);
    expect(bars[0].leftover).toBe(50);
    // Bar 2: 150 + 100 = 250 used, 350 leftover.
    expect(bars[1].cuts.map((c) => c.length)).toEqual([150, 100]);
    expect(bars[1].leftover).toBe(350);
  });

  it('flags cuts longer than a whole bar as oversize', () => {
    const { bars, oversize } = planAluminumCuts([{ length: ALUMINUM_STOCK_CM + 50, label: 'x' }]);
    expect(bars).toHaveLength(0);
    expect(oversize).toHaveLength(1);
  });

  it('packs against a custom stock length and stamps it on every bar', () => {
    // The same three 200 cm cuts fit one 600 cm bar but need two 400 cm bars.
    const cuts = [
      { length: 200, label: 'a' },
      { length: 200, label: 'b' },
      { length: 200, label: 'c' },
    ];
    expect(planAluminumCuts(cuts, 600).bars).toHaveLength(1);

    const { bars } = planAluminumCuts(cuts, 400);
    expect(bars).toHaveLength(2);
    expect(bars.map((b) => b.stock)).toEqual([400, 400]);
    expect(bars[0].leftover).toBe(0);
    expect(bars[1].leftover).toBe(200);
  });
});

describe('resolveAluminumStockCm', () => {
  it('keeps any positive length', () => {
    expect(resolveAluminumStockCm(450)).toBe(450);
    expect(resolveAluminumStockCm(0.5)).toBe(0.5);
  });

  it('falls back to the 6 m default for blank, unparseable, and impossible lengths', () => {
    for (const bad of [null, undefined, Number.NaN, 0, -300, Number.POSITIVE_INFINITY]) {
      expect(resolveAluminumStockCm(bad)).toBe(ALUMINUM_STOCK_CM);
    }
  });
});

describe('planFabricCuts (full-width strip machine model)', () => {
  it('reproduces the worked 150×150 + 100×130 example', () => {
    const pieces: FabricPiece[] = [
      { width: 150, height: 150, label: 'A' },
      { width: 100, height: 130, label: 'B' },
    ];
    const { strips, oversize } = planFabricCuts(pieces, 300);
    expect(oversize).toHaveLength(0);
    expect(strips).toHaveLength(1);

    const strip = strips[0];
    // Machine cuts the roll at the tallest height across the full width.
    expect(strip.height).toBe(150);
    expect(strip.usedWidth).toBe(250);
    // Side offcut: 300 − 250 = 50 wide at the full 150 height.
    expect(strip.sideLeftover).toEqual({ width: 50, height: 150 });
    // Top offcut above the 130-tall piece: 100 wide × (150 − 130) = 20.
    expect(strip.topLeftovers).toEqual([{ width: 100, height: 20, label: 'B' }]);
  });

  it('opens a new strip once the roll width is exhausted', () => {
    const pieces: FabricPiece[] = [
      { width: 200, height: 100, label: 'A' },
      { width: 200, height: 90, label: 'B' },
    ];
    const { strips } = planFabricCuts(pieces, 300);
    expect(strips).toHaveLength(2);
    expect(strips[0].height).toBe(100);
    expect(strips[1].height).toBe(90);
  });

  it('flags pieces wider than the roll', () => {
    const { strips, oversize } = planFabricCuts([{ width: 350, height: 100, label: 'wide' }], 300);
    expect(strips).toHaveLength(0);
    expect(oversize).toHaveLength(1);
  });
});

describe('buildManufacturingPlan', () => {
  it('separates aluminium builds, fabric strips, and as-is orders', () => {
    const items: LineItem[] = [
      lineItem({ id: 'a', blinds_type: 'Roller', panels: [150], height_cm: 150 }),
      lineItem({ id: 'b', blinds_type: 'Roller', panels: [100], height_cm: 130 }),
      lineItem({ id: 'c', blinds_type: 'Roman', panels: [120], height_cm: 200, material_id: 'mat-2' }),
      lineItem({
        id: 'd',
        item_type: 'custom',
        blinds_type: '',
        description: 'Installation fee',
        quantity: 1,
      }),
    ];
    const widths = new Map<string, number | null>([['mat-1', 300]]);
    const plan = buildManufacturingPlan(items, widths);

    // One aluminium group (Roller) → two cuts fit on one 6 m bar.
    expect(plan.aluminumGroups).toHaveLength(1);
    const alu = plan.aluminumGroups[0];
    expect(alu.blindType).toBe('Roller');
    expect(alu.barCount).toBe(1);
    expect(alu.usedCm).toBe(250);

    // One fabric roll (mat-1) → the worked example's single strip.
    expect(plan.fabricGroups).toHaveLength(1);
    const fab = plan.fabricGroups[0];
    expect(fab.rollWidth).toBe(300);
    expect(fab.assumedWidth).toBe(false);
    expect(fab.stripCount).toBe(1);
    expect(fab.consumedCm).toBe(150);
    // Utilisation = (150·150 + 100·130) / (300·150) = 35500 / 45000.
    expect(fab.utilization).toBeCloseTo(35500 / 45000, 5);

    // Roman + custom fee are ordered as-is (never cut here).
    expect(plan.asIs).toHaveLength(2);
    expect(plan.asIs.map((a) => a.label)).toContain('Room — Roman');
    expect(plan.asIs.map((a) => a.label)).toContain('Installation fee');
  });

  it('leaves the as-is detail unchanged when a blind declares no attributes', () => {
    // Every type is still on the base schema, so the production sheet must
    // read exactly as it did before the attributes column existed — no
    // stray separator, no empty tail.
    const plan = buildManufacturingPlan([
      lineItem({
        blinds_type: 'Roman',
        room_name: 'Room',
        material_name: 'Blackout White',
        color: 'Ivory',
        panels: [120],
        height_cm: 210,
        attributes: {},
      }),
    ], new Map());
    expect(plan.asIs).toHaveLength(1);
    expect(plan.asIs[0].detail).toBe('Blackout White · Ivory · 120 cm W × 210 cm H');
  });

  it('never merges the same material across different colour codes', () => {
    // Same material id + width, different colour = different physical roll.
    const items: LineItem[] = [
      lineItem({ id: 'a', material_id: 'mat-1', color: 'Snow', panels: [150], height_cm: 150 }),
      lineItem({ id: 'b', material_id: 'mat-1', color: 'Dune', panels: [150], height_cm: 150 }),
    ];
    const widths = new Map<string, number | null>([['mat-1', 300]]);
    const plan = buildManufacturingPlan(items, widths);
    expect(plan.fabricGroups).toHaveLength(2);
    expect(plan.fabricGroups.map((g) => g.materialName).sort()).toEqual([
      'Blackout White — Dune',
      'Blackout White — Snow',
    ]);
    // Both rolls still read their width from the shared material.
    expect(plan.fabricGroups.every((g) => g.rollWidth === 300)).toBe(true);
  });

  it('keeps same material + same colour on one roll', () => {
    const items: LineItem[] = [
      lineItem({ id: 'a', material_id: 'mat-1', color: 'Snow', panels: [150], height_cm: 150 }),
      lineItem({ id: 'b', material_id: 'mat-1', color: 'Snow', panels: [100], height_cm: 130 }),
    ];
    const plan = buildManufacturingPlan(items, new Map([['mat-1', 300]]));
    expect(plan.fabricGroups).toHaveLength(1);
    expect(plan.fabricGroups[0].pieceCount).toBe(2);
  });

  it('assumes the default roll width when a material has none set', () => {
    const items = [lineItem({ material_id: 'mat-x', panels: [140], height_cm: 200 })];
    const plan = buildManufacturingPlan(items, new Map());
    expect(plan.fabricGroups[0].rollWidth).toBe(DEFAULT_FABRIC_WIDTH_CM);
    expect(plan.fabricGroups[0].assumedWidth).toBe(true);
  });

  it('multiplies panels by quantity into cuts and pieces', () => {
    const items = [lineItem({ panels: [120, 80], height_cm: 160, quantity: 2, material_id: 'mat-1' })];
    const widths = new Map<string, number | null>([['mat-1', 300]]);
    const plan = buildManufacturingPlan(items, widths);
    // 2 panels × quantity 2 = 4 aluminium cuts and 4 fabric pieces.
    expect(plan.aluminumGroups[0].cutCount).toBe(4);
    expect(plan.fabricGroups[0].pieceCount).toBe(4);
  });

  it('defaults the aluminium bar length to 6 m when none is given', () => {
    const items = [lineItem({ panels: [150], height_cm: 150 })];
    const plan = buildManufacturingPlan(items, new Map([['mat-1', 300]]));
    expect(plan.aluminumGroups[0].stockCm).toBe(ALUMINUM_STOCK_CM);
    expect(plan.aluminumGroups[0].result.bars[0].stock).toBe(ALUMINUM_STOCK_CM);
  });

  it('re-packs aluminium against a custom bar length without touching fabric', () => {
    // 3 × 200 cm panels: one 600 cm bar, or three 250 cm bars.
    const items = [lineItem({ panels: [200, 200, 200], height_cm: 150, material_id: 'mat-1' })];
    const widths = new Map<string, number | null>([['mat-1', 300]]);

    const wide = buildManufacturingPlan(items, widths, 600);
    expect(wide.aluminumGroups[0].barCount).toBe(1);
    expect(wide.aluminumGroups[0].wasteCm).toBe(0);

    const narrow = buildManufacturingPlan(items, widths, 250);
    expect(narrow.aluminumGroups[0].stockCm).toBe(250);
    expect(narrow.aluminumGroups[0].barCount).toBe(3);
    expect(narrow.aluminumGroups[0].cutCount).toBe(3);
    expect(narrow.aluminumGroups[0].wasteCm).toBe(150);

    // Fabric is planned from the material's roll width, so it is identical.
    expect(narrow.fabricGroups).toEqual(wide.fabricGroups);
  });

  it('falls back to the default bar length when the override is unusable', () => {
    const items = [lineItem({ panels: [150], height_cm: 150 })];
    const widths = new Map<string, number | null>([['mat-1', 300]]);
    for (const bad of [null, 0, -50]) {
      expect(buildManufacturingPlan(items, widths, bad).aluminumGroups[0].stockCm).toBe(
        ALUMINUM_STOCK_CM
      );
    }
  });

  it('warns with the custom bar length when a cut no longer fits', () => {
    const items = [lineItem({ panels: [300], height_cm: 150 })];
    const widths = new Map<string, number | null>([['mat-1', 300]]);
    const plan = buildManufacturingPlan(items, widths, 250);
    expect(plan.aluminumGroups[0].cutCount).toBe(0);
    expect(plan.aluminumGroups[0].barCount).toBe(0);
    // The warning must quote the length actually in use, not the 600 default.
    expect(plan.warnings.join(' ')).toMatch(/300 cm exceeds a 250 cm bar/);
  });

  it('warns when an aluminium blind is missing its height', () => {
    const items = [lineItem({ panels: [150], height_cm: null })];
    const plan = buildManufacturingPlan(items, new Map([['mat-1', 300]]));
    // Aluminium can still be cut from the width; fabric is skipped + warned.
    expect(plan.aluminumGroups[0].cutCount).toBe(1);
    expect(plan.fabricGroups).toHaveLength(0);
    expect(plan.warnings.join(' ')).toMatch(/height missing/i);
  });
});
