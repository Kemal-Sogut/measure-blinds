# Material Usage & Per-m² Discount Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the consultant a live panel in the order editor showing billed material quantity per material with the rate charged, and turn a single `$/m²` give-back rate into the order's fixed discount.

**Architecture:** A new `describeMaterialUsage()` method on the blind-type class hierarchy reports how much material one blind is charged for, in the unit that type's rate is quoted in (`sqm`, or `running_m` for Curtains). A pure web-only aggregator groups those figures per material across an order's drafts. A collapsible React panel renders the table, takes a rate, and writes the resulting dollar figure into the existing fixed-discount state. No schema change, no new discount type, no change to any stored price.

**Tech Stack:** TypeScript, React 19, Vite, Tailwind v4, Vitest. pnpm monorepo: `apps/api` (Hono on Cloudflare Workers), `apps/web` (SPA).

**Spec:** `knowledge/specs/2026-08-21-material-usage-discount-design.md` — read it before Task 1.

## Global Constraints

- **Twin rule (AI_GUIDELINES §1).** `apps/api/src/lib/pricing.ts` + `blindTypes/*` and `apps/web/src/lib/pricing.ts` + `blindTypes/*` are twins. Every change to one side lands on the other, and both `pricing.test.ts` suites are updated together. The only permitted differences are the doc-comment sentences that name the opposite side.
- **`materialCost` is NOT modified.** Not its body, not its signature, not the order of its arithmetic. See spec §4.2. A task that changes it has failed.
- **SPDX header (AI_GUIDELINES §10).** Every new `.ts`/`.tsx` file starts with exactly:
  ```ts
  // SPDX-License-Identifier: GPL-3.0-only
  // Copyright (c) 2026 Blinds Nisa. All rights reserved.
  ```
- **JSDoc (AI_GUIDELINES §3).** Every exported module, component, hook, function, type and interface gets a `/** ... */` comment in English explaining purpose, behaviour, constraints and integration context — not a restatement of the name. Target 9/10 on the scoring table at the end of AI_GUIDELINES.md.
- **Scope isolation (AI_GUIDELINES §7).** Touch only the files listed in a task. `OrderDetail.tsx` is a standing ~3,170-line violation; do not opportunistically split it.
- **Strings, not numbers, in drafts.** Every numeric draft field is held as a raw string so a half-typed `"12."` does not fight the keyboard. The panel's rate inputs follow that rule.
- **Verification commands** (AI_GUIDELINES §9), from the repo root:
  ```bash
  pnpm --filter api check && pnpm --filter api test
  ```
  ```bash
  pnpm --filter web check && pnpm --filter web test && pnpm --filter web lint
  ```
  Target: 0 errors, 0 warnings. Pricing is touched, so BOTH suites run on every pricing task.

---

### Task 1: `describeMaterialUsage` on the server blind-type modules

**Files:**
- Modify: `apps/api/src/lib/blindTypes/base.ts` (add types + method after `applyHeightMinimum`, around line 324, BEFORE `materialCost`)
- Modify: `apps/api/src/lib/blindTypes/curtains.ts` (add override after `materialCost`, around line 121)
- Test: `apps/api/src/lib/pricing.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `export type MaterialUnit = 'sqm' | 'running_m'` from `apps/api/src/lib/blindTypes/base.ts`
  - `export interface MaterialUsage { unit: MaterialUnit; quantity: number; measured: number }` from the same file
  - `BaseBlindType.describeMaterialUsage(item: BlindPricingInputs): MaterialUsage` — public, overridden by `CurtainsBlindType`

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/lib/pricing.test.ts`. Note the api-side `BlindPricingInputs` has NO `quantity` field — that is web-only.

```ts
describe('describeMaterialUsage (server)', () => {
  /** A blind whose raw dimensions are BELOW both minimums, so billed and measured differ. */
  function small(): BlindPricingInputs {
    return {
      panels: [60],
      height_cm: 80,
      material_price_per_sqm: 50,
      hardware: {},
      attributes: {},
    };
  }

  it('reports billed square metres with the minimums applied', () => {
    // 60cm → 100cm, 80cm → 100cm, so 1.00 m² is billed on 0.48 m² measured.
    const usage = getBlindType('Roller').describeMaterialUsage(small());
    expect(usage.unit).toBe('sqm');
    expect(usage.quantity).toBeCloseTo(1, 10);
    expect(usage.measured).toBeCloseTo(0.48, 10);
  });

  it('reports billed and measured as equal once both minimums are cleared', () => {
    const usage = getBlindType('Roller').describeMaterialUsage({
      ...small(),
      panels: [140],
      height_cm: 200,
    });
    expect(usage.quantity).toBeCloseTo(2.8, 10);
    expect(usage.measured).toBeCloseTo(2.8, 10);
  });

  it('sums panel widths before applying the width minimum', () => {
    const usage = getBlindType('Roller').describeMaterialUsage({
      ...small(),
      panels: [70, 90],
      height_cm: 200,
    });
    expect(usage.quantity).toBeCloseTo(3.2, 10);
  });

  it('reports running metres for Curtains, not square metres', () => {
    // 3.0 m × 2.5 fullness + 1 panel × 0.5 m hem = 8.00 running metres.
    const usage = getBlindType('Curtains').describeMaterialUsage({
      panels: [300],
      height_cm: 200,
      material_price_per_sqm: 40,
      hardware: {},
      attributes: { pleat_multiplier: 2.5 },
    });
    expect(usage.unit).toBe('running_m');
    expect(usage.quantity).toBeCloseTo(8, 10);
  });

  it('leaves the Curtains hem allowance out of the fullness multiplication', () => {
    // Fullness 1 → 3.0 + 2 panels × 0.5 = 4.00, NOT (3.0 + 1.0) × 1.
    const usage = getBlindType('Curtains').describeMaterialUsage({
      panels: [150, 150],
      height_cm: 200,
      material_price_per_sqm: 40,
      hardware: {},
      attributes: { pleat_multiplier: 1 },
    });
    expect(usage.quantity).toBeCloseTo(4, 10);
  });

  it('applies the width minimum to Curtains but never the height minimum', () => {
    // 60cm → 100cm = 1.0 m running × 2 + 1 hem × 0.5 = 2.50; height is irrelevant.
    const usage = getBlindType('Curtains').describeMaterialUsage({
      panels: [60],
      height_cm: 80,
      material_price_per_sqm: 40,
      hardware: {},
      attributes: { pleat_multiplier: 2 },
    });
    expect(usage.quantity).toBeCloseTo(2.5, 10);
    expect(usage.measured).toBeCloseTo(1.7, 10);
  });
});

describe('describeMaterialUsage agrees with the material leg it reports on', () => {
  /**
   * The spec (§4.2) deliberately does NOT derive `materialCost` from
   * `describeMaterialUsage`, because reassociating the multiplication
   * could move a stored cent. This test is the entire mitigation for
   * that decision: it is what turns a silent drift between the two
   * expressions into a failure.
   */
  const CASES: { type: string; item: BlindPricingInputs }[] = [
    { type: 'Roller', item: { panels: [60], height_cm: 80, material_price_per_sqm: 45, hardware: {}, attributes: {} } },
    { type: 'Roller', item: { panels: [140], height_cm: 200, material_price_per_sqm: 50, hardware: {}, attributes: {} } },
    { type: 'Roller', item: { panels: [120], height_cm: 150, material_price_per_sqm: 33.33, hardware: {}, attributes: {} } },
    { type: 'Roller', item: { panels: [100], height_cm: 200, material_price_per_sqm: 19.99, hardware: {}, attributes: {} } },
    { type: 'Zebra', item: { panels: [70, 90], height_cm: 210, material_price_per_sqm: 62.5, hardware: {}, attributes: {} } },
    { type: 'Roman', item: { panels: [99.9], height_cm: 199, material_price_per_sqm: 41.1, hardware: {}, attributes: {} } },
    { type: 'Sunscreen/Solar', item: { panels: [250], height_cm: 260, material_price_per_sqm: 77, hardware: {}, attributes: {} } },
    { type: 'Honeycomb', item: { panels: [180], height_cm: 100, material_price_per_sqm: 55, hardware: {}, attributes: {} } },
    { type: 'Shutter', item: { panels: [200], height_cm: 200, material_price_per_sqm: 120, hardware: {}, attributes: {} } },
    { type: 'Vertical Sheer', item: { panels: [160], height_cm: 240, material_price_per_sqm: 48.75, hardware: {}, attributes: {} } },
    { type: 'Vertical Panel', item: { panels: [300], height_cm: 300, material_price_per_sqm: 30, hardware: {}, attributes: {} } },
    { type: 'Vertical Roller', item: { panels: [110], height_cm: 105, material_price_per_sqm: 66.6, hardware: {}, attributes: {} } },
    { type: 'Curtains', item: { panels: [300], height_cm: 200, material_price_per_sqm: 40, hardware: {}, attributes: { pleat_multiplier: 2.5 } } },
    { type: 'Curtains', item: { panels: [150, 150], height_cm: 200, material_price_per_sqm: 62, hardware: {}, attributes: { pleat_multiplier: 2 } } },
    { type: 'Curtains', item: { panels: [60], height_cm: 90, material_price_per_sqm: 39.95, hardware: {}, attributes: { pleat_multiplier: 3 } } },
    { type: 'Curtains', item: { panels: [420], height_cm: 280, material_price_per_sqm: 88.5, hardware: {}, attributes: {} } },
  ];

  it.each(CASES)('$type: material leg equals usage x rate', ({ type, item }) => {
    const blindType = getBlindType(type);
    const usage = blindType.describeMaterialUsage(item);
    const leg = blindType.describeUnitCosts(item).material;
    expect(usage.quantity * item.material_price_per_sqm).toBeCloseTo(leg, 6);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter api test -- pricing
```

Expected: FAIL — `describeMaterialUsage is not a function`.

- [ ] **Step 3: Add the types and the base method**

In `apps/api/src/lib/blindTypes/base.ts`, place these two declarations next to the existing exported types near the top of the file (beside `PriceBasis` / `CatalogSlot`):

```ts
/**
 * The unit a blind type's `material_price_per_sqm` rate is actually
 * quoted in. The column name is a historical simplification: every type
 * except Curtains genuinely charges by the square metre, while Curtains
 * charges by the running metre of finished width. Reporting surfaces MUST
 * carry this alongside any quantity, or a running metre and a square
 * metre would silently pool into one meaningless number.
 */
export type MaterialUnit = 'sqm' | 'running_m';

/**
 * How much material ONE blind is charged for, in the unit its rate is
 * quoted in. Produced by {@link BaseBlindType.describeMaterialUsage} for
 * reporting — the internal Material usage panel — and never for pricing.
 *
 * `quantity` is BILLED: the minimum rules are applied, so it matches what
 * the material leg actually charged. `measured` is the same figure with
 * the minimums skipped, and exists only so a reader can see how much of
 * the billed area is minimum inflation rather than fabric the customer
 * had. Neither is multiplied by the line's `quantity` — that is the
 * caller's job, because this class never sees how many identical blinds
 * a line carries.
 */
export interface MaterialUsage {
  unit: MaterialUnit;
  quantity: number;
  measured: number;
}
```

Then add the method immediately AFTER `applyHeightMinimum` and BEFORE `materialCost`:

```ts
  /**
   * How much material this blind consumes, for the internal Material
   * usage report. Reports on the same minimised dimensions `materialCost`
   * charges, so the two describe one quote rather than two.
   *
   * NOT the source of {@link BaseBlindType.materialCost}, deliberately.
   * `(w * h * rate) / 10000` and `((w * h) / 10000) * rate` are not
   * bit-identical in IEEE-754, and rewriting the leg to consume this
   * could move a stored cent on a half-cent boundary — the same hazard
   * `HARDWARE_LEG_ORDER` exists to contain. The two are instead pinned
   * together by the "material leg equals usage x rate" case table in both
   * `pricing.test.ts` suites; that test is what makes this safe, so it
   * must not be deleted.
   *
   * A type that overrides `materialCost` MUST override this too, or it
   * will report the base area formula against its own price and that
   * test will fail. Curtains is the only such type today.
   */
  describeMaterialUsage(item: BlindPricingInputs): MaterialUsage {
    const rawWidthCm = item.panels.reduce((a, b) => a + b, 0);
    const widthCm = this.applyWidthMinimum(rawWidthCm);
    const heightCm = this.applyHeightMinimum(item.height_cm);
    return {
      unit: 'sqm',
      quantity: (widthCm * heightCm) / 10000,
      measured: (rawWidthCm * item.height_cm) / 10000,
    };
  }
```

- [ ] **Step 4: Add the Curtains override**

In `apps/api/src/lib/blindTypes/curtains.ts`, add immediately after `materialCost` (still inside the class). `numericOr` and `HEM_ALLOWANCE_M` are module-private and already in scope; import `MaterialUsage` from `./base` alongside the existing type imports.

```ts
  /**
   * Curtains buy fabric by the running metre of finished width, so this
   * reports metres rather than square metres and ignores height exactly
   * as `materialCost` does — the drop is measured and printed on the
   * manufacturer copy, but it does not price.
   *
   * The hem allowance is added AFTER the fullness multiplication, matching
   * the leg above: a hem does not get wider because the curtain is
   * gathered more. `measured` skips only the width minimum, which is the
   * only minimum this type applies.
   */
  describeMaterialUsage(item: BlindPricingInputs): MaterialUsage {
    const rawWidthCm = item.panels.reduce((a, b) => a + b, 0);
    const widthCm = this.applyWidthMinimum(rawWidthCm);
    const pleat = numericOr(item.attributes.pleat_multiplier, 1);
    const hem = item.panels.length * HEM_ALLOWANCE_M;
    return {
      unit: 'running_m',
      quantity: (widthCm / 100) * pleat + hem,
      measured: (rawWidthCm / 100) * pleat + hem,
    };
  }
```

- [ ] **Step 5: Re-export the new types from the barrel**

In `apps/api/src/lib/blindTypes/index.ts`, extend the existing base export:

```ts
export {
  BaseBlindType,
  type BlindPricingInputs,
  type MaterialUnit,
  type MaterialUsage,
} from './base';
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
pnpm --filter api check && pnpm --filter api test
```

Expected: PASS, 0 type errors. Every pre-existing pricing case must still pass untouched — that is the proof `materialCost` was not disturbed.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/blindTypes/base.ts apps/api/src/lib/blindTypes/curtains.ts apps/api/src/lib/blindTypes/index.ts apps/api/src/lib/pricing.test.ts
git commit -m "feat(pricing): report billed material usage per blind type (server)"
```

---

### Task 2: Mirror `describeMaterialUsage` into the web twins

**Files:**
- Modify: `apps/web/src/lib/blindTypes/base.ts`
- Modify: `apps/web/src/lib/blindTypes/curtains.ts`
- Modify: `apps/web/src/lib/blindTypes/index.ts`
- Test: `apps/web/src/lib/pricing.test.ts`

**Interfaces:**
- Consumes: Task 1's `MaterialUnit`, `MaterialUsage`, `describeMaterialUsage` — reproduced verbatim on the web side.
- Produces: the identical three symbols from `apps/web/src/lib/blindTypes/base.ts`, re-exported by `apps/web/src/lib/blindTypes/index.ts`. Task 4 imports them from the barrel.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/lib/pricing.test.ts`. The web suite's `BlindInputs` carries `quantity` (the api twin's does not); the existing `blind()` helper at the top of that file already supplies it, so reuse it.

```ts
describe('describeMaterialUsage', () => {
  it('reports billed square metres with the minimums applied', () => {
    // 60cm → 100cm, 80cm → 100cm, so 1.00 m² is billed on 0.48 m² measured.
    const usage = getBlindType('Roller').describeMaterialUsage(
      blind({ panels: [60], height_cm: 80 })
    );
    expect(usage.unit).toBe('sqm');
    expect(usage.quantity).toBeCloseTo(1, 10);
    expect(usage.measured).toBeCloseTo(0.48, 10);
  });

  it('reports billed and measured as equal once both minimums are cleared', () => {
    const usage = getBlindType('Roller').describeMaterialUsage(blind());
    expect(usage.quantity).toBeCloseTo(2.8, 10);
    expect(usage.measured).toBeCloseTo(2.8, 10);
  });

  it('sums panel widths before applying the width minimum', () => {
    const usage = getBlindType('Roller').describeMaterialUsage(blind({ panels: [70, 90] }));
    expect(usage.quantity).toBeCloseTo(3.2, 10);
  });

  it('ignores the line quantity — that is the caller’s multiplier', () => {
    // The panel multiplies by quantity itself; baking it in here would
    // double-count for every consumer that already does.
    expect(getBlindType('Roller').describeMaterialUsage(blind({ quantity: 5 })).quantity)
      .toBeCloseTo(2.8, 10);
  });

  it('reports running metres for Curtains, not square metres', () => {
    // 3.0 m × 2.5 fullness + 1 panel × 0.5 m hem = 8.00 running metres.
    const usage = getBlindType('Curtains').describeMaterialUsage(
      blind({ panels: [300], material_price_per_sqm: 40, attributes: { pleat_multiplier: 2.5 } })
    );
    expect(usage.unit).toBe('running_m');
    expect(usage.quantity).toBeCloseTo(8, 10);
  });

  it('leaves the Curtains hem allowance out of the fullness multiplication', () => {
    // Fullness 1 → 3.0 + 2 panels × 0.5 = 4.00, NOT (3.0 + 1.0) × 1.
    const usage = getBlindType('Curtains').describeMaterialUsage(
      blind({ panels: [150, 150], attributes: { pleat_multiplier: 1 } })
    );
    expect(usage.quantity).toBeCloseTo(4, 10);
  });

  it('applies the width minimum to Curtains but never the height minimum', () => {
    // 60cm → 100cm = 1.0 m running × 2 + 1 hem × 0.5 = 2.50; height is irrelevant.
    const usage = getBlindType('Curtains').describeMaterialUsage(
      blind({ panels: [60], height_cm: 80, attributes: { pleat_multiplier: 2 } })
    );
    expect(usage.quantity).toBeCloseTo(2.5, 10);
    expect(usage.measured).toBeCloseTo(1.7, 10);
  });
});

describe('describeMaterialUsage agrees with the material leg it reports on', () => {
  /**
   * The web half of the spec §4.2 mitigation. `materialCost` is
   * deliberately not derived from `describeMaterialUsage`, so this case
   * table is what turns a drift between the two into a failure. It must
   * hold the SAME cases as the api twin.
   */
  const CASES: { type: string; item: BlindInputs }[] = [
    { type: 'Roller', item: blind({ panels: [60], height_cm: 80, material_price_per_sqm: 45 }) },
    { type: 'Roller', item: blind({ panels: [140], height_cm: 200, material_price_per_sqm: 50 }) },
    { type: 'Roller', item: blind({ panels: [120], height_cm: 150, material_price_per_sqm: 33.33 }) },
    { type: 'Roller', item: blind({ panels: [100], height_cm: 200, material_price_per_sqm: 19.99 }) },
    { type: 'Zebra', item: blind({ panels: [70, 90], height_cm: 210, material_price_per_sqm: 62.5 }) },
    { type: 'Roman', item: blind({ panels: [99.9], height_cm: 199, material_price_per_sqm: 41.1 }) },
    { type: 'Sunscreen/Solar', item: blind({ panels: [250], height_cm: 260, material_price_per_sqm: 77 }) },
    { type: 'Honeycomb', item: blind({ panels: [180], height_cm: 100, material_price_per_sqm: 55 }) },
    { type: 'Shutter', item: blind({ panels: [200], height_cm: 200, material_price_per_sqm: 120 }) },
    { type: 'Vertical Sheer', item: blind({ panels: [160], height_cm: 240, material_price_per_sqm: 48.75 }) },
    { type: 'Vertical Panel', item: blind({ panels: [300], height_cm: 300, material_price_per_sqm: 30 }) },
    { type: 'Vertical Roller', item: blind({ panels: [110], height_cm: 105, material_price_per_sqm: 66.6 }) },
    { type: 'Curtains', item: blind({ panels: [300], height_cm: 200, material_price_per_sqm: 40, attributes: { pleat_multiplier: 2.5 } }) },
    { type: 'Curtains', item: blind({ panels: [150, 150], height_cm: 200, material_price_per_sqm: 62, attributes: { pleat_multiplier: 2 } }) },
    { type: 'Curtains', item: blind({ panels: [60], height_cm: 90, material_price_per_sqm: 39.95, attributes: { pleat_multiplier: 3 } }) },
    { type: 'Curtains', item: blind({ panels: [420], height_cm: 280, material_price_per_sqm: 88.5 }) },
  ];

  it.each(CASES)('$type: material leg equals usage x rate', ({ type, item }) => {
    const blindType = getBlindType(type);
    const usage = blindType.describeMaterialUsage(item);
    const leg = blindType.describeUnitCosts(item).material;
    expect(usage.quantity * item.material_price_per_sqm).toBeCloseTo(leg, 6);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter web test -- pricing
```

Expected: FAIL — `describeMaterialUsage is not a function`.

- [ ] **Step 3: Copy the implementation across**

Copy the code from Task 1 Steps 3, 4 and 5 into the web files — `apps/web/src/lib/blindTypes/base.ts`, `apps/web/src/lib/blindTypes/curtains.ts`, `apps/web/src/lib/blindTypes/index.ts` — with the code **byte-identical**.

Copy it out of the api files rather than retyping it from this plan. The twin rule
makes an exact copy the goal, so transcription is the only real risk here, and Step 4's
`diff` is the gate that catches it.

The web barrel's existing base export line becomes:

```ts
export {
  BaseBlindType,
  type BlindPricingInputs,
  type MaterialUnit,
  type MaterialUsage,
} from './base';
```

- [ ] **Step 4: Verify the twins differ only in their doc prose**

```bash
diff apps/api/src/lib/blindTypes/base.ts apps/web/src/lib/blindTypes/base.ts
```

Expected: only the pre-existing hunks at lines 8, 16–17 and 56–58 (the sentences naming the opposite side). Any hunk inside `describeMaterialUsage`, `MaterialUsage` or `MaterialUnit` is a mistake — fix it before committing.

```bash
diff apps/api/src/lib/blindTypes/curtains.ts apps/web/src/lib/blindTypes/curtains.ts
```

Expected: only the pre-existing hunk at line 40.

- [ ] **Step 5: Run both suites**

```bash
pnpm --filter web check && pnpm --filter web test && pnpm --filter web lint
```

```bash
pnpm --filter api check && pnpm --filter api test
```

Expected: PASS on both, 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/blindTypes/base.ts apps/web/src/lib/blindTypes/curtains.ts apps/web/src/lib/blindTypes/index.ts apps/web/src/lib/pricing.test.ts
git commit -m "feat(pricing): mirror billed material usage into the web preview twins"
```

---

### Task 3: Extract `blindDraftInputs` from `blindDraftPrice`

**Files:**
- Modify: `apps/web/src/pages/orders/lineItemDrafts.ts:601-664`
- Test: `apps/web/src/pages/orders/lineItemDrafts.test.ts` (unchanged — it is the regression proof)

**Interfaces:**
- Consumes: `BlindInputs` from `apps/web/src/lib/pricing.ts`.
- Produces: `export function blindDraftInputs(draft: BlindDraft, catalogs: Catalogs): BlindInputs | null` from `apps/web/src/pages/orders/lineItemDrafts.ts`. Task 4 calls it.

This is a pure extraction: `blindDraftPrice` keeps its exact behaviour, and every existing test in `lineItemDrafts.test.ts` must stay green without modification. That is the whole verification.

- [ ] **Step 1: Move the body into the new function**

Replace `blindDraftPrice` (currently `lineItemDrafts.ts:601`) with the two functions below. The body is moved verbatim — the same guards in the same order, the same comments — and `blindDraftPrice` becomes a caller. `qty` is read a second time in `blindDraftPrice` because `adjustedDraftPrice` needs it and `BlindInputs.quantity` already carries it.

```ts
/**
 * Resolves a blind draft to the priced inputs its type's module expects,
 * or null when the draft is not yet complete enough to price.
 *
 * Split out of {@link blindDraftPrice} so the Material usage report can
 * ask a draft the same question the price preview asks — what does this
 * blind resolve to — without a second, looser copy of the completeness
 * gating. A row the editor refuses to price must not appear in the usage
 * report with a confident area figure, and sharing this function is what
 * guarantees that.
 *
 * Which hardware slots are REQUIRED comes from `slotsForType`, the same
 * scoping the form renders from and the Worker validates against: a slot
 * the selected type does not use contributes nothing rather than
 * blocking, because Curtains has neither a cassette nor a bottom rail
 * scoped to it and would otherwise never resolve.
 */
export function blindDraftInputs(draft: BlindDraft, catalogs: Catalogs): BlindInputs | null {
  const blindType = getBlindType(draft.blinds_type);
  const uses = slotsForType(catalogs, draft.blinds_type);
  const panels = draft.panels.map(parsePositive);
  const height = parsePositive(draft.height_cm);
  const qty = parsePositive(draft.quantity);
  const material = catalogs.materials.find((m) => m.id === draft.material_id);
  const control = catalogs.controls.find((x) => x.id === draft.control_id);
  const cassette = catalogs.cassettes.find((x) => x.id === draft.cassette_id);
  const bottomRail = catalogs.bottomRails.find((x) => x.id === draft.bottom_rail_id);
  const installation = catalogs.installationOptions.find((x) => x.id === draft.installation_id);
  if (panels.some((p) => p === null) || panels.length === 0) return null;
  if (!height || !qty || !material) return null;
  if (uses.has('cassette') && !cassette) return null;
  if (uses.has('bottom_rail') && !bottomRail) return null;
  if (uses.has('control') && !control) return null;
  if (uses.has('installation') && !installation) return null;

  // The type's own inputs must parse too, or the preview would show a
  // price the server is about to reject.
  const attributes = parseDraftAttributes(draft);
  if (attributes === null) return null;

  // The charges this blind carries, each on the basis its own catalog row
  // declares. A slot with no chosen option is ABSENT rather than zeroed —
  // exactly as the Worker builds it, so the preview and the save agree.
  //
  // Gated on `uses` as well as on the id, because a draft keeps whatever
  // id the PREVIOUS blind type left behind. The Worker rejects an id for a
  // slot the type does not use, so a preview that charged one would quote
  // a price the save refuses.
  const hardware: Partial<Record<CatalogSlot, HardwareCharge>> = {};
  if (uses.has('cassette') && cassette) {
    hardware.cassette = { price: Number(cassette.price), basis: cassette.price_basis };
  }
  if (uses.has('bottom_rail') && bottomRail) {
    hardware.bottom_rail = { price: Number(bottomRail.price), basis: bottomRail.price_basis };
  }
  if (uses.has('control') && control) {
    hardware.control = { price: Number(control.price), basis: control.price_basis };
  }
  if (uses.has('installation') && installation) {
    hardware.installation = { price: Number(installation.price), basis: installation.price_basis };
  }

  // Mirrors the Worker: ids in, snapshot name/value out. A chosen row
  // that is not in the cache throws, which here means "not ready yet".
  let resolved: BlindAttributes;
  try {
    resolved = blindType.resolveCatalogRefs(attributes, catalogResolver(catalogs));
  } catch {
    return null;
  }

  return {
    panels: panels as number[],
    height_cm: height,
    material_price_per_sqm: Number(material.price_per_sqm),
    hardware,
    quantity: qty,
    attributes: resolved,
  };
}

/**
 * Live price preview for a blind draft. Returns null until every field
 * the SELECTED TYPE requires is filled — see {@link blindDraftInputs},
 * which owns that completeness rule and the input assembly. This function
 * adds only the type dispatch and the override/add-on adjustment, so the
 * preview and the Material usage report can never disagree about which
 * drafts are ready.
 */
export function blindDraftPrice(draft: BlindDraft, catalogs: Catalogs): DraftPrice | null {
  const inputs = blindDraftInputs(draft, catalogs);
  if (!inputs) return null;

  // Dispatch to the selected blind type's module (default fallback).
  const base = calculateBlindUnitPriceForType(draft.blinds_type, inputs);
  return adjustedDraftPrice(base, inputs.quantity, draft, true);
}
```

- [ ] **Step 2: Fix the import**

`lineItemDrafts.ts:25` currently imports only the price function. Extend it so `BlindInputs` is available as the return type:

```ts
import { calculateBlindUnitPriceForType, type BlindInputs } from '../../lib/pricing';
```

- [ ] **Step 3: Run the existing suite unchanged**

```bash
pnpm --filter web check && pnpm --filter web test -- lineItemDrafts
```

Expected: PASS with **no test file edits**. If a test needed changing, the extraction was not behaviour-preserving — revert and redo it. Pay particular attention to the cases around `parseDraftAttributes` returning null and the `resolveCatalogRefs` throw path; both must still yield `null` from `blindDraftPrice`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/orders/lineItemDrafts.ts
git commit -m "refactor(orders): extract blindDraftInputs from blindDraftPrice"
```

---

### Task 4: The `materialUsage` aggregator

**Files:**
- Create: `apps/web/src/pages/orders/materialUsage.ts`
- Test: `apps/web/src/pages/orders/materialUsage.test.ts`

**Interfaces:**
- Consumes: `blindDraftInputs`, `Catalogs`, `ItemDraft`, `BlindDraft` from `./lineItemDrafts`; `getBlindType`, `MaterialUnit` from `../../lib/blindTypes`.
- Produces, all from `apps/web/src/pages/orders/materialUsage.ts`:
  - `export interface MaterialUsageRow { materialId: string; materialName: string; unit: MaterialUnit; quantity: number; measuredQuantity: number; rate: number; amount: number }`
  - `export interface MaterialUsageTotal { quantity: number; measured: number; amount: number }`
  - `export interface MaterialUsageSummary { rows: MaterialUsageRow[]; totals: Partial<Record<MaterialUnit, MaterialUsageTotal>>; excludedCount: number }`
  - `export function summarizeMaterialUsage(items: ItemDraft[], catalogs: Catalogs): MaterialUsageSummary`
  - `export function giveBackAmount(summary: MaterialUsageSummary, rates: Partial<Record<MaterialUnit, number>>): number`
  - Task 5 consumes all of these.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/pages/orders/materialUsage.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Aggregation tests for the internal Material usage report.
 *
 * The report exists so a consultant can decide a discount from fabric
 * quantity rather than by guessing a percentage, which makes two
 * properties load-bearing: it must count exactly the lines the order
 * total counts, and its money column must be the FABRIC leg rather than
 * the charged price. Both are asserted below.
 */

import { describe, it, expect } from 'vitest';
import { summarizeMaterialUsage, giveBackAmount } from './materialUsage';
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
  it('reports one row per material with the billed quantity and the fabric leg', () => {
    const summary = summarizeMaterialUsage([blind()], catalogs());
    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0]).toMatchObject({
      materialId: 'm1',
      materialName: 'Blackout Ivory',
      unit: 'sqm',
      rate: 50,
    });
    expect(summary.rows[0].quantity).toBeCloseTo(2.8, 10);
    expect(summary.rows[0].amount).toBeCloseTo(140, 10);
  });

  it('collapses two blinds of the same material into one row', () => {
    const summary = summarizeMaterialUsage(
      [blind({ key: 'a' }), blind({ key: 'b', panels: ['100'], height_cm: '200' })],
      catalogs()
    );
    expect(summary.rows).toHaveLength(1);
    // 2.80 + 2.00 m²
    expect(summary.rows[0].quantity).toBeCloseTo(4.8, 10);
    expect(summary.rows[0].amount).toBeCloseTo(240, 10);
  });

  it('multiplies billed quantity and fabric revenue by the line quantity', () => {
    const summary = summarizeMaterialUsage([blind({ quantity: '3' })], catalogs());
    expect(summary.rows[0].quantity).toBeCloseTo(8.4, 10);
    expect(summary.rows[0].amount).toBeCloseTo(420, 10);
  });

  it('excludes a hidden line entirely, matching the order total', () => {
    // A hidden line is excluded from the total and every document, so
    // giving back fabric money against it would discount thin air.
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

  it('ignores a manual price override — an override is not a fabric-rate change', () => {
    const summary = summarizeMaterialUsage([blind({ unit_price_override: '25' })], catalogs());
    expect(summary.rows[0].quantity).toBeCloseTo(2.8, 10);
    expect(summary.rows[0].amount).toBeCloseTo(140, 10);
  });

  it('ignores add-ons, which are not fabric', () => {
    const summary = summarizeMaterialUsage(
      [blind({ addons: [{ key: 'a1', label: 'Rush', price: '75' }] })],
      catalogs()
    );
    expect(summary.rows[0].amount).toBeCloseTo(140, 10);
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
    expect(summary.totals.sqm?.quantity).toBeCloseTo(2.8, 10);
    expect(summary.totals.running_m?.quantity).toBeCloseTo(3.5, 10);
  });

  it('omits a unit from the totals when no line uses it', () => {
    const summary = summarizeMaterialUsage([blind()], catalogs());
    expect(summary.totals.sqm).toBeDefined();
    expect(summary.totals.running_m).toBeUndefined();
  });

  it('reports measured below billed for an under-minimum blind', () => {
    // 60 × 80 cm bills 1.00 m² and measures 0.48 m².
    const summary = summarizeMaterialUsage(
      [blind({ panels: ['60'], height_cm: '80' })],
      catalogs()
    );
    expect(summary.rows[0].quantity).toBeCloseTo(1, 10);
    expect(summary.rows[0].measuredQuantity).toBeCloseTo(0.48, 10);
  });

  it('reports measured equal to billed once the minimums are cleared', () => {
    const summary = summarizeMaterialUsage([blind()], catalogs());
    expect(summary.rows[0].measuredQuantity).toBeCloseTo(2.8, 10);
  });

  it('orders rows by descending fabric spend', () => {
    // m2 is cheaper per m² but far larger, so it must lead.
    const items: ItemDraft[] = [
      blind({ key: 'a', material_id: 'm1' }),
      blind({ key: 'b', material_id: 'm2', panels: ['300'], height_cm: '300' }),
    ];
    const summary = summarizeMaterialUsage(items, catalogs());
    expect(summary.rows.map((r) => r.materialId)).toEqual(['m2', 'm1']);
  });

  it('returns an empty summary for an order with no lines', () => {
    const summary = summarizeMaterialUsage([], catalogs());
    expect(summary.rows).toEqual([]);
    expect(summary.totals).toEqual({});
    expect(summary.excludedCount).toBe(0);
  });
});

describe('giveBackAmount', () => {
  it('multiplies each unit total by its own rate', () => {
    const summary = summarizeMaterialUsage(
      [blind(), blind({ key: 'c', blinds_type: 'Curtains', panels: ['300'], cassette_id: '', bottom_rail_id: '' })],
      catalogs()
    );
    // 2.80 m² × $5 = 14.00, 3.50 m × $2 = 7.00
    expect(giveBackAmount(summary, { sqm: 5, running_m: 2 })).toBe(21);
  });

  it('treats a missing rate as zero rather than discounting on a blank field', () => {
    const summary = summarizeMaterialUsage([blind()], catalogs());
    expect(giveBackAmount(summary, {})).toBe(0);
  });

  it('rounds to whole cents', () => {
    const summary = summarizeMaterialUsage([blind()], catalogs());
    // 2.80 m² × $3.333 = 9.3324 → 9.33
    expect(giveBackAmount(summary, { sqm: 3.333 })).toBe(9.33);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter web test -- materialUsage
```

Expected: FAIL — cannot resolve `./materialUsage`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/pages/orders/materialUsage.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Material usage aggregation for the internal per-m² discount report — no JSX.
 *
 * Fabric is the flexible leg of a quote: cassettes, rails, controls and
 * installation run on tighter margins, so a discount is reasoned about as
 * "give back $X per square metre of fabric". This module answers the two
 * questions that reasoning needs — how much of each material does this
 * order carry, and at what rate — by asking each line's blind-type module
 * rather than re-deriving any area formula. `describeMaterialUsage` is the
 * single source of a billed quantity; nothing here recomputes one.
 *
 * Everything reported is BILLED quantity: the width and height minimums
 * are applied, because that is what the material leg charged. `measured`
 * travels alongside it so the panel can show how much of the billed area
 * is minimum inflation rather than fabric the customer had.
 *
 * Deliberately React-free and separate from `MaterialUsagePanel.tsx`, for
 * the same Fast Refresh reason `lineItemDrafts.ts` is: a module exporting
 * both components and plain functions cannot be hot-swapped safely.
 */

import { getBlindType, type MaterialUnit } from '../../lib/blindTypes';
import { blindDraftInputs, type Catalogs, type ItemDraft } from './lineItemDrafts';

/** Rounds to whole cents, as every money helper in the app does. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * One material's contribution across an order, in the unit that
 * material's rate is quoted in for the types that used it.
 *
 * `amount` is the FABRIC leg only — not the charged price. A consultant's
 * manual override or an add-on is not a fabric-rate change, so neither
 * may distort the effective $/m² this row reports.
 */
export interface MaterialUsageRow {
  materialId: string;
  /** Catalog name at the time of viewing; the panel's row label. */
  materialName: string;
  unit: MaterialUnit;
  /** Billed quantity across every contributing line, line quantity included. */
  quantity: number;
  /** The same figure with the minimum rules skipped. Reporting only. */
  measuredQuantity: number;
  /** The material's catalog rate — $/m² or $/running-m, per `unit`. */
  rate: number;
  /** Fabric-leg revenue across those lines. */
  amount: number;
}

/** Order-wide billed figures for one rate unit. */
export interface MaterialUsageTotal {
  quantity: number;
  measured: number;
  amount: number;
}

/**
 * What the Material usage panel renders. `totals` carries a key only for
 * a unit some line actually used, so the panel can decide whether to show
 * a running-metre rate input at all.
 */
export interface MaterialUsageSummary {
  /** Descending by `amount` — the biggest fabric spend reads first. */
  rows: MaterialUsageRow[];
  totals: Partial<Record<MaterialUnit, MaterialUsageTotal>>;
  /** Visible lines carrying no material: preset, custom, or incomplete. */
  excludedCount: number;
}

/**
 * Summarises the material an order's drafts consume, grouped per material
 * and rate unit.
 *
 * Three exclusion rules, each mirroring behaviour that already exists:
 *
 * 1. HIDDEN lines are dropped first, matching `calculateTotals` and the
 *    Worker's own filter — a line excluded from the total must not attract
 *    a give-back. Being dropped first is also why a hidden incomplete line
 *    is not reported as incomplete.
 * 2. PRESET and CUSTOM lines have no material and are counted into
 *    `excludedCount` so the panel can say so out loud.
 * 3. INCOMPLETE blind drafts — anything `blindDraftInputs` refuses — are
 *    counted the same way. A row the editor will not price must not appear
 *    here with a confident area.
 *
 * Grouping is by material AND unit. Materials are scoped to blind types
 * through `material_blind_types`, and that join permits one material
 * linked to both Curtains and a m²-priced type; without the unit in the
 * key, running metres and square metres would pool into one meaningless
 * number.
 */
export function summarizeMaterialUsage(
  items: ItemDraft[],
  catalogs: Catalogs
): MaterialUsageSummary {
  const groups = new Map<string, MaterialUsageRow>();
  let excludedCount = 0;

  for (const item of items) {
    if (item.hidden) continue;
    if (item.item_type !== 'blind') {
      excludedCount += 1;
      continue;
    }
    const inputs = blindDraftInputs(item, catalogs);
    if (!inputs) {
      excludedCount += 1;
      continue;
    }
    const material = catalogs.materials.find((m) => m.id === item.material_id);
    if (!material) {
      excludedCount += 1;
      continue;
    }

    const blindType = getBlindType(item.blinds_type);
    const usage = blindType.describeMaterialUsage(inputs);
    const rate = inputs.material_price_per_sqm;
    const qty = inputs.quantity;
    const key = `${material.id}::${usage.unit}`;

    const row = groups.get(key) ?? {
      materialId: material.id,
      materialName: material.name,
      unit: usage.unit,
      quantity: 0,
      measuredQuantity: 0,
      rate,
      amount: 0,
    };
    row.quantity += usage.quantity * qty;
    row.measuredQuantity += usage.measured * qty;
    // The fabric leg, taken from the type's own breakdown rather than
    // multiplied out here, so a type that prices fabric unusually is
    // reported the way it actually charges.
    row.amount += blindType.describeUnitCosts(inputs).material * qty;
    groups.set(key, row);
  }

  const rows = [...groups.values()].sort((a, b) => b.amount - a.amount);

  const totals: Partial<Record<MaterialUnit, MaterialUsageTotal>> = {};
  for (const row of rows) {
    const running = totals[row.unit] ?? { quantity: 0, measured: 0, amount: 0 };
    running.quantity += row.quantity;
    running.measured += row.measuredQuantity;
    running.amount += row.amount;
    totals[row.unit] = running;
  }

  return { rows, totals, excludedCount };
}

/**
 * The dollar give-back a set of per-unit rates comes to across a summary.
 *
 * A unit with no rate entered contributes nothing rather than falling
 * back to another unit's figure — a blank field must never quietly
 * discount an order. The result is rounded to whole cents because it goes
 * straight into the fixed-discount field, which is money.
 */
export function giveBackAmount(
  summary: MaterialUsageSummary,
  rates: Partial<Record<MaterialUnit, number>>
): number {
  let total = 0;
  for (const [unit, figures] of Object.entries(summary.totals)) {
    // `Object.entries` over a Partial<Record> types the value as possibly
    // undefined even though a present key always carries one.
    if (!figures) continue;
    const rate = rates[unit as MaterialUnit];
    if (!rate || !Number.isFinite(rate) || rate <= 0) continue;
    total += figures.quantity * rate;
  }
  return round2(total);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter web check && pnpm --filter web test -- materialUsage && pnpm --filter web lint
```

Expected: PASS, 0 warnings.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/orders/materialUsage.ts apps/web/src/pages/orders/materialUsage.test.ts
git commit -m "feat(orders): aggregate billed material usage per material"
```

---

### Task 5: The `MaterialUsagePanel` component

**Files:**
- Create: `apps/web/src/pages/orders/MaterialUsagePanel.tsx`

**Interfaces:**
- Consumes: `summarizeMaterialUsage`, `giveBackAmount`, `MaterialUsageSummary` from `./materialUsage`; `Catalogs`, `ItemDraft` from `./lineItemDrafts`; `MaterialUnit` from `../../lib/blindTypes`.
- Produces: `export function MaterialUsagePanel(props: MaterialUsagePanelProps)` and `export interface MaterialUsagePanelProps { items: ItemDraft[]; catalogs: Catalogs; onApplyDiscount: (amount: number) => void }`. Task 6 renders it.

No test file: this is presentational, and every figure it shows is already pinned by Task 4's suite. Verification is Task 6's browser pass.

- [ ] **Step 1: Write the component**

Create `apps/web/src/pages/orders/MaterialUsagePanel.tsx`:

```tsx
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Internal Material usage panel for the order editor — never shown to a
 * customer, never printed, and absent from the PDF and the public view.
 *
 * Answers the question a discount is actually decided on: how many square
 * metres (or running metres, for Curtains) of each material is this order,
 * at what rate, and what does giving back $X per metre come to. The
 * resulting figure is written into the order's existing FIXED discount —
 * there is no stored per-m² discount type, so the rate itself is
 * scratchpad state that does not survive a reload. The panel says so on
 * screen rather than letting anyone assume otherwise.
 *
 * Every figure comes from `summarizeMaterialUsage`; this component does no
 * arithmetic beyond formatting and the give-back multiplication it
 * delegates to `giveBackAmount`.
 */

import { useMemo, useState } from 'react';
import type { MaterialUnit } from '../../lib/blindTypes';
import type { Catalogs, ItemDraft } from './lineItemDrafts';
import { giveBackAmount, summarizeMaterialUsage } from './materialUsage';

/** Short label for a rate unit, used in headers, totals and inputs. */
const UNIT_LABEL: Record<MaterialUnit, string> = {
  sqm: 'm²',
  running_m: 'm',
};

export interface MaterialUsagePanelProps {
  /** The editor's current drafts, hidden ones included — the panel filters. */
  items: ItemDraft[];
  catalogs: Catalogs;
  /** Sets the order's fixed discount to this dollar amount. */
  onApplyDiscount: (amount: number) => void;
}

/**
 * Parses a rate input, which is held as a raw string like every other
 * numeric field in the editor so a half-typed "5." does not fight the
 * keyboard. Anything unusable reads as "no rate", never as zero-with-intent.
 */
function parseRate(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Collapsible material breakdown with a give-back calculator. Renders
 * nothing at all when no visible line carries material, so an order of
 * preset items does not grow an empty panel.
 */
export function MaterialUsagePanel({ items, catalogs, onApplyDiscount }: MaterialUsagePanelProps) {
  const [sqmRate, setSqmRate] = useState('');
  const [runningRate, setRunningRate] = useState('');

  const summary = useMemo(() => summarizeMaterialUsage(items, catalogs), [items, catalogs]);

  const rates = useMemo(
    () => ({
      sqm: parseRate(sqmRate) ?? undefined,
      running_m: parseRate(runningRate) ?? undefined,
    }),
    [sqmRate, runningRate]
  );

  const giveBack = useMemo(() => giveBackAmount(summary, rates), [summary, rates]);

  if (summary.rows.length === 0) return null;

  // The units this order actually uses, paired with their figures, so the
  // JSX below never has to assert a Partial<Record> lookup is present.
  const usedUnits = (['sqm', 'running_m'] as MaterialUnit[]).flatMap((unit) => {
    const figures = summary.totals[unit];
    return figures ? [{ unit, figures }] : [];
  });
  const hasRunning = usedUnits.some((u) => u.unit === 'running_m');
  const totalAmount = usedUnits.reduce((sum, u) => sum + u.figures.amount, 0);
  const summaryLine = usedUnits
    .map(({ unit, figures }) => `${figures.quantity.toFixed(2)} ${UNIT_LABEL[unit]}`)
    .join(' · ');

  return (
    <details className="rounded-sm border border-border-light bg-surface-muted">
      <summary className="cursor-pointer select-none px-3 py-2 text-[13px] text-text-secondary">
        Material usage · {summaryLine}
      </summary>

      <div className="flex flex-col gap-3 border-t border-border-light px-3 py-3">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-text-secondary">
              <th className="pb-1 text-left font-normal">Material</th>
              <th className="pb-1 text-right font-normal">Qty</th>
              <th className="pb-1 text-right font-normal">Rate</th>
              <th className="pb-1 text-right font-normal">Material $</th>
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((row) => {
              const rate = rates[row.unit];
              const effective = rate ? row.rate - rate : null;
              return (
                <tr key={`${row.materialId}-${row.unit}`} className="border-t border-border-light">
                  <td className="py-1.5 pr-2 wrap-anywhere text-text-primary">{row.materialName}</td>
                  <td className="py-1.5 text-right font-mono text-text-primary">
                    {row.quantity.toFixed(2)} {UNIT_LABEL[row.unit]}
                  </td>
                  {/* The effective rate after the give-back is the margin
                      question being asked, so it is answered in place
                      rather than left as arithmetic for the reader. */}
                  <td className="py-1.5 text-right font-mono text-text-primary">
                    {effective === null ? (
                      `$${row.rate.toFixed(2)}`
                    ) : (
                      <>
                        <span className="text-text-secondary line-through">
                          ${row.rate.toFixed(2)}
                        </span>{' '}
                        ${effective.toFixed(2)}
                      </>
                    )}
                  </td>
                  <td className="py-1.5 text-right font-mono text-text-primary">
                    ${row.amount.toFixed(2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-border-light">
              <td className="pt-1.5 text-text-secondary">Total</td>
              <td className="pt-1.5 text-right font-mono text-text-primary">{summaryLine}</td>
              <td />
              <td className="pt-1.5 text-right font-mono text-text-primary">
                ${totalAmount.toFixed(2)}
              </td>
            </tr>
          </tfoot>
        </table>

        {/* How much of the billed quantity is minimum inflation rather
            than fabric the customer had. Shown only when it is non-zero,
            because on an order of full-size blinds it is just noise. */}
        {usedUnits.map(({ unit, figures }) => {
          const added = figures.quantity - figures.measured;
          if (added < 0.005) return null;
          return (
            <p key={unit} className="text-[12px] text-text-secondary">
              measured {figures.measured.toFixed(2)} {UNIT_LABEL[unit]} · minimums added{' '}
              {added.toFixed(2)} {UNIT_LABEL[unit]}
            </p>
          );
        })}

        {summary.excludedCount > 0 && (
          <p className="text-[12px] text-text-secondary">
            {summary.excludedCount} item{summary.excludedCount === 1 ? '' : 's'} carry no material
            (preset, custom, or incomplete).
          </p>
        )}

        <div className="flex flex-wrap items-end gap-2 border-t border-border-light pt-3">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] text-text-secondary">Give back $ / m²</span>
            <input
              inputMode="decimal"
              value={sqmRate}
              onChange={(e) => setSqmRate(e.target.value)}
              placeholder="0.00"
              className="h-9 w-24 rounded-sm border border-border-input px-2 text-right font-mono text-[13px]"
            />
          </label>
          {hasRunning && (
            <label className="flex flex-col gap-1">
              <span className="text-[12px] text-text-secondary">Give back $ / m</span>
              <input
                inputMode="decimal"
                value={runningRate}
                onChange={(e) => setRunningRate(e.target.value)}
                placeholder="0.00"
                className="h-9 w-24 rounded-sm border border-border-input px-2 text-right font-mono text-[13px]"
              />
            </label>
          )}
          <button
            type="button"
            disabled={giveBack <= 0}
            onClick={() => onApplyDiscount(giveBack)}
            className="h-9 rounded-sm border border-border-input px-3 text-[13px] font-medium text-text-primary disabled:opacity-40"
          >
            Apply ${giveBack.toFixed(2)}
          </button>
        </div>

        <p className="text-[12px] text-text-secondary">
          Applying sets the order's fixed discount. The rate itself is not saved, and the give-back
          is calculated on fabric but applied to the whole subtotal.
        </p>
      </div>
    </details>
  );
}
```

- [ ] **Step 2: Verify it compiles and lints**

```bash
pnpm --filter web check && pnpm --filter web lint
```

Expected: 0 errors, 0 warnings. If `border-border-input`, `bg-surface-muted` or `wrap-anywhere` is not a token in this project's `@theme` block, substitute the nearest existing token used elsewhere in `OrderDetail.tsx` rather than inventing one — check with:

```bash
grep -rn "bg-surface-muted\|border-border-input\|wrap-anywhere" apps/web/src --include=*.tsx -l
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/orders/MaterialUsagePanel.tsx
git commit -m "feat(orders): add the internal material usage panel"
```

---

### Task 6: Wire the panel into the order editor

**Files:**
- Modify: `apps/web/src/pages/orders/OrderDetail.tsx` (import; one `materialUsagePanel` node beside the existing `discountControl` definition; two render sites at ~`:2499` and ~`:2607`)

**Interfaces:**
- Consumes: `MaterialUsagePanel` from `./MaterialUsagePanel`.
- Produces: nothing consumed by later tasks.

`discountControl` and `totalsRows` are already defined once and rendered at both breakpoints; the panel follows exactly that pattern so the mobile card and the desktop rail cannot drift.

- [ ] **Step 1: Import the component**

Add beside the existing `./lineItemDrafts` import in `OrderDetail.tsx`:

```tsx
import { MaterialUsagePanel } from './MaterialUsagePanel';
```

- [ ] **Step 2: Define the shared node**

Immediately after the existing `discountControl` definition, add:

```tsx
  /**
   * Internal fabric breakdown, rendered above the discount control at
   * both breakpoints. Defined once for the same reason `discountControl`
   * is: two copies of this JSX would drift.
   *
   * Applying writes into the FIXED discount because there is no stored
   * per-m² discount type — see the panel's own docs.
   */
  const materialUsagePanel = (
    <MaterialUsagePanel
      items={items}
      catalogs={catalogs}
      onApplyDiscount={(amount) => {
        setDiscountType('fixed');
        setDiscountValue(amount.toFixed(2));
      }}
    />
  );
```

If the local variables are not named `items`, `catalogs`, `setDiscountType` or `setDiscountValue`, use the actual names — confirm with:

```bash
grep -n "const discountControl\|setDiscountType\|setDiscountValue\|const catalogs" apps/web/src/pages/orders/OrderDetail.tsx | head
```

- [ ] **Step 3: Render it at both totals sites**

In the `xl:hidden` mobile totals card (~`OrderDetail.tsx:2499`):

```tsx
            <section className="flex flex-col gap-2 rounded-xl border border-border-light bg-surface p-4 shadow-md xl:hidden">
              {materialUsagePanel}
              {discountControl}
              {totalsRows}
            </section>
```

In the desktop summary rail (~`OrderDetail.tsx:2607`):

```tsx
            <div className="mt-4 flex flex-col gap-2 border-t border-border-light pt-3.5">
              {materialUsagePanel}
              {discountControl}
              {totalsRows}
```

Change nothing else in the file.

- [ ] **Step 4: Verify in the browser**

Start the dev server and drive it — do not ask anyone to check by hand:

1. `preview_start` with the web dev-server config from `.claude/launch.json` (create the entry if absent, per the preview tooling docs).
2. Open an order with at least two blinds sharing a material, plus one Curtains line.
3. `read_page` — confirm the collapsed summary reads `Material usage · <n> m² · <n> m`.
4. Expand, type `5` into the `$ / m²` input, and confirm each m² row's rate shows `$50.00 → $45.00`.
5. Click Apply; `read_page` and confirm the discount field now holds the panel's figure and the order total dropped by exactly that amount.
6. `read_console_messages` — 0 errors.
7. `resize_window` to `mobile` and reload; confirm the panel appears once, above the discount control, and the table does not force the page to scroll horizontally.
8. Screenshot both breakpoints for the hand-off.

- [ ] **Step 5: Run the full verification**

```bash
pnpm --filter web check && pnpm --filter web test && pnpm --filter web lint
```

```bash
pnpm --filter api check && pnpm --filter api test
```

Expected: PASS everywhere, 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/orders/OrderDetail.tsx
git commit -m "feat(orders): show the material usage panel above the discount control"
```

---

### Task 7: Knowledge base and memory bank

**Files:**
- Modify: `knowledge/history/engine_features.md`
- Modify: `memory-bank/activeContext.md`
- Modify: `memory-bank/progress.md`
- Modify: `memory-bank/systemPatterns.md`

AI_GUIDELINES §4 and §5 make this part of the task, not an optional follow-up: skipping it means the work is incomplete.

- [ ] **Step 1: Append the feature entry**

Add a dated entry to `knowledge/history/engine_features.md`, matching the file's existing entry format. It must record:

- The Material usage panel: what it shows, that it is internal-only, and that the rate is scratchpad state rather than a stored discount type.
- `describeMaterialUsage` as a new blind-type concept, with the Curtains override and its `running_m` unit.
- The spec §4.2 decision — `materialCost` untouched, the two pinned by the "material leg equals usage x rate" case table — and the warning that deleting that test removes the only guard against drift.
- That a future blind type overriding `materialCost` MUST override `describeMaterialUsage` too.

- [ ] **Step 2: Update the memory bank (overwrite, do not append)**

`activeContext.md` and `progress.md` are current-state snapshots, not changelogs (AI_GUIDELINES §5). Overwrite the relevant sections to describe what is true now and link to the Step 1 entry instead of re-narrating it.

In `systemPatterns.md`, record the two durable facts: billed material quantity is now a first-class blind-type concept alongside `describeUnitCosts`, and it is held consistent with `materialCost` by test rather than by construction.

- [ ] **Step 3: Commit**

```bash
git add knowledge/history/engine_features.md memory-bank/
git commit -m "docs: record the material usage panel and describeMaterialUsage"
```

---

## Done when

- Both suites pass with 0 errors and 0 warnings.
- `diff` between each pair of blind-type twins shows only the pre-existing doc-prose hunks.
- The panel renders above the discount control at both breakpoints, and Apply moves the order total by exactly the figure it displays.
- Every pre-existing pricing and `lineItemDrafts` test passes without having been edited.
