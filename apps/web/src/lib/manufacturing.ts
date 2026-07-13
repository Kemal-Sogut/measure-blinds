// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Manufacturing cut planner — turns an order's line items into the
 * concrete list of physical cuts the workshop makes, for the
 * "Manufacturer Copy" page.
 *
 * Domain model (per the business):
 *  - Roller, Zebra and Sunscreen/Solar shades are BUILT in-house from a
 *    6 m aluminium bar (tube + bottom rail run the WIDTH of the blind)
 *    plus a length of fabric. Every other blind type — and preset/custom
 *    line items — is ordered from the factory AS-IS and only needs to be
 *    listed, not cut.
 *  - A line item may hold several `panels` (each panel is one physical
 *    blind of that width) and a `quantity` (the whole panel set repeated).
 *    So one blind = one aluminium cut (length = panel width) + one fabric
 *    piece (panel width × drop height).
 *
 * Two independent 1-D/2-D packing problems are solved:
 *  1. Aluminium — classic 1-D bin packing of required lengths into 6 m
 *     bars (First-Fit-Decreasing), grouped per blind type since profiles
 *     differ between Roller/Zebra/Solar.
 *  2. Fabric — the cutting machine can only cut the HEIGHT across the FULL
 *     roll width, so pieces are packed into full-width "courses"/strips
 *     (First-Fit-Decreasing-Height shelf packing). Within a strip the
 *     tallest piece sets the cut height; each shorter piece is then
 *     trimmed down, leaving a top offcut, and any unused roll width to the
 *     side is a side offcut. Fabric is grouped per material because each
 *     material is a distinct roll with its own width.
 *
 * This module is PURE (no I/O, no React) so it is unit-testable and can be
 * reused by the page, a future PDF, or the API. All lengths are in cm.
 */

import type { LineItem } from '../types';
import { normalizeBlindType } from './calculators/registry';

/** Length of one stock aluminium bar, in cm (6 m). */
export const ALUMINUM_STOCK_CM = 600;

/** Fabric roll width assumed when a material has no width set, in cm (3 m). */
export const DEFAULT_FABRIC_WIDTH_CM = 300;

/**
 * Normalised blind-type keys built in-house from aluminium. Sunscreen and
 * Solar are the same product ("Sunscreen/Solar" normalises to
 * `sunscreensolar`); the individual `sunscreen` / `solar` spellings are
 * accepted too so hand-typed line items still resolve.
 */
const ALUMINUM_TYPE_KEYS: ReadonlySet<string> = new Set([
  'roller',
  'zebra',
  'sunscreen',
  'solar',
  'sunscreensolar',
]);

/** Floating-point slack (cm) for "does it still fit" comparisons. */
const EPSILON = 1e-6;

/**
 * True when a stored blind-type name is one the company builds in-house
 * from aluminium (Roller / Zebra / Sunscreen-Solar). Uses the same
 * normalisation as the pricing registry so spelling/spacing/"… Blind"
 * suffixes all resolve.
 */
export function isAluminumType(blindsType: string | null | undefined): boolean {
  return ALUMINUM_TYPE_KEYS.has(normalizeBlindType(blindsType));
}

/* ------------------------------------------------------------------ */
/* Aluminium — 1-D bin packing into 6 m bars                           */
/* ------------------------------------------------------------------ */

/** A single length of aluminium to be cut, with a human-readable label. */
export interface AluminumCut {
  /** Length to cut, in cm. */
  length: number;
  /** Where this cut comes from, e.g. "Living Room · Roller (panel 150 cm)". */
  label: string;
}

/** One 6 m stock bar with the cuts assigned to it and its offcut. */
export interface AluminumBar {
  /** 1-based bar number for display. */
  index: number;
  /** Stock length of this bar, in cm. */
  stock: number;
  /** Cuts taken from this bar, longest-first. */
  cuts: AluminumCut[];
  /** Total length consumed, in cm. */
  used: number;
  /** Remaining offcut, in cm. */
  leftover: number;
}

/** Result of packing aluminium cuts: the bars plus any un-packable cuts. */
export interface AluminumResult {
  bars: AluminumBar[];
  /** Cuts longer than one stock bar — flagged, never silently dropped. */
  oversize: AluminumCut[];
}

/**
 * Packs aluminium `cuts` into stock bars of `stock` cm using First-Fit-
 * Decreasing: sort longest-first, drop each cut into the first bar that
 * still has room, else open a new bar. FFD is the standard, near-optimal
 * heuristic for 1-D bin packing and is deterministic. Cuts longer than a
 * whole bar cannot be produced and are returned in `oversize`.
 */
export function planAluminumCuts(
  cuts: AluminumCut[],
  stock: number = ALUMINUM_STOCK_CM
): AluminumResult {
  const oversize = cuts.filter((c) => c.length > stock + EPSILON);
  const fit = cuts
    .filter((c) => c.length <= stock + EPSILON)
    .sort((a, b) => b.length - a.length);

  const bars: AluminumBar[] = [];
  for (const cut of fit) {
    const bar = bars.find((b) => b.leftover + EPSILON >= cut.length);
    if (bar) {
      bar.cuts.push(cut);
      bar.used += cut.length;
      bar.leftover -= cut.length;
    } else {
      bars.push({
        index: bars.length + 1,
        stock,
        cuts: [cut],
        used: cut.length,
        leftover: stock - cut.length,
      });
    }
  }
  return { bars, oversize };
}

/* ------------------------------------------------------------------ */
/* Fabric — full-width shelf packing (FFDH)                            */
/* ------------------------------------------------------------------ */

/** A rectangle of fabric to cut: `width` across the roll, `height` = drop. */
export interface FabricPiece {
  /** Width across the roll, in cm (must be ≤ roll width). */
  width: number;
  /** Drop/height, in cm — the machine cuts this across the full roll. */
  height: number;
  /** Where this piece comes from. */
  label: string;
}

/** An offcut rectangle left over from a strip. */
export interface FabricLeftover {
  width: number;
  height: number;
  /** Present on top offcuts (trim above a specific piece). */
  label?: string;
}

/**
 * One full-width "course" cut across the roll. The machine cuts the roll
 * at `height` (the tallest piece in the strip) over the whole `rollWidth`,
 * then the operator cuts each piece's width side-by-side and trims the
 * shorter pieces down — hence the two kinds of offcut.
 */
export interface FabricStrip {
  /** 1-based strip number. */
  index: number;
  /** Roll width this strip was cut from, in cm. */
  rollWidth: number;
  /** Cut height = the tallest piece in the strip, in cm. */
  height: number;
  /** Pieces placed side-by-side across the roll, widest-first. */
  pieces: FabricPiece[];
  /** Sum of piece widths, in cm. */
  usedWidth: number;
  /** Unused roll width at full strip height, or null when fully used. */
  sideLeftover: FabricLeftover | null;
  /** Trim above each piece shorter than the strip height (only >0 ones). */
  topLeftovers: FabricLeftover[];
}

/** Result of packing fabric pieces for ONE roll width. */
export interface FabricResult {
  strips: FabricStrip[];
  /** Pieces wider than the roll — cannot be cut from a single width. */
  oversize: FabricPiece[];
}

/**
 * Packs fabric `pieces` into full-width strips of `rollWidth` cm using
 * First-Fit-Decreasing-Height shelf packing: sort tallest-first, place
 * each piece into the first strip that still has horizontal room, else
 * open a new strip whose cut height is that piece's height. Because
 * pieces are processed tallest-first, the piece that opens a strip is the
 * tallest it will ever hold, so the strip height equals the machine's
 * full-width cut height. Minimising the number/height of strips minimises
 * fabric consumed. Pieces wider than the roll are returned in `oversize`.
 */
export function planFabricCuts(pieces: FabricPiece[], rollWidth: number): FabricResult {
  const oversize = pieces.filter((p) => p.width > rollWidth + EPSILON);
  const fit = pieces
    .filter((p) => p.width <= rollWidth + EPSILON)
    .sort((a, b) => b.height - a.height);

  interface OpenStrip {
    height: number;
    remaining: number;
    pieces: FabricPiece[];
  }
  const open: OpenStrip[] = [];
  for (const piece of fit) {
    const strip = open.find((s) => s.remaining + EPSILON >= piece.width);
    if (strip) {
      strip.pieces.push(piece);
      strip.remaining -= piece.width;
    } else {
      open.push({ height: piece.height, remaining: rollWidth - piece.width, pieces: [piece] });
    }
  }

  const strips: FabricStrip[] = open.map((s, i) => {
    const usedWidth = rollWidth - s.remaining;
    const topLeftovers: FabricLeftover[] = s.pieces
      .filter((p) => s.height - p.height > EPSILON)
      .map((p) => ({ width: p.width, height: s.height - p.height, label: p.label }));
    return {
      index: i + 1,
      rollWidth,
      height: s.height,
      pieces: s.pieces,
      usedWidth,
      sideLeftover: s.remaining > EPSILON ? { width: s.remaining, height: s.height } : null,
      topLeftovers,
    };
  });
  return { strips, oversize };
}

/* ------------------------------------------------------------------ */
/* Whole-order plan                                                    */
/* ------------------------------------------------------------------ */

/** Aluminium cut list for one blind type, with summary stats. */
export interface AluminumGroup {
  /** Display name of the blind type (as stored on the first line item). */
  blindType: string;
  result: AluminumResult;
  /** Number of cuts (excluding oversize). */
  cutCount: number;
  /** Number of 6 m bars needed. */
  barCount: number;
  /** Total aluminium consumed, in cm. */
  usedCm: number;
  /** Total offcut across all bars, in cm. */
  wasteCm: number;
}

/** Fabric cut list for one material roll, with summary stats. */
export interface FabricGroup {
  /** Material (fabric) name as snapshotted on the line items. */
  materialName: string;
  /** Roll width used for packing, in cm. */
  rollWidth: number;
  /** True when `rollWidth` is the assumed default (material had no width). */
  assumedWidth: boolean;
  result: FabricResult;
  /** Number of fabric pieces (excluding oversize). */
  pieceCount: number;
  /** Number of full-width strips. */
  stripCount: number;
  /** Total roll length consumed (Σ strip heights), in cm. */
  consumedCm: number;
  /** Area of the finished pieces, in cm². */
  usefulAreaCm2: number;
  /** Area of fabric consumed (rollWidth × consumedCm), in cm². */
  consumedAreaCm2: number;
  /** usefulArea / consumedArea in [0,1]; 0 when nothing consumed. */
  utilization: number;
}

/** A factory-ordered (as-is) line — not built in-house, just listed. */
export interface AsIsItem {
  label: string;
  detail: string;
  quantity: number;
}

/** Complete manufacturing plan for an order. */
export interface ManufacturingPlan {
  aluminumGroups: AluminumGroup[];
  fabricGroups: FabricGroup[];
  asIs: AsIsItem[];
  /** Non-fatal issues (missing measurements, oversize pieces, …). */
  warnings: string[];
}

/** Internal accumulator while walking line items. */
interface FabricBucket {
  materialName: string;
  rollWidth: number;
  assumedWidth: boolean;
  pieces: FabricPiece[];
}

/**
 * Builds the full cut plan for an order's line items.
 *
 * @param items             The order's line items (blind + preset/custom).
 * @param widthByMaterialId Map from material id → its `width_cm` (null when
 *                          unset); a missing/`null` width falls back to
 *                          {@link DEFAULT_FABRIC_WIDTH_CM}. Widths come from
 *                          the live catalog (line items don't snapshot
 *                          width — it is a manufacturing input, not money).
 */
export function buildManufacturingPlan(
  items: LineItem[],
  widthByMaterialId: Map<string, number | null>
): ManufacturingPlan {
  const warnings: string[] = [];

  // Aluminium cuts grouped by normalised blind type; label kept from the
  // first line item so casing follows the catalog.
  const aluminumByType = new Map<string, { label: string; cuts: AluminumCut[] }>();
  // Fabric pieces grouped per material roll (keyed by material id, or the
  // name when a line item somehow lacks an id).
  const fabricByMaterial = new Map<string, FabricBucket>();
  const asIs: AsIsItem[] = [];

  for (const item of items) {
    if (item.item_type !== 'blind') {
      asIs.push({
        label: item.description || 'Custom item',
        detail: item.item_type === 'preset' ? 'Preset item' : 'Custom item',
        quantity: item.quantity,
      });
      continue;
    }

    const roomLabel = item.room_name?.trim() || 'Blind';
    const typeLabel = item.blinds_type?.trim() || 'Blind';

    if (!isAluminumType(item.blinds_type)) {
      // Every other blind type is ordered from the factory as-is.
      const dims = describeDimensions(item.panels, item.height_cm);
      asIs.push({
        label: `${roomLabel} — ${typeLabel}`,
        detail: [item.material_name, item.color, dims].filter(Boolean).join(' · '),
        quantity: item.quantity,
      });
      continue;
    }

    const height = item.height_cm ?? 0;
    const qty = Math.max(1, item.quantity);
    const panels = (item.panels ?? []).filter((w) => w > 0);
    if (panels.length === 0) {
      warnings.push(`${roomLabel} — ${typeLabel}: no panel widths set; skipped.`);
      continue;
    }
    if (height <= 0) {
      warnings.push(`${roomLabel} — ${typeLabel}: height missing; fabric cut skipped.`);
    }

    // Aluminium bucket for this blind type.
    const typeKey = normalizeBlindType(item.blinds_type);
    const alu: { label: string; cuts: AluminumCut[] } =
      aluminumByType.get(typeKey) ?? { label: typeLabel, cuts: [] };
    aluminumByType.set(typeKey, alu);

    // Fabric bucket for this material roll.
    const matKey = item.material_id || `name:${item.material_name}`;
    const rawWidth = item.material_id ? widthByMaterialId.get(item.material_id) : null;
    const rollWidth = rawWidth != null && rawWidth > 0 ? rawWidth : DEFAULT_FABRIC_WIDTH_CM;
    const bucket: FabricBucket = fabricByMaterial.get(matKey) ?? {
      materialName: item.material_name || 'Unspecified fabric',
      rollWidth,
      assumedWidth: !(rawWidth != null && rawWidth > 0),
      pieces: [],
    };
    fabricByMaterial.set(matKey, bucket);

    for (let unit = 0; unit < qty; unit++) {
      panels.forEach((panelWidth, pIdx) => {
        const suffix = panels.length > 1 ? ` P${pIdx + 1}` : '';
        const label = `${roomLabel} · ${typeLabel}${suffix}`;
        alu.cuts.push({ length: panelWidth, label: `${label} (${panelWidth} cm)` });
        if (height > 0) {
          bucket.pieces.push({ width: panelWidth, height, label });
        }
      });
    }
  }

  const aluminumGroups: AluminumGroup[] = [...aluminumByType.values()].map((g) => {
    const result = planAluminumCuts(g.cuts);
    for (const o of result.oversize) {
      warnings.push(`${o.label}: ${o.length} cm exceeds a ${ALUMINUM_STOCK_CM} cm bar.`);
    }
    return {
      blindType: g.label,
      result,
      cutCount: g.cuts.length - result.oversize.length,
      barCount: result.bars.length,
      usedCm: result.bars.reduce((s, b) => s + b.used, 0),
      wasteCm: result.bars.reduce((s, b) => s + b.leftover, 0),
    };
  });

  const fabricGroups: FabricGroup[] = [...fabricByMaterial.values()]
    .filter((b) => b.pieces.length > 0)
    .map((b) => {
      const result = planFabricCuts(b.pieces, b.rollWidth);
      for (const o of result.oversize) {
        warnings.push(`${o.label}: ${o.width} cm is wider than the ${b.rollWidth} cm roll.`);
      }
      const consumedCm = result.strips.reduce((s, st) => s + st.height, 0);
      const usefulAreaCm2 = b.pieces
        .filter((p) => p.width <= b.rollWidth + EPSILON)
        .reduce((s, p) => s + p.width * p.height, 0);
      const consumedAreaCm2 = b.rollWidth * consumedCm;
      return {
        materialName: b.materialName,
        rollWidth: b.rollWidth,
        assumedWidth: b.assumedWidth,
        result,
        pieceCount: b.pieces.length - result.oversize.length,
        stripCount: result.strips.length,
        consumedCm,
        usefulAreaCm2,
        consumedAreaCm2,
        utilization: consumedAreaCm2 > 0 ? usefulAreaCm2 / consumedAreaCm2 : 0,
      };
    });

  return { aluminumGroups, fabricGroups, asIs, warnings };
}

/**
 * Formats a blind's panels + height into a compact spec string for the
 * as-is list, e.g. "150+100 cm W × 210 cm H". Returns '' when nothing is
 * measured.
 */
function describeDimensions(panels: number[] | null, height: number | null): string {
  const widths = (panels ?? []).filter((w) => w > 0);
  const parts: string[] = [];
  if (widths.length > 0) parts.push(`${widths.join('+')} cm W`);
  if (height && height > 0) parts.push(`${height} cm H`);
  return parts.join(' × ');
}
