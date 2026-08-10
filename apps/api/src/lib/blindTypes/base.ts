// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Base blind-type module — the shared "main" calculation logic used
 * today for every blind type, and the extension point each type builds
 * on. Each supported blind type has its own module
 * (`apps/api/src/lib/blindTypes/<type>.ts`) that EXTENDS this class; for
 * now they all inherit the default formula unchanged. A subclass
 * diverges by overriding one of the granular cost
 * hooks (`materialCost` / `cassetteCost` / `bottomRailCost` /
 * `controlCost`), the minimum rules (`applyWidthMinimum` /
 * `applyHeightMinimum`), or the whole `calculateUnitPrice` — whichever is
 * the smallest correct change.
 *
 * AUTHORITATIVE: this server class is the twin of the web-side
 * `apps/web/src/lib/blindTypes/base.ts` used for live keystroke
 * previews. The two MUST stay in sync; `pricing.test.ts` on both sides
 * encodes the same expected values so any drift fails a suite.
 *
 * Formula (IMPLEMENTATION.md §5), all costs summed then rounded to 2dp:
 *   material   = W × H × price_per_sqm / 10000   (cm² → m²)
 *   cassette   = W / 100 × price_per_m           (per linear metre of width)
 *   bottomRail = W / 100 × price_per_m           (per linear metre of width)
 *   control    = panelCount × price_per_item     (per panel)
 * with the width minimum (raise <100cm to 100cm) and the tiered height
 * minimum (<100→100, 100–199→200, ≥200→actual) applied first.
 */

import { z } from 'zod';

/**
 * A blind type's extra inputs, as stored in `line_items.attributes`.
 *
 * Deliberately flat and primitive-valued: the blob is rendered on the
 * PDF, the manufacturer copy and the customer page, all of which format
 * one label/value pair per entry. Nesting would have no way to render.
 */
export type BlindAttributes = Record<string, string | number | boolean>;

/** Inputs required to price a single blind line item. */
export interface BlindPricingInputs {
  /** Individual panel widths in cm (summed for the effective width). */
  panels: number[];
  /** Height measurement in cm. */
  height_cm: number;
  /** Material cost per m² (server-fetched snapshot). */
  material_price_per_sqm: number;
  /** Cassette cost per linear metre of width (server-fetched snapshot). */
  cassette_price_per_m: number;
  /**
   * Bottom-rail cost per linear metre of width (server-fetched snapshot).
   * REQUIRED, not optional: every blind row carries a rail (migration 28
   * backfilled the historical ones to Regular at 0), so an absent value
   * would mean a caller forgot to pass it rather than "no rail fitted" —
   * and a silent 0 there would under-price the blind.
   */
  bottom_rail_price_per_m: number;
  /** Control cost per panel (server-fetched snapshot). */
  control_price_per_item: number;
  /**
   * The blind type's own extra inputs, already validated by that type's
   * `attributeSchema`. `{}` for every type that has not diverged. Read it
   * only from a subclass that declared the key — the base formula ignores
   * it entirely, which is why every historical row prices unchanged.
   *
   * REQUIRED, not optional, for the same reason `bottom_rail_price_per_m`
   * is: an optional member would let a caller silently drop a type's
   * inputs and get the base price back with no error at all.
   */
  attributes: BlindAttributes;
}

/**
 * The default blind-type module. Instantiable on its own (used as the
 * fallback when a blind type has no dedicated module) and the superclass
 * for every per-type module.
 */
export class BaseBlindType {
  /** Human-readable label of the blind type this module prices. */
  readonly blindType: string = 'Default';

  /**
   * Extra normalised name aliases that should resolve to this
   * module, on top of the normalised `blindType` label itself
   * (e.g. Sunscreen/Solar also answers to "solar"). Lowercase,
   * alphanumerics only — see `normalizeBlindType` in the registry.
   */
  readonly aliases: readonly string[] = [];

  /**
   * Builds a `.strict()` attribute schema from a field map. Subclasses
   * use this rather than calling `z.object` directly so the strictness —
   * the server's only gate against an undeclared key reaching the jsonb
   * column — cannot be forgotten.
   *
   * Declare numeric fields with `z.coerce.number()`: the value arriving
   * from a draft is a string, because the editor holds every numeric
   * field as raw text so a half-typed "12." does not fight the keyboard.
   */
  static attrs<T extends z.ZodRawShape>(shape: T) {
    return z.object(shape).strict();
  }

  /**
   * Validation contract for this type's extra inputs. The Worker parses
   * the client's `attributes` blob through this before any write, so an
   * undeclared key (notably a price) is a 400, not a silent store.
   *
   * The base accepts ONLY `{}` — a type that has not declared fields
   * cannot receive any. Every field a subclass declares must be optional
   * or defaulted, because migration 29 left every historical row at `{}`.
   *
   * Typed `ZodTypeAny`, NOT `z.ZodType<BlindAttributes>`: a subclass
   * assigning a narrower `ZodObject` to the latter fails to typecheck,
   * because Zod's schema types are not covariant in their output. Callers
   * cast the parse result to `BlindAttributes`.
   */
  readonly attributeSchema: z.ZodTypeAny = BaseBlindType.attrs({});

  /**
   * Seed values for a freshly added blind of this type. Must satisfy
   * `attributeSchema` — `attributes.test.ts` asserts the round-trip.
   */
  defaultAttributes(): BlindAttributes {
    return {};
  }

  /**
   * Renders this type's attributes as ordered label/value pairs for the
   * documents — the estimate/invoice PDF, the manufacturer copy, the
   * customer page, and the order item rows. Deliberately React-free:
   * `apps/api/src/lib/pdf.ts` runs on the Worker and cannot import JSX.
   *
   * Return `[]` for a value the customer should not see; the caller
   * renders exactly what it is given, in order.
   */
  describeAttributes(_attrs: BlindAttributes): { label: string; value: string }[] {
    return [];
  }

  /** Raises widths below 100cm to 100cm. */
  applyWidthMinimum(totalCm: number): number {
    return totalCm < 100 ? 100 : totalCm;
  }

  /** Tiered height minimum: <100→100, 100–199→200, ≥200→actual. */
  applyHeightMinimum(heightCm: number): number {
    if (heightCm < 100) return 100;
    if (heightCm < 200) return 200;
    return heightCm;
  }

  /** Material cost for the (already-minimised) width and height. */
  protected materialCost(widthCm: number, heightCm: number, pricePerSqm: number): number {
    return (widthCm * heightCm * pricePerSqm) / 10000;
  }

  /** Cassette cost, charged per linear metre of the effective width. */
  protected cassetteCost(widthCm: number, pricePerM: number): number {
    return (widthCm / 100) * pricePerM;
  }

  /**
   * Bottom-rail cost, charged per linear metre of the effective width —
   * the same basis as the cassette, because both are cut to the blind's
   * width. Kept as its own hook rather than folded into `cassetteCost` so
   * a blind type can diverge on one without touching the other.
   */
  protected bottomRailCost(widthCm: number, pricePerM: number): number {
    return (widthCm / 100) * pricePerM;
  }

  /** Control cost, charged per panel. */
  protected controlCost(panelCount: number, pricePerItem: number): number {
    return panelCount * pricePerItem;
  }

  /**
   * Unit price of one blind: material + cassette + bottom rail + control
   * with the width/height minimums applied first, rounded to 2 decimals.
   */
  calculateUnitPrice(item: BlindPricingInputs): number {
    const width = this.applyWidthMinimum(item.panels.reduce((a, b) => a + b, 0));
    const height = this.applyHeightMinimum(item.height_cm);
    const total =
      this.materialCost(width, height, item.material_price_per_sqm) +
      this.cassetteCost(width, item.cassette_price_per_m) +
      this.bottomRailCost(width, item.bottom_rail_price_per_m) +
      this.controlCost(item.panels.length, item.control_price_per_item);
    return Math.round(total * 100) / 100;
  }
}
