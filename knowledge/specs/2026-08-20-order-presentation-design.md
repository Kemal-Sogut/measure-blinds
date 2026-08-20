# Order Presentation view — design

**Date:** 2026-08-20
**Branch:** `claude/order-overview-filters-totals-940e9b`
**Status:** approved, ready for implementation planning

## 1. Problem

A consultant standing next to the customer needs a screen that answers "what did we
pick for each window, and what did each choice cost?" — filterable live during the
conversation, with running totals per option column.

Today the closest thing is `/orders/:id/overview` ([`OrderOverview.tsx`]
(../../apps/web/src/pages/orders/OrderOverview.tsx)): a read-only print listing
grouped into one table per blind type, showing option NAMES only, with money limited
to unit price and line total. It is an internal artefact — it exposes price-override
markers and internal notes, its per-blind-type grouping fights "filter by blind type",
and it is only reachable post-draft. It is **not** modified by this work.

## 2. Scope

A new customer-facing page reachable while the order is unconfirmed, showing every
option type as a column with its money contribution, a stackable filter bar, and a
totals row that tracks the filter.

Non-goals: no server changes, no schema changes, no persisted filter state, no change
to `/orders/:id/overview`, no change to pricing behaviour.

## 3. Entry point

A new `StageAction` in `stageActions()` in
[`OrderDetail.tsx`](../../apps/web/src/pages/orders/OrderDetail.tsx):

```
key: 'present', label: 'Present to Customer', short: 'Present', icon: ICONS.present
```

Placed **first in `secondary`** so it renders directly below the primary Confirm
button in both the desktop vertical rail and the mobile sticky bar.

Shown for the unconfirmed statuses only:

| status | today | after |
|---|---|---|
| `draft` | `primary: confirm`, `secondary: []` | `secondary: [present]` |
| `sent` | `secondary: [overview]` | `secondary: [present, overview]` |
| `expired` | `secondary: [overview]` | `secondary: [present, overview]` |

Every other status is unchanged. An unsaved order (`!id`) keeps its current
"no stage actions" behaviour.

**Handler.** Mirrors the established `handleConfirm` save-first pattern:

```ts
async function handlePresent() {
  const savedId = await save();
  if (!savedId) return;
  navigate(`/orders/${savedId}/present`);
}
```

Two deliberate choices:

- **Save first.** The page reads server state through `useOrder`, so without the save
  a consultant who just typed the order would present stale or empty data. `draft` is
  precisely where that risk lives.
- **Same tab, not `window.open`.** The other report pages open a new tab, but they do
  it synchronously. A `window.open` after an `await` is popup-blocked in every current
  browser. Same-tab navigation also matches the physical situation — one tablet handed
  across a table, with `PageHeader backTo={/orders/:id}` as the way back.

## 4. Route and page

`/orders/:id/present` → `OrderPresentation.tsx`, registered in
[`App.tsx`](../../apps/web/src/App.tsx) beside the existing `/overview` and
`/manufacturer` routes, inside the same `guard(<Layout>…</Layout>)` wrapper.

Structure top to bottom:

1. `PageHeader` — title "Order Presentation", `backTo` the order, Print button
   (`print:hidden`, calls `window.print()`).
2. Order meta line: order number · customer · order date · `StatusBadge`.
3. Filter bar (§6).
4. Blinds table with `<tfoot>` totals (§5, §7).
5. "Other items" section for preset/custom lines (§7).
6. Order-total strip (§7).

**Hidden items are excluded.** `line_items` with `hidden: true` are out of the order
total and off every customer- and production-facing surface already; a customer-facing
page must match. (The existing `/overview` does not filter them — that is a
pre-existing inconsistency on an internal page and is left alone under §7 scope
isolation.)

## 5. The table and its money

### 5.0 Columns

| # | Column | Content |
|---|---|---|
| 1 | Room | `room_name`, falling back to `Blind {n}` |
| 2 | Blind type | `blinds_type` |
| 3 | Size (cm) | `120 × 210`, or `(120 + 80) × 210` when the blind has multiple panels |
| 4 | Material | name + money |
| 5 | Colour | name only |
| 6 | Cassette | name + money |
| 7 | Bottom rail | name + money |
| 8 | Control | name + money |
| 9 | Installation | name + money |
| 10 | Qty | `quantity` |
| 11 | Adjustment | §5.4, blank when zero |
| 12 | Line total | `line_total` |

The four hardware columns (6–9) and the Colour column are **omitted entirely** when no
visible blind carries that slot — the same rule §6.2 applies to the filter dropdowns.
An order of plain rollers therefore renders a narrow table rather than four columns of
`—`. The Adjustment column is omitted when no visible line has an adjustment.

### 5.1 The breakdown method

`BaseBlindType.calculateUnitPrice()` sums a material leg plus one `hardwareCost()`
call per present slot. Both helpers are `protected`, so nothing outside the class can
report the legs.

Change: add a public `describeUnitCosts()` to `BaseBlindType`, and **redefine
`calculateUnitPrice()` to sum its result**.

```ts
/** Per-leg unit cost, unrounded. Keys present exactly when the leg exists. */
export interface UnitCostBreakdown {
  material: number;
  cassette?: number;
  bottom_rail?: number;
  control?: number;
  installation?: number;
}

describeUnitCosts(item: BlindPricingInputs): UnitCostBreakdown
```

Deriving the price from the breakdown rather than computing them side by side is the
point: the two cannot drift, because there is only one calculation. A basis is still
interpreted in exactly one place (`hardwareCost`), and a type that overrides
`materialCost` (Curtains) gets its own material leg reported for free.

`calculateUnitPrice` keeps its current rounding — legs summed unrounded, the sum
rounded once to 2dp — so **every existing price is bit-identical**. This is
refactoring behind a stable result, not a pricing change.

Per AI_GUIDELINES §1 this is a twin edit: identical change to
`apps/api/src/lib/blindTypes/base.ts`, plus the mirrored assertion in both
`pricing.test.ts` suites.

### 5.2 Reconstructing the inputs from a saved line item

Nothing today builds a `BlindPricingInputs` from a *saved* `LineItem` — the editor
builds it from catalog lookups, the Worker builds it from catalog rows at save time.
The new `lib/optionBreakdown.ts` owns that mapping, reading only the snapshot columns
so the page reflects what was priced, not what the catalog says now:

| slot | rate column | basis column |
|---|---|---|
| material | `material_price_per_sqm` | — (always per m², via `materialCost`) |
| cassette | `cassette_price_per_m` | `cassette_price_basis` |
| bottom_rail | `bottom_rail_price_per_m` | `bottom_rail_price_basis` |
| control | `control_price_per_item` | `control_price_basis` |
| installation | `installation_price_per_item` | `installation_price_basis` |

A slot is **absent** (not zero) when its `*_id` is null — matching how both the editor
and the Worker build the map. `attributes` is passed through as stored, so Curtains'
`pleat_multiplier` prices its material leg correctly. Null rates coerce to 0.

### 5.3 Cell values and the penny

For a column's leg `L` on a line of quantity `q`: cell amount = `round2(L × q)`.

Rendering: `Cordless (+$50.00)` when the amount is non-zero, bare `Cordless` when it
is zero — per the requirement not to print `$0`. Colour is always name-only (it is
free-text with no pricing effect). An absent slot renders `—`.

Because legs are rounded individually for display but summed-then-rounded for the
price, the displayed cells can miss the line total by a cent. A **largest-remainder
correction** pushes that cent onto the material leg (always the largest), so the
displayed row sums exactly. The Adjustment column is therefore reserved for real
money and never shows rounding noise.

### 5.4 Adjustment column

`adjustment = round2(line_total − Σ displayed cells)`.

Non-zero only from a consultant price override (`base_unit_price !== null`) or custom
add-ons (`addons[]`). Rendered as a quiet column, blank when zero, so **every row's
option columns sum exactly to its line total** and the column totals sum exactly to
the overall total. Nothing on screen ever fails to add up in front of a customer.

## 6. Filters

### 6.1 Model

```ts
type FilterField =
  | 'room_name' | 'blinds_type' | 'material' | 'color'
  | 'cassette' | 'bottom_rail' | 'control' | 'installation';

interface Filter { id: string; field: FilterField; value: string }
```

The bar renders one row per filter — `[field ▾] [value ▾] [✕]` — plus an
"+ Add filter" button. A newly added row defaults to the first field that still has
more than one distinct value in the order, with no value chosen yet (a filter with no
value matches everything, so a half-built row never blanks the table).

### 6.2 Facets

Value dropdowns are built **from the order**, never from the catalog — "matching
criteria options are the ones in the order". For each field, the distinct non-empty
values across the order's visible blinds, each with its blind count: `Cordless (3)`.
A field with no values at all (e.g. no blind carries an installation option) is
omitted from the field dropdown entirely.

Counts are computed over **all** visible blinds, not over the currently filtered set.
They are a stable description of the order ("3 of these are cordless"), which is what
the consultant reads aloud; recomputing them against the active filters would make the
numbers jump around while a filter is being built, and would show `(0)` next to values
that are the whole reason to open the dropdown.

### 6.3 Combination

**AND across fields, OR within a field.** A blind must match every field that has at
least one valued filter; within a field, matching any chosen value is enough.

Worked example from the requirement — 10 windows, 3 cordless, 5 fabric-wrapped:

- `Control = Cordless` → the 3 cordless blinds.
- `+ Bottom rail = Fabric wrapped` → blinds that are **both**.
- `+ Control = Motorised` → blinds with a fabric-wrapped rail that are cordless **or**
  motorised.

### 6.4 Empty state

When filters exclude everything, the table is replaced by an explicit "No blinds match
these filters" message with a "Clear filters" action — not an empty table with a `$0`
totals row.

## 7. Totals

### 7.1 Column totals

A `<tfoot>` inside the same `<table>`, so each total sits under its own column and
stays aligned while the table scrolls sideways. Each option column totals
`Σ cell amount` over the currently visible rows; the Adjustment column and the line
total column total the same way. The Room cell of the footer carries the row count
("6 blinds"), Qty carries `Σ quantity`, and Blind type / Size / Colour are blank —
they have nothing to sum.

Every figure recomputes from the filtered row set — "all totals updating with the
filters".

### 7.2 Other items

Preset and custom lines carry no options, so they cannot live in the option table.
They render in a small "Other items" section below (title, description, qty, line
total), and are **included in the overall total**.

They are shown when no *option* filter is active (i.e. only room-name or blind-type
filters, or none). Once the view is narrowed to specific options they are hidden and
drop out of the overall total, because "the cordless ones" cannot meaningfully include
a call-out fee.

### 7.3 Overall total and the order strip

Two distinct numbers, deliberately labelled apart:

- **Overall total** — `Σ line_total` of what is on screen (filtered blinds + other
  items when shown). This is the number that moves with the filters.
- **Order total strip** — subtotal → discount → HST → total, read verbatim from the
  **server** `Order` row (`subtotal`, `discount_amount`, `tax_amount`, `total`). Never
  recomputed client-side: AI_GUIDELINES §1 forbids the client deriving money, and a
  13% HST figure applied to a filtered subset would be a fabricated number presented
  to a customer as real.

While any filter is active the strip carries a muted note — "Showing 6 of 14 blinds ·
order total unchanged" — so the partial view is never mistaken for the order.

## 8. Modules

| File | Responsibility | New? |
|---|---|---|
| `apps/web/src/lib/blindTypes/base.ts` | `describeUnitCosts()`; `calculateUnitPrice()` sums it | edit |
| `apps/api/src/lib/blindTypes/base.ts` | identical twin edit (§1) | edit |
| `apps/web/src/lib/optionBreakdown.ts` | pure: `LineItem` → `BlindPricingInputs` → per-column cells, penny correction, adjustment | new |
| `apps/web/src/pages/orders/presentationFilters.ts` | pure: facet extraction, match predicate, filter-list ops | new |
| `apps/web/src/pages/orders/OrderPresentation.tsx` | page shell: fetch, header, layout, print, section assembly | new |
| `apps/web/src/pages/orders/PresentationFilterBar.tsx` | filter row UI | new |
| `apps/web/src/pages/orders/PresentationTable.tsx` | option table + `<tfoot>` totals | new |
| `apps/web/src/App.tsx` | route registration | edit |
| `apps/web/src/pages/orders/OrderDetail.tsx` | `ICONS.present`, the action, `handlePresent` | edit |

The two pure modules hold every decision worth testing; the three components stay
presentational. No file approaches the 800-line guideline (§6), and `OrderDetail.tsx`
grows by roughly 20 lines rather than absorbing the feature.

## 9. Tests

| Suite | Covers |
|---|---|
| `apps/web/src/lib/pricing.test.ts` | `Σ describeUnitCosts() === calculateUnitPrice()` across every basis and for Curtains; existing expected values unchanged |
| `apps/api/src/lib/pricing.test.ts` | the same assertions, mirrored |
| `apps/web/src/lib/optionBreakdown.test.ts` | absent vs zero slots; each of the four bases; qty > 1; width/height minimums applied; penny correction; adjustment from an override; adjustment from add-ons; cells sum to `line_total` |
| `apps/web/src/pages/orders/presentationFilters.test.ts` | facet extraction with counts; fields with no values omitted; AND-across / OR-within incl. the 10-window worked example; valueless filter matches everything; empty result |

Verification per AI_GUIDELINES §9: `pnpm check`, `pnpm test`, `pnpm lint` in
`apps/web`, and `pnpm check` + `pnpm test` in `apps/api` (pricing was touched, so both
suites run).

## 10. Documentation obligations

- JSDoc file headers and per-export docs on all five new files, scored ≥8/10 (§3).
- SPDX + copyright header on every new file (§10).
- `knowledge/history/engine_features.md` — dated entry for the feature (§4).
- `memory-bank/activeContext.md` and `progress.md` — overwrite current state, do not
  append (§5).

## 11. Risks

- **Twin drift.** The `base.ts` edit must land on both sides in the same change. The
  mirrored test assertion is what catches a one-sided edit.
- **Pricing regression.** `calculateUnitPrice` is the single most load-bearing function
  in the app. The refactor keeps summed-unrounded-then-rounded-once semantics exactly;
  the existing expected-value tests on both sides are the guard, and they must pass
  unmodified.
- **Historical rows.** Orders saved before migrations 35/36 may carry null bases or
  null rates. Absent-vs-zero handling (§5.2) is specified for this and is directly
  tested.
- **Table width on a tablet.** Up to 12 columns. Same treatment as the existing report
  pages — `overflow-x-auto` with a `min-w-[…]` table, so the page body never scrolls
  sideways. Unverified on a real device, like the rest of the app.
