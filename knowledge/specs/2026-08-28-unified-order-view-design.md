# Unified order view — Present absorbs Overview

**Date:** 2026-08-28
**Status:** Approved — ready for implementation

## Problem

An order has two read-only views and neither is complete.

**Order Overview** (`/orders/:id/overview`) is the internal itemised listing:
one table per blind type, every field in its own column (Width, Height,
Material, Colour, Cassette, Bottom rail, Control, Installation, Qty, Unit,
Total, Note), add-on sub-lines, the price-override strikethrough, and
Paid / Balance due. It has no filtering and no per-option money — it shows
what each blind cost, never what each *choice* cost. Opened in a new tab from
every post-draft stage.

**Order Presentation** (`/orders/:id/present`) is the customer-facing view:
one row per blind, one column per option type carrying what that choice added,
a live filter bar, and footer totals for every money column. It drops the
Note, the unit price, the add-ons and the balance entirely.

So a consultant needing the full picture opens both, in two tabs, and the
per-option money — the one thing worth showing a customer — is on the screen
that hides the least customer-friendly detail while the internal screen shows
prices it should not. The split is backwards.

## Goal

One order view. `/orders/:id/present` survives and absorbs everything Overview
carried, and a single toggle beside the title governs whether per-option money
is on screen. Per-line totals and the order totals are visible either way.

## Non-goals

- Per-blind-type tables. All blinds stay in one filterable table; the existing
  **Blind type** column already carries that information and the filter bar
  narrows across the whole order in one place.
- Splitting Size back into Width and Height columns. `(120 + 80) × 210` stays.
- Any change to pricing, totals, or the server row. This is a rendering
  change end to end — AI_GUIDELINES §1 is untouched, no money is recomputed.
- Changing `optionBreakdown.ts` or `presentationFilters.ts`, and therefore
  their test suites.

## Entry point

`ICONS.overview` and the `overview` `StageAction` are removed from
`OrderDetail.tsx`. Every `secondary` array that held `overview` holds the
existing `present` action instead:

| Status | Primary | Secondary |
|---|---|---|
| `draft` | Confirm | Present |
| `sent` | Confirm | Present |
| `awaiting_payment` | — | Reverse Confirmation, Present |
| `in_progress` | Mark Ready | Cut Sheet, Labels, Present |
| `ready` | Propose Installation | Mark Installed, Present |
| `installed` | — | Present |
| `expired` | — | Present |

`handlePresent` is unchanged: it saves, then navigates in the SAME tab. The
new-tab behaviour Overview had is dropped deliberately — the page reads the
server row, so an unsaved edit would otherwise be shown stale, and a
`window.open` after an `await` is treated as a popup and blocked (the reason
`handlePresent` navigates in-tab in the first place).

`readOnly` is a hardcoded `false` today, so `canAct` reduces to `!saving` and
no stage loses access by moving from Overview's plain `window.open` to
save-then-navigate.

The page title becomes **Order**, not *Order Presentation*: it is now the only
order view, shown both across a table to a customer and alone by a consultant.

## The toggle

`BreakdownToggle` — a labelled switch beside the order-number heading, owned by
`OrderPresentation` as `useState(false)`.

- **Off on every load, never persisted.** The consultant reveals the breakdown
  deliberately; no previous session can leave it on screen unexpectedly.
- **On is the selling state.** The breakdown is what justifies a price to a
  customer ("the cassette added $40, the motor $180"), so ON is what you flip
  to with the tablet turned around, not what you hide before turning it.
- `print:hidden` on the control itself. Whatever state is on screen is what
  prints — there is one printable view, not two.

## What the toggle governs

| Element | Toggle OFF | Toggle ON |
|---|---|---|
| Option cell names (Material, Colour, Cassette, Bottom rail, Control, Installation) | shown | shown |
| Option cell `+$` amounts | **hidden** | shown |
| Footer per-column totals | **blank** | shown |
| Add-on label (`+ Blackout`) | shown | shown |
| Add-on price | **hidden** | shown |
| Adjustment column | **hidden** | shown |
| Room, Blind type, Size, Note, Qty | shown | shown |
| Unit price | shown | shown |
| Struck-through original price | governed by the line's `show_original_price` alone | governed by the line's `show_original_price` alone |
| **Line total** (per row) | shown | shown |
| **Overall total** (table footer) | shown | shown |
| Order totals strip (Subtotal / Discount / HST / Total / Paid / Balance) | shown | shown |

The rule in one sentence: **the toggle hides what each individual choice cost,
never what a line or the order cost.**

Hiding the Adjustment column with the rest of the breakdown is deliberate. It
holds the money no option column explains — add-ons, plus the gap a price
override opened. With option amounts and add-on prices hidden it would be the
only visible fragment of a breakdown that is otherwise off, and would read as
an unexplained charge or an unexplained discount. Off means off: with the
toggle down, add-on and override money exists only inside the line total.

### The price override

`show_original_price` is a per-line checkbox in the editor ("Show original
price to customer") and it alone decides whether the struck-through original
prints — independent of the toggle. The figure it governs is already a real
privacy control (the public endpoint omits it entirely when false), so the
page must not second-guess it in either direction: a line marked shareable
shows its "was" price to the customer, a line not marked shareable never does.

The amber "price overridden" dot from Overview is **dropped**. Overview was
internal-only, so a marker meaning "someone typed this price" was fair there.
On a page that can face a customer, a bare amber dot on a line whose
`show_original_price` is false is an unexplained internal marker —
`show_original_price` is the whole story now.

## What Present absorbs

**Blinds table** (`PresentationTable`) gains, from Overview:

- a **Note** column (`item.note`, last, matching Overview's column order);
- a **Unit** column with the strikethrough, between Qty and Line total;
- **add-on sub-lines** under the room name, indented, price gated by the
  toggle.

Column order, left to right, becomes: Room | Blind type | Size (cm) |
*options…* | Qty | Unit | *Adjustment* | Line total | Note — Overview's
Qty | Unit | Total | Note tail, with the option columns and the Adjustment
column in the positions Present already gives them. The footer gains a blank
cell under Unit and under Note: neither sums to anything a customer should
read (a column of unit prices added together is not a number that means
anything), and the Adjustment footer cell disappears with its column.

Everything else about the table is unchanged: one row per blind, option
columns dropped when no visible row fills them, filter-driven footer totals.

**Other items** is promoted from the current inline `<ul>` to a real table
matching Overview's `FlatItemsTable`: Type | Description | Qty | Unit | Total,
with the description sub-line and the add-on lines the list currently drops.
It keeps its present behaviour of dropping out once an option filter is
active — "the cordless ones" cannot meaningfully include a call-out fee.

**Totals strip** gains **Paid** and **Balance due**, rendered only when
`amount_paid > 0`, with the balance in `text-success` once it reaches zero.
Both come from the server row.

## Modules

New:

- `apps/web/src/pages/orders/presentationCells.tsx` — the shared table
  primitives: `money` (negative-safe, U+2212 leading), `Th` / `Td` / `Tf`,
  `AddonLines`, `UnitPrice`. The last two are rescued from `OrderOverview`
  before it is deleted; both the blinds table and the other-items table need
  them, which is what makes this a module rather than a local helper.
- `apps/web/src/pages/orders/BreakdownToggle.tsx` — the switch. One
  responsibility, a `boolean` and an `onChange`.
- `apps/web/src/pages/orders/PresentationOtherItems.tsx` — the promoted
  other-items table, taking `items` and `showBreakdown`.

Changed:

- `PresentationTable.tsx` — `showBreakdown` prop; Note and Unit columns;
  add-on lines; option amounts, footer column totals and the Adjustment
  column gated.
- `OrderPresentation.tsx` — toggle state, Paid / Balance rows, wires the new
  components, title copy.
- `App.tsx` — drop the `OrderOverview` lazy import and the
  `/orders/:id/overview` route.
- `OrderDetail.tsx` — drop `ICONS.overview` and the `overview` action, use
  `present` at every stage, update the file-header JSDoc (it currently
  documents the Overview new-tab behaviour and the `installed → (none beyond
  the Overview)` stage line).
- `OrderLabels.tsx` — one prose mention of "the order overview" in the
  print-rules comment.

Deleted:

- `OrderOverview.tsx`.

No file crosses the 800-line ceiling; `PresentationTable.tsx` lands around
280 lines and `OrderPresentation.tsx` around 250.

## Verification

`pnpm check`, `pnpm test` and `pnpm lint` in `apps/web`. The existing
`optionBreakdown.test.ts` and `presentationFilters.test.ts` suites must stay
green untouched — if either needs editing, something outside this scope moved.

No new unit tests: the web suite is pure-logic only (`.test.ts`, no
testing-library, no jsdom), and every behaviour this change introduces is
rendering. The invariant worth protecting — that a row's cells plus its
adjustment equal the stored line total — already has coverage in
`optionBreakdown.test.ts`, and is unaffected because the toggle hides cells
without changing what they hold.

Manual pass in the browser preview: an order with a price override on one line
(box ticked) and another (box unticked), an add-on, a note, and a payment
recorded — checked with the toggle both ways, plus a print preview of each.

## Documentation

- `knowledge/history/engine_features.md` — one dated entry for the merge.
- `memory-bank/activeContext.md` and `progress.md` — overwrite the relevant
  sections; the app now has one order view, not two. `progress.md:135` names
  `/orders/:id/overview` explicitly and must lose it. `systemPatterns.md`,
  `techContext.md` and `productContext.md` carry no Overview reference and are
  left alone.
