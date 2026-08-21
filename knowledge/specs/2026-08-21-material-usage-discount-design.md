# Material usage & per-m² discount modelling — design

**Date:** 2026-08-21
**Branch:** `claude/competent-neumann-16a922`
**Status:** approved, ready for implementation planning

## 1. Problem

Fabric (the `price_per_sqm` material leg) is the flexible part of a quote. Cassettes,
bottom rails, controls and installation run on tighter margins, so a discount is
almost always reasoned about as "give back $X per square metre of fabric".

The app gives no way to reason that way. The consultant can see a subtotal and can
type a `$` or `%` discount, but nowhere in the product is the question "how many m² of
each material is this order, and at what rate?" answerable. Deciding a discount today
means mental arithmetic over a list of blinds, or guessing a percentage and hoping the
implied fabric give-back is sane.

## 2. Scope

An internal, live, collapsible **Material usage** panel in the order editor's totals
area, directly above the existing Discount control. It shows billed material quantity
per material with the rate charged, accepts a single give-back rate, shows what that
rate comes to in dollars, and applies it into the existing fixed discount field.

Supporting this requires one new method on the blind-type modules (§4), because the
panel must not re-derive the material formula.

**Non-goals.** No schema change. No new discount type. No change to
`totals.ts` on either side. No change to `materialCost` or to any stored price. No
change to the PDF, the customer view, `/orders/:id/present`, or `/orders/:id/overview`.
The give-back rate is not persisted.

## 3. Decisions taken during brainstorming

| Question | Decision |
|---|---|
| Placement | Order editor totals rail / mobile totals card, above `discountControl`. Internal only. |
| Rate model | One order-wide rate. Not per-material, not overridable per row. |
| Curtains (priced per running metre) | Their own group with their own `$ /m` rate input, kept out of the m² pool. |
| How the figure becomes a discount | An **Apply** button that fills the existing `fixed` discount. No persisted `per_sqm` discount type. |
| Area basis | **Billed** (minimised) area, because that is what the material leg charged. Measured area is shown as a secondary footer figure. |
| `materialCost` refactor | NOT refactored. A parallel `describeMaterialUsage` is added and pinned to it by test. See §4.2. |

## 4. Pricing-module change

### 4.1 The new method

Added to `BaseBlindType` in **both** `apps/api/src/lib/blindTypes/base.ts` and
`apps/web/src/lib/blindTypes/base.ts` (twin rule, AI_GUIDELINES §1):

```ts
/** The unit a blind type's `material_price_per_sqm` rate is actually quoted in. */
export type MaterialUnit = 'sqm' | 'running_m';

/** How much material one blind is CHARGED for, in the unit its rate is quoted in. */
export interface MaterialUsage {
  unit: MaterialUnit;
  /** BILLED quantity for ONE blind, minimums applied — what the material leg charged. */
  quantity: number;
  /** MEASURED quantity for ONE blind, minimums skipped. Reporting only; never prices. */
  measured: number;
}
```

`measured` is returned here rather than re-derived by the caller for the same reason
`quantity` is: a second expression of the formula outside these modules would be a
third thing to keep in sync, and the whole point of §4.1 is that there is one.

```ts
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

Curtains override, in both `blindTypes/curtains.ts` twins:

```ts
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

Both use the **minimised** dimensions, identical to `materialCost` and to every
hardware leg — two figures of one quote must not be derived from different dimensions.
Curtains ignore height, matching `curtains.ts`, where height is measured and reaches
the manufacturer copy but does not price.

No other blind-type module changes. Every type other than Curtains inherits the base
material formula unchanged, so every type other than Curtains inherits the base usage
unchanged.

### 4.2 Why `materialCost` is NOT refactored to call it

The obvious refactor is `materialCost = describeMaterialUsage(item).quantity * rate`,
which would make `material leg === usage × rate` true by construction.

It is rejected. `(W × H × price) / 10000` and `((W × H) / 10000) × price` are not
bit-identical in IEEE-754. The codebase already treats that class of change as
dangerous — `HARDWARE_LEG_ORDER` exists solely to preserve a floating-point
association so that deriving a price from `describeUnitCosts` cannot move a stored
cent. A material-leg reassociation could move a real price at a half-cent boundary,
against AI_GUIDELINES §8 (stability first) on a production system with historical
orders.

**The compromise, stated plainly:** two expressions of one idea, held together by a
test rather than by construction. The mitigation is §7.1's consistency test, which
fails on any drift.

### 4.3 Documentation

Both new methods and both new types carry JSDoc at 9/10 or better per AI_GUIDELINES
§3: what the number means, that it is billed rather than measured, that quantity
multiplication is the caller's job, and — on the base method — an explicit pointer to
§4.2 explaining why it is not the source of `materialCost`.

## 5. Aggregation module

New file `apps/web/src/pages/orders/materialUsage.ts`. Pure, React-free, testable.

```ts
export interface MaterialUsageRow {
  materialId: string;
  materialName: string;
  unit: MaterialUnit;
  /** Billed quantity across every contributing line, quantity included. */
  quantity: number;
  /** Snapshot rate — $/m² or $/running-m depending on `unit`. */
  rate: number;
  /** Material-leg revenue across those lines, from the option-derived base price. */
  amount: number;
  /** Measured (un-minimised) quantity, for the footer's minimum-inflation figure. */
  measuredQuantity: number;
}

export interface MaterialUsageSummary {
  rows: MaterialUsageRow[];
  /** Order-wide billed totals, one per unit. Absent when no line uses that unit. */
  totals: Partial<Record<MaterialUnit, { quantity: number; measured: number; amount: number }>>;
  /** Count of visible lines contributing no material (preset, custom, un-priceable). */
  excludedCount: number;
}

export function summarizeMaterialUsage(
  items: ItemDraft[],
  catalogs: Catalogs
): MaterialUsageSummary;
```

Rules, each mirroring behaviour that already exists elsewhere:

1. **Hidden lines are excluded.** `items.filter(it => !it.hidden)`, matching the
   `totals` memo in `OrderDetail.tsx` and the Worker's own filter.
2. **Non-blind lines are excluded**, counted into `excludedCount`. Preset and custom
   items have no material.
3. **Un-priceable blind drafts are excluded**, counted into `excludedCount`. A draft
   whose `blindDraftPrice` would return `null` (missing panels, height, quantity,
   material, a required hardware slot, or unparseable attributes) has no defensible
   area. The module reuses the same guards rather than inventing looser ones — a row
   the editor refuses to price must not appear here with a confident m² figure.
4. **Quantity multiplies.** `quantity = describeMaterialUsage(...).quantity × qty`.
5. **Grouping key is `materialId + unit`.** Materials are scoped to blind types
   (`material_blind_types`), but the join permits a material linked to both Curtains
   and a m²-priced type; without the unit in the key, running metres and square metres
   would silently pool into one meaningless number.
6. **`amount` uses the option-derived material leg**, i.e.
   `describeUnitCosts(inputs).material × qty`, NOT the stored/override unit price. A
   consultant's manual price override is not a fabric-rate change and must not distort
   the effective $/m² the panel reports.
7. **`measuredQuantity`** is `describeMaterialUsage(...).measured × qty` — read
   straight off the blind-type module, never re-derived here. It exists only to
   populate the footer note in §6 and never touches money.
8. **Row order** is descending by `amount` — the biggest fabric spend, where a
   give-back actually moves the number, reads first.

### 5.1 Consuming the blind-type modules

`summarizeMaterialUsage` builds `BlindPricingInputs` exactly as
`blindDraftPrice` does (`lineItemDrafts.ts:601`) — same `slotsForType` gating, same
`resolveCatalogRefs`, same `parseDraftAttributes`. To avoid a second copy of that
assembly, `lineItemDrafts.ts` exports the existing body as a helper:

```ts
/** The priced inputs a blind draft resolves to, or null when it cannot be priced. */
export function blindDraftInputs(draft: BlindDraft, catalogs: Catalogs): BlindPricingInputs | null
```

`blindDraftPrice` is rewritten as a thin caller of it, so its behaviour is unchanged
and `lineItemDrafts.test.ts` continues to pin it. This is the one existing-file
refactor in scope, and it is the minimal one: the alternative is duplicating twenty
lines of gating logic that the AI_GUIDELINES §1 twin rule exists to prevent.

## 6. The panel

New file `apps/web/src/pages/orders/MaterialUsagePanel.tsx`.

```ts
interface MaterialUsagePanelProps {
  items: ItemDraft[];
  catalogs: Catalogs;
  /** Sets the order's fixed discount to this dollar amount. */
  onApplyDiscount: (amount: number) => void;
}
```

A `<details>` element. Rendered once inside `OrderDetail.tsx` as a shared node
(alongside `discountControl` and `totalsRows`, which are already defined once and
rendered twice), then placed immediately **above** `{discountControl}` at both render
sites: the `xl:hidden` mobile totals card (`OrderDetail.tsx:2499`) and the desktop
summary rail (`OrderDetail.tsx:2607`). Nothing else in `OrderDetail.tsx` moves.

**Collapsed** `<summary>`: `Material usage · 38.40 m² · 12.00 m` — units listed only
when present. Nothing renders at all when `rows` is empty.

**Expanded**, in order:

1. **Table**, one row per `MaterialUsageRow`:

   | Material | Qty | Rate | Material $ | Give-back |
   |---|---|---|---|---|
   | Sunscreen 3% Charcoal | 18.40 m² | $45.00 | $828.00 | −$92.00 |
   | Blackout Ivory | 20.00 m² | $38.00 | $760.00 | −$100.00 |
   | Linen Sheer | 12.00 m | $62.00 | $744.00 | −$60.00 |

   The Rate cell shows the effective rate once a give-back is entered:
   `$45.00 → $40.00`. That is the margin question being asked, answered in place.

2. **Footer row**: billed totals per unit, plus a muted note
   `measured 31.20 m² · minimums added 7.20 m²`, shown only when the two differ. This
   is what stops a give-back being decided on area the customer never had.

3. **Rate inputs**: a `$ /m²` input, and a `$ /m` input rendered **only when a
   `running_m` row exists**. Both `inputMode="decimal"`, both held as raw text like
   every other numeric field in the editor, both `useState` local to the panel.

4. **Apply row**: `Give back $252.00` and an Apply button calling
   `onApplyDiscount(252.00)`. Disabled while the computed amount is 0 or the inputs
   are unparseable.

5. **Excluded note** when `excludedCount > 0`:
   `3 items carry no material (preset, custom, or incomplete).`

`OrderDetail.tsx` wires it as:

```tsx
onApplyDiscount={(amount) => {
  setDiscountType('fixed');
  setDiscountValue(amount.toFixed(2));
}}
```

Give-back arithmetic: `round2(Σ over rows of row.quantity × rateFor(row.unit))`,
summed across both units into one dollar figure.

### 6.1 Two properties the panel makes explicit on screen

- **The rate is scratchpad state.** It is not persisted. Reopening the order shows a
  plain `$252.00` fixed discount with no record of the $5/m² that produced it. The
  panel says so in a one-line muted caption, so nobody assumes otherwise. Promoting it
  to a stored `per_sqm` discount type remains available later; it would need a
  migration, both `totals.ts` twins, both test suites, and the PDF/customer view.
- **The give-back is computed from fabric but applied to the whole subtotal**
  (fabric + hardware). That is the requested behaviour. It means the fabric give-back
  is exactly what it says, while the order-level discount percentage is lower than the
  fabric-level one.

## 7. Testing

### 7.1 Pricing-module suites (both sides, mirrored)

Added to `apps/api/src/lib/pricing.test.ts` and `apps/web/src/lib/pricing.test.ts`:

- **Consistency (the §4.2 mitigation).** For a table of cases spanning every blind
  type — under-minimum width, under-minimum height, the 100–199 → 200 tier, at-minimum
  boundaries, multi-panel, and Curtains at several pleat multipliers — assert
  `describeUnitCosts(item).material` equals `describeMaterialUsage(item).quantity ×
  material_price_per_sqm` to within a tenth of a cent.
- **Unit correctness.** Every non-Curtains type reports `sqm`; Curtains reports
  `running_m`.
- **Minimums applied.** A 60 × 80 cm blind reports `quantity` 1.00 m² and `measured`
  0.48 m². An over-minimum blind reports the two as equal.
- **Curtains pleat and hem.** A 2-panel, 200 cm, ×2.5 pleat curtain reports
  `200/100 × 2.5 + 2 × 0.5 = 6.00` running metres.

### 7.2 `apps/web/src/pages/orders/materialUsage.test.ts` (new)

- Two blinds sharing a material collapse into one row with summed quantity.
- `quantity > 1` multiplies billed area and material revenue.
- A hidden line contributes nothing.
- Preset and custom lines contribute nothing and raise `excludedCount`.
- An incomplete blind draft (no height) contributes nothing and raises
  `excludedCount`.
- A price override changes neither `quantity` nor `amount`.
- A m²-priced line and a curtain line produce two rows with different units, and
  `totals` carries both keys.
- `measuredQuantity` is below `quantity` for an under-minimum blind and equal to it
  for an over-minimum one.
- Rows are ordered by descending `amount`.

### 7.3 Regression

`apps/web/src/pages/orders/lineItemDrafts.test.ts` is unchanged and must stay green —
it is the proof that extracting `blindDraftInputs` did not alter `blindDraftPrice`.

### 7.4 Commands

Pricing is touched, so AI_GUIDELINES §9 requires both suites:

```
pnpm --filter api check && pnpm --filter api test
pnpm --filter web check && pnpm --filter web test && pnpm --filter web lint
```

Target: 0 errors, 0 warnings.

## 8. Files

| File | Change |
|---|---|
| `apps/api/src/lib/blindTypes/base.ts` | + `MaterialUnit`, `MaterialUsage`, `describeMaterialUsage` |
| `apps/api/src/lib/blindTypes/curtains.ts` | + `describeMaterialUsage` override |
| `apps/api/src/lib/pricing.test.ts` | + §7.1 cases |
| `apps/web/src/lib/blindTypes/base.ts` | twin of the api change |
| `apps/web/src/lib/blindTypes/curtains.ts` | twin of the api change |
| `apps/web/src/lib/pricing.test.ts` | twin of the api test change |
| `apps/web/src/pages/orders/lineItemDrafts.ts` | extract + export `blindDraftInputs` |
| `apps/web/src/pages/orders/materialUsage.ts` | NEW — aggregation |
| `apps/web/src/pages/orders/materialUsage.test.ts` | NEW — §7.2 |
| `apps/web/src/pages/orders/MaterialUsagePanel.tsx` | NEW — the panel |
| `apps/web/src/pages/orders/OrderDetail.tsx` | render the panel at the two totals sites; `onApplyDiscount` handler |

Every new file opens with the SPDX header required by AI_GUIDELINES §10 and a module
JSDoc describing its responsibility.

`OrderDetail.tsx` is a standing size violation (~3,170 lines, AI_GUIDELINES §6). This
work does not enlarge it meaningfully — the panel is its own file and the wiring is a
handler plus two render sites — and no opportunistic reduction is attempted, per
scope isolation (§7).

## 9. Knowledge base

On completion, per AI_GUIDELINES §4 and §5:

- `knowledge/history/engine_features.md` — dated entry for the panel and the new
  blind-type method, including the §4.2 rationale.
- `memory-bank/activeContext.md` and `memory-bank/progress.md` — current-state
  sections overwritten, not appended.
- `memory-bank/systemPatterns.md` — record that billed material quantity is now a
  first-class blind-type concept, and that it is pinned to `materialCost` by test
  rather than by construction.
