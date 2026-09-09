# Unified Order View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the two read-only order views into one — `/orders/:id/present` absorbs everything Order Overview carried, and a toggle beside the title reveals or hides per-option money without ever hiding a line total or an order total.

**Architecture:** Purely a rendering change. `OrderPresentation` owns one `useState<boolean>` and threads it to the blinds table and the other-items table as a `showBreakdown` prop. Table primitives shared by both tables move into a new `presentationCells.tsx` (two of them rescued from `OrderOverview` before it is deleted). No pricing, totals, API, or database code is touched — AI_GUIDELINES §1 is untouched end to end.

**Tech Stack:** React 19, Vite 8, Tailwind v4 (`@theme` tokens — no PostCSS), React Router 6, TanStack Query 5, Vitest 3.

**Spec:** `knowledge/specs/2026-08-28-unified-order-view-design.md`

## Global Constraints

- Every source file begins with, verbatim:
  ```ts
  // SPDX-License-Identifier: GPL-3.0-only
  // Copyright (c) 2026 Blinds Nisa. All rights reserved.
  ```
- Every exported module, component, function and type carries a JSDoc (`/** … */`) block. English only. Explain purpose, behavior, constraints and integration context — never restate the name. Target ≥8/10 on the AI_GUIDELINES scoring table.
- No file exceeds 800 lines; functions stay under ~100.
- No money is recomputed anywhere in this change. Every figure on screen comes from a stored `line_item` column, from the server order row, or from `describeLineBreakdown` — which is NOT modified.
- Tailwind utility classes only; no new CSS files, no inline `style` attributes.
- `apps/web/src/lib/optionBreakdown.ts` and `apps/web/src/pages/orders/presentationFilters.ts` are OUT OF SCOPE. Their test suites (`optionBreakdown.test.ts`, `presentationFilters.test.ts`) must stay green **without being edited**. If either needs a change, stop and report — something outside this plan has moved.
- Per-task verification, run from `apps/web`:
  ```bash
  pnpm check && pnpm lint && pnpm test
  ```
  Target: 0 errors, 0 warnings.

### A note on tests

This plan contains no new unit tests, and that is deliberate rather than an omission. The `apps/web` suite is pure-logic only — 25 `.test.ts` files, no `.test.tsx`, no `@testing-library/*`, no jsdom in `package.json`. Every behaviour this change introduces is rendering, so there is no honest unit test to write for it without first introducing a component-test harness, which is a separate decision and out of scope here.

The invariant that actually matters — a row's option cells plus its adjustment equal the stored `line_total` — is already covered by `optionBreakdown.test.ts` and is unaffected, because the toggle hides cells without changing what they hold.

Verification is therefore: `tsc --noEmit` for types, `oxlint` for correctness, the existing suite for regressions, and the scripted browser pass in Task 6 for behaviour. Task 6 is not optional — it is where this plan's changes are actually proven.

---

### Task 1: Shared table primitives and the toggle

Two new files that nothing imports yet. Splitting them out first means Tasks 2 and 3 both consume a settled interface instead of one of them inventing it and the other adapting.

**Files:**
- Create: `apps/web/src/pages/orders/presentationCells.tsx`
- Create: `apps/web/src/pages/orders/BreakdownToggle.tsx`
- Reference (do not modify): `apps/web/src/pages/orders/OrderOverview.tsx:116-153` — the origin of `AddonLines` and `UnitPrice`
- Reference (do not modify): `apps/web/src/pages/orders/ManufacturerCopy.tsx:455-471` — the app's existing `role="switch"` pattern

**Interfaces:**
- Consumes: `LineItem` from `apps/web/src/types`.
- Produces, all consumed by Tasks 2 and 3:
  - `money(value: number | null | undefined): string`
  - `Th({ children: ReactNode; right?: boolean })`
  - `Td({ children: ReactNode; right?: boolean; mono?: boolean })`
  - `Tf({ children: ReactNode; right?: boolean })`
  - `AddonLines({ item: LineItem; showBreakdown: boolean })`
  - `UnitPrice({ item: LineItem })`
  - `BreakdownToggle({ value: boolean; onChange: (next: boolean) => void })` (default export)

- [ ] **Step 1: Create `presentationCells.tsx`**

```tsx
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Shared table primitives for the order view (`/orders/:id/present`).
 *
 * The page renders two tables — blinds and other items — that must agree
 * on cell padding, type scale, alignment and money formatting, because
 * they sit one above the other on the same screen and a customer reads
 * them as one document. Keeping the primitives here rather than in either
 * table is what makes that agreement structural instead of a convention
 * two files are expected to remember.
 *
 * `AddonLines` and `UnitPrice` came from the deleted Order Overview page,
 * whose information this page absorbed. They carry the two pieces of
 * per-line money that are NOT option choices, so neither belongs in
 * `optionBreakdown.ts`.
 */

import type { ReactNode } from 'react';
import type { LineItem } from '../../types';

/**
 * Formats a number as dollars, e.g. `$1234.50`.
 *
 * This has to survive NEGATIVES — the adjustment column goes below zero
 * whenever a consultant discounts a line, and the balance goes below zero
 * on an overpayment — so the sign LEADS and the dollar sign hugs the
 * digits. Naive interpolation yields `$-21.20`, which reads as a typo on
 * a screen a customer is looking at. The U+2212 minus matches the
 * discount row on the order-total strip.
 */
export function money(value: number | null | undefined): string {
  const amount = Number(value) || 0;
  return `${amount < 0 ? '−' : ''}$${Math.abs(amount).toFixed(2)}`;
}

/** Header cell. `right` aligns the column for figures. */
export function Th({ children, right = false }: { children: ReactNode; right?: boolean }) {
  return (
    <th
      className={`whitespace-nowrap px-3 py-2 text-xs font-semibold uppercase tracking-wide text-text-muted ${right ? 'text-right' : 'text-left'}`}
    >
      {children}
    </th>
  );
}

/** Body cell. `mono` marks money and size figures so columns of digits align. */
export function Td({
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
export function Tf({ children, right = false }: { children: ReactNode; right?: boolean }) {
  return (
    <td
      className={`whitespace-nowrap px-3 py-2 font-mono text-sm font-semibold text-text-primary ${right ? 'text-right' : 'text-left'}`}
    >
      {children}
    </td>
  );
}

/**
 * A line's add-ons as indented sub-lines beneath its descriptive column,
 * or nothing when it has none.
 *
 * Rendered under an existing column rather than as extra rows so the money
 * columns keep lining up one row per line item.
 *
 * The LABEL always prints and the PRICE follows the breakdown toggle: an
 * add-on is a choice the customer made, exactly like an option name, and
 * its price is per-choice money, exactly like an option amount. With the
 * toggle down the add-on's money still reaches the customer — inside the
 * line total, where all per-choice money goes when the breakdown is off.
 */
export function AddonLines({ item, showBreakdown }: { item: LineItem; showBreakdown: boolean }) {
  return (
    <>
      {item.addons.map((addon, i) => (
        <span key={i} className="mt-0.5 block text-xs text-text-muted">
          + {addon.label}
          {showBreakdown && ` ${money(addon.price)}`}
        </span>
      ))}
    </>
  );
}

/**
 * The charged unit price, preceded by the struck-through calculated one on
 * a line whose override the consultant marked shareable.
 *
 * Independent of the breakdown toggle in BOTH directions. `base_unit_price`
 * is only meaningful alongside `show_original_price`, which is a real
 * privacy control rather than a display preference — the public endpoint
 * omits the figure entirely when it is false. A line marked shareable shows
 * its "was" price to the customer; a line not marked shareable never does,
 * whatever the toggle says.
 *
 * The Overview page's amber "price overridden" dot is deliberately absent.
 * It meant "someone typed this price", which was fair on an internal-only
 * screen; on a page that can face a customer it is an unexplained marker
 * on lines whose override was specifically NOT to be shown.
 */
export function UnitPrice({ item }: { item: LineItem }) {
  const showOriginal = item.base_unit_price !== null && item.show_original_price;
  return (
    <>
      {showOriginal && (
        <span className="mr-1.5 text-text-muted line-through">{money(item.base_unit_price!)}</span>
      )}
      {money(item.unit_price)}
    </>
  );
}
```

- [ ] **Step 2: Create `BreakdownToggle.tsx`**

```tsx
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * The price-breakdown switch on the order view's title row.
 *
 * ON is the SELLING state: it reveals what each individual choice cost
 * ("the cassette added $40, the motor $180"), which is what justifies a
 * price to a customer looking at the screen. The consultant flips it on
 * deliberately, with the tablet already turned around.
 *
 * It never governs a line total or an order total — those are on screen
 * in both states — so turning it off cannot make the page disagree with
 * the estimate the customer was sent. See `PresentationTable` for what it
 * does reach.
 *
 * `print:hidden` applies to the control alone, not its effect: whatever
 * state is on screen is what prints, because this page is now the only
 * printable order view and both states are legitimate paper.
 */
export default function BreakdownToggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className="flex items-center gap-2 print:hidden"
    >
      <span className="text-[13px] font-medium text-text-secondary">Price breakdown</span>
      <span
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
          value ? 'bg-brand-600' : 'bg-border-input'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
            value ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </span>
    </button>
  );
}
```

- [ ] **Step 3: Verify**

Run from `apps/web`:
```bash
pnpm check && pnpm lint && pnpm test
```
Expected: 0 errors, 0 warnings. Both files are unimported so far; that is fine — unused *exports* are not flagged.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/orders/presentationCells.tsx apps/web/src/pages/orders/BreakdownToggle.tsx
git commit -m "feat(orders): shared presentation cells and breakdown toggle"
```

---

### Task 2: Blinds table absorbs Overview's columns and gains the toggle

**Files:**
- Modify: `apps/web/src/pages/orders/PresentationTable.tsx` (whole file — rewrite below)

**Interfaces:**
- Consumes: `money`, `Th`, `Td`, `Tf`, `AddonLines`, `UnitPrice` from `./presentationCells` (Task 1); `OPTION_COLUMNS`, `OPTION_COLUMN_LABELS`, `describeLineBreakdown`, `OptionCell`, `OptionColumn` from `../../lib/optionBreakdown` (unchanged).
- Produces: `PresentationTable({ items: LineItem[]; showBreakdown: boolean })` — default export. Task 3 passes both props.

Column order becomes `Room | Blind type | Size (cm) | options… | Qty | Unit | [Adjustment] | Line total | Note`. The Adjustment column now requires `showBreakdown` **and** a non-zero adjustment; the footer gains blank cells under Unit and Note.

- [ ] **Step 1: Replace the file's contents**

```tsx
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * The order view's blinds table — one row per blind, one column per option
 * type, and a `<tfoot>` carrying a total for every money column.
 *
 * Purely presentational: it renders exactly the rows it is handed, so the
 * page owns filtering and this component's totals are automatically "the
 * totals for what is on screen". All option money comes from
 * `describeLineBreakdown`, which guarantees each row's cells plus its
 * adjustment equal the stored line total — so the footer sums are real
 * money, not indicative figures.
 *
 * `showBreakdown` governs PER-CHOICE money only: the option cells' `+$`
 * amounts, their footer totals, the add-on prices, and the Adjustment
 * column. Option NAMES, add-on LABELS, Qty, Unit, Note, every row's Line
 * total and the footer's overall total are on screen in both states — the
 * toggle hides what each individual choice cost, never what a line cost.
 *
 * Adjustment hides with the rest rather than persisting: it holds the money
 * no option column explains (add-ons, plus the gap a price override
 * opened), so with the breakdown off it would be the last visible fragment
 * of an otherwise-hidden decomposition, reading as an unexplained charge.
 *
 * Columns for option types no visible blind carries are dropped entirely
 * rather than rendered full of dashes: an order of plain rollers should not
 * present a customer with four empty columns. That is independent of the
 * toggle — a column survives on whether any row NAMES an option, not on
 * whether its price is showing. The table scrolls inside its own container
 * so the page body never scrolls sideways on a tablet.
 */

import { useMemo } from 'react';
import {
  OPTION_COLUMNS,
  OPTION_COLUMN_LABELS,
  describeLineBreakdown,
  type OptionCell,
  type OptionColumn,
} from '../../lib/optionBreakdown';
import { AddonLines, Td, Tf, Th, UnitPrice, money } from './presentationCells';
import type { LineItem } from '../../types';

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

/**
 * One option cell: the chosen option's name, with what it added to this
 * line beneath it while the breakdown is showing.
 *
 * An option that adds nothing prints its name alone even with the
 * breakdown on — a customer reading a column of "$0.00" learns nothing and
 * starts wondering what it means.
 */
function OptionValue({ cell, showBreakdown }: { cell: OptionCell; showBreakdown: boolean }) {
  if (cell.name === null) return <>—</>;
  return (
    <>
      <span className="block">{cell.name}</span>
      {showBreakdown && cell.amount !== null && cell.amount !== 0 && (
        <span className="mt-0.5 block font-mono text-xs text-text-muted">
          +{money(cell.amount)}
        </span>
      )}
    </>
  );
}

export default function PresentationTable({
  items,
  showBreakdown,
}: {
  items: LineItem[];
  showBreakdown: boolean;
}) {
  /**
   * Rows, their surviving column set, and every footer figure — recomputed
   * only when the visible items change. A column survives when at least one
   * visible row fills it, so the table narrows as the filters narrow.
   *
   * `showBreakdown` is NOT a dependency here: every figure below is
   * computed either way and the toggle decides what is rendered. Folding it
   * in would recompute the whole table on a switch flip for no change in
   * result, and would make `hasAdjustment` mean two things at once.
   */
  const { rows, columns, totals, adjustmentTotal, overall, quantityTotal, hasAdjustment } =
    useMemo(() => {
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
      return {
        rows,
        columns,
        totals,
        adjustmentTotal:
          Math.round(rows.reduce((sum, row) => sum + row.breakdown.adjustment, 0) * 100) / 100,
        overall: Math.round(rows.reduce((sum, row) => sum + row.breakdown.lineTotal, 0) * 100) / 100,
        quantityTotal: rows.reduce((sum, row) => sum + (Number(row.item.quantity) || 0), 0),
        hasAdjustment: rows.some((row) => row.breakdown.adjustment !== 0),
      };
    }, [items]);

  // The column earns its width only when there is adjustment money AND the
  // breakdown is on to explain it.
  const showAdjustment = showBreakdown && hasAdjustment;

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full min-w-[1100px] border-collapse">
        <thead>
          <tr className="border-b border-border bg-surface-muted">
            <Th>Room</Th>
            <Th>Blind type</Th>
            <Th right>Size (cm)</Th>
            {columns.map((column) => (
              <Th key={column}>{OPTION_COLUMN_LABELS[column]}</Th>
            ))}
            <Th right>Qty</Th>
            <Th right>Unit</Th>
            {showAdjustment && <Th right>Adjustment</Th>}
            <Th right>Line total</Th>
            <Th>Note</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-light">
          {rows.map(({ item, breakdown }, i) => (
            <tr key={item.id}>
              <Td>
                <span className="block">{item.room_name || `Blind ${i + 1}`}</span>
                <AddonLines item={item} showBreakdown={showBreakdown} />
              </Td>
              <Td>{item.blinds_type || '—'}</Td>
              <Td right mono>
                {size(item)}
              </Td>
              {columns.map((column) => (
                <Td key={column}>
                  <OptionValue cell={breakdown.cells[column]} showBreakdown={showBreakdown} />
                </Td>
              ))}
              <Td right mono>
                {item.quantity}
              </Td>
              <Td right mono>
                <UnitPrice item={item} />
              </Td>
              {showAdjustment && (
                <Td right mono>
                  {breakdown.adjustment === 0 ? '' : money(breakdown.adjustment)}
                </Td>
              )}
              <Td right mono>
                {money(breakdown.lineTotal)}
              </Td>
              <Td>{item.note || '—'}</Td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border bg-surface-muted">
            <Tf>
              {rows.length} blind{rows.length !== 1 ? 's' : ''}
            </Tf>
            {/* Blind type and Size have nothing to sum. */}
            <Tf>{''}</Tf>
            <Tf>{''}</Tf>
            {columns.map((column) => (
              <Tf key={column} right>
                {showBreakdown && totals.get(column) ? money(totals.get(column)) : ''}
              </Tf>
            ))}
            <Tf right>{quantityTotal}</Tf>
            {/* Unit prices summed across rows is not a number that means
                anything to anyone; the column exists per-row only. */}
            <Tf>{''}</Tf>
            {showAdjustment && <Tf right>{adjustmentTotal ? money(adjustmentTotal) : ''}</Tf>}
            <Tf right>{money(overall)}</Tf>
            <Tf>{''}</Tf>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run from `apps/web`:
```bash
pnpm check && pnpm lint && pnpm test
```
Expected: **one** `tsc` error, in `OrderPresentation.tsx`, of the form *"Property 'showBreakdown' is missing…"* at the `<PresentationTable items={shown} />` call site. That is the expected red state — Task 3 closes it. `pnpm test` must be 0 failures regardless, since no test file imports this component.

If `tsc` reports anything else, or if `optionBreakdown.test.ts` fails, stop and report.

- [ ] **Step 3: Do NOT commit yet**

This task leaves the tree not type-checking, so it is committed together with Task 3. Proceed straight to Task 3.

---

### Task 3: Other-items table, toggle state, and the totals strip

Closes the type error Task 2 opened.

**Files:**
- Create: `apps/web/src/pages/orders/PresentationOtherItems.tsx`
- Modify: `apps/web/src/pages/orders/OrderPresentation.tsx` (whole file — rewrite below)

**Interfaces:**
- Consumes: `money`, `Th`, `Td`, `AddonLines`, `UnitPrice` from `./presentationCells` (Task 1); `PresentationTable({ items, showBreakdown })` from Task 2; `BreakdownToggle({ value, onChange })` from Task 1.
- Produces: `PresentationOtherItems({ items: LineItem[]; showBreakdown: boolean })` — default export, consumed by `OrderPresentation` only.

- [ ] **Step 1: Create `PresentationOtherItems.tsx`**

```tsx
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * The order view's preset/custom lines — everything that is not a blind:
 * call-out fees, site measures, one-off charges.
 *
 * A table rather than a list, matching the blinds table above it, because
 * these lines carry the same money columns (Qty, Unit, Total) and a
 * customer reading down the page should not meet two different shapes for
 * the same information. It absorbed the deleted Order Overview page's
 * "Other Items" table wholesale.
 *
 * These lines have no options — `describeLineBreakdown` returns every cell
 * empty for them — which is exactly why they are not rows in the blinds
 * table. `showBreakdown` therefore reaches only their add-on prices.
 *
 * The header subtotal is the sum of the STORED `line_total`s of the lines
 * shown. Nothing here is derived from a rate or a percentage; the order's
 * own money lives on the page's totals strip and is read verbatim from the
 * server row.
 */

import { useMemo } from 'react';
import { AddonLines, Td, Th, UnitPrice, money } from './presentationCells';
import type { LineItem } from '../../types';

export default function PresentationOtherItems({
  items,
  showBreakdown,
}: {
  items: LineItem[];
  showBreakdown: boolean;
}) {
  const total = useMemo(
    () => Math.round(items.reduce((sum, item) => sum + (Number(item.line_total) || 0), 0) * 100) / 100,
    [items]
  );

  return (
    <section className="rounded-lg border border-border bg-surface print:break-inside-avoid">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
        <h3 className="text-base font-semibold text-text-primary">
          Other items{' '}
          <span className="text-sm font-normal text-text-muted">
            ({items.length} item{items.length !== 1 ? 's' : ''})
          </span>
        </h3>
        <span className="font-mono text-sm font-semibold text-text-primary">{money(total)}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse">
          <thead>
            <tr className="border-b border-border bg-surface-muted">
              <Th>Type</Th>
              <Th>Description</Th>
              <Th right>Qty</Th>
              <Th right>Unit</Th>
              <Th right>Total</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-light">
            {items.map((item, i) => (
              <tr key={item.id}>
                <Td>{item.item_type === 'preset' ? 'Preset' : 'Custom'}</Td>
                <Td>
                  {/* Title heads the cell; a row saved before titles existed
                      has only a description, which takes its place. */}
                  <span className="block">{item.title || item.description || `Item ${i + 1}`}</span>
                  {item.title && item.description && (
                    <span className="mt-0.5 block whitespace-pre-line text-xs text-text-muted">
                      {item.description}
                    </span>
                  )}
                  <AddonLines item={item} showBreakdown={showBreakdown} />
                </Td>
                <Td right mono>
                  {item.quantity}
                </Td>
                <Td right mono>
                  <UnitPrice item={item} />
                </Td>
                <Td right mono>
                  {money(item.line_total)}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Replace `OrderPresentation.tsx`'s contents**

```tsx
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Order view (`/orders/:id/present`) — the app's ONE read-only order
 * screen, reached from the "Present to Customer" action at every stage of
 * the order detail page.
 *
 * It serves two readings of the same page. Turned toward a customer it is
 * the presentation: every blind is one row, every option type is a column,
 * and the filter bar narrows the list live during the conversation — "just
 * the cordless ones", "the bedroom" — with every total following. Read by
 * a consultant alone it is the itemised listing the separate Order
 * Overview page used to be, carrying notes, unit prices, add-ons and the
 * outstanding balance.
 *
 * The `Price breakdown` switch beside the order number is what spans those
 * two readings. ON reveals what each individual CHOICE cost; OFF leaves
 * option and add-on names on screen without their money. It starts OFF on
 * every load and is not persisted — a consultant reveals the breakdown
 * deliberately rather than discovering the last session's state on a
 * screen already facing a customer. It never touches a line total or an
 * order total: those are on screen in both states, so the page cannot
 * disagree with the estimate the customer was sent.
 *
 * The action SAVES before navigating here: this page reads the server row,
 * so an unsaved draft would otherwise be presented stale.
 *
 * Money discipline (AI_GUIDELINES §1). Two different numbers are on screen
 * and they are labelled apart on purpose:
 *   - the table's overall total is the sum of the stored `line_total`s of
 *     whatever is currently visible, and moves with the filters;
 *   - the order strip (subtotal / discount / HST / total / paid / balance)
 *     is read VERBATIM from the server row and never recomputed. Applying
 *     13% to a filtered subset would put a fabricated number in front of a
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
import BreakdownToggle from './BreakdownToggle';
import PresentationFilterBar from './PresentationFilterBar';
import PresentationOtherItems from './PresentationOtherItems';
import PresentationTable from './PresentationTable';
import { money } from './presentationCells';
import {
  buildFacets,
  hasOptionFilter,
  matchesFilters,
  type PresentationFilter,
} from './presentationFilters';

/** One line of the order-total strip. */
function TotalRow({
  label,
  value,
  strong = false,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  /** Overrides the value's colour, e.g. a settled balance in green. */
  tone?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span
        className={strong ? 'text-sm font-semibold text-text-primary' : 'text-sm text-text-muted'}
      >
        {label}
      </span>
      <span
        className={`font-mono ${strong ? 'text-base font-semibold text-text-primary' : 'text-sm text-text-secondary'} ${tone ?? ''}`}
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
  const [showBreakdown, setShowBreakdown] = useState(false);

  // Stable reference so the memos below don't recompute every render.
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

  const customerName = order?.customer ? displayName(order.customer) : '';
  const amountPaid = Number(order?.amount_paid ?? 0);
  const balance = order ? Math.round((Number(order.total) - amountPaid) * 100) / 100 : 0;

  return (
    <div className="min-h-screen bg-surface-muted print:bg-white">
      <PageHeader
        title="Order"
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
            {/* Order meta. The breakdown switch sits on the title row: it
                changes what the whole page shows, not one section of it. */}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-text-primary">{order.order_number}</h2>
                {(customerName || order.order_date) && (
                  <p className="text-sm text-text-muted">
                    {[customerName, order.order_date].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <BreakdownToggle value={showBreakdown} onChange={setShowBreakdown} />
                <StatusBadge status={order.status} />
              </div>
            </div>

            <PresentationFilterBar facets={facets} filters={filters} onChange={setFilters} />

            {shown.length === 0 ? (
              <div className="rounded-lg border border-border bg-surface p-8 text-center">
                <p className="text-sm text-text-muted">
                  {blinds.length === 0
                    ? 'This order has no blinds.'
                    : 'No blinds match these filters.'}
                </p>
                {blinds.length > 0 && (
                  <button
                    onClick={() => setFilters([])}
                    className="mt-3 text-sm font-medium text-brand-600 underline"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              <PresentationTable items={shown} showBreakdown={showBreakdown} />
            )}

            {showOtherItems && (
              <PresentationOtherItems items={otherItems} showBreakdown={showBreakdown} />
            )}

            {/* Server-authoritative order money. Never recomputed here, and
                never governed by the breakdown toggle. */}
            <section className="rounded-lg border border-border bg-surface p-4 print:break-inside-avoid">
              <TotalRow label="Subtotal" value={money(order.subtotal)} />
              {Number(order.discount_amount) > 0 && (
                <TotalRow label="Discount" value={`−${money(order.discount_amount)}`} />
              )}
              <TotalRow
                label={`HST (${Math.round(Number(order.tax_rate) * 100)}%)`}
                value={money(order.tax_amount)}
              />
              <TotalRow label="Order total" value={money(order.total)} strong />
              {amountPaid > 0 && (
                <>
                  <TotalRow label="Paid" value={`−${money(amountPaid)}`} />
                  <TotalRow
                    label="Balance due"
                    value={money(balance)}
                    strong
                    tone={balance <= 0 ? 'text-success' : undefined}
                  />
                </>
              )}
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

- [ ] **Step 3: Verify**

Run from `apps/web`:
```bash
pnpm check && pnpm lint && pnpm test
```
Expected: 0 errors, 0 warnings, 0 test failures. The Task 2 type error is now closed.

`OrderOverview.tsx` still exists and still compiles at this point — it is deleted in Task 4.

- [ ] **Step 4: Commit Tasks 2 and 3 together**

```bash
git add apps/web/src/pages/orders/PresentationTable.tsx \
        apps/web/src/pages/orders/PresentationOtherItems.tsx \
        apps/web/src/pages/orders/OrderPresentation.tsx
git commit -m "feat(orders): order view absorbs overview columns behind a breakdown toggle"
```

---

### Task 4: Delete Order Overview and repoint every entry to the merged view

**Files:**
- Delete: `apps/web/src/pages/orders/OrderOverview.tsx`
- Modify: `apps/web/src/App.tsx:30`, `apps/web/src/App.tsx:101`
- Modify: `apps/web/src/pages/orders/OrderDetail.tsx` — file-header JSDoc (~lines 26-33), `ICONS.overview` (~lines 440-445), `stageActions()` (~lines 2033-2145)
- Modify: `apps/web/src/pages/orders/OrderLabels.tsx:116`

**Interfaces:**
- Consumes: the `present` `StageAction` already defined inside `stageActions()`.
- Produces: nothing new. This task only removes.

- [ ] **Step 1: Delete the page**

```bash
git rm apps/web/src/pages/orders/OrderOverview.tsx
```

- [ ] **Step 2: Drop the route and its lazy import from `App.tsx`**

Delete line 30 entirely:
```tsx
const OrderOverview = lazy(() => import('./pages/orders/OrderOverview'));
```

Delete line 101 entirely:
```tsx
<Route path="/orders/:id/overview" element={guard(<Layout><OrderOverview /></Layout>)} />
```

Leave the `/orders/:id/present` route on line 102 untouched.

- [ ] **Step 3: Drop `ICONS.overview` from `OrderDetail.tsx`**

Delete this whole entry from the `ICONS` object:
```tsx
  overview: (
    <ActionIcon>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3 6h.01M3 12h.01M3 18h.01" />
    </ActionIcon>
  ),
```
Leave `ICONS.present` — it is now the icon for every stage.

- [ ] **Step 4: Rewrite `stageActions()` to use `present` everywhere**

Delete the `overview` `StageAction` declaration entirely:
```tsx
    const overview: StageAction = {
      key: 'overview',
      icon: ICONS.overview,
      label: 'Order Overview',
      short: 'Overview',
      onClick: () => window.open(`/orders/${id}/overview`, '_blank', 'noopener'),
    };
```

Replace its JSDoc sentence — *"The Order Overview action is included at every post-draft stage and opens `/orders/:id/overview` in a new tab."* — with:
```
   * The Present to Customer action is included at EVERY stage: it opens
   * the app's one read-only order view, which serves both the customer
   * conversation and the consultant's itemised read.
```

Then substitute `overview` → `present` in each return, so the five stages become exactly:

```tsx
    if (status === 'awaiting_payment') {
      // …reverse declared above…
      return { primary: null, secondary: [reverse, present] };
    }
```
```tsx
      return { primary: markReady, secondary: [manufacturer, labels, present] };
```
```tsx
      return { primary: propose, secondary: [markInstalled, present] };
```
```tsx
    if (status === 'installed') {
      return { primary: null, secondary: [present] };
    }
```
```tsx
    // Expired — the estimate lapsed but was never confirmed.
    return { primary: null, secondary: [present] };
```

`draft` (`{ primary: confirm, secondary: [present] }`) and `sent` (`{ primary: confirm, secondary: [present] }`) already read this way — `sent` loses its trailing `, overview`. Leave `handlePresent` untouched: save-then-navigate in the same tab is correct at every stage.

- [ ] **Step 5: Update the `OrderDetail.tsx` file-header JSDoc**

Replace:
```
 *   installed        → (none beyond the Overview)
 * Every post-draft stage additionally offers an Order Overview action
 * that opens `/orders/:id/overview` in a NEW TAB — a read-only,
 * itemised listing of the line items (sizes, options, notes, totals).
 * Every UNCONFIRMED stage (draft, sent, expired) offers a Present to
 * Customer action directly below Confirm, which saves and then navigates
 * to `/orders/:id/present` — the filterable, per-option view shown to the
 * customer in person.
```
with:
```
 *   installed        → (none beyond Present to Customer)
 * EVERY stage offers a Present to Customer action, which saves and then
 * navigates in the same tab to `/orders/:id/present` — the app's one
 * read-only order view. It is filterable and per-option for the customer
 * conversation, and carries notes, unit prices, add-ons and the balance
 * for the consultant's own read; a switch on its title row reveals or
 * hides what each individual choice cost. It replaced a separate Order
 * Overview page in 2026-08.
```

- [ ] **Step 6: Fix the `OrderLabels.tsx` prose**

At line 116, replace:
```
        view (the cut sheet and the order overview are both Letter).
```
with:
```
        view (the cut sheet and the order view are both Letter).
```

- [ ] **Step 7: Verify**

Run from `apps/web`:
```bash
pnpm check && pnpm lint && pnpm test
```
Expected: 0 errors, 0 warnings, 0 test failures.

Then confirm nothing still points at the dead route — run from the repo root:
```bash
grep -rn "OrderOverview\|orders/:id/overview\|/overview" apps/ --include=*.ts --include=*.tsx
```
Expected: no output. Any hit is a dangling reference to fix before committing.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/App.tsx \
        apps/web/src/pages/orders/OrderDetail.tsx \
        apps/web/src/pages/orders/OrderLabels.tsx \
        apps/web/src/pages/orders/OrderOverview.tsx
git commit -m "refactor(orders): delete Order Overview, one order view at every stage"
```

---

### Task 5: Knowledge base and memory bank

Required by AI_GUIDELINES §4 and §5 — the task is incomplete without it.

**Files:**
- Modify: `knowledge/history/engine_features.md`
- Modify: `memory-bank/activeContext.md`
- Modify: `memory-bank/progress.md` (line ~135 names the dead route)

**Interfaces:** none — documentation only.

- [ ] **Step 1: Append a dated entry to `knowledge/history/engine_features.md`**

Match the file's existing heading level and entry shape (read the last entry first). Content:

```markdown
### 2026-08-28 — One order view: Present absorbs Overview

`/orders/:id/overview` and `OrderOverview.tsx` are gone. `/orders/:id/present`
is the app's only read-only order view and now carries everything Overview did
— the Note column, the Unit price with its `show_original_price` strikethrough,
add-on sub-lines, the Other-items table (Type | Description | Qty | Unit |
Total), and Paid / Balance due on the totals strip.

A `Price breakdown` switch on the title row (`BreakdownToggle`) governs
PER-CHOICE money only: option cells' `+$` amounts, their footer totals, add-on
prices, and the Adjustment column. Option names, add-on labels, every line
total, the footer overall and the order totals strip are on screen in both
states — the page can never disagree with the estimate the customer was sent.
It defaults OFF and is not persisted: ON is the selling state, revealed
deliberately with the tablet already turned around.

The Adjustment column hides WITH the breakdown rather than persisting. It holds
the money no option column explains (add-ons, plus the gap a price override
opened), so on its own it reads as an unexplained charge.

Overview's amber "price overridden" dot is dropped. `show_original_price` — a
real privacy control, not a display preference — is now the whole story, and it
is independent of the toggle in both directions.

Every stage of the order detail page offers one **Present to Customer** action
(same tab, saves first). `stageActions()` no longer has an `overview` entry.

New: `presentationCells.tsx` (shared `money`/`Th`/`Td`/`Tf`/`AddonLines`/
`UnitPrice`), `BreakdownToggle.tsx`, `PresentationOtherItems.tsx`.
`optionBreakdown.ts` and `presentationFilters.ts` were NOT touched.

Spec: `knowledge/specs/2026-08-28-unified-order-view-design.md`
```

- [ ] **Step 2: Update `memory-bank/progress.md`**

Around line 135 the material-usage note lists `/orders/:id/present`, and `/orders/:id/overview`. Remove the dead route from that sentence so it names `/orders/:id/present` alone. Read the surrounding sentence and rewrite it to read naturally — do not leave a dangling comma or an orphaned "and".

Then scan the file for any other statement implying two read-only order views and correct it in place. **Overwrite; do not append a dated entry** — `progress.md` is a current-state snapshot, not a changelog (AI_GUIDELINES §5).

- [ ] **Step 3: Update `memory-bank/activeContext.md`**

Overwrite the "Current Focus" / "Recent Changes" sections to describe what is true NOW: the app has one read-only order view at `/orders/:id/present`, with a breakdown toggle; Order Overview no longer exists. Link to the `engine_features.md` entry rather than re-narrating it. Again: overwrite, do not append.

- [ ] **Step 4: Commit**

```bash
git add knowledge/history/engine_features.md memory-bank/activeContext.md memory-bank/progress.md
git commit -m "docs: record the unified order view"
```

---

### Task 6: Browser verification

This is where the change is actually proven — there are no component tests standing in for it. Do not skip it and do not report the work complete without it.

**Files:** none modified (unless a defect is found — then fix, re-verify, and amend the relevant commit).

- [ ] **Step 1: Prepare fixture data**

Pick or build ONE order that exercises every branch at once:

| Needs | Why |
|---|---|
| ≥2 blinds of different `blinds_type` | option columns, the Blind type column |
| One blind with a `note` | the new Note column |
| One blind with an add-on | add-on sub-line, label vs price gating |
| One blind with a price override, `show_original_price` **ticked** | strikethrough must appear in BOTH toggle states |
| One blind with a price override, `show_original_price` **unticked** | strikethrough must appear in NEITHER state |
| ≥1 preset or custom item, one with a title AND description | the promoted Other-items table |
| A recorded payment (partial) | Paid / Balance due rows |

If no such order exists, build one in the app rather than editing the database directly — pricing is server-authoritative and hand-written rows will not reconcile.

- [ ] **Step 2: Open the app and navigate to the view**

Start the dev server through the Browser pane's `preview_start` (never `Bash`). Add an entry to `.claude/launch.json` if one does not exist. Open the order, then click **Present to Customer**.

Note: `apps/web/.env` must supply the Supabase config or the app renders blank — check it exists before concluding the page is broken.

- [ ] **Step 3: Check the toggle-OFF state (the default)**

Confirm on load, without touching the switch:
- the switch reads **Price breakdown** and is off;
- option cells show NAMES with no `+$` beneath them;
- the add-on sub-line reads `+ <label>` with **no** price;
- there is **no** Adjustment column;
- Qty, Unit, Line total and Note columns are all present;
- the footer shows the blind count, the Qty total, the overall total, and **blank** cells under every option column;
- the totals strip shows Subtotal, HST, Order total, Paid and Balance due.

- [ ] **Step 4: Check the toggle-ON state**

Flip the switch. Confirm:
- option cells gain `+$` amounts, except any option whose amount is exactly 0 (name alone is correct there);
- the add-on sub-line gains its price;
- the Adjustment column appears, with a footer total;
- **every line total is byte-identical to what it was with the toggle off**, as is the footer overall and the whole totals strip. This is the plan's central invariant — if any of these move, stop and report.

- [ ] **Step 5: Check the override strikethrough**

In BOTH toggle states: the ticked line shows its struck-through original beside the unit price; the unticked line shows the charged unit price alone. No amber dot on either.

- [ ] **Step 6: Check the filter bar still drives the totals**

Apply an option filter. Confirm the blinds table narrows, the footer totals follow, the Other-items section disappears, and the strip's "Showing N of M blinds · order total unchanged" note appears while the order total itself does not move. Clear the filters.

- [ ] **Step 7: Check print and narrow widths**

Print-preview in both toggle states: the switch and the Print button must be absent from paper, and the state on screen is the state on the page. Then `resize_window` to the tablet preset and confirm the tables scroll inside their own containers with no horizontal scroll on the page body.

- [ ] **Step 8: Check every stage's entry point**

For at least `installed` (or the latest stage available on a real order), confirm the action bar offers **Present to Customer**, that clicking it lands on this page in the SAME tab, and that no Order Overview button remains anywhere.

- [ ] **Step 9: Report**

Screenshot both toggle states and hand them over with the results. If any step failed, fix the source, re-run `pnpm check && pnpm lint && pnpm test`, and re-verify from Step 3 before reporting.

---

## Plan Self-Review

**Spec coverage** — every section maps to a task:

| Spec section | Task |
|---|---|
| Entry point (stage table, same-tab, title copy) | 4 (actions), 3 (title) |
| The toggle (default off, not persisted, `print:hidden`, ON = selling) | 1 (component), 3 (state) |
| What the toggle governs (the full table) | 2 (blinds), 3 (other items) |
| Adjustment hidden when off | 2 |
| The price override / `show_original_price`, amber dot dropped | 1 (`UnitPrice`) |
| Absorbed: Note, Unit, add-on sub-lines | 2 |
| Absorbed: Other-items table | 3 |
| Absorbed: Paid / Balance due | 3 |
| Column order + blank Unit/Note footer cells | 2 |
| Modules (3 new, 5 changed, 1 deleted) | 1, 2, 3, 4 |
| Verification (check/lint/test, suites untouched, manual pass) | every task, plus 6 |
| Documentation (engine_features, memory-bank) | 5 |

**Type consistency** — the prop is `showBreakdown: boolean` in `PresentationTable`, `PresentationOtherItems`, `AddonLines` and `OptionValue`; `BreakdownToggle` alone takes `value` / `onChange`, because it is a control rather than a consumer of the state. `money` has one definition (in `presentationCells.tsx`), negative-aware, imported by all four consumers — the old duplicate in `OrderPresentation.tsx` is deleted in Task 3 Step 2 and the old duplicate in `PresentationTable.tsx` in Task 2 Step 1.

**Deliberate red state** — Task 2 leaves `tsc` failing at one call site and is committed with Task 3. This is called out explicitly in Task 2 Step 2 with the exact expected error, so an executor cannot mistake it for a defect.

**Known non-obvious risk** — the blinds table's `min-w` rises from `900px` to `1100px` (Task 2) to absorb Unit and Note. Task 6 Step 7 exercises it at the tablet preset.
