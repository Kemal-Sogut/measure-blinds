// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Base blind-type module — the shared "main" calculation logic used
 * today for every blind type, and the extension point each type builds
 * on. Each supported blind type has its own module
 * (`apps/web/src/lib/blindTypes/<type>.ts`) that EXTENDS this class; for
 * now all but Curtains inherit the default formula unchanged. A subclass
 * diverges by overriding `materialCost` (the fabric leg) or the minimum
 * rules (`applyWidthMinimum` / `applyHeightMinimum`) — whichever is the
 * smallest correct change. It must NOT override `calculateUnitPrice`:
 * the hardware sum has to mean the same thing for every type, or a price
 * basis would be interpreted two ways.
 *
 * This client class is the twin of the AUTHORITATIVE server-side
 * `apps/api/src/lib/blindTypes/base.ts`, which recalculates and
 * finalizes pricing on save; this web class only powers live keystroke
 * previews. The two MUST stay in sync; `pricing.test.ts` on both sides
 * encodes the same expected values so any drift fails a suite.
 *
 * Formula (IMPLEMENTATION.md §5), all costs summed then rounded to 2dp:
 *   material = W × H × price_per_sqm / 10000     (cm² → m²)
 *   hardware = the sum of every charge the blind carries, each on the
 *              basis its own catalog row declares:
 *                per_m     = W / 100 × price     (per linear metre of width)
 *                per_sqm   = W × H / 10000 × price
 *                per_panel = panelCount × price
 *                per_unit  = price               (flat, once per blind)
 * with the width minimum (raise <100cm to 100cm) and the tiered height
 * minimum (<100→100, 100–199→200, ≥200→actual) applied first — the
 * hardware legs are charged on those same minimised figures.
 *
 * Until migration 36 the basis was hardcoded per slot (a cassette was
 * always per-metre, a control always per-panel). It is data now, chosen
 * next to the price in Settings, which is why there is one cost function
 * rather than one per slot.
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

/**
 * The four shared hardware catalogs a blind type may or may not use.
 *
 * WHICH of them a given type uses is DATA, not code: an option is linked
 * to a blind type in a `<catalog>_blind_types` join table (migration 35),
 * and a type uses a slot exactly when at least one ACTIVE option is
 * linked to it. This union only names the slots — `slotsForType` in the
 * line-item editor answers the question, mirroring the server's
 * `apps/api/src/lib/optionScoping.ts`.
 */
export type CatalogSlot = 'cassette' | 'bottom_rail' | 'control' | 'installation';

/**
 * How a hardware option's price is charged. Stored per catalog ROW
 * (`<catalog>.price_basis`, migration 36) rather than baked into the
 * formula, because the shop buys some parts by the metre, some by the
 * square metre, some outright and some per panel.
 *
 * Mirrored by the `price_basis` check constraint on all four catalogs.
 * Adding a member here means adding it there, and `hardwareCost`'s switch
 * is exhaustive so the compiler will point at what else needs saying.
 */
export type PriceBasis = 'per_m' | 'per_sqm' | 'per_unit' | 'per_panel';

/**
 * One hardware charge: a server-fetched rate and the basis it is charged
 * on. Never assembled by a client — `resolveLineItems` reads both columns
 * from the catalog row itself.
 */
export interface HardwareCharge {
  price: number;
  basis: PriceBasis;
}

/**
 * A declaration that one attribute key holds the id of a row in a priced
 * catalog table, plus where that row's name and numeric value get
 * snapshotted to.
 *
 * This is how a blind type takes a PRICE INPUT without ever accepting one
 * from the client: the client sends `attrKey` (an id), the Worker looks
 * the row up itself, and writes `nameKey`/`valueKey` into the stored blob
 * afterwards. `attributeSchema` deliberately does NOT declare the two
 * snapshot keys, so a client that sends them gets a 400.
 */
export interface CatalogRef {
  /** Attribute key holding the row id (declared in `attributeSchema`). */
  readonly attrKey: string;
  /** Postgres table the id points at. */
  readonly table: string;
  /** Numeric column to snapshot (e.g. 'multiplier', 'price_per_item'). */
  readonly valueColumn: string;
  /** Attribute key the row's name is written to. Never client-supplied. */
  readonly nameKey: string;
  /** Attribute key the numeric value is written to. Never client-supplied. */
  readonly valueKey: string;
  /** Lowercase noun for the "no longer exists" error (e.g. 'pleat type'). */
  readonly noun: string;
}

/** One resolved catalog row: the two fields a `CatalogRef` snapshots. */
export interface CatalogSnapshot {
  name: string;
  value: number;
}

/**
 * Looks up one catalog row. The Worker backs this with rows it fetched
 * from Postgres; the web preview backs it with the lists TanStack Query
 * already holds, so both sides resolve the same ids the same way.
 */
export type CatalogResolver = (table: string, id: string) => CatalogSnapshot | undefined;

/** Inputs required to price a single blind line item. */
export interface BlindPricingInputs {
  /** Individual panel widths in cm (summed for the effective width). */
  panels: number[];
  /** Height measurement in cm. */
  height_cm: number;
  /** Material cost per m² (server-fetched snapshot). */
  material_price_per_sqm: number;
  /**
   * The hardware charges this blind actually carries, keyed by slot.
   *
   * A slot is PRESENT only when the blind type has an option of that
   * catalog scoped to it and one was chosen (see `optionScoping.ts` on the
   * server, `slotsForType` in the editor). An absent slot contributes
   * nothing — there is no "0 charge" to pass, because there is no charge.
   *
   * Each entry carries its own basis, so nothing here assumes a cassette
   * is per-metre or a control is per-panel; migration 36 moved that
   * decision onto the catalog row.
   */
  hardware: Partial<Record<CatalogSlot, HardwareCharge>>;
  /**
   * The blind type's own extra inputs, already validated by that type's
   * `attributeSchema`. `{}` for every type that has not diverged. Read it
   * only from a subclass that declared the key — the base formula ignores
   * it entirely, which is why every historical row prices unchanged.
   *
   * REQUIRED, not optional: an optional member would let a caller
   * silently drop a type's inputs and get the base price back with no
   * error at all.
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
   * Catalog rows this type's attributes point at. Empty for every type
   * that prices purely from the shared hardware options, which is why
   * adding this changed no existing type's behaviour.
   */
  readonly catalogRefs: readonly CatalogRef[] = [];

  /**
   * Attribute keys this type accepts FROM A CLIENT — the keys declared in
   * `attributeSchema`, which by construction excludes every key the
   * Worker writes itself.
   *
   * The web editor uses this to strip a re-opened order's snapshot keys
   * out of a draft before re-parsing it. Without that strip the strict
   * schema would reject the round-tripped blob and the item would lose
   * its options on the second save.
   */
  inputKeys(): string[] {
    const shape = (this.attributeSchema as unknown as { shape?: Record<string, unknown> }).shape;
    return shape ? Object.keys(shape) : [];
  }

  /**
   * Returns a copy of `attrs` with every declared `CatalogRef` resolved —
   * the row's name and numeric value written to the ref's snapshot keys.
   * A ref whose id is absent is skipped, so the caller's fallback applies;
   * an id that no longer resolves throws, matching how a deleted material
   * or control option already behaves.
   *
   * Callers MUST run this AFTER parsing through `attributeSchema`, never
   * before: the parse is what proves the client sent no price, and this
   * overwrite is what puts the real one in.
   */
  resolveCatalogRefs(attrs: BlindAttributes, resolve: CatalogResolver): BlindAttributes {
    const out: BlindAttributes = { ...attrs };
    for (const ref of this.catalogRefs) {
      const id = attrs[ref.attrKey];
      if (typeof id !== 'string' || id === '') continue;
      const hit = resolve(ref.table, id);
      if (!hit) throw new Error(`The selected ${ref.noun} no longer exists.`);
      out[ref.nameKey] = hit.name;
      out[ref.valueKey] = hit.value;
    }
    return out;
  }

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

  /**
   * Material cost for the (already-minimised) width and height.
   *
   * Takes the WHOLE input rather than a rate, because this is the one leg
   * a blind type is expected to diverge on and a type that prices fabric
   * differently generally needs its panel count or its own attributes to
   * do it — Curtains multiplies by a pleat fullness and adds a per-panel
   * hem allowance. Overriding this is now the ONLY thing a type has to do
   * to change its formula; `calculateUnitPrice` is no longer a valid
   * override point, because the hardware sum below must stay identical
   * across every type or a basis would mean two different things.
   */
  protected materialCost(item: BlindPricingInputs, widthCm: number, heightCm: number): number {
    return (widthCm * heightCm * item.material_price_per_sqm) / 10000;
  }

  /**
   * Cost of ONE hardware charge, on its own basis. The single place any
   * basis is interpreted — cassette, bottom rail, control and installation
   * all come through here, so "per m²" cannot mean one thing for a rail
   * and another for a control.
   *
   * `ctx` carries the MINIMISED width and height, the same figures the
   * material leg is charged on: two lines of one quote must not be priced
   * off different dimensions.
   */
  protected hardwareCost(
    charge: HardwareCharge,
    ctx: { widthCm: number; heightCm: number; panelCount: number }
  ): number {
    switch (charge.basis) {
      case 'per_m':
        return (ctx.widthCm / 100) * charge.price;
      case 'per_sqm':
        return (ctx.widthCm * ctx.heightCm * charge.price) / 10000;
      case 'per_panel':
        return ctx.panelCount * charge.price;
      case 'per_unit':
        return charge.price;
    }
  }

  /**
   * Unit price of one blind: the material leg plus every hardware charge
   * it carries, each on its own basis, with the width/height minimums
   * applied first and the sum rounded to 2 decimals.
   *
   * Deliberately NOT an override point any more. A type that needs a
   * different formula overrides `materialCost`; one that reaches in here
   * would be free to reinterpret a basis, which is exactly the drift this
   * shape exists to prevent.
   */
  calculateUnitPrice(item: BlindPricingInputs): number {
    const widthCm = this.applyWidthMinimum(item.panels.reduce((a, b) => a + b, 0));
    const heightCm = this.applyHeightMinimum(item.height_cm);
    const ctx = { widthCm, heightCm, panelCount: item.panels.length };
    const hardware = Object.values(item.hardware).reduce(
      (sum, charge) => sum + (charge ? this.hardwareCost(charge, ctx) : 0),
      0
    );
    return Math.round((this.materialCost(item, widthCm, heightCm) + hardware) * 100) / 100;
  }
}
