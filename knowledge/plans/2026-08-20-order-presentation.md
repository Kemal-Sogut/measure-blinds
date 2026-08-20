# Order Presentation View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A customer-facing `/orders/:id/present` page, reachable from a new button below Confirm while an order is unconfirmed, showing one column per option type with that option's money contribution, stackable filters built from the order's own values, and column totals that track the filter.

**Architecture:** Two pure modules carry every decision worth testing — `lib/optionBreakdown.ts` (a saved `LineItem` → per-column money) and `pages/orders/presentationFilters.ts` (facets + match predicate). Three thin components render them. The per-option money is not re-derived: `BaseBlindType` gains a public `describeUnitCosts()` and `calculateUnitPrice()` is redefined to sum it, so the breakdown and the price are one calculation.

**Tech Stack:** React 19, TypeScript ~6.0, Vite 8, Tailwind 4, React Router 6, TanStack Query 5, Vitest 3, oxlint.

**Spec:** [`knowledge/specs/2026-08-20-order-presentation-design.md`](../specs/2026-08-20-order-presentation-design.md). Section references below (§5.1, §6.2, …) point into it.

## Global Constraints

- **SPDX header** — every new `.ts`/`.tsx` file begins with exactly these two lines, before anything else (AI_GUIDELINES §10):
  ```ts
  // SPDX-License-Identifier: GPL-3.0-only
  // Copyright (c) 2026 Blinds Nisa. All rights reserved.
  ```
- **JSDoc** — every exported module, component, hook, function and type gets a `/** … */` comment scored ≥8/10: purpose, behaviour, constraints, integration context. Never a restatement of the name. English only (§3).
- **Twin files** — `apps/web/src/lib/blindTypes/base.ts` and `apps/api/src/lib/blindTypes/base.ts` are twins. Any edit to one is made to the other in the SAME commit, with both `pricing.test.ts` suites updated (§1). Their code is currently byte-identical; only the file-header prose differs. Do not "fix" that prose difference.
- **No client-derived money** — the page never computes subtotal, discount, HST or the order total. Those are read verbatim from the server `Order` row (§1, §7.3).
- **Money rounding** — always `Math.round(n * 100) / 100`. Never `toFixed` for arithmetic (only for display).
- **File size** — no file over 800 lines; functions ideally under 100 (§6).
- **Scope** — touch only the files this plan names. No drive-by refactors, and specifically do NOT modify `OrderOverview.tsx` (§7).
- **No component tests** — this repo has no jsdom or Testing Library. Every test in this plan is a pure-logic `.test.ts`. Do not add a testing library.
- **Currency display** — `$1234.50` via a local `money()` helper, matching `OrderOverview.tsx`.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `apps/web/src/lib/blindTypes/base.ts` | `UnitCostBreakdown`, `describeUnitCosts()`; `calculateUnitPrice()` sums it | 1 |
| `apps/api/src/lib/blindTypes/base.ts` | identical twin edit | 1 |
| `apps/web/src/lib/pricing.test.ts` | breakdown assertions | 1 |
| `apps/api/src/lib/pricing.test.ts` | mirrored assertions | 1 |
| `apps/web/src/lib/optionBreakdown.ts` | saved `LineItem` → per-column cells + adjustment | 2 |
| `apps/web/src/lib/optionBreakdown.test.ts` | its tests | 2 |
| `apps/web/src/pages/orders/presentationFilters.ts` | facets, match predicate, filter-list ops | 3 |
| `apps/web/src/pages/orders/presentationFilters.test.ts` | its tests | 3 |
| `apps/web/src/pages/orders/PresentationTable.tsx` | option table + `<tfoot>` totals | 4 |
| `apps/web/src/pages/orders/PresentationFilterBar.tsx` | filter row UI | 5 |
| `apps/web/src/pages/orders/OrderPresentation.tsx` | page shell; assembles 4 + 5 | 6 |
| `apps/web/src/App.tsx` | lazy import + route | 6 |
| `apps/web/src/pages/orders/OrderDetail.tsx` | `ICONS.present`, `handlePresent`, stage action | 7 |
| `knowledge/history/engine_features.md`, `memory-bank/*` | required documentation | 8 |

---

### Task 0: Bootstrap the worktree

This worktree has no `node_modules` — git worktrees do not share them with the main checkout. Nothing else will run until this is done.

- [ ] **Step 1: Install dependencies**

Run from the repo root:

```bash
pnpm install
```

Expected: pnpm links `apps/web` and `apps/api`. Takes a minute or two on a cold store.

- [ ] **Step 2: Confirm a green baseline before changing anything**

```bash
pnpm --filter web test
```

Expected: PASS, 305 tests across 20 files.

```bash
pnpm --filter api test
```

Expected: PASS, 340 tests across 18 files.

If either is red before you have touched a file, **stop and report it** — the whole plan leans on these suites being the guard for the pricing refactor.

- [ ] **Step 3: No commit**

Nothing changed. `node_modules` is gitignored.

---

### Task 1: `describeUnitCosts()` on both pricing twins

**Files:**
- Modify: `apps/web/src/lib/blindTypes/base.ts`
- Modify: `apps/api/src/lib/blindTypes/base.ts` (identical change)
- Test: `apps/web/src/lib/pricing.test.ts`
- Test: `apps/api/src/lib/pricing.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `export interface UnitCostBreakdown { material: number; cassette?: number; bottom_rail?: number; control?: number; installation?: number }` — exported from `blindTypes/base.ts`.
  - `BaseBlindType.describeUnitCosts(item: BlindPricingInputs): UnitCostBreakdown` — public method. Values are **unrounded** per-blind costs. A hardware key is present exactly when that slot carries a charge; `material` is always present.
  - `calculateUnitPrice(item: BlindPricingInputs): number` — unchanged signature, unchanged results.

**Why this shape:** see §5.1. The alternative — computing the breakdown alongside the price — would put a second copy of "what `per_m` means" on each twin, which is the drift `curtains.ts` was rewritten to remove.

- [ ] **Step 1: Write the failing tests (web)**

Append to `apps/web/src/lib/pricing.test.ts`. Note `toBeCloseTo`, not `toBe`: `(140/100) * 12` is `16.799999999999997` in IEEE-754, and asserting `16.8` exactly would fail for reasons that have nothing to do with this feature.

```ts
describe('describeUnitCosts', () => {
  /** A blind carrying a charge on all four slots, one per basis family. */
  const loaded: BlindInputs = blind({
    panels: [140],
    height_cm: 200,
    material_price_per_sqm: 50,
    hardware: {
      cassette: { price: 12, basis: 'per_m' as PriceBasis },
      bottom_rail: { price: 8, basis: 'per_m' as PriceBasis },
      control: { price: 25, basis: 'per_panel' as PriceBasis },
      installation: { price: 30, basis: 'per_unit' as PriceBasis },
    },
  });

  it('reports the material leg plus one leg per charge carried', () => {
    const legs = getBlindType('Roller').describeUnitCosts(loaded);
    expect(legs.material).toBeCloseTo(140, 10); // 140 * 200 * 50 / 10000
    expect(legs.cassette).toBeCloseTo(16.8, 10); // 1.4m * 12
    expect(legs.bottom_rail).toBeCloseTo(11.2, 10); // 1.4m * 8
    expect(legs.control).toBeCloseTo(25, 10); // 1 panel * 25
    expect(legs.installation).toBeCloseTo(30, 10); // flat
  });

  it('omits a slot the blind does not carry rather than reporting it as 0', () => {
    const legs = getBlindType('Roller').describeUnitCosts(blind());
    expect(Object.keys(legs)).toEqual(['material']);
    expect(legs.control).toBeUndefined();
  });

  it('inserts hardware legs in the order both callers build the map', () => {
    // Not cosmetic: calculateUnitPrice reduces over these values, and
    // float addition is not associative. See spec 5.1.1.
    expect(Object.keys(getBlindType('Roller').describeUnitCosts(loaded))).toEqual([
      'material',
      'cassette',
      'bottom_rail',
      'control',
      'installation',
    ]);
  });

  it('applies the width and height minimums, like the price does', () => {
    const small = blind({
      panels: [60],
      height_cm: 150,
      material_price_per_sqm: 50,
      hardware: { cassette: { price: 12, basis: 'per_m' as PriceBasis } },
    });
    const legs = getBlindType('Roller').describeUnitCosts(small);
    expect(legs.material).toBeCloseTo(100, 10); // 100cm x 200cm minimums
    expect(legs.cassette).toBeCloseTo(12, 10); // charged on the minimised 100cm
  });

  it('sums to calculateUnitPrice for every registered blind type', () => {
    for (const type of [
      'Roller',
      'Zebra',
      'Sunscreen',
      'Roman',
      'Honeycomb',
      'Shutter',
      'Vertical Panel',
      'Vertical Roller',
      'Vertical Sheer',
      'Curtains',
    ]) {
      const module = getBlindType(type);
      const { material, ...hw } = module.describeUnitCosts(loaded);
      const summed =
        Math.round((material + Object.values(hw).reduce((s, c) => s + (c ?? 0), 0)) * 100) / 100;
      expect(summed).toBe(module.calculateUnitPrice(loaded));
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter web exec vitest run src/lib/pricing.test.ts
```

Expected: FAIL — `describeUnitCosts is not a function`.

- [ ] **Step 3: Implement it in `apps/web/src/lib/blindTypes/base.ts`**

Add above the `BaseBlindType` class, after the `HardwareCharge` interface:

```ts
/**
 * The per-leg unit costs behind {@link BaseBlindType.calculateUnitPrice} —
 * the material leg, plus one entry for each hardware charge the blind
 * actually carries.
 *
 * Values are UNROUNDED per-blind costs, because the price rounds the SUM
 * once rather than each leg; a consumer that needs displayable cents must
 * round them itself and reconcile against the stored price (see
 * `apps/web/src/lib/optionBreakdown.ts`, which fits them to it).
 *
 * A hardware key is ABSENT, not zero, when the blind carries no charge on
 * that slot — the same distinction `BlindPricingInputs.hardware` makes,
 * so "no cassette" and "a free cassette" never collapse into one another.
 */
export interface UnitCostBreakdown {
  material: number;
  cassette?: number;
  bottom_rail?: number;
  control?: number;
  installation?: number;
}

/**
 * The order {@link BaseBlindType.describeUnitCosts} inserts hardware legs
 * in — deliberately the same insertion order both callers already use
 * (`resolveLineItems` on the Worker, `previewUnitPrice` in the editor).
 *
 * Not cosmetic. `calculateUnitPrice` reduces over these values and
 * floating-point addition is not associative, so a different order could
 * shift the last ULP and, at a half-cent boundary, the rounded cent. This
 * constant is what makes the refactor bit-identical to the arithmetic it
 * replaced rather than merely equivalent.
 */
const HARDWARE_LEG_ORDER: readonly CatalogSlot[] = [
  'cassette',
  'bottom_rail',
  'control',
  'installation',
];
```

Then, inside the class, add `describeUnitCosts` immediately above `calculateUnitPrice` and REPLACE the body of `calculateUnitPrice`:

```ts
  /**
   * The unit price broken into its legs — what {@link calculateUnitPrice}
   * sums, exposed so a surface can show a customer what each choice cost.
   *
   * This is the ONLY public route to a per-option figure. Reassembling one
   * outside the class would mean a second interpretation of a price basis,
   * which is exactly the duplication `hardwareCost` exists to prevent, so
   * the price is derived FROM this rather than computed beside it.
   *
   * Every leg is charged on the minimised width and height, identical to
   * the price — two lines of one quote must not be priced off different
   * dimensions.
   */
  describeUnitCosts(item: BlindPricingInputs): UnitCostBreakdown {
    const widthCm = this.applyWidthMinimum(item.panels.reduce((a, b) => a + b, 0));
    const heightCm = this.applyHeightMinimum(item.height_cm);
    const ctx = { widthCm, heightCm, panelCount: item.panels.length };
    const legs: UnitCostBreakdown = {
      material: this.materialCost(item, widthCm, heightCm),
    };
    for (const slot of HARDWARE_LEG_ORDER) {
      const charge = item.hardware[slot];
      if (charge) legs[slot] = this.hardwareCost(charge, ctx);
    }
    return legs;
  }

  /**
   * Unit price of one blind: the material leg plus every hardware charge
   * it carries, each on its own basis, with the width/height minimums
   * applied first and the sum rounded to 2 decimals.
   *
   * Deliberately NOT an override point. A type that needs a different
   * formula overrides `materialCost`; one that reaches in here would be
   * free to reinterpret a basis, which is exactly the drift this shape
   * exists to prevent.
   *
   * The material leg stays OUT of the reduction on purpose: this
   * reproduces the historical association `material + ((h1 + h2) + h3)`
   * exactly, so no existing price can move by a cent. See
   * {@link HARDWARE_LEG_ORDER}.
   */
  calculateUnitPrice(item: BlindPricingInputs): number {
    const { material, ...hardwareLegs } = this.describeUnitCosts(item);
    const hardware = Object.values(hardwareLegs).reduce<number>(
      (sum, cost) => sum + (cost ?? 0),
      0
    );
    return Math.round((material + hardware) * 100) / 100;
  }
```

- [ ] **Step 4: Run the web suites**

```bash
pnpm --filter web exec vitest run src/lib/pricing.test.ts
```

Expected: PASS.

```bash
pnpm --filter web test
```

Expected: PASS, now 310 tests. **Every pre-existing expected value must pass unmodified.** If any previously-passing money assertion now fails, the refactor is wrong — do not edit the test to match. Re-read §5.1.1 and fix the implementation.

- [ ] **Step 5: Mirror the change to the API twin**

Apply the *identical* code to `apps/api/src/lib/blindTypes/base.ts` — same `UnitCostBreakdown`, same `HARDWARE_LEG_ORDER`, same two methods, same JSDoc, except the one cross-reference which becomes `apps/web/src/lib/optionBreakdown.ts` on both sides (the module lives in web only). Then verify the two files still differ ONLY in their file-header prose:

```bash
diff apps/web/src/lib/blindTypes/base.ts apps/api/src/lib/blindTypes/base.ts
```

Expected: hunks at lines ~8 and ~16 and ~57 only (the pre-existing header wording). Any hunk inside the class body is a mistake.

- [ ] **Step 6: Mirror the tests to the API suite**

Copy the whole `describe('describeUnitCosts', …)` block into `apps/api/src/lib/pricing.test.ts`. Check that file's local helper and import names first — it has its own `blind()` builder and may import `getBlindType` from a different relative path. Adapt the imports, not the assertions.

- [ ] **Step 7: Run the API suites**

```bash
pnpm --filter api exec vitest run src/lib/pricing.test.ts
```

Expected: PASS.

```bash
pnpm --filter api test
```

Expected: PASS, now 345 tests, every pre-existing value unmodified.

- [ ] **Step 8: Typecheck both**

```bash
pnpm check
```

Expected: 0 errors in both workspaces.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/blindTypes/base.ts apps/api/src/lib/blindTypes/base.ts apps/web/src/lib/pricing.test.ts apps/api/src/lib/pricing.test.ts
git commit -m "feat(pricing): expose describeUnitCosts and derive the unit price from it

The per-leg costs behind calculateUnitPrice had no public route out, so a
customer-facing surface could not say what each option cost without a
second copy of the basis maths. The price is now the sum of the breakdown
rather than a parallel calculation.

Material stays out of the reduction and hardware legs are inserted in the
order both callers build them, so the float association is unchanged and
every existing price is bit-identical. Both twins, both suites."
```

---

### Task 2: `lib/optionBreakdown.ts` — a saved line item's per-column money

**Files:**
- Create: `apps/web/src/lib/optionBreakdown.ts`
- Test: `apps/web/src/lib/optionBreakdown.test.ts`

**Interfaces:**
- Consumes: `describeUnitCosts()` and `UnitCostBreakdown` from Task 1; `addonsTotal` from `lib/lineItemAdjustments`; `getBlindType` from `lib/blindTypes`; `LineItem`, `CatalogSlot`, `HardwareCharge`, `PriceBasis` types.
- Produces:
  - `export type OptionColumn = 'material' | 'color' | CatalogSlot`
  - `export const OPTION_COLUMNS: readonly OptionColumn[]` — `['material','color','cassette','bottom_rail','control','installation']`
  - `export const OPTION_COLUMN_LABELS: Record<OptionColumn, string>`
  - `export interface OptionCell { name: string | null; amount: number | null }`
  - `export interface LineBreakdown { cells: Record<OptionColumn, OptionCell>; adjustment: number; lineTotal: number }`
  - `export function describeLineBreakdown(item: LineItem): LineBreakdown`

**Key rule (§5.3):** cells are **fitted** to the stored price, not summed independently of it. `line_total` is built as `round2(unit_price × qty) + addonsTotal(addons)`, so rounding each leg separately can miss it by two or three cents — Task 2's tests contain a verified real case. Material carries the correction.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/optionBreakdown.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Unit tests for `optionBreakdown.ts`.
 *
 * These protect the invariant the Order Presentation page is built on:
 * every row's option cells plus its adjustment equal the stored
 * `line_total` EXACTLY, so nothing shown to a customer fails to add up.
 * The fixtures carry real snapshot values, including a case where naive
 * per-leg rounding misses the stored total by two cents.
 */

import { describe, it, expect } from 'vitest';
import { describeLineBreakdown } from './optionBreakdown';
import type { LineItem } from '../types';

/** A saved blind line item; individual tests override single fields. */
function lineItem(overrides: Partial<LineItem> = {}): LineItem {
  return {
    id: 'li-1',
    order_id: 'o-1',
    item_type: 'blind',
    position: 0,
    uid: 'u-1',
    hidden: false,
    room_name: 'Living Room',
    blinds_type: 'Roller',
    panels: [140],
    height_cm: 200,
    material_id: 'm-1',
    material_name: 'Blackout White',
    material_price_per_sqm: 50,
    cassette_id: null,
    cassette_name: null,
    cassette_price_per_m: null,
    cassette_price_basis: null,
    bottom_rail_id: null,
    bottom_rail_name: null,
    bottom_rail_price_per_m: null,
    bottom_rail_price_basis: null,
    control_id: null,
    control_name: null,
    control_price_per_item: null,
    control_price_basis: null,
    installation_id: null,
    installation_name: null,
    installation_price_per_item: null,
    installation_price_basis: null,
    description: '',
    note: '',
    color: 'White',
    attributes: {},
    quantity: 1,
    unit_price: 140,
    line_total: 140,
    title: '',
    preset_id: null,
    base_unit_price: null,
    addons: [],
    ...overrides,
  } as LineItem;
}

describe('describeLineBreakdown', () => {
  it('reports the material name and its cost when the blind has no hardware', () => {
    const { cells, adjustment } = describeLineBreakdown(lineItem());
    expect(cells.material).toEqual({ name: 'Blackout White', amount: 140 });
    expect(adjustment).toBe(0);
  });

  it('reports colour as a name with no money', () => {
    const { cells } = describeLineBreakdown(lineItem());
    expect(cells.color).toEqual({ name: 'White', amount: null });
  });

  it('leaves a slot the blind does not carry as an empty cell', () => {
    const { cells } = describeLineBreakdown(lineItem());
    expect(cells.control).toEqual({ name: null, amount: null });
  });

  it('charges each basis the way the price did', () => {
    const { cells } = describeLineBreakdown(
      lineItem({
        cassette_id: 'c-1',
        cassette_name: 'Slimline',
        cassette_price_per_m: 12,
        cassette_price_basis: 'per_m',
        control_id: 'ct-1',
        control_name: 'Cordless',
        control_price_per_item: 25,
        control_price_basis: 'per_panel',
        installation_id: 'i-1',
        installation_name: 'Top fix',
        installation_price_per_item: 30,
        installation_price_basis: 'per_unit',
        unit_price: 211.8, // 140 + 16.8 + 25 + 30
        line_total: 211.8,
      })
    );
    expect(cells.cassette).toEqual({ name: 'Slimline', amount: 16.8 });
    expect(cells.control).toEqual({ name: 'Cordless', amount: 25 });
    expect(cells.installation).toEqual({ name: 'Top fix', amount: 30 });
  });

  it('multiplies every cell by the quantity', () => {
    const { cells } = describeLineBreakdown(
      lineItem({
        control_id: 'ct-1',
        control_name: 'Cordless',
        control_price_per_item: 25,
        control_price_basis: 'per_unit',
        quantity: 3,
        unit_price: 165,
        line_total: 495,
      })
    );
    expect(cells.control).toEqual({ name: 'Cordless', amount: 75 });
    expect(cells.material).toEqual({ name: 'Blackout White', amount: 420 });
  });

  it('reports an option that costs nothing as 0, not as absent', () => {
    // A "Regular" control priced at $0 is still a choice the customer made.
    const { cells } = describeLineBreakdown(
      lineItem({
        control_id: 'ct-0',
        control_name: 'Regular',
        control_price_per_item: 0,
        control_price_basis: 'per_unit',
      })
    );
    expect(cells.control).toEqual({ name: 'Regular', amount: 0 });
  });

  it('fits the material cell so the row sums to the stored line total', () => {
    // Verified case: naive per-leg rounding gives material 393.40 and a
    // row that misses line_total by 2 cents. Material absorbs it.
    const item = lineItem({
      panels: [101],
      height_cm: 205,
      material_price_per_sqm: 47.5,
      cassette_id: 'c-1',
      cassette_name: 'Slimline',
      cassette_price_per_m: 5.66,
      cassette_price_basis: 'per_m',
      bottom_rail_id: 'br-1',
      bottom_rail_name: 'Fabric wrapped',
      bottom_rail_price_per_m: 6.66,
      bottom_rail_price_basis: 'per_m',
      control_id: 'ct-1',
      control_name: 'Cordless',
      control_price_per_item: 19.99,
      control_price_basis: 'per_panel',
      installation_id: 'i-1',
      installation_name: 'Top fix',
      installation_price_per_item: 33.33,
      installation_price_basis: 'per_unit',
      quantity: 4,
      unit_price: 164.11,
      line_total: 656.44,
    });
    const { cells, adjustment } = describeLineBreakdown(item);
    expect(cells.cassette?.amount).toBe(22.87);
    expect(cells.bottom_rail?.amount).toBe(26.91);
    expect(cells.control?.amount).toBe(79.96);
    expect(cells.installation?.amount).toBe(133.32);
    expect(cells.material?.amount).toBe(393.38); // not 393.40
    expect(adjustment).toBe(0);
  });

  it('reports add-ons as the adjustment', () => {
    const { adjustment } = describeLineBreakdown(
      lineItem({ addons: [{ label: 'Rush fee', price: 40 }], line_total: 180 })
    );
    expect(adjustment).toBe(40);
  });

  it('reports a price override as the adjustment, per blind', () => {
    // Calculated 140, charged 120, qty 2 -> line_total 240, adjustment -40.
    const { cells, adjustment } = describeLineBreakdown(
      lineItem({ quantity: 2, base_unit_price: 140, unit_price: 120, line_total: 240 })
    );
    expect(cells.material).toEqual({ name: 'Blackout White', amount: 280 });
    expect(adjustment).toBe(-40);
  });

  it('reports an override and add-ons together', () => {
    const { adjustment } = describeLineBreakdown(
      lineItem({
        quantity: 2,
        base_unit_price: 140,
        unit_price: 120,
        addons: [{ label: 'Rush fee', price: 40 }],
        line_total: 280,
      })
    );
    expect(adjustment).toBe(-40 + 40 + 0);
  });

  it('always satisfies: sum of cells + adjustment === line_total', () => {
    const cases: LineItem[] = [
      lineItem(),
      lineItem({ quantity: 3, unit_price: 140, line_total: 420 }),
      lineItem({ base_unit_price: 140, unit_price: 99.99, line_total: 99.99 }),
      lineItem({ addons: [{ label: 'Rush', price: 12.34 }], line_total: 152.34 }),
    ];
    for (const item of cases) {
      const { cells, adjustment, lineTotal } = describeLineBreakdown(item);
      const summed = Object.values(cells).reduce((s, c) => s + (c.amount ?? 0), 0);
      expect(Math.round((summed + adjustment) * 100) / 100).toBe(lineTotal);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter web exec vitest run src/lib/optionBreakdown.test.ts
```

Expected: FAIL — cannot resolve `./optionBreakdown`.

- [ ] **Step 3: Implement `apps/web/src/lib/optionBreakdown.ts`**

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Per-option money for a SAVED line item — what the Order Presentation
 * page puts in each option column.
 *
 * Nothing else in the app turns a stored `LineItem` back into pricing
 * inputs: the editor builds them from the catalog and the Worker builds
 * them from catalog rows at save time. This module builds them from the
 * item's own SNAPSHOT columns instead, so the page reports what was
 * actually charged rather than what the catalog says today.
 *
 * The costs themselves come from `BaseBlindType.describeUnitCosts` — the
 * same calculation that produced the price — so a price basis is never
 * interpreted twice. What this module adds on top is the reconciliation
 * (see {@link describeLineBreakdown}): rounding legs independently does
 * NOT reproduce the stored `line_total`, and a customer-facing table
 * whose row does not add up is worse than one with no money in it.
 */

import { getBlindType } from './blindTypes';
import type { CatalogSlot, HardwareCharge } from './blindTypes/base';
import { addonsTotal } from './lineItemAdjustments';
import type { LineItem } from '../types';

/**
 * The option types the presentation table has a column for.
 *
 * `color` is a member despite carrying no money: it is a choice the
 * customer made and asked to filter on, and modelling it here keeps the
 * table and the filter bar reading from one list.
 */
export type OptionColumn = 'material' | 'color' | CatalogSlot;

/** Column order, left to right. */
export const OPTION_COLUMNS: readonly OptionColumn[] = [
  'material',
  'color',
  'cassette',
  'bottom_rail',
  'control',
  'installation',
];

/** Customer-facing heading for each option column. */
export const OPTION_COLUMN_LABELS: Record<OptionColumn, string> = {
  material: 'Material',
  color: 'Colour',
  cassette: 'Cassette',
  bottom_rail: 'Bottom rail',
  control: 'Control',
  installation: 'Installation',
};

/**
 * One option column's content for one line.
 *
 * `name === null` means the blind carries no option of this type — the
 * cell renders as a dash, and the column may be dropped entirely if no
 * visible line fills it. `amount === null` means the column carries no
 * money at all (colour); `amount === 0` is different again: a real
 * choice that happens to add nothing, which renders as a bare name.
 */
export interface OptionCell {
  name: string | null;
  amount: number | null;
}

/** Everything one table row needs, already reconciled to the stored total. */
export interface LineBreakdown {
  cells: Record<OptionColumn, OptionCell>;
  /**
   * Money on this line that no option column explains: add-ons, and the
   * gap a consultant's price override opened. Zero on an ordinary line —
   * never rounding noise, because the cells were fitted to the stored
   * price rather than summed independently of it.
   */
  adjustment: number;
  /** The stored `line_total`, echoed so callers total one field. */
  lineTotal: number;
}

/** Rounds to 2 decimal places (half-up), like every money path in the app. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Reads one hardware slot's snapshotted name off a line item. */
const SLOT_NAME: Record<CatalogSlot, (item: LineItem) => string | null> = {
  cassette: (item) => item.cassette_name,
  bottom_rail: (item) => item.bottom_rail_name,
  control: (item) => item.control_name,
  installation: (item) => item.installation_name,
};

/**
 * Rebuilds the `hardware` map the item was priced with, from its snapshot
 * columns.
 *
 * A slot is ABSENT when its id is null, never a zero charge — matching how
 * both the Worker and the editor build the map, and preserving the
 * difference between "no cassette" and "a cassette that costs nothing". A
 * row saved before migration 36 can carry an id with a null basis; it is
 * treated as absent, because there is no way to know what basis it was
 * charged on and guessing would invent money.
 */
function hardwareFromLineItem(item: LineItem): Partial<Record<CatalogSlot, HardwareCharge>> {
  const hardware: Partial<Record<CatalogSlot, HardwareCharge>> = {};
  if (item.cassette_id && item.cassette_price_basis) {
    hardware.cassette = {
      price: Number(item.cassette_price_per_m) || 0,
      basis: item.cassette_price_basis,
    };
  }
  if (item.bottom_rail_id && item.bottom_rail_price_basis) {
    hardware.bottom_rail = {
      price: Number(item.bottom_rail_price_per_m) || 0,
      basis: item.bottom_rail_price_basis,
    };
  }
  if (item.control_id && item.control_price_basis) {
    hardware.control = {
      price: Number(item.control_price_per_item) || 0,
      basis: item.control_price_basis,
    };
  }
  if (item.installation_id && item.installation_price_basis) {
    hardware.installation = {
      price: Number(item.installation_price_per_item) || 0,
      basis: item.installation_price_basis,
    };
  }
  return hardware;
}

/** An empty cell for every column — the starting point each row fills in. */
function emptyCells(): Record<OptionColumn, OptionCell> {
  return {
    material: { name: null, amount: null },
    color: { name: null, amount: null },
    cassette: { name: null, amount: null },
    bottom_rail: { name: null, amount: null },
    control: { name: null, amount: null },
    installation: { name: null, amount: null },
  };
}

/**
 * Splits one line item into per-option cells that sum EXACTLY to its
 * stored `line_total`.
 *
 * The reconciliation is the whole point. `line_total` is built as
 * `round2(unit_price * qty) + addonsTotal(addons)`, so `Σ round2(leg *
 * qty)` is not the same number — with five legs the two can differ by two
 * or three cents. Left alone that surfaces as a phantom adjustment on an
 * ordinary line, which is exactly the "why doesn't this add up?" moment
 * the column exists to prevent. So the hardware cells are computed
 * directly and the MATERIAL cell is fitted to close the gap: it is always
 * present and always the largest leg, so a two-cent correction cannot
 * push it negative or be noticed.
 *
 * `base_unit_price` is read in preference to `unit_price` because on an
 * overridden line it is the price the options actually produced, leaving
 * the override itself to show up as the adjustment. This matches how
 * `originalLineTotal` already defines the "was" price.
 *
 * Preset and custom items have no options; they come back with every cell
 * empty and their whole `line_total` as the adjustment, which is why the
 * page lists them separately rather than in the option table.
 */
export function describeLineBreakdown(item: LineItem): LineBreakdown {
  const cells = emptyCells();
  const lineTotal = round2(Number(item.line_total) || 0);

  if (item.item_type !== 'blind') {
    return { cells, adjustment: lineTotal, lineTotal };
  }

  const quantity = Number(item.quantity) || 0;
  const calcUnit = Number(item.base_unit_price ?? item.unit_price) || 0;
  const optionsLine = round2(calcUnit * quantity);

  const legs = getBlindType(item.blinds_type).describeUnitCosts({
    panels: item.panels,
    height_cm: Number(item.height_cm) || 0,
    material_price_per_sqm: Number(item.material_price_per_sqm) || 0,
    hardware: hardwareFromLineItem(item),
    attributes: item.attributes,
  });

  let hardwareSum = 0;
  for (const slot of ['cassette', 'bottom_rail', 'control', 'installation'] as CatalogSlot[]) {
    const name = SLOT_NAME[slot](item);
    if (name === null) continue;
    const amount = round2((legs[slot] ?? 0) * quantity);
    cells[slot] = { name, amount };
    hardwareSum += amount;
  }

  cells.material = {
    name: item.material_name,
    amount: round2(optionsLine - hardwareSum),
  };
  cells.color = { name: item.color || null, amount: null };

  return { cells, adjustment: round2(lineTotal - optionsLine), lineTotal };
}
```

Note `addonsTotal` is imported for its type-level role in the doc comment only — if oxlint flags it as unused, drop the import and keep the prose reference.

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter web exec vitest run src/lib/optionBreakdown.test.ts
```

Expected: PASS, 11 tests.

- [ ] **Step 5: Typecheck and lint**

```bash
pnpm --filter web check && pnpm --filter web lint
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/optionBreakdown.ts apps/web/src/lib/optionBreakdown.test.ts
git commit -m "feat(orders): per-option money for a saved line item

Rebuilds pricing inputs from a line item's snapshot columns and splits
the line into per-option cells, fitting the material cell so every row
sums exactly to the stored line_total and the adjustment reports only
real money (overrides and add-ons)."
```

---

### Task 3: `presentationFilters.ts` — facets and the match predicate

**Files:**
- Create: `apps/web/src/pages/orders/presentationFilters.ts`
- Test: `apps/web/src/pages/orders/presentationFilters.test.ts`

**Interfaces:**
- Consumes: `LineItem` type; `OptionColumn` from Task 2 is NOT used here (filter fields include `room_name`/`blinds_type`, which are not option columns).
- Produces:
  - `export type FilterField = 'room_name' | 'blinds_type' | 'material' | 'color' | 'cassette' | 'bottom_rail' | 'control' | 'installation'`
  - `export const FILTER_FIELDS: readonly FilterField[]`
  - `export const FILTER_FIELD_LABELS: Record<FilterField, string>`
  - `export interface PresentationFilter { id: string; field: FilterField; value: string }`
  - `export interface Facet { field: FilterField; values: { value: string; count: number }[] }`
  - `export function fieldValue(item: LineItem, field: FilterField): string`
  - `export function buildFacets(items: LineItem[]): Facet[]`
  - `export function matchesFilters(item: LineItem, filters: PresentationFilter[]): boolean`
  - `export function hasOptionFilter(filters: PresentationFilter[]): boolean`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/pages/orders/presentationFilters.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Unit tests for `presentationFilters.ts` — the facet extraction and
 * match predicate behind the Order Presentation filter bar.
 *
 * The combination rule (AND across option types, OR within one) is the
 * behaviour the whole feature was specified around, so the spec's own
 * ten-window worked example is encoded here verbatim.
 */

import { describe, it, expect } from 'vitest';
import {
  buildFacets,
  fieldValue,
  hasOptionFilter,
  matchesFilters,
  type PresentationFilter,
} from './presentationFilters';
import type { LineItem } from '../../types';

/** A saved blind carrying only the fields the filters read. */
function blind(overrides: Partial<LineItem> = {}): LineItem {
  return {
    item_type: 'blind',
    room_name: 'Living Room',
    blinds_type: 'Roller',
    material_name: 'Blackout White',
    color: 'White',
    cassette_name: null,
    bottom_rail_name: null,
    control_name: null,
    installation_name: null,
    ...overrides,
  } as LineItem;
}

/** Builds a filter without caring about the ids the UI mints. */
function f(field: PresentationFilter['field'], value: string): PresentationFilter {
  return { id: `${field}:${value}`, field, value };
}

describe('fieldValue', () => {
  it('reads each field off its snapshot column', () => {
    const item = blind({ control_name: 'Cordless', bottom_rail_name: 'Fabric wrapped' });
    expect(fieldValue(item, 'room_name')).toBe('Living Room');
    expect(fieldValue(item, 'blinds_type')).toBe('Roller');
    expect(fieldValue(item, 'material')).toBe('Blackout White');
    expect(fieldValue(item, 'color')).toBe('White');
    expect(fieldValue(item, 'control')).toBe('Cordless');
    expect(fieldValue(item, 'bottom_rail')).toBe('Fabric wrapped');
  });

  it('returns an empty string for an option the blind does not carry', () => {
    expect(fieldValue(blind(), 'cassette')).toBe('');
  });
});

describe('buildFacets', () => {
  it('lists each distinct value with the number of blinds carrying it', () => {
    const items = [
      blind({ control_name: 'Cordless' }),
      blind({ control_name: 'Cordless' }),
      blind({ control_name: 'Motorised' }),
    ];
    const control = buildFacets(items).find((facet) => facet.field === 'control');
    expect(control?.values).toEqual([
      { value: 'Cordless', count: 2 },
      { value: 'Motorised', count: 1 },
    ]);
  });

  it('omits a field no blind in the order carries a value for', () => {
    const facets = buildFacets([blind()]);
    expect(facets.map((facet) => facet.field)).not.toContain('installation');
    expect(facets.map((facet) => facet.field)).not.toContain('cassette');
  });

  it('omits preset and custom lines — they have no options to filter on', () => {
    const items = [blind(), { item_type: 'preset', room_name: 'Call-out' } as LineItem];
    const room = buildFacets(items).find((facet) => facet.field === 'room_name');
    expect(room?.values).toEqual([{ value: 'Living Room', count: 1 }]);
  });
});

describe('matchesFilters', () => {
  it('matches everything when there are no filters', () => {
    expect(matchesFilters(blind(), [])).toBe(true);
  });

  it('matches everything when a filter has no value chosen yet', () => {
    expect(matchesFilters(blind(), [f('control', '')])).toBe(true);
  });

  it('ANDs across different option types', () => {
    const both = blind({ control_name: 'Cordless', bottom_rail_name: 'Fabric wrapped' });
    const onlyControl = blind({ control_name: 'Cordless' });
    const filters = [f('control', 'Cordless'), f('bottom_rail', 'Fabric wrapped')];
    expect(matchesFilters(both, filters)).toBe(true);
    expect(matchesFilters(onlyControl, filters)).toBe(false);
  });

  it('ORs within one option type', () => {
    const filters = [f('control', 'Cordless'), f('control', 'Motorised')];
    expect(matchesFilters(blind({ control_name: 'Cordless' }), filters)).toBe(true);
    expect(matchesFilters(blind({ control_name: 'Motorised' }), filters)).toBe(true);
    expect(matchesFilters(blind({ control_name: 'Chain' }), filters)).toBe(false);
  });

  it("reproduces the spec's ten-window example", () => {
    // 10 windows: 3 cordless, 5 fabric-wrapped, 2 of them both.
    const windows: LineItem[] = [
      blind({ room_name: 'W1', control_name: 'Cordless', bottom_rail_name: 'Fabric wrapped' }),
      blind({ room_name: 'W2', control_name: 'Cordless', bottom_rail_name: 'Fabric wrapped' }),
      blind({ room_name: 'W3', control_name: 'Cordless' }),
      blind({ room_name: 'W4', bottom_rail_name: 'Fabric wrapped' }),
      blind({ room_name: 'W5', bottom_rail_name: 'Fabric wrapped' }),
      blind({ room_name: 'W6', bottom_rail_name: 'Fabric wrapped' }),
      blind({ room_name: 'W7', control_name: 'Motorised' }),
      blind({ room_name: 'W8' }),
      blind({ room_name: 'W9' }),
      blind({ room_name: 'W10' }),
    ];
    const count = (filters: PresentationFilter[]) =>
      windows.filter((w) => matchesFilters(w, filters)).length;

    expect(count([f('control', 'Cordless')])).toBe(3);
    expect(count([f('bottom_rail', 'Fabric wrapped')])).toBe(5);
    expect(count([f('control', 'Cordless'), f('bottom_rail', 'Fabric wrapped')])).toBe(2);
    expect(
      count([f('control', 'Cordless'), f('control', 'Motorised'), f('bottom_rail', 'Fabric wrapped')])
    ).toBe(2);
  });
});

describe('hasOptionFilter', () => {
  it('is false for no filters, and for room or blind-type filters alone', () => {
    expect(hasOptionFilter([])).toBe(false);
    expect(hasOptionFilter([f('room_name', 'Living Room'), f('blinds_type', 'Roller')])).toBe(false);
  });

  it('is false for an option filter with no value chosen yet', () => {
    expect(hasOptionFilter([f('control', '')])).toBe(false);
  });

  it('is true once any option type is narrowed', () => {
    expect(hasOptionFilter([f('control', 'Cordless')])).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter web exec vitest run src/pages/orders/presentationFilters.test.ts
```

Expected: FAIL — cannot resolve `./presentationFilters`.

- [ ] **Step 3: Implement `apps/web/src/pages/orders/presentationFilters.ts`**

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Filter model for the Order Presentation page.
 *
 * A consultant standing with a customer narrows the blind list by the
 * choices already made in THIS order — "show me the cordless ones", "the
 * fabric-wrapped rails in the bedroom". Every value offered is therefore
 * harvested from the order's own line items rather than from the catalog:
 * a filter can never be built that matches nothing.
 *
 * Deliberately free of React so the combination rule can be tested
 * directly. The page owns the filter array; this module only answers
 * questions about it.
 */

import type { LineItem } from '../../types';

/**
 * A field a blind can be filtered on: the two identity fields plus every
 * option type. Superset of `OptionColumn` in `lib/optionBreakdown.ts` —
 * room and blind type are filterable but are not option columns, so the
 * two lists are intentionally separate rather than one leaking into the
 * other.
 */
export type FilterField =
  | 'room_name'
  | 'blinds_type'
  | 'material'
  | 'color'
  | 'cassette'
  | 'bottom_rail'
  | 'control'
  | 'installation';

/** Field order in the filter-row dropdown. */
export const FILTER_FIELDS: readonly FilterField[] = [
  'room_name',
  'blinds_type',
  'material',
  'color',
  'cassette',
  'bottom_rail',
  'control',
  'installation',
];

/** Customer-facing label for each filter field. */
export const FILTER_FIELD_LABELS: Record<FilterField, string> = {
  room_name: 'Room',
  blinds_type: 'Blind type',
  material: 'Material',
  color: 'Colour',
  cassette: 'Cassette',
  bottom_rail: 'Bottom rail',
  control: 'Control',
  installation: 'Installation',
};

/**
 * One filter row. `value === ''` means the consultant has added the row
 * but not yet chosen — it matches everything, so a half-built filter
 * never blanks the table mid-gesture.
 *
 * `id` is UI identity only (React keys, removal), never compared.
 */
export interface PresentationFilter {
  id: string;
  field: FilterField;
  value: string;
}

/** One field's available values, with how many blinds carry each. */
export interface Facet {
  field: FilterField;
  values: { value: string; count: number }[];
}

/** Fields that describe a CHOICE rather than a blind's identity. */
const OPTION_FIELDS: readonly FilterField[] = [
  'material',
  'color',
  'cassette',
  'bottom_rail',
  'control',
  'installation',
];

/**
 * The value a blind carries for one filter field, or `''` when it carries
 * none. Reads the SNAPSHOT columns, so filtering agrees with the money the
 * table shows beside it.
 */
export function fieldValue(item: LineItem, field: FilterField): string {
  switch (field) {
    case 'room_name':
      return item.room_name || '';
    case 'blinds_type':
      return item.blinds_type || '';
    case 'material':
      return item.material_name || '';
    case 'color':
      return item.color || '';
    case 'cassette':
      return item.cassette_name || '';
    case 'bottom_rail':
      return item.bottom_rail_name || '';
    case 'control':
      return item.control_name || '';
    case 'installation':
      return item.installation_name || '';
  }
}

/**
 * The filterable values present in this order, first-seen order preserved
 * so the dropdown reads in the order the consultant entered the blinds.
 *
 * Counts are over ALL the blinds passed in, NOT over the currently
 * filtered set: they describe the order ("3 of these are cordless"),
 * which is what gets read aloud, and recomputing them against live
 * filters would make the numbers jump while a filter is being built and
 * show `(0)` beside the value the consultant is reaching for.
 *
 * A field no blind carries a value for is omitted entirely, which is what
 * keeps an order of plain rollers from offering four empty dropdowns.
 * Preset and custom lines are skipped — they have no options.
 */
export function buildFacets(items: LineItem[]): Facet[] {
  const blinds = items.filter((item) => item.item_type === 'blind');
  const facets: Facet[] = [];
  for (const field of FILTER_FIELDS) {
    const counts = new Map<string, number>();
    for (const item of blinds) {
      const value = fieldValue(item, field);
      if (!value) continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    if (counts.size === 0) continue;
    facets.push({
      field,
      values: [...counts.entries()].map(([value, count]) => ({ value, count })),
    });
  }
  return facets;
}

/**
 * Whether a blind survives the active filters.
 *
 * AND across fields, OR within one: a blind must satisfy every field that
 * has at least one valued filter, and within a field matching any chosen
 * value is enough. That is what makes "cordless AND fabric-wrapped"
 * narrow while "cordless OR motorised" widens — ANDing everywhere would
 * make two values of one field a guaranteed empty table.
 *
 * Valueless rows are ignored rather than matching nothing.
 */
export function matchesFilters(item: LineItem, filters: PresentationFilter[]): boolean {
  const byField = new Map<FilterField, string[]>();
  for (const filter of filters) {
    if (!filter.value) continue;
    const values = byField.get(filter.field);
    if (values) values.push(filter.value);
    else byField.set(filter.field, [filter.value]);
  }
  for (const [field, values] of byField) {
    if (!values.includes(fieldValue(item, field))) return false;
  }
  return true;
}

/**
 * Whether the view has been narrowed to particular OPTIONS, as opposed to
 * not filtered at all or filtered only by room / blind type.
 *
 * The page uses this to decide whether preset and custom lines still
 * belong on screen: "the blinds in the bedroom" can reasonably include the
 * call-out fee, but "the cordless ones" cannot.
 */
export function hasOptionFilter(filters: PresentationFilter[]): boolean {
  return filters.some((filter) => Boolean(filter.value) && OPTION_FIELDS.includes(filter.field));
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter web exec vitest run src/pages/orders/presentationFilters.test.ts
```

Expected: PASS, 13 tests.

- [ ] **Step 5: Typecheck and lint**

```bash
pnpm --filter web check && pnpm --filter web lint
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/orders/presentationFilters.ts apps/web/src/pages/orders/presentationFilters.test.ts
git commit -m "feat(orders): filter model for the Order Presentation page

Facets harvested from the order's own line items (so no filter can match
nothing), and an AND-across-fields / OR-within-a-field predicate."
```

---

### Task 4: `PresentationTable.tsx`

**Files:**
- Create: `apps/web/src/pages/orders/PresentationTable.tsx`

**Interfaces:**
- Consumes: `describeLineBreakdown`, `OPTION_COLUMNS`, `OPTION_COLUMN_LABELS`, `OptionColumn`, `LineBreakdown` (Task 2).
- Produces: `export default function PresentationTable({ items }: { items: LineItem[] })` — renders the option table with its `<tfoot>` totals for exactly the rows given. It does no filtering; the page passes the already-filtered list.

No test: this repo has no component-testing setup. It is covered by `pnpm check` / `pnpm lint` and by Task 8's browser verification.

- [ ] **Step 1: Create the component**

```tsx
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * The Order Presentation option table — one row per blind, one column per
 * option type, and a `<tfoot>` carrying a total for every money column.
 *
 * Purely presentational: it renders exactly the rows it is handed, so the
 * page owns filtering and this component's totals are automatically "the
 * totals for what is on screen". All money comes from
 * `describeLineBreakdown`, which guarantees each row's cells plus its
 * adjustment equal the stored line total — so the footer sums are real,
 * not indicative.
 *
 * Columns for option types no visible blind carries are dropped entirely
 * rather than rendered full of dashes: an order of plain rollers should
 * not present a customer with four empty columns. The table scrolls
 * inside its own container so the page body never scrolls sideways on a
 * tablet.
 */

import { useMemo, type ReactNode } from 'react';
import {
  OPTION_COLUMNS,
  OPTION_COLUMN_LABELS,
  describeLineBreakdown,
  type LineBreakdown,
  type OptionColumn,
} from '../../lib/optionBreakdown';
import type { LineItem } from '../../types';

/** Formats a number as dollars, e.g. `$1234.50`. Matches Order Overview. */
function money(value: number | null | undefined): string {
  return `$${(Number(value) || 0).toFixed(2)}`;
}

/**
 * A blind's size for a customer: `120 × 210`, or `(120 + 80) × 210` when
 * it is split into panels. The parentheses matter — `120 + 80 × 210` reads
 * as arithmetic with the wrong precedence.
 */
function size(item: LineItem): string {
  const widths = item.panels.filter((w) => w > 0);
  if (widths.length === 0 || item.height_cm === null) return '—';
  const width = widths.length > 1 ? `(${widths.join(' + ')})` : `${widths[0]}`;
  return `${width} × ${item.height_cm}`;
}

/** Header cell. */
function Th({ children, right = false }: { children: ReactNode; right?: boolean }) {
  return (
    <th
      className={`whitespace-nowrap px-3 py-2 text-xs font-semibold uppercase tracking-wide text-text-muted ${right ? 'text-right' : 'text-left'}`}
    >
      {children}
    </th>
  );
}

/** Body cell. `mono` marks money and size figures. */
function Td({
  children,
  right = false,
  mono = false,
}: {
  children: ReactNode;
  right?: boolean;
  mono?: boolean;
}) {
  return (
    <td
      className={`px-3 py-2 text-[13px] text-text-secondary ${right ? 'text-right' : 'text-left'} ${mono ? 'whitespace-nowrap font-mono' : ''}`}
    >
      {children}
    </td>
  );
}

/** Footer cell — heavier than a body cell, since it carries the totals. */
function Tf({ children, right = false }: { children: ReactNode; right?: boolean }) {
  return (
    <td
      className={`whitespace-nowrap px-3 py-2 font-mono text-sm font-semibold text-text-primary ${right ? 'text-right' : 'text-left'}`}
    >
      {children}
    </td>
  );
}

/**
 * One option cell: the chosen option's name, with what it added to this
 * line beneath it.
 *
 * An option that adds nothing prints its name alone — a customer reading
 * a column of "$0.00" learns nothing and starts wondering what it means.
 */
function OptionValue({ cell }: { cell: LineBreakdown['cells'][OptionColumn] }) {
  if (cell.name === null) return <>—</>;
  return (
    <>
      <span className="block">{cell.name}</span>
      {cell.amount !== null && cell.amount !== 0 && (
        <span className="mt-0.5 block font-mono text-xs text-text-muted">
          +{money(cell.amount)}
        </span>
      )}
    </>
  );
}

export default function PresentationTable({ items }: { items: LineItem[] }) {
  /**
   * Rows and their column set, recomputed only when the visible items
   * change. A column survives when at least one visible row fills it, so
   * the table narrows as the filters narrow.
   */
  const { rows, columns, totals, adjustmentTotal, overall, quantityTotal } = useMemo(() => {
    const rows = items.map((item) => ({ item, breakdown: describeLineBreakdown(item) }));
    const columns = OPTION_COLUMNS.filter((column) =>
      rows.some((row) => row.breakdown.cells[column].name !== null)
    );
    const totals = new Map<OptionColumn, number>();
    for (const column of columns) {
      totals.set(
        column,
        Math.round(
          rows.reduce((sum, row) => sum + (row.breakdown.cells[column].amount ?? 0), 0) * 100
        ) / 100
      );
    }
    const adjustmentTotal =
      Math.round(rows.reduce((sum, row) => sum + row.breakdown.adjustment, 0) * 100) / 100;
    const overall =
      Math.round(rows.reduce((sum, row) => sum + row.breakdown.lineTotal, 0) * 100) / 100;
    const quantityTotal = rows.reduce((sum, row) => sum + (Number(row.item.quantity) || 0), 0);
    return { rows, columns, totals, adjustmentTotal, overall, quantityTotal };
  }, [items]);

  const showAdjustment = rows.some((row) => row.breakdown.adjustment !== 0);

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full min-w-[900px] border-collapse">
        <thead>
          <tr className="border-b border-border bg-surface-muted">
            <Th>Room</Th>
            <Th>Blind type</Th>
            <Th right>Size (cm)</Th>
            {columns.map((column) => (
              <Th key={column}>{OPTION_COLUMN_LABELS[column]}</Th>
            ))}
            <Th right>Qty</Th>
            {showAdjustment && <Th right>Adjustment</Th>}
            <Th right>Line total</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-light">
          {rows.map(({ item, breakdown }, i) => (
            <tr key={item.id}>
              <Td>{item.room_name || `Blind ${i + 1}`}</Td>
              <Td>{item.blinds_type || '—'}</Td>
              <Td right mono>
                {size(item)}
              </Td>
              {columns.map((column) => (
                <Td key={column}>
                  <OptionValue cell={breakdown.cells[column]} />
                </Td>
              ))}
              <Td right mono>
                {item.quantity}
              </Td>
              {showAdjustment && (
                <Td right mono>
                  {breakdown.adjustment === 0 ? '' : money(breakdown.adjustment)}
                </Td>
              )}
              <Td right mono>
                {money(breakdown.lineTotal)}
              </Td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border bg-surface-muted">
            <Tf>
              {rows.length} blind{rows.length !== 1 ? 's' : ''}
            </Tf>
            <Tf>{''}</Tf>
            <Tf>{''}</Tf>
            {columns.map((column) => (
              <Tf key={column} right>
                {totals.get(column) ? money(totals.get(column)) : ''}
              </Tf>
            ))}
            <Tf right>{quantityTotal}</Tf>
            {showAdjustment && <Tf right>{adjustmentTotal ? money(adjustmentTotal) : ''}</Tf>}
            <Tf right>{money(overall)}</Tf>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

```bash
pnpm --filter web check && pnpm --filter web lint
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/orders/PresentationTable.tsx
git commit -m "feat(orders): option table with per-column totals for the presentation view"
```

---

### Task 5: `PresentationFilterBar.tsx`

**Files:**
- Create: `apps/web/src/pages/orders/PresentationFilterBar.tsx`

**Interfaces:**
- Consumes: `Facet`, `FilterField`, `FILTER_FIELD_LABELS`, `PresentationFilter` (Task 3); `Button` from `components/ui`.
- Produces: `export default function PresentationFilterBar({ facets, filters, onChange }: { facets: Facet[]; filters: PresentationFilter[]; onChange: (next: PresentationFilter[]) => void })` — a controlled component. It never holds filter state; the page does.

- [ ] **Step 1: Create the component**

```tsx
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * The Order Presentation filter bar — a stack of `[field] [value] [remove]`
 * rows plus an "Add filter" button.
 *
 * Fully controlled: the page owns the filter array and this component only
 * reports edits, so the table, the totals and the bar can never disagree
 * about what is being shown.
 *
 * Both dropdowns are built from `facets`, which is harvested from the
 * order's own line items — a consultant can only ever build a filter that
 * matches something, and each value carries the number of blinds behind it
 * ("Cordless (3)") because that count is the sentence being read aloud to
 * the customer.
 *
 * A freshly added row has no value chosen, and a valueless row matches
 * everything, so adding a filter never blanks the table mid-gesture.
 */

import { Button } from '../../components/ui';
import {
  FILTER_FIELD_LABELS,
  type Facet,
  type FilterField,
  type PresentationFilter,
} from './presentationFilters';

/** Shared select styling — matches the app's input chrome. */
const SELECT_CLASS =
  'h-11 min-w-0 flex-1 rounded-md border border-border-input bg-surface px-3 text-sm text-text-primary';

export default function PresentationFilterBar({
  facets,
  filters,
  onChange,
}: {
  facets: Facet[];
  filters: PresentationFilter[];
  onChange: (next: PresentationFilter[]) => void;
}) {
  // An order with nothing to distinguish its blinds gets no filter bar at
  // all, rather than a control that can only ever be a no-op.
  if (facets.length === 0) return null;

  /** Appends an empty row on the first field that still has choices. */
  function addFilter() {
    const field = facets[0].field;
    onChange([...filters, { id: `${field}-${Date.now()}-${filters.length}`, field, value: '' }]);
  }

  /** Changing the FIELD clears the value — it belonged to the old field. */
  function setField(id: string, field: FilterField) {
    onChange(filters.map((f) => (f.id === id ? { ...f, field, value: '' } : f)));
  }

  function setValue(id: string, value: string) {
    onChange(filters.map((f) => (f.id === id ? { ...f, value } : f)));
  }

  function removeFilter(id: string) {
    onChange(filters.filter((f) => f.id !== id));
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-3 print:hidden">
      <div className="flex flex-col gap-2">
        {filters.map((filter) => {
          const facet = facets.find((f) => f.field === filter.field);
          return (
            <div key={filter.id} className="flex items-center gap-2">
              <select
                aria-label="Filter by"
                className={SELECT_CLASS}
                value={filter.field}
                onChange={(e) => setField(filter.id, e.target.value as FilterField)}
              >
                {facets.map((f) => (
                  <option key={f.field} value={f.field}>
                    {FILTER_FIELD_LABELS[f.field]}
                  </option>
                ))}
              </select>
              <select
                aria-label="Matching"
                className={SELECT_CLASS}
                value={filter.value}
                onChange={(e) => setValue(filter.id, e.target.value)}
              >
                <option value="">Any</option>
                {facet?.values.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.value} ({v.count})
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-label="Remove filter"
                onClick={() => removeFilter(filter.id)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border-input text-text-muted hover:bg-surface-sunken"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-2">
        <Button variant="secondary" size="sm" onClick={addFilter}>
          + Add filter
        </Button>
        {filters.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => onChange([])}>
            Clear
          </Button>
        )}
      </div>
    </section>
  );
}
```

`'ghost'` and `'sm'` are verified members of `Button`'s `VARIANTS` and `SIZES`. Note `sm` is still 44px tall by design ("small means visually lighter, not physically smaller, because the app is used with gloves on ladders"), so the filter rows keep their tap targets.

- [ ] **Step 2: Typecheck and lint**

```bash
pnpm --filter web check && pnpm --filter web lint
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/orders/PresentationFilterBar.tsx
git commit -m "feat(orders): filter bar for the Order Presentation page"
```

---

### Task 6: `OrderPresentation.tsx` and its route

**Files:**
- Create: `apps/web/src/pages/orders/OrderPresentation.tsx`
- Modify: `apps/web/src/App.tsx` (lazy import near line 31, route near line 101)

**Interfaces:**
- Consumes: `PresentationTable` (Task 4), `PresentationFilterBar` (Task 5), `buildFacets` / `matchesFilters` / `hasOptionFilter` / `PresentationFilter` (Task 3), `useOrder` from `hooks/useOrders`, `displayName` from `lib/customerName`, `PageHeader`, `StatusBadge`.
- Produces: default-exported page component at `/orders/:id/present`.

- [ ] **Step 1: Create the page**

```tsx
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Order Presentation page (`/orders/:id/present`).
 *
 * The screen a consultant turns toward the customer while an order is
 * still unconfirmed. Every blind is one row, every option type is a
 * column carrying what that choice cost, and the filter bar narrows the
 * list live during the conversation — "just the cordless ones", "the
 * bedroom" — with every total following.
 *
 * Reached from the "Present to Customer" action below Confirm on the
 * order detail page, which SAVES before navigating: this page reads the
 * server row, so an unsaved draft would otherwise be presented stale.
 *
 * Money discipline (AI_GUIDELINES §1). Two different numbers are on
 * screen and they are labelled apart on purpose:
 *   - the table's overall total is the sum of the stored `line_total`s of
 *     whatever is currently visible, and moves with the filters;
 *   - the order strip (subtotal / discount / HST / total) is read
 *     VERBATIM from the server row and never recomputed. Applying 13% to
 *     a filtered subset would put a fabricated number in front of a
 *     customer.
 *
 * Hidden line items are excluded throughout — they are already out of the
 * order total and off every other customer-facing surface.
 */

import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import StatusBadge from '../../components/StatusBadge';
import { useOrder } from '../../hooks/useOrders';
import { displayName } from '../../lib/customerName';
import PresentationFilterBar from './PresentationFilterBar';
import PresentationTable from './PresentationTable';
import {
  buildFacets,
  hasOptionFilter,
  matchesFilters,
  type PresentationFilter,
} from './presentationFilters';

/** Formats a number as dollars, e.g. `$1234.50`. */
function money(value: number | null | undefined): string {
  return `$${(Number(value) || 0).toFixed(2)}`;
}

/** One line of the order-total strip. */
function TotalRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span className={strong ? 'text-sm font-semibold text-text-primary' : 'text-sm text-text-muted'}>
        {label}
      </span>
      <span
        className={`font-mono ${strong ? 'text-base font-semibold text-text-primary' : 'text-sm text-text-secondary'}`}
      >
        {value}
      </span>
    </div>
  );
}

export default function OrderPresentation() {
  const { id } = useParams<{ id: string }>();
  const { data: order, isLoading, error } = useOrder(id);
  const [filters, setFilters] = useState<PresentationFilter[]>([]);

  const lineItems = order?.line_items;
  // Hidden items are excluded once, here, so nothing downstream has to
  // remember to do it.
  const visible = useMemo(() => (lineItems ?? []).filter((item) => !item.hidden), [lineItems]);

  const blinds = useMemo(() => visible.filter((item) => item.item_type === 'blind'), [visible]);
  const otherItems = useMemo(() => visible.filter((item) => item.item_type !== 'blind'), [visible]);

  const facets = useMemo(() => buildFacets(blinds), [blinds]);
  const shown = useMemo(
    () => blinds.filter((item) => matchesFilters(item, filters)),
    [blinds, filters]
  );

  // "The cordless ones" cannot meaningfully include a call-out fee, so the
  // other-items section drops out once the view is narrowed to options.
  const showOtherItems = otherItems.length > 0 && !hasOptionFilter(filters);
  const filtered = shown.length !== blinds.length;

  const otherItemsTotal = useMemo(
    () =>
      Math.round(otherItems.reduce((sum, item) => sum + (Number(item.line_total) || 0), 0) * 100) /
      100,
    [otherItems]
  );

  const customerName = order?.customer ? displayName(order.customer) : '';

  return (
    <div className="min-h-screen bg-surface-muted print:bg-white">
      <PageHeader
        title="Order Presentation"
        backTo={id ? `/orders/${id}` : '/'}
        right={
          <button
            onClick={() => window.print()}
            className="flex h-9 items-center gap-1.5 rounded-md border border-border-input bg-surface px-3 text-sm font-medium text-text-secondary hover:bg-surface-sunken print:hidden"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <path d="M6 14h12v8H6z" />
            </svg>
            Print
          </button>
        }
      />

      <div className="page-container py-4 md:py-6 lg:py-8">
        {isLoading && <p className="p-4 text-text-muted">Loading…</p>}
        {error && <p className="p-4 text-danger">{error.message}</p>}

        {order && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-text-primary">{order.order_number}</h2>
                {(customerName || order.order_date) && (
                  <p className="text-sm text-text-muted">
                    {[customerName, order.order_date].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
              <StatusBadge status={order.status} />
            </div>

            <PresentationFilterBar facets={facets} filters={filters} onChange={setFilters} />

            {shown.length === 0 ? (
              <div className="rounded-lg border border-border bg-surface p-8 text-center">
                <p className="text-sm text-text-muted">No blinds match these filters.</p>
                <button
                  onClick={() => setFilters([])}
                  className="mt-3 text-sm font-medium text-brand underline"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <PresentationTable items={shown} />
            )}

            {showOtherItems && (
              <section className="rounded-lg border border-border bg-surface">
                <div className="flex items-baseline justify-between gap-2 border-b border-border px-4 py-3">
                  <h3 className="text-base font-semibold text-text-primary">Other items</h3>
                  <span className="font-mono text-sm font-semibold text-text-primary">
                    {money(otherItemsTotal)}
                  </span>
                </div>
                <ul className="divide-y divide-border-light">
                  {otherItems.map((item, i) => (
                    <li key={item.id} className="flex items-baseline justify-between gap-4 px-4 py-2">
                      <span className="text-[13px] text-text-secondary">
                        {item.title || item.description || `Item ${i + 1}`}
                        {item.quantity > 1 && (
                          <span className="ml-1 text-text-muted">× {item.quantity}</span>
                        )}
                      </span>
                      <span className="font-mono text-[13px] text-text-secondary">
                        {money(item.line_total)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Server-authoritative order money. Never recomputed here. */}
            <section className="rounded-lg border border-border bg-surface p-4">
              <TotalRow label="Subtotal" value={money(order.subtotal)} />
              {Number(order.discount_amount) > 0 && (
                <TotalRow label="Discount" value={`−${money(order.discount_amount)}`} />
              )}
              <TotalRow label={`HST (${Math.round(Number(order.tax_rate) * 100)}%)`} value={money(order.tax_amount)} />
              <TotalRow label="Order total" value={money(order.total)} strong />
              {filtered && (
                <p className="mt-2 border-t border-border-light pt-2 text-xs text-text-muted">
                  Showing {shown.length} of {blinds.length} blinds · order total unchanged
                </p>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
```

`orders.tax_rate` is `numeric(5,4) not null default 0.13` (migration `20260703000008_estimates.sql`), i.e. a fraction — so `Math.round(tax_rate * 100)` correctly yields `13`. This is a LABEL only; the tax amount itself is `order.tax_amount` straight from the server.

- [ ] **Step 2: Register the route in `apps/web/src/App.tsx`**

Add the lazy import beside the others (near line 31):

```tsx
const OrderPresentation = lazy(() => import('./pages/orders/OrderPresentation'));
```

Add the route immediately after the `/overview` route (near line 100):

```tsx
<Route path="/orders/:id/present" element={guard(<Layout><OrderPresentation /></Layout>)} />
```

- [ ] **Step 3: Typecheck and lint**

```bash
pnpm --filter web check && pnpm --filter web lint
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/orders/OrderPresentation.tsx apps/web/src/App.tsx
git commit -m "feat(orders): Order Presentation page at /orders/:id/present

Filterable customer-facing view of an order's blinds with per-option
money and filter-tracking totals. The order strip stays server-
authoritative: a filtered subset never gets its own HST figure."
```

---

### Task 7: The entry point below Confirm

**Files:**
- Modify: `apps/web/src/pages/orders/OrderDetail.tsx` — `ICONS` (ends ~line 444), a new handler beside `handleConfirm` (~line 1195), and `stageActions()` (~line 1949)

**Interfaces:**
- Consumes: the `/orders/:id/present` route from Task 6.
- Produces: no new exports. `navigate` and `useNavigate` are already imported and in scope (line 66 / line 478) — do not re-import them.

- [ ] **Step 1: Add the icon**

In the `ICONS` object, after the `overview` entry, add a presentation-screen glyph:

```tsx
  present: (
    <ActionIcon>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </ActionIcon>
  ),
```

- [ ] **Step 2: Add the handler**

Immediately after `handleConfirm` (which ends around line 1203), add:

```tsx
  /**
   * Opens the customer presentation view.
   *
   * Saves first, for the same reason `handleConfirm` does: the page reads
   * the SERVER row, so on a draft that has just been typed an unsaved
   * order would be presented empty or stale. Navigates in the same tab
   * rather than opening one — a `window.open` after an `await` is treated
   * as a popup and blocked, and handing one tablet across a table beats
   * juggling tabs anyway.
   */
  async function handlePresent() {
    const savedId = await save();
    if (!savedId) return;
    navigate(`/orders/${savedId}/present`);
  }
```

- [ ] **Step 3: Wire it into the stage actions**

Inside `stageActions()`, beside the existing `overview` and `confirm` consts, add:

```tsx
    const present: StageAction = {
      key: 'present',
      icon: ICONS.present,
      label: 'Present to Customer',
      short: 'Present',
      onClick: handlePresent,
      disabled: !canAct || !customer || items.length === 0,
    };
```

Then change exactly three returns — the unconfirmed stages, so the button sits directly below Confirm:

```tsx
    // Draft — confirm the order (Send/Save live in the top bar).
    if (status === 'draft') return { primary: confirm, secondary: [present] };

    // Sent — confirm the order.
    if (status === 'sent') {
      return { primary: confirm, secondary: [present, overview] };
    }
```

and the final fall-through (expired):

```tsx
    // Expired — the estimate lapsed but was never confirmed, so the
    // presentation view still applies (Save/Send/Download are in the top
    // bar; send after updating the expiry date).
    return { primary: null, secondary: [present, overview] };
```

Leave `awaiting_payment`, `in_progress`, `ready` and `installed` untouched — those orders are confirmed.

- [ ] **Step 4: Update the file's header JSDoc**

The module header (around lines 23–29) lists the per-stage action set and says the Overview is offered "at every post-draft stage". Extend it so the new action is documented in the same place:

```
 * Every post-draft stage additionally offers an Order Overview action
 * that opens `/orders/:id/overview` in a NEW TAB — a read-only,
 * ...
 * Every UNCONFIRMED stage (draft, sent, expired) additionally offers a
 * Present to Customer action directly below Confirm, which saves and then
 * navigates to `/orders/:id/present` — the filterable, per-option view
 * shown to the customer in person.
```

Match the surrounding comment's wrapping and wording; do not restructure it.

- [ ] **Step 5: Typecheck and lint**

```bash
pnpm --filter web check && pnpm --filter web lint
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/orders/OrderDetail.tsx
git commit -m "feat(orders): Present to Customer action below Confirm

Offered on the unconfirmed stages (draft, sent, expired). Saves before
navigating, because the presentation page reads the server row."
```

---

### Task 8: Verification, browser check, and required documentation

**Files:**
- Modify: `knowledge/history/engine_features.md`
- Modify: `memory-bank/activeContext.md`, `memory-bank/progress.md`

- [ ] **Step 1: Full verification, both workspaces**

```bash
pnpm check
```
Expected: 0 errors in web and api.

```bash
pnpm --filter web test
```
Expected: PASS — 305 original + 5 breakdown + 11 optionBreakdown + 13 presentationFilters = 334 tests.

```bash
pnpm --filter api test
```
Expected: PASS — 340 original + 5 = 345 tests.

```bash
pnpm --filter web lint
```
Expected: 0 warnings, 0 errors.

If any pre-existing test needed editing to pass, stop and report — see Task 1 Step 4.

- [ ] **Step 2: Verify in the browser**

Start the dev server through the preview tooling (never `pnpm dev` in a shell), open an order with several blinds, and confirm:

1. A "Present to Customer" button sits directly below Confirm on a draft and on a sent order, and is absent once the order is confirmed.
2. Clicking it saves and lands on `/orders/:id/present`.
3. Adding `Control = <something>` narrows the table and **every** footer total changes with it.
4. Adding a second value for the same option type WIDENS the result (OR within a field).
5. Adding a different option type NARROWS it (AND across fields).
6. On any row, the option cells plus the adjustment visibly equal the line total.
7. The footer's overall total equals the sum of the visible line totals.
8. With no filters active, that overall total equals the order's subtotal.
9. An option that adds nothing prints its name with no `$0.00` under it.
10. The page body does not scroll sideways at a 768px tablet width — only the table does.

Capture a screenshot of the filtered table with its totals row.

- [ ] **Step 3: Append the feature to the permanent history**

Add a dated entry to `knowledge/history/engine_features.md` following the existing format (see the `2026-07-20 — Order Overview page` entry as the model). Cover: the new route and button and which stages show it; the `describeUnitCosts` refactor and WHY the material leg stays out of the reduction; the cell-fitting rule and why the adjustment column exists; the AND-across / OR-within filter rule; and the deliberate split between the filter-tracking overall total and the server-authoritative order strip. This is append-only history — do not edit older entries.

- [ ] **Step 4: Overwrite the current-state memory bank**

Per AI_GUIDELINES §5, these are snapshots and not changelogs — **overwrite** the relevant sections, do not add a new dated block on top.

In `memory-bank/activeContext.md`: update "Where things stand" for this branch and the new test counts, and add to "Active decisions / learnings not obvious from the code":

- `calculateUnitPrice` is now the sum of `describeUnitCosts()`; the material leg is deliberately kept out of the reduction and hardware legs are inserted in a fixed order, because float addition is not associative and the refactor had to be bit-identical, not merely equivalent.
- Option cells on the presentation page are FITTED to `round2(calcUnit × qty)` with material absorbing the correction — `line_total` is `round2(unit_price × qty) + addonsTotal`, so summing independently-rounded legs would show a phantom one- or two-cent adjustment on ordinary lines.

In `memory-bank/progress.md`: record the feature as working, and add to the open-work list that the presentation page has not been driven on a real device — consistent with the standing note about every other staff route.

- [ ] **Step 5: Commit**

```bash
git add knowledge/history/engine_features.md memory-bank/activeContext.md memory-bank/progress.md
git commit -m "docs: record the Order Presentation view in history and memory bank"
```

---

## Self-Review

**Spec coverage:**

| Spec § | Covered by |
|---|---|
| §3 entry point, statuses, save-first, same-tab | Task 7 |
| §4 route, page structure, hidden excluded | Task 6 |
| §5.0 columns, omitted-when-empty | Task 4 |
| §5.1 / §5.1.1 `describeUnitCosts`, fixed order, association | Task 1 |
| §5.2 snapshot columns → pricing inputs, absent vs zero | Task 2 |
| §5.3 cell values, no `$0`, fitting rule | Tasks 2 (money) + 4 (rendering) |
| §5.4 adjustment column | Tasks 2 (money) + 4 (rendering) |
| §6.1–6.4 filter model, facets, AND/OR, empty state | Tasks 3 (logic) + 5 (UI) + 6 (empty state) |
| §7.1 column totals | Task 4 |
| §7.2 other items, dropped on option filter | Task 6 |
| §7.3 overall total vs server order strip | Task 6 |
| §8 module split | Tasks 1–7 |
| §9 tests + verification | Tasks 1–3, 8 |
| §10 JSDoc, SPDX, history, memory bank | Global Constraints + Task 8 |

No gaps.

**Type consistency:** `describeUnitCosts` / `UnitCostBreakdown` (Task 1) are consumed under those names in Task 2. `describeLineBreakdown`, `OptionCell`, `LineBreakdown`, `OPTION_COLUMNS`, `OPTION_COLUMN_LABELS`, `OptionColumn` (Task 2) are consumed under those names in Task 4. `PresentationFilter`, `Facet`, `FilterField`, `FILTER_FIELD_LABELS`, `buildFacets`, `matchesFilters`, `hasOptionFilter` (Task 3) are consumed under those names in Tasks 5 and 6. `PresentationTable({ items })` and `PresentationFilterBar({ facets, filters, onChange })` match their call sites in Task 6.

**Assumptions verified while writing this plan**, so no task carries an open question: `Button` exposes `'ghost'` and `'sm'`; `orders.tax_rate` is `numeric(5,4)` holding a fraction; `node_modules` is absent from this worktree (hence Task 0); both twins' `base.ts` differ only in file-header prose; and the fitting rule in Task 2 was checked against a real case (W=101, H=205, $47.50/m², qty 4) where naive per-leg rounding misses `line_total` by two cents.
