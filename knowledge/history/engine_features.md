# Engine Features / Feature History

## 2026-08-25 — Maintenance mode closes the customer surfaces
Migration 40 (`20260825000040_company_maintenance_mode.sql`) adds two columns to the
`company_settings` singleton: `maintenance_mode boolean not null default false` and
`maintenance_message text not null default ''`. Existing installs stay OPEN across the
migration, and the flag is never NULL, so the Worker always has a boolean to branch on.

**Gate** (`apps/api/src/routes/public.ts`). A single `app.use('*')` registered AFTER the rate
limiter and BEFORE every handler reads the singleton and, while the flag is on, answers
`503 { error, maintenance: true, message }` — the staff wording, or `MAINTENANCE_FALLBACK`
when it is blank. All eight public routes close together (estimate view/ping/confirm/
cancel-request/cancel-withdraw, appointment view/confirm/request) and no order or appointment
row is read or written while closed. `/api/*` is deliberately untouched: being able to keep
working while customers are held off is the whole point. A FAILED settings read is treated as
"open" — a transient Supabase error must not take the customer site down by itself.

**Settings** (`apps/api/src/routes/settings.ts`). `companySchema` gained `maintenance_mode`
(boolean) and `maintenance_message` (≤500 chars). Still `.strict()` and still a partial update;
no money surface is involved.

**Staff UI.** The switch lives on Company Info (`apps/web/src/pages/settings/CompanyInfo.tsx`)
as its own card, and it is the ONE control there that does not wait for the Save button —
toggling persists immediately, carrying whatever message is currently typed, because a kill
switch a user believes they flipped while the app quietly kept serving customers is the worst
failure this feature has. The switch reads the SERVER's flag (optimistically patched by the
mutation), never local form state. `MaintenanceBanner` (`apps/web/src/components/`) is mounted
once in `Layout` and renders an amber strip on every authenticated page while the flag is on —
without it nothing in the staff app would look any different while customers are turned away.

**Customer UI.** `maintenanceMessage(res, body)` (`apps/web/src/lib/maintenance.ts`) is the one
rule for "closed vs broken": it requires BOTH a 503 and the explicit `maintenance` flag, so a
proxy 503 or a cold Worker still falls through to the normal error path. `CustomerView` and
`AppointmentView` each hold a `maintenance` state, check every response (load AND actions, so a
switch flipped mid-visit lands correctly), and render a "Back shortly" card that outranks their
"not found" state — a closed shop must never tell a customer their order does not exist.

### Verified
api 428/428 with 4 new public-route tests (all eight routes 503 with the flag, configured
message vs fallback, no order write while closed, everything live when off) and 4 new settings
tests (both fields accepted, non-boolean rejected, >500-char message rejected, unknown key
still 400); web 425/425 with 4 new `maintenance.test.ts` cases. `tsc` clean and `oxlint` clean
both sides. Two pre-existing public tests were retitled: a malformed token now costs ONE
`company_settings.select` (the gate) before its 404 — the invariant they pin, no `orders`
access from a junk token, is unchanged and still asserted. NOT verified in a browser: needs the
migration applied first.

**Deployment order matters**: apply the migration BEFORE deploying the Worker — the settings
PUT and the public gate both reference the new columns.

## 2026-08-25 — Calendar under-grid sections show upcoming appointments only
Web-only, one file (`apps/web/src/pages/calendar/ScheduleSections.tsx`). The two lists under
the calendar grid ("Estimate appointments" / "Installation appointments") rendered every event
in the visible month range, so a month filled up with visits that were already done and the
staff worklist buried what still needed doing.

New local `hasPassed(dateIso, time)` treats an appointment as past once its 1-hour visit
window has ENDED — `new Date(y, mo-1, d, h+1, m) < new Date()` — the same `[time, time+1h)`
window `whenLabel` already prints, so a row never disappears while it is still being shown as
in progress. Both sections now filter from one `upcoming` array; empty copy became
"No upcoming … this month."

Deliberately NOT hidden anywhere else: past appointments keep their chips on the grid above
(the month view is still a record of the month) and the paginated "See All" page
(`/appointments`, date-desc) is unchanged and remains the archive. No API, hook or query
change — the filter is client-side over data `useCalendarEvents` already returns.

Consequence to expect: paging back to a fully past month leaves both sections empty while the
grid above still shows chips. That is intended; the archive is one tap away via "See All".

### Verified
web `tsc --noEmit` clean, `oxlint` clean, vitest 399/399 (no test targets this component —
⚠️ no covering tests exist for `ScheduleSections`). Not exercised in a browser.

## 2026-08-25 — Material usage breaks down per window
Web-only (no API, schema or pricing surface), off `main` at `6f3cff0`. The Material usage
dialog reported only order-wide and per-material totals, so "12.40 m² of Blackout Ivory" could
not say whether that was one oversized opening or six ordinary ones — which is exactly the
check a consultant makes before giving fabric away at a rate.

**`MaterialUsageLine` (`apps/web/src/pages/orders/materialUsage.ts`).** Each
`MaterialUsageRow` now carries `lines: MaterialUsageLine[]` — one entry per contributing
window, in the order the editor lists them, always `lineCount` long. Each holds the draft
`key`, a `label` (`room_name`, falling back to `Blind N` by position in the FULL item list,
matching `OrderDetail.tsx` and `PresentationTable.tsx`), `blindType`, `widthCm`/`heightCm`,
`itemQuantity`, and the same three figures the row is summed from: `quantity`,
`measuredQuantity`, `amount`.

Not a second calculation. The line figures are the SAME `describeMaterialUsage` reading and
the SAME `describeUnitCosts(inputs).material` product the row accumulates — the loop now
pushes what it just added rather than deriving it again — so a row and its breakdown cannot
drift. A test asserts the sum identity across all three figures.

`widthCm`/`heightCm` are the MEASURED dimensions, before any minimum. They identify the
window; a 60cm blind shown as its billed 100cm would not. The measured-vs-billed gap keeps
being reported once per unit at the bottom of the dialog, where it already was.

**The dialog** (`MaterialUsageDialog.tsx`) renders the breakdown as a `<ul>` under each
material's rate line, in that row's own unit — m² for the m²-priced types, running metres for
Curtains, driven by `row.unit` with no per-type branch. `dimensionsOf` prints `140 × 200 cm`
for `sqm` and `300 cm wide` for `running_m`, because Curtains price on finished width alone
and a drop printed beside a metre figure it played no part in reads as related to it. `×N`
appears only when a line carries more than one blind, and the blind type appears only when
one material row spans more than one type. The rail trigger is unchanged — still the
order-wide one-liner.

**Collapsed by default** (same day, follow-up). The breakdown is a disclosure — a `Per window`
button (chevron, `aria-expanded`/`aria-controls`) inside a new non-exported `LineBreakdown`
component — and it starts CLOSED. The dialog's job is the rate decision, and twenty windows
across four materials would push the rate boxes and the give-back calculator off screen before
the consultant reached them; the breakdown answers the follow-up question, so it waits to be
asked. Its `open` flag is LOCAL `useState`, the one deliberate exception to the "every piece
of state is lifted" rule in `MaterialUsageDialogProps`: that rule exists because `Modal`
unmounts its children on close and because the trigger renders at two breakpoints, and
neither applies to a panel that renders once inside the dialog and is SUPPOSED to be forgotten
on dismissal. Each button carries its own `aria-label` (material name + unit) because the
visible text is "Per window" on every row.

### Verified
web 399/399 (9 new in `materialUsage.test.ts`: editor order, the sum identity, line quantity,
the Curtains running-metre case, measured-not-billed dimensions, the `Blind N` fallback
numbering past a preset, and exclusion of hidden/incomplete lines from the breakdown),
`tsc --noEmit` clean, `oxlint` clean. NOT verified in a browser — the dialog still needs a
live order with catalogs behind it.

## 2026-08-25 — Bulk edit v3: a mixed or still-typeless selection is editable
Web-only (no API, schema or pricing surface), off `main` at `262aabe`. Bulk edit stops
refusing two of its four selection verdicts and resolves them in the popup instead, which is
what makes "these three rows should all become Roller" a one-pass operation.

**Two blockers become states.** `BulkEditBlocker` (`lineItemDrafts.ts`) is now
`'empty' | 'non_blind'` — `no_type` and `mixed_types` are gone. `bulkEditSelection` returns
`{ ok, blindsType, mixed, keys }`, where `blindsType` is the type every selected blind shares
and `''` when they do not share one, and `mixed` is true when the selection spans two or more
distinct type values (a blank type counts as one of them, so Roller + blank is `mixed`). An
ALL-blank selection is therefore `blindsType: ''` with `mixed: false` — the rows agree, they
just agree on having no type — and a mixed one is `blindsType: ''` with `mixed: true`. The
two render the same way; `mixed` only picks the wording.

**The popup has two shapes, keyed on whether a scope exists.** `BulkEditForm` takes the new
`mixed` prop and gates every option control on `effectiveType = state.blinds_type ||
blindsType`:

- **Shared type (or blank-and-agreed):** unchanged from v2 — Blind type ("No change"
  pre-filled), Colour, then Material and whichever hardware dropdowns that type uses.
- **No effective type yet:** ONLY the two unscoped fields render — Blind type and Colour —
  plus one line saying why ("The selected items are of different blind types. Pick one
  above…" / "The selected items have no blind type yet."). Every catalog is scoped per type,
  so a grid of empty dropdowns would read as "this type has nothing set up" rather than
  "choose a type first". Picking a type immediately reveals that type's options, still
  "No change"-pre-filled, in the same popup.

**"No change" stays available on a mixed selection** (maintainer's call): it keeps each row's
own type and limits the run to colour, which is the only field that is never scoped. So a
colour-only bulk edit across mixed types — impossible before, because the selection was
refused outright — now works.

**Applying a type is still the reset gesture, not a diff.** `applyBulkPatch` is UNCHANGED:
any non-empty `patch.blinds_type` routes the item through `applyTypeDefaults(item, type,
catalogs)` with no `keepValid`, so options land on that type's saved defaults and
`pricingChanged` clears `unit_price_override` — even for an item that was ALREADY on the
picked type. That is deliberate: a mixed selection unified onto Roller must leave every
selected row identical, and skipping the rows that happened to be Roller already would leave
their old options behind. Colour-only patches still never clear an override.

**Toolbar.** The Edit button is now disabled only for `empty` / `non_blind`. Its `title` and
the count line say which state the selection is in rather than which rule it breaks:
"3 selected · mixed blind types", "2 selected · no blind type yet", "2 selected · Roller".
The popup heading follows the same three cases ("Editing 3 items of different blind types.").

### Files
`apps/web/src/pages/orders/lineItemDrafts.ts` (`BulkEditBlocker`, `BulkEditSelection`,
`bulkEditSelection`), `LineItemEditor.tsx` (`BulkEditForm` + `mixed`), `OrderDetail.tsx`
(toolbar verdict wording, popup heading, `openBulkEdit` doc). `lineItemBulk.ts` untouched.

### Verified
web `pnpm check` clean, `pnpm lint` 0/0, `pnpm test` 392/392 (23 files) — up from 389 with
three new cases: mixed and all-blank selections resolve as `ok` with the right `mixed` flag,
a still-typeless item takes the picked type's defaults, and re-picking the type an item
already has still resets it onto those defaults. Not driven in a browser (no `apps/web/.env`
in this worktree — see `memory-bank/activeContext.md`). Not deployed.

## 2026-08-22 — Material usage becomes a dialog, with per-material discount rates
Two changes to the panel added earlier the same day (entry below), driven by the panel
being unreadable in the ~280px summary rail and by the need to discount ONE fabric
rather than the whole job.

**The panel is now a dialog.** `MaterialUsagePanel.tsx` was renamed to
`MaterialUsageDialog.tsx` and split into two exports. `MaterialUsageTrigger` is a
single stateless summary row ("Material usage · 5.60 m²") that still renders above the
discount control at BOTH totals sites; `MaterialUsageDialog` is the content, built on
`components/ui/Modal` (bottom sheet below `lg`, centred dialog above) and rendered
EXACTLY ONCE for the page, beside the other overlays. Rendering it twice — the pattern
the old inline panel used — would stack two dialogs when open. Rows are now stacked
cards rather than table rows, which is what makes a per-row editor fit at all.

**Per-material discount rates.** Each material row carries a rate box prefilled with the
catalog rate, a reset button INSIDE the box, and a "Discount $X" button. Typing a lower
rate and applying adds `(catalog rate − typed rate) × that material's billed quantity`
to the order's fixed discount: $73/m² dropped to $70 over 10.72 m² is $32.16 off.

**NOTHING touches a line item.** Both instruments are pure discount math — no unit price
is overridden and no line is repriced, so a price a consultant typed by hand on a line is
never at risk. (An earlier iteration of this feature did write per-line
`unit_price_override` and was replaced; the override path, its `material_rate_applied`
provenance flag and `materialRateOverrides.ts` are all gone.)

**The composition is additive and reversible**, via `applyGiveBackPart` in
`materialUsage.ts`. A second Apply sits ON TOP of the first rather than replacing it;
re-applying one row SWAPS that row's own figure instead of stacking a second copy;
Reset (amount `0`) takes exactly that row's figure back out; and anything typed into the
discount field by hand is the base all of it sits on. The contributions are held in a
session-only `Record<key, number>` keyed by `materialRowKey` (plus `ORDER_WIDE_GIVE_BACK`),
so after a reload the discount is a plain dollar figure and Reset can no longer take an
earlier session's contributions back out — stated on screen. Applying anything switches a
PERCENTAGE discount to fixed, which discards the percentage; the dialog warns first.

**The order-wide give-back is unchanged in intent and still present**, in its own section
at the bottom: one $/metre figure across every material. It now composes through the same
additive path (and gained a "Remove $X" button) rather than overwriting the field, so it
can no longer silently wipe a per-material contribution. Applying it on top of a
per-material rate still double-counts the overlapping fabric, and the dialog says so in red.

Rate rises are clamped, not honoured: a rate typed ABOVE the catalog rate yields $0.00 and
a disabled button with an explanation, because the discount field has no meaningful
negative. `summarizeMaterialUsage` now also reports `lineCount` per row. New pure helpers
`materialRowKey`, `rowGiveBack` and `applyGiveBackPart` live in `materialUsage.ts` with
tests in `materialUsage.test.ts` (30 total). Nothing under `lib/` changed, so the api/web
pricing twins are untouched, and no stored price can move.

## 2026-08-22 — Material usage panel + `describeMaterialUsage`
An internal order-editor panel that turns "how much fabric is this order, and at what
rate?" into an answerable question, plus the one new blind-type method it needed.
Money paths are unchanged — see the §4.2 rationale below for why the existing material
formula was deliberately left alone.

**The Material usage panel** (`apps/web/src/pages/orders/MaterialUsagePanel.tsx`), a
`<details>` rendered immediately above the discount control at BOTH totals sites in
`OrderDetail.tsx` (the `xl:hidden` mobile totals card and the desktop summary rail, via
a single `materialUsagePanel` JSX variable so the two cannot drift). It lists billed
quantity, rate, and material-leg revenue per material — grouped by material AND rate
unit, so a m²-priced fabric and a running-metre Curtains fabric never pool into one
number — with a footer note when billed area exceeds measured area (minimum-width/
height inflation). It accepts a `$/m²` rate and, only when a `running_m` row exists, a
separate `$/m` rate, computes the resulting give-back in dollars, and an Apply button
writes that dollar figure into the order's existing FIXED discount
(`setDiscountType('fixed')` + `setDiscountValue`) — there is no stored per-m² discount
type. **It is internal-only**: never shown to a customer, never printed, absent from
the PDF, the public customer view, `/orders/:id/present`, and `/orders/:id/overview`.
**The give-back rate is scratchpad state, not persisted anywhere.** Reopening the order
later shows only the plain dollar discount that resulted — no record of the $/m² or
$/m that produced it survives a reload; the panel says so on screen in its own JSDoc
and copy so nobody assumes otherwise. Rows exclude hidden lines (matching the order
totals), and preset/custom/incomplete-blind lines are counted into an `excludedCount`
note rather than priced with a guessed area. Manual price overrides and custom add-ons
never distort the reported figures: `amount` is computed from the option-derived
material leg (`describeUnitCosts(inputs).material × qty`), never from the stored/
overridden unit price.

Aggregation lives in a new pure, React-free `apps/web/src/pages/orders/materialUsage.ts`
(`summarizeMaterialUsage`, `giveBackAmount`), built and tested independently of the
component (`materialUsage.test.ts`). To share the price preview's exact completeness
gating (same `slotsForType`, `resolveCatalogRefs`, attribute parsing) instead of a
second looser copy, `lineItemDrafts.ts` now exports `blindDraftInputs(draft, catalogs)`
— the priced-inputs assembly extracted out of `blindDraftPrice`, which is rewritten as
a thin caller of it. `lineItemDrafts.test.ts` was not edited and still pins
`blindDraftPrice`'s behaviour unchanged.

**`BaseBlindType.describeMaterialUsage(item)`** — a new PUBLIC method added to BOTH
blind-type twins (`apps/api/src/lib/blindTypes/base.ts`, `apps/web/src/lib/blindTypes/
base.ts`), alongside `describeUnitCosts` (2026-08-20) as the second first-class
reporting concept on the hierarchy. Returns `{ unit: 'sqm' | 'running_m'; quantity;
measured }` for ONE blind, on the SAME minimised dimensions `materialCost` charges.
`quantity` is BILLED — width/height minimum rules applied, matching what the material
leg actually charged; `measured` skips the minimums and exists only for the panel's
footer figure, never for pricing. Nine of the ten canonical types inherit the base
`sqm` formula unchanged. **Curtains overrides it** (`blindTypes/curtains.ts`, both
twins) to report `running_m`: only the width minimum is applied (Curtains ignores
height, as `materialCost` already does), the pleat-fullness multiplier is applied to
the minimised width, and the per-panel hem allowance is added AFTER that
multiplication — mirroring `materialCost`'s own shape exactly, hem included outside
the fullness math.

**Why `materialCost` was NOT refactored to derive from `describeMaterialUsage`**
(design §4.2, `knowledge/specs/2026-08-21-material-usage-discount-design.md`). The
obvious refactor — `materialCost = describeMaterialUsage(item).quantity × rate` — would
make "material leg equals usage × rate" true by construction. It was rejected: `(W × H
× price) / 10000` and `((W × H) / 10000) × price` are not bit-identical in IEEE-754,
and reassociating the material leg on a production system with historical orders could
move a stored cent at a half-cent boundary — the same class of hazard
`HARDWARE_LEG_ORDER` (2026-08-20) exists to contain. **The compromise is two separate
expressions of one idea, held together by a test rather than by construction.** Both
`pricing.test.ts` suites (api and web) gained a consistency case table spanning every
blind type — under-minimum width, under-minimum height, tier boundaries, multi-panel,
and Curtains at several pleat multipliers — asserting `describeUnitCosts(item).material
≈ describeMaterialUsage(item).quantity × material_price_per_sqm` to within a tenth of a
cent. **Deleting that test removes the only guard against the two expressions
drifting apart** — there is no other mechanism keeping them in sync.

**Warning for future maintainers, stated in the base method's own JSDoc:** any new
blind type that overrides `materialCost` MUST also override `describeMaterialUsage`
AND add a row to the `CASES` table in both `pricing.test.ts` suites — that table is
hand-maintained, not derived from the blind-type registry, so it does not self-extend.
A new type with a divergent `materialCost` and no new `CASES` row drifts silently
rather than failing the consistency test above. Curtains is the only type that needs
the override
today, but the rule applies to any future type with a divergent material formula.

### Verified
web `pnpm check` clean, `pnpm test` 377/377 (23 files), `pnpm lint` 0/0; api `pnpm
check` clean, `pnpm test` 391/391 (19 files). `lineItemDrafts.test.ts` passed
unmodified, confirming the `blindDraftInputs` extraction did not change
`blindDraftPrice`'s behaviour. **Not verified in a running browser.** The dev server
boots but `apps/web/src/lib/supabaseClient.ts` throws at module init
(`Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY`) because no `apps/web/.env`
exists in this worktree, so the app never renders past a blank page — no login screen,
no route, nothing to click. The panel's underlying calculation is covered by
`materialUsage.test.ts`, but nobody has seen it on screen: not the collapsed summary
line, not the expand/rate/Apply flow, not the discount field actually updating, not
mobile layout, not the two-rate-input case (a `running_m` row present). This is a known
open item, not a soft "should probably check" — see `memory-bank/progress.md`.

## 2026-08-20 — Order Presentation view (filters + per-option column totals) + `describeUnitCosts`
A new customer-facing page, plus the one pricing change it needed. Money paths are
behaviourally unchanged — see the bit-identical note below.

**`BaseBlindType.describeUnitCosts()` (both twins, `lib/blindTypes/base.ts`).** The per-leg
costs behind `calculateUnitPrice` (the material leg plus one `hardwareCost` call per slot the
blind carries) were both `protected`, so no surface could say what an individual option cost
without a SECOND copy of the basis maths. A new public `describeUnitCosts(item):
UnitCostBreakdown` returns them, and `calculateUnitPrice` is now the sum of its result rather
than a parallel calculation — the same reasoning that made `curtains.ts` stop computing its
own control charge ("duplicating that maths here is what used to let the two drift apart").
A hardware key is ABSENT, not zero, when the blind carries no charge on that slot.

- **The refactor is bit-identical, not merely equivalent, and that took care.** Floating-point
  addition is NOT associative. The old code summed hardware from zero and added material last
  (`material + ((h1 + h2) + h3)`); a naive `sum(Object.values(breakdown))` would produce
  `(((material + h1) + h2) + h3)`, a different association, a possible last-ULP difference and
  therefore in principle a different cent at a half-cent boundary. So `calculateUnitPrice`
  destructures the material leg OUT of the reduction, and `describeUnitCosts` inserts hardware
  legs in the fixed order `cassette, bottom_rail, control, installation` — already the
  insertion order both callers use (`resolveLineItems` on the Worker, `previewUnitPrice` in the
  editor). Both `pricing.test.ts` suites gained the same 5 assertions, including a key-order
  test that exists purely to protect this; every pre-existing expected value passed unmodified.

**`lib/optionBreakdown.ts` (web).** Turns a SAVED `LineItem` back into pricing inputs from its
own snapshot columns — nothing else in the app did this; the editor builds them from the
catalog and the Worker from catalog rows at save time. Returns per-column cells
(`material | color | cassette | bottom_rail | control | installation`), an adjustment, and the
stored line total.

- **Cells are FITTED to the stored price, not summed independently of it.** `line_total` is
  `round2(unit_price × qty) + addonsTotal(addons)`, so `Σ round2(leg × qty)` is a different
  number — with five legs it can differ by two or three cents (verified case: W=101, H=205,
  $47.50/m², cassette $5.66/m, rail $6.66/m, control $19.99/panel, install $33.33, qty 4 →
  naive material cell $393.40 against a row needing $393.38). Left alone that shows a phantom
  adjustment on an ordinary line, which is exactly the "why doesn't this add up?" moment the
  column exists to prevent. So hardware cells are computed directly and the MATERIAL cell
  closes the gap: it is always present and always the largest leg.
- `base_unit_price` is read in preference to `unit_price`, because on an overridden line that
  is the price the OPTIONS produced — leaving the override itself to appear as the adjustment.
  Same definition `originalLineTotal` already uses for the "was" price.
- Invariant, directly tested: `Σ cells + adjustment === line_total`, exactly, on every row —
  so `Σ column totals === overall total` too. The adjustment is therefore only ever real money
  (a price override, custom add-ons), never rounding noise.

**`/orders/:id/present` (`pages/orders/OrderPresentation.tsx`, lazy + guarded route).** One row
per blind, one column per option type carrying what that choice cost, `<tfoot>` totals under
each column. Columns for option types no visible blind carries are dropped entirely (an order
of plain rollers renders narrow, not four columns of `—`), as is the Adjustment column when no
visible line has one. An option costing nothing prints its bare name — no `$0.00`. `hidden`
line items are excluded throughout (unlike `/overview`, which still shows them).

- **Filter bar (`PresentationFilterBar.tsx` + pure `presentationFilters.ts`):** stacked
  `[field] [value] [✕]` rows plus "+ Add filter". Every value is harvested from the ORDER's own
  line items with a blind count (`Cordless (3)`), so a filter that matches nothing cannot be
  built; a field no blind carries a value for is omitted from the dropdown entirely. Counts are
  over ALL blinds, not the filtered subset, so they don't jump while a filter is being built.
  **AND across fields, OR within one** — "cordless AND fabric-wrapped" narrows, "cordless OR
  motorised" widens; ANDing everywhere would make two values of one field a guaranteed empty
  table. A valueless row matches everything, so adding a filter never blanks the table
  mid-gesture. Zero matches gets an explicit message, not a table with a `$0` footer.
- **Two totals, deliberately labelled apart.** The table's overall total is `Σ line_total` of
  what is visible and moves with the filters. The order strip (subtotal → discount → HST →
  total) is read VERBATIM from the server row and never recomputed (AI_GUIDELINES §1) —
  applying 13% to a filtered subset would put a fabricated number in front of a customer. While
  filtered it carries "Showing 6 of 14 blinds · order total unchanged". Preset/custom lines get
  an "Other items" section that counts toward the overall total but drops out once an OPTION
  filter is active ("the cordless ones" cannot include a call-out fee).
- **Entry point:** a "Present to Customer" `StageAction` (`ICONS.present`) placed FIRST in
  `secondary` on the unconfirmed stages only — `draft` (which had no secondary actions at all
  before), `sent` and `expired` — so it renders directly below the primary Confirm button in
  both the desktop rail and the mobile sticky bar. It SAVES first (`const savedId = await
  save()`, the `handleConfirm` pattern) because the page reads the server row, then navigates
  in the SAME tab rather than `window.open` — a popup opened after an `await` is blocked, and
  handing one tablet across a table beats juggling tabs.
- Money helper here takes the sign OUT of the dollar interpolation (`−$21.20`, not `$-21.20`)
  because the adjustment column goes negative on a discounted line — caught in browser
  verification, not by a test.

Verification: web `pnpm check` clean, `pnpm test` 336/336 (22 files), `pnpm lint` 0/0; api
`pnpm check` clean, `pnpm test` 345/345 (18 files). The components were driven through a
throwaway component-level Vite entry (the same technique used for the bulk-add row) at 1280px
and 768px: AND/OR combination, column dropping, the empty state, exact reconciliation of every
footer figure, 44px selects, and a body that does not scroll sideways while the table scrolls
inside itself. Not yet driven inside the real authenticated app on a device.
## 2026-08-20 — Installed orders quote the outstanding balance in "How to pay"
Web-only (no API, schema, or pricing surface). An installed order that still owes money now
shows the customer HOW MUCH to send, not just where.

**`PaymentSection`** (`apps/web/src/components/PaymentSection.tsx`) previously took a single
`depositDue?: number` and hard-coded the "Deposit due now (50% of total)" caption and deposit
lead-in. Its figure slot is now a general `amountDue?: { amount; caption; instruction }`
descriptor — the same amber box, the caller supplies the label. The component stays purely
presentational and still never computes money.

**`CustomerView`** (`apps/web/src/pages/customer-view/CustomerView.tsx`) builds that descriptor
from server figures only (AI_GUIDELINES rule 1): the Worker's `deposit_due` with
"Deposit due now (50% of total)" while the order awaits its first payment, or the Worker's
`balance` (`total − amount_paid`, already in the payload) with "Pay your balance" once the order
is `installed` and `balance > 0`. A partial deposit not yet at 50% still falls through to a
"how to pay" with no headline figure, as before. The mount rule (`showHowToPay`) is unchanged.

- This is the ONE figure now shown in two places on purpose: the totals block keeps the running
  "Balance due", and the installed customer also sees that amount in the payment box, beside the
  e-Transfer address they send it to. The deposit still appears nowhere else.

### Verified
web `tsc` clean, `oxlint` clean, `pnpm test` 305/305. The box's markup is unchanged from the
already-shipping deposit box (only caption/amount/lead-in differ), confirmed against a
token-accurate static render of both states; not exercised on the live token-gated customer
page — the standing project-wide gap.

## 2026-08-20 — Editing an expired estimate's validity date revives it to draft
API-only (no web, schema, or pricing surface). Reopening a lapsed estimate no longer leaves it
stuck on the `expired` tab: extending its expiry date brings it back into the workflow.

**`PUT /api/orders/:id`** (`apps/api/src/routes/orders.ts`) now, after resolving the incoming
`expiry_date`, computes `reviveToDraft = existing.status === 'expired' && expiry_date >= today`
and, when true, writes `status: 'draft'` alongside the recalculated totals. The threshold is the
exact inverse of the `expiry_date < today` rule that expired the order in `applyDefensiveExpiry`
(so "today or later" un-expires; a still-past date leaves it expired). The target is `draft`,
never `sent`, on purpose — no fresh estimate has reached the customer, so a new `/send` is the
only path back to `sent`. Only an `expired` order is ever rewritten; every other status passes
through untouched. The revive gets its own line in the activity trail
("Expiry extended to today or later — estimate revived to draft.") on top of the usual
"Order edited (was expired)." entry.

No web change was needed: the editor already allows editing at any stage and shows the top-bar
Save on an expired order (`OrderDetail.tsx` — "send after updating the expiry date"), and the
page derives `status` straight from the server response (`existing?.status`) cached by
`useCacheOrder`, so the revived `draft` renders on save with no client-side status logic.

- Test harness gained update-payload capture (`db.updatePayloads`, mirroring `db.insertPayloads`)
  so the written `status` can be asserted — updates were previously only counted in `db.calls`.

### Verified
api `tsc` clean, `pnpm test` 343/343 (three new cases in
`PUT /api/orders/:id — expiry revive`: future expiry → `draft`, still-past expiry → unchanged,
non-expired order → status never written). Not exercised on a live signed-in order — staff
routes are behind `ProtectedRoute`, the standing project-wide gap.

## 2026-08-20 — "Add order" from an appointment: new order with the customer pre-filled
Web-only (no API, schema, or pricing surface). A consultant looking at an appointment can turn
the visit into an order in one tap.

**AppointmentDetail** (`apps/web/src/pages/calendar/AppointmentDetail.tsx`) gains an "Add
order" button (brand-filled, first in the customer block's button row, shown whenever the
appointment has a customer — both estimate and installation visits). It links to
`/orders/new?customer=<customer.id>`.

**OrderDetail** reads that param and pre-fills the customer picker. `prefillCustomerId` is the
`?customer=` value but ONLY for a new order (`id` absent); `useCustomer(prefillCustomerId)`
fetches it (the hook is disabled on `undefined`, so no request fires for an edit or a param-
less `/orders/new`). A one-time effect (`prefillApplied` ref) drops the fetched customer into
the existing `customer` state, and only while the consultant hasn't already picked one — so a
later change or clear from the picker is never undone, and the apply never repeats. From there
the order saves through the ordinary path (`customer_id: customer.id`); nothing about pricing
or persistence changed.

- Query param, not router state: it survives a refresh and needs no new plumbing, and the
  single-customer GET (`useCustomer` → `GET /api/customers/:id`) already existed.
- The pre-fill is a convenience only — the customer picker, quick-add, and clear all still work
  exactly as before.

### Verified
web `tsc` clean, `oxlint` clean, `pnpm test` 305/305. Live/on-device click-through
(appointment → Add order → order opens with customer set) not run — staff routes are behind
`ProtectedRoute` + live data, the standing project-wide gap.

## 2026-08-20 — 50% deposit gates the production trigger; customer "how to pay" windowed; auto-scroll on confirm
Three changes, one to money-lifecycle logic (api) and two to the public customer page (web).

**Production now begins at the 50% deposit, not the first dollar.** `recordOrderPayment`
(`apps/api/src/lib/payments.ts`) previously advanced `awaiting_payment → in_progress` on ANY
first payment. It now re-reads the order total and the full ledger AFTER inserting the payment
and advances only when paid-to-date reaches the standard 50% deposit (`round2(total / 2)`,
with a half-cent `DEPOSIT_EPSILON` — the same figure `routes/public.ts` `depositDue` quotes
and `lib/etransferMatch.ts` recognises). A sub-deposit payment is still recorded; it just
leaves the order awaiting payment. Because both the staff Record-Payment route and the
e-Transfer webhook share this one helper, the gate applies identically to both doors.

- **Manual progress is deliberately NOT gated.** A staff member can still advance an
  under-deposited order to production by hand — that is the status-PUT/mark path, a different
  route, untouched here. The gate only stops a token payment from doing it automatically.
- **Auto-revert on payment deletion is unchanged**: `DELETE /:id/payments/:paymentId` still
  rolls `in_progress → awaiting_payment` ONLY when the ledger is emptied (last payment
  removed), never merely because paid dropped back below 50% — a manual/threshold advance is
  not auto-undone. (Deliberate decision, 2026-08-20.)
- Reading the ledger post-insert (not deriving from `input.amount`) means a run of smaller
  payments that together cross 50% triggers production exactly like one payment that clears
  it.

**Customer page — "HOW TO PAY" is now windowed to when the customer actually owes a
transfer.** It used to mount on `confirmed && balance > 0`. It now mounts on `showHowToPay`
(`CustomerView.tsx`): confirmed, balance > 0, AND (`!depositPaid` OR status is `installed`).
So it shows while the deposit is outstanding, hides once the 50% is in and the order is in
production / ready (nothing is expected from the customer then), and reappears at installation
if a final balance remains. `depositPaid` compares `amount_paid` to the server's `deposit_due`
(never derived client-side — AI_GUIDELINES rule 1) with the same half-cent tolerance, falling
back to "any payment recorded" only if a Worker predating `deposit_due` served the payload.
`PaymentSection` itself is unchanged (still renders whenever mounted); only the caller's mount
rule and the two doc comments moved. The "PAYMENTS RECEIVED" receipt list still shows each
payment, but its "Paid to date" subtotal row was removed — the customer sees the individual
receipts and the "Balance due" line, without the running-total line in between.

**Customer page — confirming scrolls back to the top.** Confirm is tapped from the fixed bar
at the bottom; after the successful confirm + reload, `handleConfirm` calls
`window.scrollTo({ top: 0, behavior: 'smooth' })` (optional-chained for non-browser test
envs) so the customer lands on the payment instructions and tracker rather than the middle of
the order.

### Verified
api `tsc --noEmit` clean, `pnpm test` 340/340 (new: three cases under `POST /api/orders/:id/
payments — 50% production trigger` — advances at the deposit, advances when a later payment
tops the ledger over it, records a sub-deposit payment without advancing). web `tsc` clean,
`oxlint` clean, `pnpm test` 305/305. Visual/on-device verification of the customer page
remains the standing project-wide gap (the page sits behind a token + live API), not run here.

## 2026-08-19/20 — Bulk-add refinements: legacy popup retired, panel shorthand, incomplete-row capture, contrast pass
Web-only (no API, schema, or pricing surface). Branch `feat/defaults-bulk-lineitems`, spec
`.superpowers/sdd/2026-08-18-bulkadd-refinements/` (continues from the 2026-08-17/18 batch
below). Ten commits across five tasks, all reviewed (several with fix rounds) and committed —
`git log --oneline 1f28c9f..1620e4a`.

- **The older single-config "Add Measurements in Bulk" popup is retired** (`ada348c`) — fully
  superseded by the 2026-08-17 `BulkAddSheet.tsx` entry below, which does everything the older
  popup did (blank-blind capture, no type/material required) and more (multi-section, per-
  section shared config). Deleted: `BulkMeasureForm` from `LineItemEditor.tsx` (420 → 283
  lines); from `lineItemDrafts.ts` — `MeasurementRow`, `newMeasurementRow`,
  `MeasurementRowState`, `measurementRowState`, `MeasurementRowCounts`,
  `countMeasurementRows`, `measurementRowsToDrafts` (777 → 671 lines, back under the 800-line
  cap the file had been sitting right at); from `OrderDetail.tsx` — the `'bulkMeasure'` sheet
  state, `measureRows`, `openBulkMeasure`, `applyBulkMeasure`, `closeBulkMeasure` (3290 → 3168
  lines). A follow-up commit (`a7c5149`) corrected the JSDoc on `NO_ADJUSTMENTS` and
  `newBlindDraft`'s `BlindDraftDefaults` in `lineItemDrafts.ts`, both of which still named "the
  bulk measurement popup" as a shared call site after it was gone — missed on the first pass
  because the prose named no deleted identifier, only described a deleted concept.
  `lineItemDrafts.ts` sits at 680 lines after that doc expansion, still under the cap.

- **New pure module `panelInput.ts`** (`90801c0`, extended `da5c852`/`cccc973`/`f69a3f0`, now
  186 lines) — `parsePanelInput`/`formatPanelInput` implement a typed shorthand where
  `118.5+118` in one width field means two panels (118.5cm and 118cm), so a consultant can
  type instead of tapping "+ Panel" for every extra panel. Deliberately does NOT validate that
  a split part is a valid positive number — `parsePositive` (`lineItemDrafts.ts`) and the
  save-time rules already own numeric validation, and this function runs on every keystroke
  while the field is still mid-edit, so a half-typed `12.` (about to become `12.5`) has to
  survive completely untouched or the cursor and the digit being typed get clobbered. Wired
  into both entry forms (`da5c852`), per an explicit maintainer ruling that the shorthand
  applies to both but the single form keeps its own "+ Panel" button too: bulk-add rows now
  carry ONE `width_cm` string (`BulkMeasureRow.width_cm`) instead of a `panels` array —
  `expandBulkSections`, `validateBulkSections`, `bulkAddHasContent`/`bulkRowHasContent` and
  `BulkAddSectionCard.tsx` all read that one field, with the previous panels array gone from
  all of them — and the single-blind form's `PanelWidths` (`blindForms/fields.tsx`) accepts
  the same shorthand alongside its existing "+ Panel" button.
  - **A bug in the live split was found and fixed during review** (`cccc973`) — see
    `bug_fixes.md` 2026-08-19.
  - **`insertPanelSeparator`** (added `f69a3f0`, a fix-round finding on the contrast/layout
    task below) backs a 44px "+" button beside the bulk-add width input only — the single-item
    form does not get one, since its own "+ Panel" button already solves the same problem and
    a second plus-shaped control beside it would be two similar buttons doing different
    things. The button exists because `inputMode="decimal"` gives iOS's on-screen keypad no
    `+` key at all, making the shorthand otherwise untypeable on the target device.
    `insertPanelSeparator` replaces the input's current text SELECTION with `+` (a collapsed
    selection — the ordinary case, just a caret — degrades to a plain insert at that position),
    the same behaviour any native text field gives a keystroke landing on a selection; an
    earlier version of the button ignored `selectionEnd` and only inserted at `selectionStart`.

- **Bulk add now accepts rows before the blind type or material are known** (`b41fa94`,
  refined `ced893d`) — the on-site flow is "measure everything fast, configure after."
  `validateBulkSections` no longer requires a blind type, material or any hardware slot; it
  still rejects a section with zero rows and a present-but-malformed width or height (blank is
  fine — a typo like `'12a'` or a stray `'-5'` is not), and — only once a type IS chosen —
  still runs the type's `attributeSchema` against the section's `attributes` via
  `parseDraftAttributes`. `expandBulkSections` now skips an entirely blank row
  (`bulkRowHasContent`: no room name, no width, no height typed) instead of turning it into an
  empty line item; a row with only one of the three filled in still expands, carrying its
  unfilled fields through as empty strings. Completeness is enforced exactly where it always
  was — `buildPayload` in `OrderDetail.tsx` blocks the save and names the first incomplete
  item by number, same as a blind added one at a time with nothing picked yet. Bulk EDIT
  (`lineItemBulk.ts`) is how a whole batch of incomplete items gets filled in at once
  afterwards, back at the customer's house or later at a desk. Verified during review: a
  blank-type item's `material_id` is always empty too, so `buildPayload` catches it on the
  material check before it would ever reach an unguarded attribute parse — nothing incomplete
  can silently reach the Worker.
  - **A second bug was found and fixed in review** (`ced893d`) — see `bug_fixes.md`
    2026-08-19.

- **Contrast/layout pass on the bulk-add sheet** (`1cf5800`, two fix rounds: `f69a3f0`,
  `1620e4a`; final sizes `BulkAddSectionCard.tsx` 530 lines, `BulkAddSheet.tsx` 291 lines) —
  - New token `--color-border-strong` (`#b6bdcc`, `apps/web/src/index.css`) rather than a
    hardcoded hex, so the fix is reusable and lives with the other border tokens. Section
    cards changed to `rounded-xl border-border-strong bg-surface shadow-md` (mirroring the
    order-details page's own cards), with the OPEN section marked by a `bg-brand-50` header
    tint — reusing the same "active one is coloured" convention the calendar's "today" cell
    already uses — instead of a heavier border, which would have introduced a third border
    weight competing with the newly-uniform strong one.
  - Blind type + Material + Colour now render as three equal columns on one row
    (`grid grid-cols-1 sm:grid-cols-3`) instead of through the shared `MaterialAndColor`
    (which pairs Material/Colour in its own 2-column grid that cannot be split into thirds
    alongside Blind type) — a third deliberate near-duplicate in `BulkAddSectionCard.tsx`,
    alongside the pre-existing `SectionTypeSelect`/`RowFields`.
  - **The section's shared note field was removed outright** (a maintainer decision) — the
    row-level item note stays editable later, per item, through the single-item edit form's
    existing `NoteField`.
  - Measurement rows now lay out Room/Width/Height on one line via
    `grid-cols-[4fr_3fr_3fr]` (a 40/30/30 split using the `fr` form, so `gap-2` between the
    columns is subtracted from the tracks automatically instead of overflowing them), with the
    44px "+" separator button (see `insertPanelSeparator` above) inset into the width input's
    own top-right corner.
    **SUPERSEDED 2026-08-20** — that one-line split left the width field unreadable on a phone
    (the "+" button's `pr-12` reservation consumed most of a 30% track); rows are now two lines,
    room + ✕ above, Width/Height at `grid-cols-[3fr_2fr]` below. See `bug_fixes.md`, 2026-08-20.
  - Both item popups widened: the blind add/edit popup (`OrderDetail.tsx`) to `lg:max-w-3xl`,
    bulk add (`BulkAddSheet.tsx`) to `lg:max-w-5xl` — wider because it carries a multi-column
    `HardwareRow` grid the single-item popup does not.
  - **Two review rounds were needed on the row layer specifically.** The first pass paired
    the new `bg-surface-sunken` row fill with `border-light` — measured LIGHTER than the fill
    itself (`#edeef2` vs `#f1f2f5`, a 1.04:1 contrast ratio, contributing nothing at all).
    Rewritten to `border-border-strong` on `bg-surface-sunken`: 1.68:1 against the row's own
    fill and 1.89:1 against the white card behind it — a real jump against both surfaces it
    separates, the same order of contrast the card's own border already makes against the
    sheet, not a marginal one. Only existing tokens were used; no new one was added for this.

- **Verified (this session, real command runs):** web `pnpm check` clean, `pnpm test`
  **305/305** (20 files, up from the prior entry's 282/282 across 19 — `panelInput.test.ts`
  new at 30 cases, plus growth in `bulkAdd.test.ts` and `lineItemDrafts.test.ts` as rows/tests
  were removed and re-added across the five tasks), `pnpm lint` (oxlint) **0 warnings/errors**.
  api unaffected by any of this — `pnpm check` clean, `pnpm test` **337/337** (18 files,
  unchanged from the prior entry, no API surface touched by this work).

- **Not verified in a browser.** The bulk-add sheet and the single-blind popup both sit behind
  `ProtectedRoute`; no subagent that touched this work had a browser available. Owed: the 44px
  "+" button and the live shorthand split on an actual iOS decimal keypad, the new card/row
  contrast in daylight on the target device, and the wider popups on a tablet. **The white
  input fill (`bg-surface`, `#ffffff`) against the new row background (`bg-surface-sunken`,
  `#f1f2f5`) is only 1.12:1** — a pre-existing pairing, not touched by this pass — the next
  thing to look at if the rows still read flat once seen on a real device. See
  `memory-bank/progress.md` for the full known-issues list.

## 2026-08-17 — Line-item row v2: 3-dot menu, expandable detail panel, drag-and-drop reorder
Web-only (no API, schema, or pricing surface). Branch `feat/defaults-bulk-lineitems`, spec
`.superpowers/sdd/2026-08-17-defaults-bulk-lineitems/`. Reworks how one line item ROW looks and
behaves on `/orders/:id`, and gives every row a real drag handle. Full plumbing for the other
three features on this branch is documented in the entries below.

- **`LineItemList.tsx` (new) extracted from `OrderDetail.tsx` as a pure move** — no visual or
  behavioural change on its own. `OrderDetail.tsx` keeps the `<section>` wrapper, the bulk-select
  toolbar and the "Add" buttons; `LineItemList` owns only the `<ul>`, the empty state, and (from
  here on) the `expanded` detail-panel key set — the one piece of state that belongs to the LIST
  rather than to any one row.
- **`LineItemRow.tsx` (new)** — one row's markup, split out the same session once the row grew a
  menu, a detail panel and move controls on top of what `LineItemList` already rendered inline.
  Row structure: drag handle · name/summary (tap to expand) · quantity/price · a 3-dot menu ·
  Edit/Delete (still directly visible, unchanged from before). **The blind-type badge that used
  to sit beside the name is REMOVED** — the type is now inside the expanded detail panel instead,
  alongside every other spec line, so the collapsed row reads as one line of room + short summary
  regardless of item type.
- **The 3-dot menu replaces what used to be inline icon buttons for these four actions:** Show/Hide
  (toggles `hidden`; disabled with an explanatory `title` once `postConfirm` is true, mirroring the
  existing visibility-freeze rule), Duplicate, Move up, Move down (disabled at the first/last row
  rather than relying on `onMove`'s no-op alone — a disabled control reads better than a button that
  silently does nothing).
- **The expandable detail panel** replaces the old always-visible attribute line under the row name.
  `blindDetailLines`/`flatDetailLines` in `LineItemRow.tsx` build one string per fact — panel widths
  × height, material, colour, one line per hardware slot the SELECTED TYPE actually uses (via
  `slotsForType`, so a slot the type doesn't scope is silently skipped rather than shown blank),
  the type's own attributes via `describeAttributes` (so this panel can never disagree with the PDF
  or the customer page about a label), note, and quantity × unit price — every empty entry dropped
  rather than rendered blank. Reads from the in-progress DRAFT, never the persisted `LineItem`, for
  the same reason the rest of the list does: unsaved edits must show immediately.
- **Drag-and-drop reordering (`@dnd-kit/core` + `@dnd-kit/sortable`, new dependencies).**
  `LineItemList` owns the single `DndContext`/`SortableContext` (it needs the full `items` array for
  `SortableContext`'s id list) and a `PointerSensor` with `activationConstraint: { distance: 6 }` —
  a small dead zone so an ordinary tap on the row body, the menu, or a checkbox is never mistaken
  for the start of a drag. Each `LineItemRow` calls `useSortable` itself (each row needs its OWN id
  and transform) and attaches the resulting `listeners`/`attributes` to the drag-handle button ONLY
  — never to the row or its name/body button — so dragging can never fight the row's existing tap
  targets. Dropping fires the same `onMove`-style reorder callback the menu's Move up/down already
  used, so both paths funnel through one reorder implementation in `OrderDetail.tsx`.
  - **⚠️ No `KeyboardSensor` is registered.** Drag-and-drop reordering today is pointer/touch only;
    the menu's Move up/Move down items are the ONLY reorder path reachable from a keyboard or a
    screen reader. This is a deliberate, known gap — see `memory-bank/progress.md`.
- **`expanded` (the detail-panel key `Set<string>`) is pruned whenever the item list's membership
  changes** — a stale key surviving a delete/duplicate would otherwise silently expand whatever
  new item happens to reuse that key.
- **Verified (this session, real command runs — see `.superpowers/sdd/2026-08-17-defaults-bulk-lineitems/task-13-report.md` for full output):** across the whole branch — api `pnpm check` clean,
  api `pnpm test` **337/337** (18 files); web `pnpm check` clean, web `pnpm test` **267/267**
  (19 files, +1 file/+2 tests from this task's new guard test), web `pnpm lint` (oxlint) **0
  warnings/errors** (the `LineItemEditor.tsx` `react/only-export-components` warnings this
  history tracked through 2026-08-09 were already resolved by that date's `lineItemDrafts.ts`
  extraction — see that entry below; this branch's `LineItemList.tsx`/`LineItemRow.tsx` split
  never touched `LineItemEditor.tsx`'s exports and gets no credit for it).
- **Not verified in a browser.** The order editor sits behind `ProtectedRoute`. Owed: the menu on
  a phone, the drag handle on a touch device, and the detail panel's line ordering against a real
  multi-hardware blind.

## 2026-08-17 — Bulk-add sheet: multi-section, multi-room blind entry
Web-only (no API, schema, or pricing surface). Branch `feat/defaults-bulk-lineitems`. Replaces the
old single-measurement "Add Measurements in Bulk" popup's typing workflow for the common case — a
whole house measured in one sitting, several rooms per blind type — with one sheet that adds
FULLY SPECIFIED blind line items (type, material, hardware, attributes already chosen), not blank
placeholders to specify later. The older single-config bulk-measurement popup
(`measurementRowsToDrafts`, 2026-08-15) is untouched and still exists for the "just capture
numbers, decide the rest later" case.

- **Logic module `bulkAdd.ts` (new):**
  - **`BulkSection { key, config: BlindDraft, rows: BulkMeasureRow[] }`** — one shared blind
    configuration (type, material, hardware, attributes, colour, note) plus many `BulkMeasureRow`s
    (`{ key, room_name, panels, height_cm }`, no blind type/material/hardware of its own — those
    are the section's, not the row's). `newBulkSection()` seeds a config via `newBlindDraft` +
    `EMPTY_HARDWARE` (blank ids, same discipline as a brand-new single blind — see
    `applyTypeDefaults` below) and one blank `newBulkRow()`.
  - **`expandBulkSections(sections)` → `BlindDraft[]`** — one line item per row, `key`s from the
    shared `nextKey` sequence (now in its own leaf module `draftKeys.ts` — see its own entry
    below), `panels`/`attributes` from the row/section as applicable, `quantity` fixed to `'1'`
    and every price-adjustment field reset to `NO_ADJUSTMENTS` regardless of what the section's
    config carries (an override typed against a template before any row existed has no single row
    it was ever meant for). `panels` and `attributes` are always fresh shallow copies, never the
    row's/config's own array/object reference — see `bug_fixes.md` 2026-08-17 for the aliasing bug
    this guards against.
  - **`validateBulkSections(sections, catalogs)` → message | null** — MUST mirror `buildPayload`'s
    rules, message wording, AND CHECK ORDER (`OrderDetail.tsx`): per-ROW measurement checks (every
    panel a positive number, a height present) before per-SECTION configuration checks (type
    chosen — the one check with no `buildPayload` counterpart, since an untyped blind's
    `material_id` is always empty anyway and falls through to the material message instead —
    material, each hardware slot the type USES via `slotsForType`, and the type's own
    `attributeSchema` via `parseDraftAttributes`). Room name and quantity are deliberately never
    checked — an empty room is allowed exactly as it is for a saved blind today, and
    `expandBulkSections` overwrites quantity regardless of what the config holds. See
    `bug_fixes.md` 2026-08-17 for the two defects this function's current shape fixes (the
    attribute check was originally missing entirely, and the order didn't match `buildPayload`'s).
- **UI — `BulkAddSheet.tsx` (new)**: the accordion shell — one collapsible `SectionCard` per
  section, `openKey` (single-open accordion), "+ Section", Cancel/Add (Add calls
  `validateBulkSections` then `expandBulkSections`, handing the caller already-expanded
  `BlindDraft[]` so it never has to re-derive them from `sections`). Reached from the item list
  toolbar alongside the existing bulk-measurement button.
- **UI — `BulkAddSectionCard.tsx` (new)**: one section's card — `SectionTypeSelect` (near-duplicate
  of `blindForms/fields.tsx`'s `BlindTypeSelect`, calling `applyTypeDefaults` WITHOUT `keepValid`,
  since a fresh section has no "current pick" worth preserving across a type change),
  `SectionAttributes` (the Curtains-pleat extension point — gated on `blindType === 'Curtains'`; see
  this task's new guard test, `BulkAddSectionCard.test.ts`, which fails the day a type grows a
  REQUIRED attribute with no matching case here), the shared `MaterialAndColor`/`HardwareRow`/
  `NoteField` from `blindForms/fields.tsx` (reused directly — no reimplementation), then the
  section's `RowFields` list (room, per-panel width inputs, height, remove) and "+ Row". Enter in a
  row's height field appends a new row and focuses its room input, so a whole run of windows can
  be typed without reaching for the button.
- **`draftKeys.ts` (new, leaf module)** — `nextKey()`/its backing counter, pulled out of
  `OrderDetail.tsx` into an importable, dependency-free module. Needed because `expandBulkSections`
  had to mint keys from the exact SAME sequence every other draft-creating call site in the app
  already draws from (`toDrafts`, `addBlind`, `addPreset`, `addCustom`, the duplicate-item clone
  path, the older bulk-measurement popup) — two independently-seeded counters could mint the same
  key for two different items once both land in one `items` array, breaking React list identity.
  Not folded into `lineItemDrafts.ts` (already near its 800-line cap) or left inside `bulkAdd.ts`
  (whose importers have nothing to do with bulk add).
- **Verified together with the row-v2/reorder entry above** — same branch, same test run.

## 2026-08-17 — Bulk edit v2: change blind type and colour, smarter override reset
Web-only (no API, schema, or pricing surface). Branch `feat/defaults-bulk-lineitems`. Extends the
2026-08-15 single-blind-type bulk edit (`bulkEditSelection`, unchanged) with two new editable
fields and replaces the retired `applyBulkEditToDraft` with `applyBulkPatch` in the new module
`lineItemBulk.ts`.

- **`BulkEditState` gains `blinds_type` and `color`.** Picking a new blind type in the bulk-edit
  form now RESETS every selected item onto that type's saved defaults via the shared
  `applyTypeDefaults(item, patch.blinds_type, catalogs)` helper — exactly the same reset the
  single-item type dropdown and a bulk-add section's type picker use, so all three cannot drift on
  what "switching type" means. Colour is a plain free-text overwrite (never priced, never gated by
  `slotsForType`).
- **`applyBulkPatch(item, patch, catalogs)` (replaces `applyBulkEditToDraft`)** — a no-op pass-through
  for a non-blind item (`item.item_type !== 'blind'`), so `OrderDetail`'s `Array.prototype.map` over
  every selected item never needs its own type branch. For a blind: `applyTypeDefaults` first if the
  type changed, then each hardware field is written only `if (patch.<slot> && uses.has(<slot>))` —
  a field left blank in the form, or one for a slot the (possibly just-changed) type doesn't use, is
  never written.
- **`unit_price_override` is cleared ONLY on a change that FEEDS the calculated price** — a type
  change, a material change, or a hardware-slot change — tracked via a local `pricingChanged` flag
  set alongside each such write. A COLOUR-only patch never clears it: colour is never priced, so
  wiping an override the consultant deliberately set would be a surprise with nothing that changed
  to justify it. `addons` and `show_original_price` are untouched either way — they add to a price
  rather than replace it, so a re-price never invalidates them. This restores (and narrows) the
  2026-08-15 override-clearing rule that was dropped when `applyBulkEditToDraft` was retired for
  this rewrite — see `bug_fixes.md` 2026-08-17.
- **Verified together with the row-v2/reorder entry above** — same branch, same test run.

## 2026-08-17 — Per-blind-type default options (`blind_type_defaults`) + `applyTypeDefaults`
Full-stack feature (api + web + migration 38). Branch `feat/defaults-bulk-lineitems`. The shop can
now save, per blind type, a preferred Material and a preferred option for every hardware slot
(Cassette / Bottom rail / Control / Installation) — and every place a blind's TYPE changes now
resets its options onto those saved defaults through one shared function, `applyTypeDefaults`,
rather than four independent, drifting implementations.

- **Schema — migration 38 (`supabase/migrations/20260817000038_blind_type_defaults.sql`,
  APPLIED to live `lgbxxlwsdeuhdgzrjjen` — confirmed via `list_tables`: `public.blind_type_defaults`
  exists with RLS enabled):** `blind_type_defaults` — ONE row per blind type
  (`blind_type_id uuid primary key references blind_types(id) on delete cascade`), with
  `material_id`/`cassette_id`/`bottom_rail_id`/`control_id`/`installation_id`, **every id
  NULLABLE and `on delete set null`** on its own catalog table. A type simply has no row until its
  first save; a missing row and an all-null row read identically ("no defaults saved"). Deleting
  the option an existing default points at degrades that one field to NULL rather than blocking the
  delete or leaving a dangling id — the shop can retire a discontinued option without first hunting
  down which types default to it.
- **API — `GET`/`PUT /api/settings/blind-type-defaults` (`apps/api/src/routes/settings.ts`):** GET
  lists every saved row as-is (no synthetic placeholder for an unsaved type). `PUT
  /:blindTypeId` upserts the FULL row — the settings page always resends every field, by design
  (see `bug_fixes.md` 2026-08-17 for why a partial-patch design would have made a card permanently
  unsavable) — after validating every NON-NULL id via `DEFAULT_LINKS` against that field's own
  `<catalog>_blind_types` join table: the id must be an ACTIVE option LINKED to `blindTypeId`,
  the identical "active AND linked" rule `loadSlotScoping` already enforces for hardware at
  order-save time, now applied to all five slots including Material. A `null` field is left
  unvalidated and simply clears that slot's default. 404 for an unknown `blindTypeId`, 400 naming
  the offending field and WHICH rule failed (not-linked vs. inactive are distinct messages), 500 —
  not silently swallowed — the moment any lookup itself errors (see `bug_fixes.md` 2026-08-17).
- **Web plumbing:** `BlindTypeDefaults` type + `useBlindTypeDefaults()`/
  `useUpdateBlindTypeDefaults()` (`hooks/useSettings.ts`), and `Catalogs.defaults:
  BlindTypeDefaults[]` — a REQUIRED field, not optional, on the shared draft-pricing `Catalogs`
  shape (`lineItemDrafts.ts`) — so every construction site, production and test alike, is forced to
  decide what to pass; an optional field would let a caller silently omit defaults and get
  `applyTypeDefaults` behaving as if nothing were ever saved, with no error anywhere.
- **`applyTypeDefaults(draft, blindsType, catalogs, opts?)` (`lineItemDrafts.ts`) — the single
  source of truth for "a blind's type changed, reset its options."** Looks up the type's saved
  `blind_type_defaults` row, then for Material and each hardware slot: if `opts.keepValid` is set
  AND the draft's CURRENT pick is still valid for the new type, keep it (used by the single-item
  type dropdown, where an already-set option deliberately survives an unrelated type edit);
  otherwise fall through to the type's SAVED default if that default is itself still valid;
  otherwise blank. A slot the new type doesn't use resolves to `''` regardless. Attributes are
  reseeded from `getBlindType(blindsType).defaultAttributes()`. Three call sites now route through
  it exclusively: the single-item blind-type dropdown (`blindForms/fields.tsx`, `keepValid: true`),
  bulk edit's type change (`lineItemBulk.ts`, no `keepValid`), and a bulk-add section's type picker
  (`BulkAddSectionCard.tsx`, no `keepValid`) — the same function backing all three is what keeps
  them from silently disagreeing on what "switching type" means.
  - **⚠️ Behaviour change, stricter than before: an option is now kept only if that EXACT id is
    scoped+active for the NEW type** — `pick()`'s `keepValid` branch checks `scoped.some((o) =>
    o.id === current)`, not just "the slot is used by both types." Two options with the same NAME
    but different ids (e.g. two catalog rows both called "Regular") are NOT interchangeable under
    this rule, where the retired `findOptionIdByName`-based seeding (deleted this branch — the old
    hardcoded 'Regular'/'Chain' seeds went with it) would have silently swapped one id for another
    of matching name. This closes a **latent save-time 400**: the old lookup-by-name path could
    hand back an id belonging to a DIFFERENT catalog row than the one actually scoped to the new
    type, which the Worker would then reject at save. `newBlindDraft`'s defaults parameter is now
    always all-empty ids at every call site — see the corrected JSDoc on `BlindDraftDefaults` in
    `lineItemDrafts.ts`.
- **Settings — new page `/settings/defaults`** (`BlindTypeDefaults.tsx` + `blindTypeDefaultsDraft.ts`,
  reached from the Settings index): one card per ACTIVE blind type. Material is ALWAYS rendered
  (disabled with an explanatory placeholder when nothing is scoped, mirroring the order form's
  `MaterialAndColor`, which never hides Material either); a hardware slot with NOTHING scoped to
  the type renders NO field at all (mirroring `HardwareRow`'s own hide rule). A type with nothing
  scoped anywhere shows a muted explanation instead of a wall of disabled controls. Every pick PUTs
  the full row immediately (no separate Save button) through two guards applied in order —
  `sanitizeDraftForType` (clears any field no longer valid under the CURRENT catalogs, applied both
  when building the on-screen draft and again right before every save) then `toPatch` (`''` → `null`)
  — and a per-field pending-write/lock mechanism (`nextDraftForSave`) that keeps a same-card edit to
  a DIFFERENT field, made while an earlier field's save is still in flight, from reverting to the
  pre-edit value once that earlier save resolves. See `bug_fixes.md` 2026-08-17 for the exact defect
  this design replaced and the one known limit it does not close (a sibling PUT already in flight
  cannot be un-sent).
- **Verified together with the row-v2/reorder entry above** — same branch, same test run.
- ⚠️ **No API route test exists for `GET`/`PUT /api/settings/blind-type-defaults`** — `settings.
  routes.test.ts` covers the other catalog groups but not this one. The route is exercised only
  indirectly (by nothing, currently — the web hooks have no test either). Worth closing before this
  endpoint sees real traffic.

## 2026-08-12 — Pull-to-refresh for the installed home-screen app

The 2026-08-11 manifest made the app installable; this makes it usable once installed. A
standalone launch has no reload affordance of any kind, so the shell now provides the
gesture itself. Root-cause detail is in `bug_fixes.md` 2026-08-12; this entry is the API.

### Files (web only — no API, no schema, no pricing surface)

- **`apps/web/src/hooks/usePullToRefresh.ts`** — the gesture. Registers `touchstart` /
  `touchmove` / `touchend` / `touchcancel` on `window` and reports
  `{ distance, armed, refreshing, dragging }`. Renders nothing and moves nothing. Exported
  pure rules, which are what the tests cover: `pullDistance` (damping + cap), `isPullArmed`
  (threshold), `isStandaloneDisplay` (the gate).
- **`apps/web/src/components/PullToRefresh.tsx`** — the indicator, and the one place that
  decides what refresh MEANS: `queryClient.invalidateQueries()`. Renders a `fixed` puck
  parked above the viewport at rest, so it costs no layout and cannot be tapped.
- **`apps/web/src/components/Layout.tsx`** — mounts it once, beside `Sidebar`.
- **`apps/web/src/hooks/usePullToRefresh.test.ts`** — 9 cases on the geometry.

### The four constants, and why those numbers

| Constant            |  Value | Reason                                                              |
| ------------------- | -----: | ------------------------------------------------------------------- |
| `PULL_TRIGGER_PX`   |   64px | Far enough that a flick at the top of the orders list is not a refetch; short enough for one thumb stroke. |
| `PULL_MAX_PX`       |   96px | A long drag cannot fling the puck down the screen.                   |
| `PULL_RESISTANCE`   |    0.5 | Native pull-to-refresh drags slower than the finger; matching that is what makes it read as the OS. |
| `REFRESH_MIN_MS`    |  450ms | A cached invalidation settles in ~30ms, which reads as a flicker.    |

`PULL_TRIGGER_PX <= PULL_MAX_PX` is an invariant, not a coincidence — a trigger above the
ceiling is unreachable by any drag. There is a test that says so.

### Constraints that shaped it

1. **The gesture is standalone-only.** In a browser tab the native one already exists.
2. **`touchmove` is non-passive**, and `preventDefault` is called only while pulling down at
   the top — that call is what suppresses iOS rubber-banding under the puck.
3. **The content column is never transformed** (it would re-base every `position: fixed`
   element in the app).
4. **Modal and menu suppression** is by `document.body.style.overflow` and
   `useSidebar.mobileOpen` respectively.

### Standing hazards

- **A pull does not pick up a newly deployed build**, only fresh data. Without a service
  worker a cold launch does fetch the new bundle, so the gap only affects a session left open
  across a deploy. If that ever matters, the fix is a build-version check, not a
  `location.reload()` on the gesture — reload discards in-progress measurements.
- **Untestable in this workspace's runner.** vitest runs in node with no jsdom, so only the
  pure geometry is covered; the listener wiring has to be verified on a device.
- **Public customer views (`/customer/:token`, `/appointment/:token`) do not get the
  gesture** — they render outside `Layout`. Deliberate, and the place to change it if a
  customer ever installs the app.

## 2026-08-11 — Installable home-screen app (PWA manifest, real brand icons)

Owner asked whether an `.htaccess` could turn the app into a phone/tablet home-screen
shortcut with the browser UI hidden. **`.htaccess` does nothing here** — `apps/web` is served
by a Cloudflare Worker with `[assets]` (`apps/web/wrangler.toml`), so there is no Apache to
read one. The web-standard equivalent is a manifest, and `display: "standalone"` is the single
line that drops the address bar and tabs once the app is launched from its icon.

### Files (all static, all web-side — nothing in `apps/api`)

- **`apps/web/public/logo.svg`** — the real Blinds Nisa mark, replacing the purple placeholder
  that shipped as `favicon.svg`. A blind in a black frame: five slats in a tonal red ramp
  (`#d1090f → #e96d6f → #f8a9af → #fbd1d6 → #ffffff`) behind a white pull cord with a
  weighted tassel. `viewBox="0 0 593 1060"`, tight to the mark, no padding.
  - **The slats overrun the frame (x to 623 against a 593-wide frame) and are cut by
    `clipPath #frame`.** That is deliberate: it gives them flush square ends against the
    frame's rounded right edge without anyone hand-matching a curve. The clip path string and
    the frame's fill path string must stay identical.
  - Colours are literal hex, not design tokens — browsers and OS icon pipelines fetch this
    file as a static asset and never resolve CSS variables.
- **`scripts/generate-icons.mjs`** — the ONLY place icons are padded, plated and rasterised.
  Reads `logo.svg`, writes `favicon.svg` (square, transparent, 88% fit) plus `icon-192.png`,
  `icon-512.png` (82% fit), `icon-maskable-512.png` (60% fit) and `apple-touch-icon.png`
  (180px, 78% fit). Run it after ANY edit to `logo.svg` and commit the output — the geometry
  must never be hand-copied into a second file.
- **`apps/web/public/manifest.webmanifest`** — `display: "standalone"`, `start_url`/`scope`
  `/`, `theme_color` `#2563eb` (matches the existing `theme-color` meta and `--color-brand-600`),
  `background_color` `#f6f7f9` (matches `--color-surface-muted`, the body background, so the
  splash does not flash a different colour than the first paint), `orientation: "any"` because
  staff hold tablets both ways.
- **`apps/web/index.html`** — `<link rel="manifest">` plus the Apple tags Safari needs
  instead of the manifest.

### Three constraints that dictated the numbers

1. **Every PNG is an opaque white plate.** iOS composites a transparent `apple-touch-icon`
   onto BLACK, which would erase this mark's black frame completely; Android theming can do
   the same on a dark background. Only the SVG keeps transparency, because the tab strip
   handles it correctly.
2. **The maskable icon is inset much further (60% vs 82%).** Android crops maskable icons to
   arbitrary launcher shapes and only guarantees the middle 80%. A portrait mark at 82% loses
   the top slat and the tassel on round-icon launchers.
3. **`apple-mobile-web-app-status-bar-style` is `default`, NOT `black-translucent`.**
   Translucent hands the app the area under the iOS clock/notch, and nothing in `apps/web`
   styles `env(safe-area-inset-top)` — every existing inset rule is `safe-area-inset-bottom`.
   Translucent would put the shell header under the status bar. Changing this is a
   top-inset-pass prerequisite, not a free toggle.

### Standing hazards

- **Installed PWAs cache the manifest.** A bad `start_url` or icon path is not fixed by the
  next deploy for anyone who already installed — they must remove and re-add the icon. Verify
  on a real device before merging to `main`.
- **Android standalone has no browser back button.** Any route reachable without in-app back
  navigation becomes a dead end once installed. Not audited by this change.
- **No service worker, so no offline.** Launching still needs network. Offline is not a small
  follow-up: pricing is server-authoritative, so offline writes would need a queue and a
  re-price-on-sync story.
## 2026-08-10 — Curtains diverges: fabric by the running metre × pleat fullness

The first blind type to leave the shared base formula. Everything below builds on the
module scaffold from the 2026-08-09 entry; nothing there had to change shape to allow it.

### The formula

```
width   = applyWidthMinimum(sum(panels))          // <100cm → 100cm, unchanged
fabric  = (width / 100) × pleat_multiplier × material_price_per_sqm
control = panels.length × control_price_per_item  // unchanged
install = installation_price                       // fixed, once per curtain
unit    = round2(fabric + control + install)
```

- **Height is measured but never priced.** It still reaches the manufacturer copy.
- **Cassette and bottom rail do not exist for this type.** Not zero-priced entries someone
  must remember to pick — genuinely absent, `null` in the row, `0` in the formula.
- **For Curtains materials, `materials.price_per_sqm` holds DOLLARS PER RUNNING METRE.**
  One column, two meanings, keyed off the blind type. `MaterialsForType` relabels every
  affected string (`Price / m`, list rows, CSV hint, CSV error) when the type resolves to
  Curtains. That relabel is load-bearing: an m² price entered there under-quotes by roughly
  the drop in metres.

Worked example, in both `pricing.test.ts` suites: 300cm wide, pleat 2.5, $40/m fabric →
`3.0 × 2.5 × 40 = $300.00`.

### Migration 30 — two catalogs, both seeded at their identity

`pleat_types` (`multiplier numeric check (multiplier > 0)`, seeded No-pleat / Regular /
Pinch at **1.0**) and `installation_options` (`price_per_item`, seeded Rod / Track at
**0**). `line_items` gains NO columns — the snapshot lives in the `attributes` jsonb from
migration 29, so `update_order_with_items()` needed no rebuild.

Every seeded value is the identity for its operation (×1, +0), so **applying the migration
cannot move any existing order's total**. The deliberate consequence: a curtain prices as
flat fabric until someone sets the real ratios, and the Pleat Types page carries a standing
note saying exactly that.

### `catalogRefs` — a price input that never comes from the client

The generic mechanism, on `BaseBlindType` (both twins), empty for every other type:

```ts
readonly catalogRefs: readonly CatalogRef[] = [];        // attrKey → table/value/snapshot keys
readonly requiredCatalogs: readonly CatalogSlot[] = ['cassette', 'bottom_rail', 'control'];
inputKeys(): string[]                                    // the schema's declared keys
resolveCatalogRefs(attrs, resolve: CatalogResolver): BlindAttributes
```

Curtains declares `pleat_type_id → pleat_types.multiplier → {pleat_name, pleat_multiplier}`
and `installation_id → installation_options.price_per_item → {installation_name,
installation_price}`, plus `requiredCatalogs = ['control']`.

- The client sends **ids only**. The two snapshot keys are NOT in `attributeSchema`, so a
  client that sends `pleat_multiplier` gets a **400** — the same `.strict()` gate, now
  covering the one place a price could have leaked in.
- `resolveLineItems` collects ids, queries once per referenced table, and calls
  `resolveCatalogRefs` **after** the strict parse, always overwriting. `orders.ts` gained a
  generic loop, not a branch on `blinds_type`.
- The web preview runs the same declaration against the TanStack Query cache, so the
  keystroke price and the server agree. `lineItemDrafts.ts` holds the only table-name→list
  mapping on the client.

### Absent hardware

`cassette_id` / `bottom_rail_id` are now `z.string().uuid().nullable().default(null)`.
`resolveLineItems` requires an id for each declared slot and **rejects one for a slot the
type does not use** — otherwise the option would be named on every document while
contributing nothing to the price, and the form and the total would disagree.

Three client paths had to learn the same rule or the order became unsavable: the save
guard, `BlindTypeSelect` (clears a hardware id the new type does not use), and bulk edit
(skips a slot the target type does not have).

### Settings

- `/settings/pleat-types` — reached from the **Curtains materials page**, not the Settings
  index, because a pleat is meaningless without the fabric it gathers. `CatalogEditor`
  gained `priceUnit: 'plain'` (renders `2.50×`, not `$2.50`), `priceMin` (0.01 here — a 0
  multiplier would zero the line) and `note`.
- `/settings/installation-options` — listed beside Control Options; an ordinary priced
  hardware catalog.

### Documents

All four surfaces render `Installation: Rod · Pleat: Pinch` from `describeAttributes`,
which returns the snapshot **names only** — the multiplier and the installation charge are
internal pricing detail and are never printed. `public.ts` was NOT touched; it already
forwards `attribute_lines`.

### Verified
`pnpm check` clean; api 242 tests / 14 files, web 133 / 13; `pnpm lint` 0 warnings. Twin
bodies byte-identical for `base.ts` and `curtains.ts`. Two tests were caught passing
trivially and re-fixtured (see `bug_fixes.md`, same date). Not yet exercised against live
data — migration 30 is applied by the maintainer.

## 2026-08-09 — Blind types become modules: own inputs, own form, own documents

Driven by the request to modularize item adding: "different calculation logic usually
requires different inputs — more or less, but the UI should be different… each UI of the
blinds adding form can be edited separately." Spec
`docs/superpowers/specs/2026-08-09-blind-type-modules-design.md`, plan
`docs/superpowers/plans/2026-08-09-blind-type-modules.md` (both local-only; `docs/` is
gitignored).

**End state: nothing diverges yet.** Every type still prices by the base formula and
declares zero attributes, so no order's price moved and no form looks different. The
scaffold is the deliverable. The first real divergence is a two-file change per type
(`lib/blindTypes/<type>.ts` in both twins + `blindForms/<Type>Form.tsx`) and needs the
owner's actual formula.

- **`calculators/` → `blindTypes/` (both twins), `BaseBlindCalculator` → `BaseBlindType`,
  `getCalculator` → `getBlindType`.** The class stopped being only a calculator once it
  owned a field schema and a display formatter. Rename verified behaviour-free by test
  count: web 98/10 and api 196/11, identical either side. `normalizeBlindType` kept its
  name — `manufacturing.ts` depends on its exact output for `isAluminumType`.
- **Three new members on `BaseBlindType`:**
  - `attributeSchema` — a `.strict()` Zod contract, built via the `BaseBlindType.attrs()`
    helper so strictness cannot be forgotten. The base accepts ONLY `{}`. Typed
    `z.ZodTypeAny`, NOT `z.ZodType<BlindAttributes>`: Zod schema types are not covariant in
    their output, so a subclass assigning a narrower `ZodObject` would not typecheck.
    Declare numeric fields with `z.coerce.number()` — the value arriving from a draft is a
    string.
  - `defaultAttributes()` — seed for a new draft, re-seeded when the type dropdown changes.
  - `describeAttributes()` — React-free `{label, value}[]`, because `apps/api/src/lib/pdf.ts`
    runs on the Worker and cannot import JSX. Every display surface renders through this one
    formatter, so they cannot disagree about labels.
- **`BlindPricingInputs.attributes` is REQUIRED**, matching the reasoning behind
  `bottom_rail_price_per_m`: an optional member would let a caller silently drop a type's
  inputs and get the base price back with no error at all.
- **DB (migration 29, APPLIED live to `lgbxxlwsdeuhdgzrjjen` by the maintainer):**
  `line_items.attributes jsonb not null default '{}'`. One jsonb column rather than a sparse
  column per field per type — a real column per field costs a migration plus the locked
  bulk-insert column-set discipline every time any type gains a field, and a child table
  would add a read path to every consumer for data only ever read alongside its parent.
  `update_order_with_items()` rebuilt to carry the column; the diff against migration 28 is
  exactly three hunks (insert list, select, recordset definition).
- **Two-stage validation, because Zod cannot branch on a sibling field.** `blindItemSchema`
  accepts `attributes` as a loose `z.record(z.unknown())` — the discriminator it needs
  (`blinds_type`) sits beside it — then `resolveLineItems` re-parses the blob through that
  type's own `.strict()` schema. An undeclared key, a price above all, is a 400 and never a
  silent write. The route tests assert on the error MESSAGE, not just the 400, so they fail
  if the second gate is ever removed.
- **Flat rows carry `attributes: {}` explicitly** — PostgREST unifies keys across
  bulk-inserted rows and NULL-fills any row missing one, and the column is not-null.
- **Web forms split per type:** `pages/orders/blindForms/` — `fields.tsx` (shared controls,
  moved verbatim, plus `AttributeText`), `DefaultForm.tsx` (the old layout, and the permanent
  fallback for unknown/inactive/legacy free-text types), `index.ts` (`getBlindForm`), and ten
  per-type files. `BlindEditForm` is now a ~4-line dispatcher with unchanged props.
- **`getBlindForm` resolves through `getBlindType` FIRST** and keys the form map on the
  canonical label that comes back, instead of duplicating each type's aliases into a second
  map. Sunscreen alone answers to four spellings. Adding an alias in `lib/blindTypes/` needs
  no edit in the form layer, and the two registries cannot disagree even in principle.
- **`lineItemDrafts.ts` (new, JSX-free)** holds the draft models and every pure function over
  them, including `parseDraftAttributes` — the ONE string→typed conversion, used by both the
  live preview and the save payload. Blank strings are dropped rather than coerced so an
  unfilled field looks absent to the schema instead of reading as NaN. Splitting it out of
  `LineItemEditor.tsx` took `apps/web` lint from 4 pre-existing `react/only-export-components`
  warnings to **0**: a module exporting both components and plain functions cannot be
  Fast-Refreshed. `LineItemEditor.tsx` 570 → 168 lines.
- **Display surfaces, all fed by `describeAttributes`:** the PDF (`itemContent`, between
  Control and Note — attributes are specification, the free-text note stays last), the
  customer page, the manufacturer copy's as-is detail (written `Label value`, no colons, in
  that dense middot run), and the order item rows.
- **SECURITY — `/public/estimate/:token` forwards `attribute_lines`, never `attributes`.**
  That endpoint is unauthenticated; the capability token is the only gate. The handler names
  every field explicitly, which is what has kept internal columns off it, and the blob is
  formatted server-side so a future internal-only field reaches a customer only if its type's
  `describeAttributes` chose to return it. **Do not replace it with a spread.** The
  regression test seeds `attributes.internal_cost_code = 'SUPPLIER-SECRET-123'` and asserts
  the string appears nowhere in the response bytes.
- **Verification:** web 116/13, api 214/13, lint 0 warnings, production build clean. The
  blind popup was verified in a signed-in browser against the pre-refactor build by restoring
  the old file, letting vite reload it, and diffing the rendered DOM — **byte-identical, 6826
  chars**. The item row was verified the same way (2647 chars identical) after a first attempt
  regressed it, below.

## 2026-07-28 — Production label printing (TSPL labels, `print_jobs` queue, print-agent workspace)

> **⛔ PARTLY DROPPED — removed 2026-07-28 at the owner's request (the shop PC covers printing,
> so the iPad/agent path was unneeded); confirmed gone from disk 2026-07-30. This banner exists
> because the bullets below were never revised — `memory-bank/activeContext.md` (2026-07-28
> prior focus) is the accurate account.**
> Only the **browser print path survives**: `apps/web/src/lib/labels.ts` (+ `labels.test.ts`) and
> `apps/web/src/pages/orders/OrderLabels.tsx` at `/orders/:id/labels`. Everything TSPL- or
> queue-related was removed from the repo and never reached the live database:
> `apps/api/src/lib/labels.ts`, `apps/api/src/lib/labelTspl.ts`,
> `apps/api/src/routes/printAgent.ts`, `POST /api/orders/:id/print-label`, the whole
> `apps/print-agent/` workspace, and `supabase/migrations/20260728000028_print_jobs.sql` are all
> **gone from disk** (verified 2026-07-30: 0 matches for `print_jobs`, `claim_print_job`,
> `PRINT_AGENT` anywhere under `apps/`, and no `*print*` file in `supabase/migrations/`).
> **Consequences for anyone reading the bullets below:** the api/web `labels.ts` twin pair is no
> longer a twin — the web copy is now the only copy, so there is nothing to keep in sync. The
> `PRINT_AGENT_SECRET` and `GAP 0.12,0` calibration warnings are moot. And **"Migration 28" in
> this section means the print-jobs migration that was never written**, NOT
> `20260729000028_bottom_rail_options.sql`, which is a different migration that shares the
> number and WAS applied on 2026-07-30. Refer to migrations by filename, never by number.
> The bullets below are kept verbatim as the design record of why the queue was built the way it
> was, in case the agent path is ever revived.

Full-stack feature, spec `docs/superpowers/specs/2026-07-28-label-printing-design.md`, plan
`docs/superpowers/plans/2026-07-28-label-printing.md`. Every blind line item now produces its
own 3x1.5in production label, fixed behind the cassette before the blind ships: one label per
unit of quantity, numbered across the WHOLE order ("3 of 7"). Two independent ways to get a
label onto paper — a browser print from the shop PC, and a queued job a headless print agent
pulls and sends to the physical thermal printer, which is the only path an iPad can use since
it has no Bluetooth/USB route to the printer.

- **Twin field-extraction modules**: `apps/api/src/lib/labels.ts` + `apps/web/src/lib/labels.ts`.
  `buildLabels(order)` expands an order's blind line items (`item_type === 'blind'`) into
  `LabelFields[]` — one entry per unit of quantity, sorted by line-item `position` then copy
  index, with `index`/`total` numbered across the whole order BEFORE any caller filtering.
  Deliberately duplicated across the API/web boundary, exactly the existing
  pricing.ts/totals.ts precedent: the two print paths render differently (CSS vs TSPL) but must
  always carry identical wording, so the extraction is forked rather than shared. Every field is
  always a plain string (`''` when absent, never omitted) so a renderer can test truthiness and
  never leave a dangling label line. Mirrored `labels.test.ts` on both sides, 9 tests each.
- **`apps/api/src/lib/labelTspl.ts`** renders `LabelFields[]` to a TSPL command stream for a
  609x304-dot label (3in x 1.5in @ 203dpi). Every field owns a FIXED y-coordinate — an empty
  field (no cassette, say) omits its `TEXT` line entirely rather than shifting the rows below it,
  so an operator's eye finds the same fact in the same place on every label in a batch.
  `stripControl` is a SECURITY control, not formatting: TSPL is a newline/quote-delimited command
  language, so an unsanitized customer name or room could break out of a `TEXT` statement and
  have the remainder executed as printer commands — same class of rule as `escapeHtml` for email
  bodies and the PostgREST `or()` sanitizer (AI_GUIDELINES §2). Control characters and backslashes
  are stripped outright and quotes downgraded to apostrophes; removal instead of escaping because
  backslash handling varies across TSPL firmware. `foldAscii` exists because the printer's bitmap
  fonts cannot render accented or Turkish characters ("Émile Şoğut" → "Emile Sogut"); only the
  TSPL path folds, the browser path renders the original text as typed. 12 tests in
  `labelTspl.test.ts`.
- **Migration 28** (`supabase/migrations/20260728000028_print_jobs.sql`) adds the `print_jobs`
  queue (`pending`/`printing`/`done`/`failed`) — one row per print REQUEST (the whole rendered
  TSPL batch), not one per label, so the agent never has to parse TSPL. Claiming a job had to be
  an RPC rather than a plain PostgREST update: PostgREST has no way to express "update the
  oldest pending row" as a single statement, so a client-side read-then-update (select the
  oldest pending id, then update it) leaves a window where two polling agents can both read the
  same "oldest pending" row before either writes to it, and both would print the same job.
  `claim_print_job()` closes that window inside the database — it uses `FOR UPDATE SKIP LOCKED`
  so two agent instances can never claim the same row, and reaps jobs stuck in `printing` for
  more than 5 minutes (re-queued, or failed outright once `attempts >= 3`). Invoker rights,
  `set search_path = ''`, and an explicit revoke/grant
  restricting execution to `service_role` — matches the house style set by
  `update_order_with_items`.
- **`POST /api/orders/:id/print-label`** (`apps/api/src/routes/orders.ts`) renders via
  `buildLabels` + `renderLabelsTspl` and inserts one `print_jobs` row. `{ items?: number[] }`
  selects a subset by label index for reprinting a damaged label; selection happens AFTER
  numbering, so reprinting label 3 of an order still prints "3 of 7" instead of renumbering to
  "1 of 1".
- **`apps/api/src/routes/printAgent.ts`**, mounted at `/agent` — deliberately OUTSIDE `/api/*`,
  because a headless shop-PC process has no Supabase session and no way to obtain one. Guarded by
  the shared `PRINT_AGENT_SECRET` bearer token; `authorized()` returns false whenever the binding
  is unset, so an unconfigured Worker fails closed rather than open. `GET /agent/print-jobs/next`
  calls `claim_print_job()` and answers 204 the common case (queue empty); `POST
  /agent/print-jobs/:id/result` records success/failure, filtered on `status = 'printing'` so a
  retried report is a no-op the second time.
- **`apps/web/src/pages/orders/OrderLabels.tsx`** at `/orders/:id/labels` (new tab, Manufacturer
  Copy pattern). `@page { size: 3in 1.5in; margin: 0 }` is scoped INSIDE the component, not the
  global stylesheet, so it cannot leak onto the Letter-sized cut sheet (`ManufacturerCopy.tsx`) or
  the Overview page. One checkbox selection feeds two buttons: "Print" runs `window.print()`
  through a Windows-installed driver on the shop PC; "Send to printer" calls the new
  `useEnqueuePrintLabels()` hook against `/print-label` — the only path an iPad can use.
- **`apps/print-agent/`** — new pnpm workspace (covered by the existing `apps/*` glob in
  `pnpm-workspace.yaml`, no workspace-file change needed), zero runtime dependencies.
  `src/config.ts` validates `API_BASE_URL`/`PRINT_AGENT_SECRET`/`PRINTER_TARGET` (+ optional
  `POLL_MS`, floored at 1000ms) at startup and throws naming every missing variable at once — an
  unattended shop-PC process must not start half-broken. `src/printer.ts` picks a strategy from
  the target's shape: `strategyFor()` matches `^COM\d+$` for a direct write to `\\.\COM<n>` (the
  Bluetooth-SPP port or a USB-serial port), anything else is treated as a Windows printer share
  and piped through `copy /b` (RAW datatype, bypasses spooler page layout — no printer driver
  participates in layout either way). `src/index.ts` polls `claim_print_job` every 30s (default)
  and reports the outcome back. README documents install/config.
- **Files added:** `apps/api/src/lib/labels.ts` + `.test.ts`, `apps/api/src/lib/labelTspl.ts` +
  `.test.ts`, `apps/api/src/routes/printAgent.ts` + `.routes.test.ts`,
  `apps/web/src/lib/labels.ts` + `.test.ts`, `apps/web/src/pages/orders/OrderLabels.tsx`,
  `apps/print-agent/{package.json,tsconfig.json,README.md,src/config.ts,src/config.test.ts,
  src/index.ts,src/printer.ts,src/printer.test.ts}`,
  `supabase/migrations/20260728000028_print_jobs.sql`,
  `docs/superpowers/specs/2026-07-28-label-printing-design.md`,
  `docs/superpowers/plans/2026-07-28-label-printing.md`.
  **Files modified:** `apps/api/src/index.ts` (mounts `/agent`), `apps/api/src/routes/orders.ts`
  (+`POST /:id/print-label`), `apps/api/src/routes/orders.routes.test.ts`,
  `apps/web/src/App.tsx` (route), `apps/web/src/hooks/useOrders.ts`
  (`useEnqueuePrintLabels`), `apps/web/src/pages/orders/OrderDetail.tsx` (entry point to the new
  tab), `pnpm-lock.yaml`.
- **Verification (this session, dev machine — real command runs, not sandbox-claimed; full
  verbatim output in `.superpowers/sdd/2026-07-28-label-printing/task-9-report.md`):**
  - api: `pnpm --filter api check` (`tsc --noEmit`) clean; `pnpm --filter api test` — vitest
    **152/152** across 9 files (`labels.test.ts` 9, `labelTspl.test.ts` 12,
    `printAgent.routes.test.ts` 10, `orders.routes.test.ts` 39, plus the pre-existing suites).
  - web: `apps/web` has NO `check` script (pre-existing gap, already recorded separately — not
    fixed here, out of scope for this task). `npx tsc -b --noEmit` run from inside `apps/web` is
    clean. `pnpm --filter web test` — vitest **56/56** across 5 files (`labels.test.ts` 9, plus
    the pre-existing suites). `pnpm --filter web lint` (oxlint) — exactly the 4 pre-existing
    `LineItemEditor.tsx` warnings, none from this feature.
  - print-agent: `pnpm --filter print-agent check` (`tsc --noEmit`) clean; `pnpm --filter
    print-agent test` — vitest **8/8** (`config.test.ts` 5, `printer.test.ts` 3).
- ~~⚠️ Migration 28 is NOT applied…~~ **MOOT (2026-07-30).** The print-jobs migration file no
  longer exists and nothing calls `claim_print_job()`; `blinds-nisa-api` deploys fine without it.
  Do not confuse this with `20260729000028_bottom_rail_options.sql`, which shares the number 28
  and was applied manually on 2026-07-30.
- ~~⚠️ `PRINT_AGENT_SECRET` has not been set…~~ **MOOT (2026-07-30).** No `/agent/*` routes and
  no agent process remain; the secret is not needed.
- ~~⚠️ The `GAP 0.12,0` value in `labelTspl.ts`…~~ **MOOT (2026-07-28 removal).** `labelTspl.ts`
  is gone; no TSPL is emitted, so there is no label-stock gap to calibrate.
- ~~⚠️ TSPL support on the LabelCreate 2410BT is ASSUMED…~~ **MOOT (2026-07-28 removal).** The
  browser path prints through the Windows driver and never speaks TSPL.
- ~~⚠️ The print agent's serial path opens the port with fs `open(target, 'w')`…~~ **MOOT
  (2026-07-28 removal).** No agent, no serial path.
- ⚠️ **STILL OPEN:** the surviving browser print path has not been exercised against physical
  hardware. No test in any suite can confirm a label is legible.
- ⚠️ Nothing is deployed. Both Workers (`blinds-nisa-api`, `measure-blinds`) still need `wrangler
  deploy`.

## 2026-07-25 — Recalculable aluminium bar length on the Manufacturer Copy
Web-only, no API/schema/pricing involvement. The aluminium cut list was permanently
planned against a 6 m bar; the workshop can now type the length of the stock actually on
the rack and watch the bar layout re-pack.

- **The 600 cm was already a constant but not yet a variable.**
  `planAluminumCuts(cuts, stock = ALUMINUM_STOCK_CM)` had always accepted a stock length,
  but `buildManufacturingPlan` called it as `planAluminumCuts(g.cuts)` and the oversize
  warning interpolated `ALUMINUM_STOCK_CM` directly — so the parameter was dead and 600
  was effectively hardcoded. `buildManufacturingPlan` gained a third parameter
  `aluminumStockCm: number | null = ALUMINUM_STOCK_CM`, threaded into both the packer and
  the warning text. **The warning now quotes the length in use** ("300 cm exceeds a 250 cm
  bar"), which is the whole point — a warning naming 600 while packing 250 is a lie.
- **`resolveAluminumStockCm(value)` is the single fallback rule.** `null`/`undefined`
  (blank field), `NaN` (unparseable text), `0`, negatives and `Infinity` all resolve to
  `ALUMINUM_STOCK_CM`. Exported and used by BOTH the planner and the page, so the number
  displayed as "Packing into X cm bars" can never disagree with the number packed against.
  Do not re-implement this fallback at a call site.
- **`AluminumGroup.stockCm`** carries the length on the group, not only on each
  `AluminumBar.stock`. Deliberate: when every cut is oversize for the entered length
  `result.bars` is empty, and the UI still has to label the stat ("2.5 m bars: 0").
- **UI — `AluminumStockField` in `ManufacturerCopy.tsx`**, rendered directly above the
  aluminium sections and only when `plan.aluminumGroups.length > 0`.
  - **VIEW-ONLY state.** `useState` on the page; never persisted to the order, never sent
    to the API. It is a what-if calculator, not an order field.
  - **Raw text state, not a number.** Blank must stay distinguishable from 0 (blank = use
    the default), and the field has to hold in-progress input like `"5."`.
  - **Numbers-only via a `numericOnly()` sanitizer on a plain `inputMode="decimal"` input**,
    matching the codebase's existing numeric-input convention (`MaterialsForType`,
    `CatalogEditor`, `LineItemEditor`). NOT `<input type="number">`: that still accepts
    `e`/`+`/`-` and reports an empty `value` for text the browser deems invalid, which
    would hide a typo from the operator. The sanitizer strips non-`[\d.]` and keeps one
    decimal point.
  - Live re-pack (no Apply button — the point is comparing stock options at a glance), a
    Reset button that appears only while overridden, and an explicit "Not a usable bar
    length — packing into the default 600 cm bars" line instead of a silent fallback.
- **Print behaviour:** the field itself is `print:hidden` (a text box is meaningless on a
  cut sheet) but the length still reaches paper via the page meta line — "Aluminium bars
  are 5.5 m (custom length)." — and every "Bar N · 5.5 m" heading. The three places that
  hardcoded "6 m" in the JSX are gone; `barLength()` formats compact metres (600 → "6 m",
  550 → "5.5 m").
- **Fabric is untouched by design** — roll widths still come from the material catalog. A
  test asserts `fabricGroups` is identical across two different bar lengths.
- Verification on the dev machine: web `tsc -b` clean, vitest **47/47**
  (`manufacturing.test.ts` 12 → 20), oxlint clean apart from the 4 pre-existing
  `LineItemEditor` warnings, `pnpm --filter web build` OK. Not deployed —
  `wrangler deploy` for `measure-blinds` still pending.

## 2026-07-21 — Responsive emails + `email-theme.ts` presentation split
Full-stack-adjacent feature, api only (spec:
`docs/superpowers/specs/2026-07-21-responsive-email-design.md`, plan:
`docs/superpowers/plans/2026-07-21-responsive-emails.md`). Every outbound email — all 9
customer templates and all 4 internal staff notices — now renders correctly on a phone.
None of them did before: there was no `<head>` in any template, so no viewport meta at
all.

- **New module `apps/api/src/lib/email-theme.ts` (344 lines).** `email.ts` was 817 lines
  and holding both message CONTENT and visual FORM. The presentation layer moved out:
  tokens (`FONT`/`MONO`/`C`), `EMAIL_HEAD`, `CompanyBrand`/`brandFromSettings`,
  `escapeHtml`, `brandedShell`, `plainShell`, and every block helper. `email.ts` keeps
  `sendEmail` and the 13 `build*Html` templates, and drops to 610 lines. Both are now
  under the Rule 6 limit.
  - **Call sites are unchanged.** `email.ts` re-exports `escapeHtml`, `brandFromSettings`
    and `CompanyBrand` via `export { ... } from './email-theme'`, so `routes/orders.ts`,
    `routes/public.ts`, `routes/appointments.ts` and `lib/reminders.ts` were not touched.
    The same names appear in both an `import` and an `export ... from` in `email.ts` —
    that is intentional and not a redundancy: the import creates the local binding the
    templates call, the re-export creates the public surface.
- **Hybrid responsive approach — the layout does not depend on `<style>` surviving.**
  Fluid base + a single `@media only screen and (max-width:600px)` block in `EMAIL_HEAD`.
  The media rules are progressive enhancement ONLY: gutters 40px→20px, card padding, tap
  targets, heading and small-print sizing. Anything that could actually overflow a 320px
  screen was fixed structurally instead, so a client that strips `<style>` gets chunkier
  gutters, never a broken layout. **Do not "simplify" a structural fix into a media
  query** — that is the invariant this design is built on.
- **Four structural fixes** (none rely on the breakpoint):
  - `width="640"` presentational attribute removed; card is `width:100%` +
    `max-width:640px`. Some clients honour the attribute over the CSS.
  - Review-request CTA was a hard `width:280px` cell inside a card offering ~168px at
    320px wide — it overflowed the card. Now `width:100%` + `max-width:280px`.
  - `buttonPairHtml` no longer splits into 50% cells (each button got ~110px on a phone,
    wrapping "View & confirm installation" over 3–4 lines). It stacks full-width on ALL
    viewports — both buttons link to the same URL anyway, and every other template
    already used a single full-width button.
  - Summary-card rows table gained `width="100%"`; it was shrink-wrapped, so
    `display:block` cells could not fill it.
- **Outlook desktop keeps its fixed width via an MSO conditional ghost table.** The Word
  engine ignores `max-width`, so removing the fixed width would have left it laying the
  card out at content width. The ghost table pins 640px for that client alone.
- **`plainShell` for the 4 internal notices.** They each repeated the same bare
  `<!doctype>`/`<div max-width:560px>` wrapper. Consolidated, purely to add `EMAIL_HEAD`
  (viewport for staff on phones, charset so the raw ✅/🕑/⚠️/↩️ emoji survive). **Their
  rendered appearance is deliberately unchanged** — restyling staff email was out of
  scope, and a test asserts the layout and content still match.
- **13-builder table-driven invariant suite.** Every template is asserted to carry the
  viewport, charset and media block, and to contain no fixed width that can overflow.
  Adding a template to the `templates` array enforces all of it for free; a template that
  skips `brandedShell`/`plainShell` fails loudly.
  - **Assertion trap, documented in the test file:** `not.toContain('width:640px')` and
    `not.toContain('width:280px')` are WRONG here — `max-width:640px`/`max-width:280px`
    contain those substrings, so such a test passes against broken code and fails against
    correct code. Anchor on the full attribute prefix, and strip MSO blocks first because
    the ghost table contains `width="640"` on purpose.
- **Verification:** api tsc clean, vitest 181/181 (email.test.ts 20 → 85, +65).
- ⚠️ **Markup is verified; RENDERING is not.** The suite asserts HTML invariants — no
  test can confirm these look right in Gmail or iOS Mail. A live Resend send to a real
  phone is still outstanding.

## 2026-07-21 — Public order summary + status tracker, cancellation requests, e-Transfer details
Full-stack feature (spec:
`docs/superpowers/specs/2026-07-21-customer-order-summary-cancellation-design.md`).
The token'd customer page stops being a one-shot estimate and becomes a permanent order
summary: the same emailed link now shows live status, what is owed, where to send money,
and a way to ask for the confirmation to be cancelled.

- **Schema** (`supabase/migrations/20260721000027_order_cancel_request_etransfer.sql` —
  NOT YET APPLIED to live `lgbxxlwsdeuhdgzrjjen`): `orders.cancel_requested_at
  timestamptz` + `orders.cancel_request_note text not null default ''`;
  `company_settings.etransfer_email` + `etransfer_instructions`, both
  `not null default ''` so the singleton needs no backfill. The cancellation request is
  columns on `orders` (NOT a side table) — same precedent as `install_status` /
  `install_response_note`: one optional side-conversation per order, never a collection.
  Either answer clears the flag back to NULL; `order_logs` is the audit trail.
- **The customer still cannot undo a confirmation.** `cancel_requested_at` changes NO
  status by itself — it only raises a flag staff must answer. Reversing a confirmation
  remains user-only.
- **API — public** (`routes/public.ts`): `loadByToken` gained a `payments(amount)` embed
  purely so the Worker can compute money; individual payment rows are NEVER exposed, only
  `amount_paid` and `balance` (rule 1). `GET /estimate/:token` also returns
  `cancel_requested_at` and the two e-Transfer fields.
  `POST /estimate/:token/cancel-request { note? }` — 409 unless `awaiting_payment` with
  zero payments and no open request (that last one makes a double tap idempotent and
  stops duplicate staff notices); note capped at 500 chars; the status guard is re-applied
  as a DB filter on the UPDATE so a payment landing mid-request can't slip through the
  read-then-write gap. `POST /estimate/:token/cancel-withdraw` clears it, guarded on the
  flag being set. Both inherit the existing 5-req/min `/public` limiter.
- **API — staff** (`routes/orders.ts`): `POST /:id/cancel-request/resolve
  { accept, message? }` (`.strict()`, `/cut-done` shape). `accept:true` clears the flag
  AND applies the unconfirm transition (`awaiting_payment → sent`, `confirmed_at` nulled),
  refused once a payment exists — no email, because the customer's page simply shows the
  estimate with its Confirm button again. `accept:false` emails the customer, THEN clears
  (email-then-persist: 502 leaves the request open for a retry rather than silently
  dropping it). Sole exception: a customer with no email on file is cleared without a
  send and the log records why — a missing address must never trap staff in an
  unresolvable request.
- **Email** (`lib/email.ts`): TWO builders in different halves of the file because they
  serve different audiences. `buildCancellationDeniedHtml` is customer-facing and follows
  the "Customer Emails" design system (branded shell, "Still confirmed" summary card,
  staff message block, CTA to the summary). `buildCancellationNoticeHtml` is the internal
  staff notice in the plain `buildInstallationNoticeHtml` style, fired on both request and
  withdrawal (`withdrawn: boolean`), best-effort. Both escape everything — the customer's
  reason and the staff explanation are free text.
- **Web — customer** (`pages/customer-view/`): additive-only split, no existing logic
  relocated. New `OrderProgress.tsx` (pure 4-step tracker: Confirmed · In Production ·
  Ready · Installed — internal names are never shown; grid tracks, not flex, so long
  labels can't force horizontal overflow) and `CancellationRequest.tsx` (pure
  request/pending/withdraw UI, styled NEUTRALLY — red belongs on the staff page).
  `CustomerView.tsx` keeps its fetch and summary markup; its `status !== 'sent'` dead-end
  card is replaced by the full summary + tracker + payment block + cancellation block, and
  every mutation re-reads the server rather than patching state locally. A `draft` that
  somehow resolves reads as not-found.
- **Web — staff** (`pages/orders/OrderDetail.tsx`, `hooks/useOrders.ts`
  `useResolveCancelRequest()`): red bordered banner directly above the Progress card while
  a request is open, showing the customer's reason, with Confirm (direct, behind a
  `window.confirm` since it reverses status) and Deny (opens a sheet for the optional
  explanation that gets emailed).
- **Web — settings** (`pages/settings/CompanyInfo.tsx`, `routes/settings.ts`): e-Transfer
  email + instructions fields. `components/PaymentSection.tsx` was rewritten to take them
  as props alongside the server-computed balance — the hardcoded `blindsnisa@gmail.com`
  literal is GONE (changing it used to need a redeploy). The block renders only when
  confirmed AND `balance > 0` AND an address is configured.
- **Decisions:** cancellation only in the pre-payment window; banner red on staff only;
  customer may withdraw; denial emails the customer but acceptance does not.
- Verified on the dev machine: api `tsc` clean + vitest 114/114 (+24: 11 public-route,
  9 resolve-route, 4 template), web `tsc` clean + vitest 40/40 + oxlint clean (only the 4
  pre-existing `LineItemEditor` warnings). NOT yet exercised against live Resend, and
  migration 27 is NOT yet applied.

## 2026-07-21 — Payment receipt emails (manual, per payment, with invoice-overview link)
Full-stack feature (spec: `docs/superpowers/specs/2026-07-21-payment-receipt-email-design.md`).
For a specific recorded payment, the consultant can email the customer a branded
receipt with a "View your order" CTA to the public page (`/customer/:public_token`).

- **Schema** (`supabase/migrations/20260721000026_payments_receipt_sent.sql`, applied
  live to `lgbxxlwsdeuhdgzrjjen`): `payments.receipt_sent_at timestamptz` — NULL = never
  sent, no backfill; re-stamped on resend. Stamped only AFTER Resend accepts the send.
- **API** (`routes/orders.ts`): `POST /:id/payments/:paymentId/receipt`, body
  `{ message? }` via the shared `sendMessageSchema` (`.strict()`). Guards: 404 order /
  payment-not-on-this-order, 400 no customer email, 502 on Resend failure (email-then-
  persist: a failed send leaves the row untouched). `public_token` reused, minted +
  persisted like send-invoice when absent. ALL money server-side: paid-to-date =
  `sumPayments(ledger)`, balance = `total − paidToDate` (round2). On success: stamp,
  activity log `Receipt for $X.XX emailed to <email>.`, refreshed detail response.
- **Email** (`lib/email.ts`): `buildReceiptEmailHtml` / `ReceiptEmailInputs` in the
  "Customer Emails" design system. Summary card rows Payment / Received / Order total /
  Paid to date; balance > 0 → "Balance remaining" total line; balance ≤ 0 → accent
  "Paid in full" headline and NO balance line. Optional consultant message block;
  CTA "View your order"; everything through `escapeHtml`.
- **Web** (`pages/orders/OrderDetail.tsx`, `hooks/useOrders.ts` `useSendReceipt()`,
  `types/index.ts` `Payment.receipt_sent_at`): envelope icon action on each payment row
  (between amount and delete, `shrink-0` so rows can't widen on phones); muted
  "· ✓ Receipt sent" micro-text inside the row's truncating span; Send/Resend receipt
  bottom sheet (recipient email read-only, amount + date, optional 1000-char message).
  Missing customer email blocks the trigger with a toast (send-estimate precedent).
- **Decisions:** manual only (no auto-send from the e-Transfer webhook), no PDF
  attachment, resend always allowed.
- Verified centrally: api `tsc` clean + vitest 81/81 (4 new route tests, 6 new template
  tests), web `tsc` clean + vitest 40/40 + oxlint clean (only the 4 pre-existing
  `LineItemEditor` warnings). Not yet exercised against live Resend from the UI.

## 2026-07-21 — Mobile alignment pass, Record Payment moved into the Payments panel, darker card outlines
Web-only UI change (no API, schema, or pricing impact — money paths untouched).

- **One gutter for the whole screen.** The order page used three different horizontal
  gutters: `PageHeader` `px-2` (8px), the content column `p-4` (16px), and the mobile
  sticky action bar `p-3.5` (14px), so the header row, the card edges and the bar edges
  each stopped at a different x. All three now share the page container —
  `mx-auto w-full max-w-lg` + a 16px gutter:
  - `components/PageHeader.tsx` — the bar stays full-bleed (its hairline still spans the
    screen) but its ROW is now a constrained `mx-auto w-full max-w-lg px-4 lg:max-w-none
    lg:px-6` flex row. The back chevron gets `-ml-2.5` so the GLYPH, not its 44px tap
    target, aligns with the gutter, and `shrink-0`; the right slot is `shrink-0` (the
    title truncates instead).
  - `pages/orders/OrderDetail.tsx` — sticky bar padding `p-3.5 → py-3.5`, inner wrapper
    `mx-auto max-w-lg → mx-auto w-full max-w-lg px-4`.
- **Record Payment moved into the Payments panel body** (`paymentsPanel`): a full-width
  brand button (h-11, `ICONS.payment`) below the Balance due row, calling the same
  `openPayment()` sheet. The `payment` `StageAction` was DELETED from `stageActions()`,
  so it no longer appears in the mobile sticky bar or the desktop pricing-rail footer.
  Consequent stage sets: `awaiting_payment` → `{ primary: null, secondary: [reverse,
  overview] }`; `in_progress` → `{ markReady, [manufacturer, overview] }`; `ready` →
  `{ propose, [markInstalled, overview] }`; `installed` → `{ null, [overview] }`.
  Coverage is unchanged because the panel renders on exactly the `postConfirm` stages
  that used to offer the action. The ledger itself is untouched: order total, one row per
  recorded payment (date · note, amount, delete), amount paid, balance due.
- **Darker card outlines (design tokens, `index.css`).** `--color-border` (card outlines)
  `#e4e4e7 → #d4d4d8` and `--color-border-light` (inner dividers) `#ececee → #e4e4e7`, so
  a card's outline is now one clear step darker than the rows inside it and each section
  reads as one group. Inner separators on the order page were moved onto the light token
  to keep that hierarchy: the line-item list `divide-border-light`, its bulk toolbar
  `border-b`, the Total / Balance-due rules, and the desktop rail's totals rule. Structural
  chrome (rail edges, sticky-bar top border, header hairline) stays on the darker token.
- Files: `apps/web/src/index.css`, `apps/web/src/components/PageHeader.tsx`,
  `apps/web/src/pages/orders/OrderDetail.tsx`.
- Verified on the dev machine: web `tsc --noEmit` clean, vitest 40/40, oxlint clean for
  both touched files (only the 4 pre-existing `LineItemEditor` fast-refresh warnings
  remain). NOT verified on a physical phone — see `bug_fixes.md` for the overflow fixes
  shipped alongside.

## 2026-07-20 — Order Overview page (new tab) + compact mobile action bar
Two UI features (web only; no API, schema, or pricing impact — money paths untouched):
- **Order Overview action (every post-draft stage):** a new "Order Overview" button
  (`ICONS.overview`, list icon) on `sent`, `awaiting_payment`, `in_progress`, `ready`,
  `installed` AND `expired` orders (not draft/unsaved). It opens the NEW PAGE
  `/orders/:id/overview` in a NEW TAB (`window.open(..., '_blank', 'noopener')` — same
  pattern as the Manufacturer Copy page). The page (`pages/orders/OrderOverview.tsx`,
  lazy + guarded route in `App.tsx`, registered after `/orders/:id/manufacturer`) is a
  read-only, print-friendly (Print button → `window.print()`) TABLE view rendered from the
  SERVER row: ONE TABLE PER BLIND TYPE (grouped by the snapshotted `blinds_type`, insertion
  order; empty type falls back to "Blind") with one column per field —
  Room | Width (cm, multi-panel widths join as `120 + 80`) | Height (cm) | Material |
  Colour | Cassette | Control | Qty | Unit | Total | Note (Width/Height split into separate
  right-aligned columns on request; page container widened `max-w-3xl → max-w-6xl` for
  readability) — plus one trailing "Other Items" table for preset/custom lines
  (Type | Description | Qty | Unit | Total). Each table card's header shows the group's
  item count + subtotal (summed stored `line_total`s). Real `<table>`s (the app's grid-table
  pattern squeezes; these need ~10 columns) inside `overflow-x-auto` wrappers with a
  `min-w`, so tables scroll horizontally on phones while the page body never does. A totals
  card shows subtotal / discount / tax / total plus Paid & Balance due when payments exist.
  Snapshot names (not the live catalog) are used deliberately so the page reflects exactly
  what was priced. `items` is memoized off `order.line_items` before the grouping `useMemo`s
  (avoids the oxlint exhaustive-deps churn warning). (Iterations same day: in-page bottom
  sheet → new-tab page → per-type tables, each at the user's request; the sheet, its
  `sheet` union entry and the `optionName()` helper were removed from `OrderDetail.tsx`.)
- **Compact mobile sticky action bar (max 3 rows):** the old `actions()` builder (one
  full-width button per row — up to 5 rows on `in_progress`/`ready`, covering much of a
  phone screen) was refactored into a data-driven `stageActions()` returning
  `{ primary, stacked, trailing }` `StageAction` descriptors (icon, full `label`, compact
  `short` label, onClick, disabled, tone), consumed by two renderers inside `actions(vertical)`:
  - **Desktop rail (`vertical`)**: unchanged layout — primary, stacked full-width
    secondaries, Send + Download as the 50/50 trailing row (Overview now appears as a
    stacked secondary).
  - **Mobile bar**: the stage's primary action alone on its own full-width row (h-12);
    ALL other actions become smaller inline buttons (h-10, 12px text, short labels like
    "Cut Sheet"/"Payment"/"Reverse"/"Resend") packed ≤3 per row (4 actions split 2+2 for
    balance). Worst case (in_progress/ready: 6 secondaries) = primary + 2 rows = 3 rows.
    Expired has no primary (save/overview/send/download in 2 rows).
- **Save / Send / Download moved to the TOP BAR (same day, follow-up request):** the three
  document actions left the action panels entirely and now sit in `PageHeader`'s `right`
  slot on `OrderDetail.tsx` (`headerActions`, next to the StatusBadge), colour-coded:
  Save GREEN (`bg-success`), Send BLUE (`bg-brand-600`), Download GRAY (the standard
  bordered secondary style). h-9, icon-only on phones (labels `hidden sm:inline`;
  title/aria-label preserved), same enable rules as before (Save `!canAct`; Send busy/
  no-customer/no-items; Download unsaved-without-customer). `stageActions()` slimmed to
  `{ primary, secondary }` (no more `trailing`): unsaved → nothing (top-bar Save is the
  action; `actions()` returns null and the desktop rail footer strip is skipped via
  `railActions`); draft → Confirm is now the PRIMARY (was send); other stages keep their
  primary + [stage actions..., overview] as inline secondaries. Mobile bar worst case is
  now 2 rows (primary + ≤3 compact buttons).
- Also fixed the one standing oxlint warning in this file (`no-unused-expressions` ternary
  in `toggleSelect` → if/else). Verified after the top-bar rework: web `tsc --noEmit` clean,
  `vitest` 40/40, `oxlint` 0 warnings outside the pre-existing LineItemEditor fast-refresh
  notices.

## 2026-07-13 — Manufacturer Copy (workshop cut sheet) + Material fabric width
A new in-house cut-planning feature. From an `in_progress` order, a "See Manufacturer Copy"
button opens `/orders/:id/manufacturer` in a NEW TAB — a print-friendly cut sheet computed
entirely client-side from the order's line items + the live Materials catalog. NO pricing/
money impact anywhere (the snapshot/twin rules are untouched).
- **Domain rule:** Roller, Zebra and Sunscreen/Solar are BUILT in-house from a 6 m aluminium
  bar (runs the WIDTH) + fabric; every other blind type and all preset/custom lines are
  ordered from the factory as-is (just listed). One physical blind = one aluminium cut
  (length = panel width) + one fabric piece (panel width × drop). Panels × quantity expand.
- **DB (migration 24, `20260713000024_materials_width.sql`):** adds nullable
  `materials.width_cm numeric(10,2)` with `check (width_cm is null or width_cm > 0)`. NULL =
  "assume a 3 m (300 cm) roll" in the planner. It flows through the existing generic
  insert/update in `settings.ts` automatically (real column, `withBlindTypeIds` spreads it).
  ⚠️ NOT yet applied to live `lgbxxlwsdeuhdgzrjjen` — run it before shipping.
- **API (`routes/settings.ts`):** `materialSchema.width_cm`
  (`z.number().positive().finite().nullable()`), added to the create-partial key list so it's
  optional on create and clearable on update. Width is a manufacturing input, so it is NOT
  snapshotted onto `line_items` (read LIVE from the catalog by `material_id`; a deleted/blank
  material falls back to 300 cm).
- **Algorithm — new pure module `apps/web/src/lib/manufacturing.ts` (no I/O, no React):**
  - `planAluminumCuts()` — 1-D bin packing (First-Fit-Decreasing) of cut lengths into 6 m
    (`ALUMINUM_STOCK_CM=600`) bars; cuts > one bar returned as `oversize`. Grouped per blind
    type (Roller/Zebra/Solar profiles differ).
  - `planFabricCuts()` — 2-D **shelf** packing (First-Fit-Decreasing-Height) at a fixed roll
    width (`DEFAULT_FABRIC_WIDTH_CM=300`). Models the real machine: it cuts the HEIGHT across
    the FULL roll width per "course"; the tallest piece in a course sets its cut height, each
    shorter piece is trimmed (top offcut), unused roll width is a side offcut. Pieces wider
    than the roll → `oversize`. Grouped per DISTINCT FABRIC CODE = material
    **+ colour** (`material_id|color`), so the same material in two colours is planned as two
    separate rolls and never cut together; roll width still comes from the material catalog
    (colour doesn't change width). Group heading shows "Material — Colour".
  - `buildManufacturingPlan(items, widthByMaterialId)` — walks line items into aluminium
    groups + fabric groups (+ utilisation stats) + an as-is list + `warnings` (missing
    height/panels, oversize). Reuses `normalizeBlindType` from the calculator registry for
    `isAluminumType` (keys: roller/zebra/sunscreen/solar/sunscreensolar).
  - Tests `manufacturing.test.ts` encode the spec's worked example (150×150 + 100×130 on a
    300 roll → one 150-tall course, 50×150 side + 100×20 top offcuts, 78.9% utilisation).
- **Web UI:** `types Material.width_cm`; `MaterialsForType.tsx` gains an optional "Width cm"
  input on the add + edit forms, an optional 3rd CSV column (name, price, width), and a
  "… cm wide" tag in the list row (blank width shows nothing). New page
  `pages/orders/ManufacturerCopy.tsx` (aluminium bars, fabric courses with cut instructions +
  offcuts, as-is table, warnings box, Print button). Route
  `/orders/:id/manufacturer` (lazy, guarded, `Layout nav={false}`) in `App.tsx`. New
  `ICONS.manufacturer` + "See Manufacturer Copy" secondary button in the `in_progress` branch
  of `OrderDetail.tsx`'s `actions()` (`window.open(..., '_blank', 'noopener')`).
- **Cut-done milestone (added same session):** a REVERSIBLE "Cut done" toggle switch at the
  bottom of the Manufacturer Copy page records when the workshop finished cutting, so
  re-opening the page shows the switch on + "Cuts completed on <date>".
  - **DB (migration 25, `20260713000025_orders_cut_done.sql`, NOT yet applied live):**
    nullable `orders.cut_done_at timestamptz`. Independent of the status lifecycle.
  - **API (`routes/orders.ts`):** `POST /:id/cut-done` with a `{ done: boolean }` `.strict()`
    body (400 on malformed). Confirmed-only (409 otherwise, 404 if missing). `done:true` stamps
    `cut_done_at = now()` (only if not already set, so re-marking keeps the original date);
    `done:false` clears it to null; a no-op (already in the requested state) skips the
    write + log. Logs "Cuts marked done." / "Cut-done cleared." `DETAIL_SELECT` is `*` so the
    column flows through reads automatically. 6 route tests (on / off / no-op / 409 / 400 / 404).
  - **Web:** `Order.cut_done_at`; `useSetCutDone()` (`{ id, done }`; `onSuccess` caches the
    authoritative order → the switch reflects the new state immediately and on reload).
    `ManufacturerCopy.tsx` footer is a `role="switch"` toggle (green when on, shows the
    completed date; only when there's in-house cut work).
- **Verification:** algorithm + colour-grouping runtime-verified in isolation via standalone
  Node ports (all assertions incl. the worked example passed). ⚠️ The Cowork sandbox mount was
  truncated this session (even the pnpm store's `tsc.js`/`vitest.mjs` were byte stubs), so
  `pnpm check` / `pnpm test` / `pnpm lint` (web + api) COULD NOT run here — run them on the dev
  machine, plus apply migrations 24 AND 25, before deploying.

## 2026-06-27 — Phase 1: Project Scaffolding
- Initialized pnpm monorepo with `apps/web` (React frontend) and `apps/api` (CF Worker backend)
- Configured Tailwind CSS v4 with custom design tokens (brand colors, spacing, shadows)
- Implemented core pricing logic in `apps/web/src/lib/pricing.ts`:
  - `applyWidthMinimum()` — widths < 100cm charged as 100cm
  - `applyHeightMinimum()` — tiered minimums: <100→100, 100-199→200, ≥200→actual
  - `calculateBlindUnitPrice()` — fabric + cassette + control costs
  - `calculateBlindLineTotal()` — unit price × quantity
- Implemented order number generator in `apps/web/src/lib/orderNumber.ts`
- Created typed API fetch wrapper in `apps/web/src/lib/api.ts`
- Set up Supabase admin client factory in `apps/api/src/lib/supabase.ts`
- Defined complete TypeScript types for all database models in `apps/web/src/types/index.ts`
- Created Worker entry point with CORS, security headers, health check, and cron handler

## 2026-07-03 — Stability Improvements (plan review)
- Added Vitest + 18 unit tests for money math: `pricing.test.ts` (14), `orderNumber.test.ts` (4)
- Plan: UNIQUE index on `estimates.order_number` + Worker retry-on-conflict (implements in Phase 7)
- Plan: send flow sets `status='sent'` only after Resend succeeds; `public_token` reused on resend
- Plan: Phase 10 weekly `pg_dump` backup routine (free tier has no PITR)
- Upgraded wrangler ^3.114.0 → ^4.20.0 in `apps/api/package.json`

## 2026-07-03 — Phase 2: Database Schema
- 10 migrations in `supabase/migrations/` (00 helpers + one per table, per AI Guidelines §14):
  profiles, company_settings (singleton id=1), fabrics, cassette_options, control_options,
  preset_line_items, customers (soft delete), estimates, line_items (snapshot pricing columns)
- Every table: RLS enabled, `authenticated_full_access` policy, `updated_at` trigger
- `estimates`: status check constraint, `expiry_date >= estimate_date` check, UNIQUE order_number,
  status/customer indexes; deliberate deviation — NO anon RLS policy (public reads only via Worker)
- Idempotent `supabase/seed.sql` with dev fabrics/cassettes/controls/presets

## 2026-07-03 — Phase 3: Authentication
- `apps/api/src/middleware/auth.ts` — `requireAuth`: Bearer extraction, jose JWKS verify
  (per-isolate JWKS cache), issuer check, attaches `{id, email}` to context, uniform 401s
- `apps/api/src/middleware/rateLimit.ts` — fixed-window in-memory limiter (5/min/IP default),
  Retry-After header, 10k-IP memory cap; per-isolate limitation documented and accepted
- `apps/web/src/lib/supabaseClient.ts` — anon-key client for auth only; fails loudly on missing env
- `apps/web/src/hooks/useAuth.ts` — Zustand store: initialize/signIn/signOut, onAuthStateChange sub
- `apps/web/src/pages/Login.tsx` — mobile-first form, 48px targets, redirect-back-after-login
- `apps/web/src/components/ProtectedRoute.tsx` — loading splash / redirect guard
- `apps/web/src/lib/api.ts` — rewritten: token fetched from supabase session per request
  (no manual storage), typed `ApiError` with HTTP status
- `apps/api/src/index.ts` — `requireAuth` on `/api/*` (health stays public), temp `/api/me` echo

## 2026-07-03 — Database Live (Supabase project lgbxxlwsdeuhdgzrjjen)
- Applied all 10 migrations + seed data via Supabase MCP; 9 tables, RLS on all, 15 catalog rows
- Advisor-driven hardening: `set_updated_at()` now pins `search_path = ''` (lint 0011);
  mirrored into `supabase/migrations/20260703000000_init_helpers.sql`
- Advisor `rls_policy_always_true` warnings on all tables ACCEPTED — intentional single-org
  design; policies grant only the `authenticated` role, Worker uses service role, anon gets nothing
- Live middleware test via `wrangler dev`: `/api/health` 200 public; `/api/me` 401 for both
  missing and invalid Bearer tokens; project JWKS confirmed serving ES256 key
- Created `apps/web/.env` (project URL + anon key) and `apps/api/.dev.vars` (service_role placeholder)

## 2026-07-03 — Phase 4: Settings Module
- `apps/api/src/routes/settings.ts` — company GET/PUT (Zod partial schema), logo upload
  (multipart, image/* ≤2MB, timestamped name in `company-assets` bucket, public URL saved),
  and a catalog route factory registering GET/POST/PUT/DELETE for fabrics, cassette-options,
  control-options, presets; uniform `{data}`/`{error}` envelopes; mounted at `/api/settings`
- Migration 10: `company-assets` storage bucket (public read, service-role-only writes) —
  applied live + mirrored to `supabase/migrations/20260703000010_company_assets_bucket.sql`
- `apps/web/src/lib/api.ts` — FormData bodies skip the manual Content-Type header
- `apps/web/src/hooks/useSettings.ts` — company query/mutation/logo-upload hooks + generic
  catalog hooks; updates are optimistic with rollback, create/delete invalidate (tiny lists)
- `apps/web/src/components/PageHeader.tsx` — shared back-button header (≥44px targets)
- `apps/web/src/components/CatalogEditor.tsx` — generic add/edit/toggle/delete list editor;
  the four catalog pages are ~20-line configs of it
- Pages: SettingsIndex (nav hub), CompanyInfo (form + logo upload), Fabrics, CassetteOptions,
  ControlOptions, PresetLineItems, TermsAndConditions (1.5s debounced autosave + status text)
- App.tsx settings routes now render real pages; hooks barrel re-exports settings hooks
- Verified: api `tsc` clean, web build clean, 18 tests pass, live `wrangler dev` smoke test
  (`/api/settings/fabrics` → 401 unauthenticated, health → 200)

## 2026-07-03 — Phase 5: Customers Module
- `apps/api/src/routes/customers.ts` — list with `?q=` ILIKE search (sanitized term: commas/
  parens/wildcards stripped before embedding in PostgREST `or()`), POST create, GET/:id,
  PUT/:id partial update, DELETE/:id soft delete via `deleted_at`; all reads exclude deleted;
  mounted at `/api/customers`
- `apps/web/src/types/index.ts` — Customer aligned with live schema (non-null text fields,
  `deleted_at` added, phantom `created_by` removed)
- `apps/web/src/hooks/useDebouncedValue.ts` — reusable 300ms debounce hook
- `apps/web/src/hooks/useCustomers.ts` — `useCustomerSearch` (debounced, keepPreviousData;
  shared with Phase 7 estimate editor), detail/create/update/delete hooks
- `apps/web/src/pages/customers/CustomerList.tsx` — search-as-you-type list, sticky
  "+ New Customer" bar
- `apps/web/src/pages/customers/CustomerForm.tsx` — one component for new/edit routes;
  billing block hidden by "Billing same as shipping" checkbox (values preserved when hidden);
  soft-delete button in edit mode; sticky save bar
- Verified: api `tsc` clean, web build clean, 18 tests pass, `/api/customers` → 401 smoke test

## 2026-07-03 — Phase 6: Main Page & App Shell
- `apps/web/index.html` — Inter font (Google Fonts, preconnect), proper title, theme-color,
  viewport-fit=cover for iOS safe areas
- `apps/web/src/components/BottomNav.tsx` — fixed bottom nav (Home/Customers/Estimates/
  Settings), active-tab highlighting via NavLink, safe-area padding, ≥44px targets
- `apps/web/src/components/Layout.tsx` — wraps SECTION-level pages only (Main, lists,
  settings hub); form/detail pages keep their own sticky action bars instead — nesting both
  would stack two fixed bottom bars
- `apps/web/src/components/Skeleton.tsx` — Skeleton + ListSkeleton loading placeholders
- `apps/web/src/components/EmptyState.tsx` — icon/title/hint empty state
- `apps/web/src/pages/Main.tsx` — company logo+name header (live from settings), gear icon
  → /settings, three big buttons (Customers, Estimates, Tools-disabled), sign-out
- CustomerList adopted ListSkeleton/EmptyState; its sticky "+ New Customer" bar moved to
  `bottom-14` to clear the nav
- NOTE: web bundle now warns >500 kB minified — consider route-level code-splitting in Phase 10

## 2026-07-03 — Phase 7: Estimates Core
- Types aligned with DB (`position`, `cassette_id`, no 'rejected', no created_by/notes/width_cm)
- `apps/web/src/lib/totals.ts` + tests — §6 order: subtotal → discount (clamped 0..subtotal,
  before tax) → taxable → 13% HST → total; every stage rounded to 2dp
- `apps/api/src/lib/{pricing,totals,orderNumber}.ts` — AUTHORITATIVE server twins of the web
  libs, each with mirrored unit tests (drift in either side fails a suite)
- `apps/api/src/routes/estimates.ts` — list (status tabs + sanitized search), POST with
  server-generated order number (23505 retry ×5) and 100% server-side pricing (catalog prices
  fetched by id, names+prices snapshotted; line-item schemas are `.strict()` so client-sent
  money fields are REJECTED), GET/:id with defensive expiry, PUT full-recalc (draft/sent only)
- `components/DatePicker.tsx` — react-day-picker in bottom-sheet (mobile) / dialog (sm+)
- `hooks/useEstimates.ts`, `EstimateList.tsx` (Waiting/Confirmed/Expired tabs),
  `LineItemEditor.tsx` (draft models + blind/flat cards, live per-keystroke pricing),
  `EstimateDetail.tsx` (customer bottom-sheet selector, expiry auto-follow until manual
  override, preset picker, discount toggle, sticky Save/Send/Confirm/PDF bar)
- `lib/api.ts` gained `apiDownload` (authenticated blob fetch for PDFs)

## 2026-07-03 — Phase 8: PDF & Email
- `apps/api/src/lib/pdf.ts` — @react-pdf/renderer layout per §10 via React.createElement
  (keeps planned filename, no JSX config change); logo pre-fetched to bytes (png/jpg only,
  fails soft); unit tests render real PDFs and assert %PDF magic + %%EOF
- `apps/api/src/lib/email.ts` — escapeHtml + Resend via plain fetch + branded templates;
  injection attempts pinned by tests
- Routes: GET /:id/pdf (streams), POST /:id/send (email FIRST, DB write only after Resend
  success; public_token reused on resend; chunked base64 for attachments), POST /:id/confirm
- wrangler.toml gained `nodejs_compat`; api package gained react + @react-pdf/renderer + vitest

## 2026-07-03 — Phase 9: Public Flow & Expiry
- `apps/api/src/routes/public.ts` — /public/estimate/:token (sanitized payload — no ids, no
  token echo) + /confirm (DB-level status='sent' guard → exactly-once, 409/410/400 taxonomy),
  UUID shape pre-check, rate limited 5/min/IP, internal notification email best-effort
- Cron scheduled handler implemented: daily UPDATE of stale sent → expired via ctx.waitUntil
- `pages/customer-view/CustomerView.tsx` — expired/confirmed/active/post-confirm states,
  PDF-mirroring layout, big confirm button; `components/PaymentSection.tsx` deposit stub

## 2026-07-04 — UI Redesign (design/project/Blinds Nisa Redesign.dc.html)
- New design language: IBM Plex Sans + IBM Plex Mono (money/order numbers), indigo #2A4FCF
  brand, 2px universal radius, white cards + #E4E4E7 hairlines on #FAFAFA, design focus ring
- Token-level swap in index.css @theme — existing utility classes kept working; added
  surface-sunken, border-input, and status tint tokens
- New components: StatusBadge (uppercase status chips), Sidebar (220px desktop rail with
  active tint + left border, user footer); Layout is now responsive (sidebar lg+, BottomNav
  <lg, `nav` prop for detail pages); PageHeader gained a right slot
- Dashboard rebuilt per screen 02: greeting, live stat cards (awaiting / confirmed this
  week), recent estimates, New Estimate CTA; sign-out moved to Settings per screen 06
- EstimateList/CustomerList: segmented tabs + cards <lg, table pattern (screen 07) on lg+
- EstimateDetail: desktop two-column layout with 320px Live Pricing rail (per-item lines,
  discount, totals, action stack); mobile keeps running-total sticky bar; line item cards
  restyled with "Line item N" headers
- Login per screen 01 (brand mark, admin-provisioned note)
- DESIGN OVERRIDES (kept app truth over mockup): panel-width list instead of single Width
  field, free-text room/blind type, discount + expiry controls, Confirm/PDF actions,
  Control Options + Preset rows in settings
- Verified: build clean, 25 web + 29 api tests pass

## 2026-07-03 — Phase 10 & Verification
- Route-level code splitting (React.lazy + Suspense): public CustomerView chunk is ~8 kB;
  500 kB chunk warning resolved
- Security audit: no secrets in dist bundle, CORS origin-checked (never *), CSP/XFO/nosniff
  global, Zod safeParse on every body-carrying route, zero raw SQL, public payload sanitized
- Route-level integration tests with scripted fake Supabase (28 api tests total): order-number
  retry, tamper rejection, send-failure leaves DB untouched, confirm-once + 409, defensive
  expiry, 429 rate limit
- Live DB constraint tests via Supabase MCP (all pass): unique order_number, expiry check,
  status check, updated_at trigger, line_items cascade, singleton guard, FK delete restriction
- `scripts/e2e.mjs` — full live E2E for the dev machine (creates + cleans temp user/customer/
  estimates); sandbox egress cannot reach supabase.co, so live E2E runs user-side
- Root README.md: setup, tests, env vars, weekly backup routine, deployment steps
- Final: api tsc clean + 28 tests, web tsc/build clean + 25 tests, Worker dry-run bundles
  (825 KiB gzip, within limits)

## 2026-07-04 — Order model (Estimates → Orders) + payments + invoices
The product shifted from an estimate-centric model to an ORDER-centric one. An
"estimate" is now just the PDF/email artifact we send about an order; an "invoice" is
the same document once a payment exists. Two user requests drove this:
  1. Confirmations are reversible by the USER only (never the customer).
  2. Orders carry the properties (total, items, payments); the estimate carries none.

- **DB (migrations 11 + 12):**
  - `20260704000011_orders_rename.sql` — non-destructive `ALTER TABLE estimates RENAME TO
    orders`, `estimate_date → order_date`, `line_items.estimate_id → order_id`; new status
    CHECK `('draft','sent','awaiting_payment','in_progress','completed','expired')`; legacy
    `confirmed` rows migrated to `awaiting_payment`; indexes/trigger renamed.
  - `20260704000012_payments.sql` — `payments` ledger (order_id FK cascade, amount>0,
    paid_on, note), RLS `authenticated_full_access`. Balance is DERIVED (`total − Σamount`),
    never stored.
- **Lifecycle & transitions (api/src/routes/orders.ts, was estimates.ts):**
  send estimate (draft/sent→sent) · confirm (draft/sent→awaiting_payment) · **unconfirm**
  (awaiting_payment→sent, user-only, refused once a payment exists) · record payment
  (awaiting_payment→in_progress on the first) · complete (in_progress→completed) · cron
  defensive expiry still only lapses `sent`. Mounted at `/api/orders`.
- **PDF (lib/pdf.ts):** `buildEstimatePdf`→`buildDocumentPdf`, `PdfEstimateData`→
  `PdfDocumentData` with `docType`. Title flips ESTIMATE↔INVOICE; the invoice variant adds
  an "Amount paid / Balance due" block and a payments list. `docType='invoice'` iff the
  order has ≥1 payment; the send flow always emails an Estimate.
- **Public flow (routes/public.ts):** customer confirm now moves `sent→awaiting_payment`
  (410 expired · 409 already-confirmed). Customers still cannot reverse.
- **Web:** types `Estimate→Order` / `EstimateStatus→OrderStatus` (+`Payment`, `amount_paid`);
  hook `useEstimates→useOrders` (+ send/confirm/unconfirm/complete/recordPayment);
  `pages/estimates → pages/orders` (`OrderList` new tabs, `OrderDetail` status-aware actions
  + Payments panel + Record-Payment sheet); `StatusBadge` 6 statuses w/ labels; dashboard,
  Sidebar/BottomNav ("Orders"), `App.tsx` `/orders` routes (legacy `/estimates/*` aliased);
  `CustomerView` maps post-`sent` statuses to the already-confirmed screen.
- **Tests updated** (orders.routes / public.routes / pdf) — NOTE: not executed in the Cowork
  sandbox (Windows-only node_modules + a flaky mount); run `pnpm --filter api test`,
  `pnpm --filter web test`, and both `tsc --noEmit` on the dev machine to confirm green.

## 2026-07-04 — Installation scheduling + status rename (Ready / Installed)
Status change: `completed` → `ready`, plus a new terminal `installed`. Lifecycle is now
draft → sent → awaiting_payment → in_progress → **ready → installed** (+ expired). After an
order is Ready the user proposes an installation time; the customer confirms it or requests
another via the existing token'd public page. Reaching `installed` stays a deliberate user
action (confirmed via the AskUserQuestion clarification).

- **DB (migration 13, `20260704000013_orders_installation.sql`, applied live):** swapped
  `completed`→`ready` and added `installed` in `orders_status_check`; added `install_date`
  (date), `install_time` (time), `install_status`
  (`unscheduled|proposed|confirmed|change_requested`, default unscheduled),
  `install_confirmed_at`, `install_response_note`.
- **API (routes/orders.ts):** `/complete` → `/ready` (in_progress→ready); new `/installed`
  (ready→installed); new `/install/propose` (ready-only) — emails the customer a one-hour
  arrival window [install_time, +1h] on install_date and stores `install_status='proposed'`
  (mints a public_token if the order was never emailed). Email FIRST, then persist.
  `LIST_STATUSES` updated for the new statuses. Date/time formatting is hand-rolled (no
  `Intl` locale data under workerd).
- **API (routes/public.ts):** public payload now carries `install_status/date/time`; new
  `POST /estimate/:token/install/confirm` (proposed→confirmed) and `.../install/request`
  (→change_requested, optional note). Both notify the business best-effort. Customers can
  respond but never reverse an order confirmation.
- **API (lib/email.ts):** `buildInstallationProposalHtml` (the "We will be there between
  {start} and {end} on {date} if that works for you." message + CTA) and
  `buildInstallationNoticeHtml` (internal confirm/request notice).
- **Web:** `OrderStatus` completed→ready +installed; new `InstallStatus` + install fields on
  `Order`; `StatusBadge` Ready/Installed; `OrderList` tabs Ready/Installed; hooks
  `useMarkReady` / `useMarkInstalled` / `useProposeInstallation`; `OrderDetail` gains a
  Propose-Installation sheet (date + time, live window preview), an Installation panel
  (proposed time + customer response + note), and Mark Ready / Mark Installed actions;
  `CustomerView` shows the proposed window with Confirm / Request-another-time (+note).
- **Tests:** added install propose (orders.routes) and install confirm/request
  (public.routes) — again not executed in-sandbox; run locally.

## 2026-07-04 — Payments at any stage
- **API (routes/orders.ts):** `POST /:id/payments` now accepts any post-confirmation status
  (`awaiting_payment | in_progress | ready | installed`), not just awaiting_payment /
  in_progress. First payment on an awaiting_payment order still advances it to in_progress.
- **Web (OrderDetail.tsx):** a "Record Payment" action is now present at every
  post-confirmation stage (added to `ready` and `installed`; expired stays PDF-only). The
  Record Payment sheet opens with an empty amount (no prefilled default).

## 2026-07-04 — Delete order, progress timeline + revert, edit/delete install time
- **API (routes/orders.ts):**
  - `DELETE /:id` — deletes an order; line_items + payments cascade.
  - `POST /:id/revert { to }` — moves an order BACKWARD to an earlier lifecycle stage
    (`STAGE_ORDER` guard: target must be earlier). Resets stage-dependent metadata —
    confirmed_at below awaiting_payment, sent_at below sent, the whole install schedule
    below ready. Payments (a ledger) are never deleted. `expired` is treated as just past
    `sent`, so it can be reverted to draft/sent (re-activated).
  - `POST /:id/install/cancel` — clears a set installation time (back to unscheduled).
- **Web (OrderDetail.tsx):**
  - A **Progress** timeline card renders the six linear stages with the current one
    highlighted and a small undo icon on each earlier stage to revert to it (confirm-gated).
    Placed OUTSIDE the disabled fieldset so revert works on read-only (confirmed) orders; so
    are the payments/installation panels and the new **Delete Order** button.
  - Installation panel (ready) gained **Change time** (re-opens the propose sheet prefilled
    from the existing proposal) and **Delete time** (cancel) buttons.
  - New hooks: `useDeleteOrder`, `useRevertOrder`, `useCancelInstallation`.
- **Tests:** added revert (200 backward / 409 forward) and delete (200 / 404) route tests.

## 2026-07-06 — Calendar feature (monthly view + install-proposal wizard)
Added a dedicated **Calendar** surface over the existing installation-scheduling domain
(no new lifecycle, no schema change) per the approved `calendar_feature_plan.md`.

- **API (`routes/orders.ts`):** new `GET /calendar?from=&to=` (inclusive `YYYY-MM-DD`
  range, Zod-validated via the existing `isoDate` schema in a `.strict()` object).
  Returns `{ data: CalendarEvent[] }` — lightweight rows (id, order_number, install_date,
  install_time, install_status, status, customer(first_name,last_name)) filtered to
  `install_status IN ('proposed','confirmed','change_requested')`; a plain `unscheduled`
  order never appears. **Registered BEFORE `GET /:id`** (right after the `GET /` list
  handler) — Hono resolves routes in registration order, so `/:id` first would have
  swallowed `/calendar` as `id="calendar"` and 404d. A route-ordering regression test
  pins this.
- **API tests (`orders.routes.test.ts`):** extended the fake DB builder's
  `makeBuilder().chain()` method list with `gte`/`lte` (previously unstubbed) and added
  a `GET /api/orders/calendar` describe block: route-ordering regression, range/status
  result shape, empty range, and two 400 cases (malformed date, missing param).
- **Web types (`types/index.ts`):** new `CalendarEvent` interface — a strict subset of
  `Order` (reuses `InstallStatus`/`OrderStatus`, customer narrowed to
  `Pick<Customer, 'first_name'|'last_name'>`).
- **Web hook (`hooks/useCalendar.ts`, new file):** `useCalendarEvents(fromIso, toIso)` —
  a direct-import TanStack Query wrapper over the new endpoint, deliberately NOT added
  to the `hooks/index.ts` barrel (matches `useOrders.ts`'s existing direct-import
  convention; no barrel refactor). The wizard's ready-order list reuses
  `useOrderList('ready', '')` from `useOrders.ts` rather than a redundant hook.
- **Web components (`pages/calendar/`, new folder):**
  - `MonthGrid.tsx` — pure presentational 6×7 monthly grid (`date-fns` `startOfMonth`/
    `endOfMonth`/`startOfWeek`/`endOfWeek`/`eachDayOfInterval`), weekday header, up to
    3 `EventChip`s per day + "+k more"; tapping empty cell space opens the wizard
    pre-set to that day.
  - `EventChip.tsx` — pending (amber/`warning` token, for `proposed`/`change_requested`)
    vs confirmed (`brand-600`) chip; tap navigates straight to `/orders/:id`.
  - `InstallProposalWizard.tsx` — strict 3-step, one-selection-per-step flow: Day
    (`DatePicker`) → Time (30-minute slots, 08:00–18:00, LOCKED) → Ready order
    (`useOrderList('ready','')`). Submits via the EXISTING emailing
    `useProposeInstallation` mutation (`POST /:id/install/propose`) — no new "quiet"
    endpoint (LOCKED decision); success toast "Installation proposed — customer
    emailed"; invalidates `['orders','calendar']` + `['orders','list']`. Mobile bottom
    sheet / desktop dialog mirrors `DatePicker.tsx`'s overlay pattern.
  - `CalendarPage.tsx` — thin composition root: owns month state + wizard open/day
    state only; header has month label + prev/next/Today.
- **Nav:** `Calendar` added as a 5th item in `Sidebar.tsx` `ITEMS` and a 5th tab in
  `BottomNav.tsx` `TABS` (Home, Customers, Orders, Calendar, Settings), both `/calendar`,
  stroked-SVG calendar glyph matching the existing icon convention.
- **Routing (`App.tsx`):** lazy-imported `CalendarPage`; `<Route path="/calendar" .../>`
  wrapped in the auth guard + `Layout` like the other section-level pages.
- **Verification:** the Cowork sandbox's mounted view of the repo lagged behind on-disk
  edits during this session (files read back as truncated/stale via the bash tool even
  though the Read/Edit tools confirmed correct, complete content) — a sharper case of
  the previously-documented "flaky mount" issue. `tsc --noEmit` / `pnpm build` could NOT
  be run reliably against the live tree; a scratch `npm install` + `tsc -p
  tsconfig.app.json --noEmit` copy caught one real issue (an unused `isSameDay` import
  in `MonthGrid.tsx`, since fixed) before the mount staleness made further copies
  untrustworthy. Manual line-by-line review of every new/changed file was done instead.
  **Run on the dev machine before shipping:** `pnpm --filter api test`,
  `pnpm --filter web test`, `pnpm --filter api exec tsc --noEmit`,
  `pnpm --filter web exec tsc --noEmit`, `pnpm --filter web build`.

## 2026-07-04 — Line Item Summary Table, Bulk Edit, and Status Advance
- **Web (LineItemEditor.tsx):** Refactored from full inline cards (`BlindItemCard`, `FlatItemCard`) to modular forms (`BlindEditForm`, `FlatEditForm`) designed for modal use. Added `BulkEditForm` to manage bulk edits (only `fabric_id`, `cassette_id`, `control_id`).
- **Web (OrderDetail.tsx):** 
  - **Summary Table:** Replaced inline line item cards with a compact summary list showing a checkbox, type badge, description/name, total price, and action icons (Edit, Delete).
  - **Bulk Actions:** Added a toolbar above the line items list to support Select All, Bulk Edit, and Bulk Delete. Bulk editing is correctly restricted to only blind items (disables if custom/preset items are selected).
  - **Edit Popups:** Integrated bottom sheets for individual line item edits (local copy pattern; changes applied on save) and bulk editing.
  - **Status Advance:** Added tick (✓) icons below future stages in the Progress timeline to allow one-step-forward status progression. Later stages are disabled with context-aware tooltips (e.g., `awaiting_payment → in_progress` requires recording a payment).
- **API (routes/orders.ts):** 
  - `DELETE /:id/payments/:paymentId` — deletes a payment and auto-reverts `in_progress → awaiting_payment` if it was the last payment.
- **Web (Hooks):** Added `useDeletePayment` hook.

## 2026-07-06 — All Orders Tab, Always-Editable Orders, Order Activity Log
- **All Orders tab:** `OrderList.tsx` gains an `all` tab (first in `TABS`) alongside the existing
  status tabs. `useOrders.ts`'s `OrderTab` union gained `'all'`. `GET /api/orders?status=all` in
  `routes/orders.ts` is now handled explicitly (no filter applied — every status, including
  `expired`) rather than relying on the prior implicit fallthrough.
- **Orders editable at any status:** `PUT /:id` in `routes/orders.ts` no longer rejects edits on
  confirmed/later-stage orders — the `EDITABLE = ['draft','sent']` guard was removed from that
  route only (the `send`/`send-invoice` re-send eligibility check and the `confirm` eligibility
  check still use `EDITABLE`, since those represent a different rule: which orders may be
  (re)confirmed/sent, not which may have their line items changed). `OrderDetail.tsx`'s `readOnly`
  flag is now hardcoded `false` — the customer/dates/line-item fieldset is never disabled, and a
  "Save as Draft" button was added to the `awaiting_payment` / `in_progress` / `ready` / `installed`
  / expired-fallback action-bar branches (previously only `draft`/`sent` had a save action). The
  server still fully recalculates totals on every save regardless of status.
- **Order activity log:** new `order_logs` table (migration
  `20260706000017_order_logs.sql`, applied to the live Supabase project) — append-only,
  `order_id` FK cascade-deletes with the order, `message` (plain text), `created_at`. `routes/orders.ts`
  gained a `logOrderEvent(sb, orderId, message)` best-effort helper (swallows insert errors — logging
  must never fail the mutation it describes) called from: create, edit (PUT), send estimate, send
  invoice, confirm, unconfirm, record payment, delete payment, in-progress, ready, installed,
  install/propose, revert, install/cancel. New `GET /:id/logs` route returns the trail newest-first
  (limit 200). Web: `OrderLog` type in `types/index.ts`, `useOrderLogs(id)` hook in `useOrders.ts`
  (cache-invalidated by every lifecycle mutation's shared `useCacheOrder`), and an "Activity Log"
  section in `OrderDetail.tsx` rendered at the very bottom of the page, below the Delete Order
  button (outside the disabled fieldset, always visible for a saved order).

## 2026-07-07 — Terms & Conditions: expandable section on the public customer view
- Terms & Conditions was already fully wired: `company_settings.terms_and_conditions`
  (migration `20260703000002`), `apps/api/src/routes/settings.ts`'s `companySchema`,
  the `apps/web/src/pages/settings/TermsAndConditions.tsx` autosave page (linked from
  `/settings/terms`), the order-level `terms_snapshot` captured at send-time (falls back
  to live `company_settings.terms_and_conditions` if unset), and the PDF's
  "Terms & Conditions" block at the very bottom of `apps/api/src/lib/pdf.ts`.
- The one gap was `apps/web/src/pages/customer-view/CustomerView.tsx`: the public estimate's
  TERMS & CONDITIONS block rendered as a static always-open `<section>`. Changed it to a
  collapsed-by-default expandable section — a `<button aria-expanded>` header (title +
  rotating chevron `<svg>`, matching `PageHeader.tsx`'s back-chevron stroke-icon style) that
  toggles local `termsOpen` state; the terms paragraph only renders while open. No API/DB/PDF
  changes were needed.

## 2026-07-07 — Security-review hardening: log actors, delete guard, payment guards
- `order_logs.actor_email` (migration 18): every authenticated mutation now logs WHO did
  it — `logOrderEvent()` gained an `actorEmail` param, filled from `c.get('user')?.email`
  at all 14 call sites in `routes/orders.ts`; `GET /:id/logs` selects it and the Activity
  Log section in `OrderDetail.tsx` renders it muted after the message. Empty for system
  events (cron) and pre-migration rows.
- **Delete guard:** `DELETE /api/orders/:id` now requires status `draft` or `expired`
  (409 otherwise) — sent/paid orders are accounting history; use `/revert` instead. The
  Delete Order button in `OrderDetail.tsx` hides on all other statuses. Route tests cover
  draft/expired/409/404.
- **Payment guards:** `payments.client_key` idempotency + `allow_overpay` overpay consent
  flow with an OVERPAY confirmation pop-up (see bug_fixes.md 2026-07-07 for details).
- **Atomic order updates:** `update_order_with_items` RPC (see bug_fixes.md 2026-07-07).
- **Business-timezone dates:** new `apps/api/src/lib/dates.ts` (see bug_fixes.md).
- Migration `20260707000018_payment_guards_log_actor.sql` APPLIED live to
  `lgbxxlwsdeuhdgzrjjen` (RPC smoke-tested: raises "Order … not found" for unknown ids).
- ⚠️ Not executed in the Cowork sandbox (Windows-built node_modules): api/web
  `tsc --noEmit` + `vitest`. Run on the dev machine before deploying.

## 2026-07-11 — Address autocomplete, appointment-details page, See All list
- **Address autocomplete (Photon, key-less):** new `apps/web/src/lib/addressSearch.ts`
  wraps the free OpenStreetMap Photon geocoder (`photon.komoot.io`, biased to southern
  Ontario, Canada-only, results normalised to line1/city/province-code/postal). New
  `apps/web/src/components/AddressAutocomplete.tsx` is a controlled Address-Line-1 input
  with a debounced (300ms, reuses `useDebouncedValue`) suggestion dropdown, keyboard
  nav (↑/↓/Enter/Esc), and abortable in-flight requests; picking a suggestion fires
  `onSelect` to auto-fill the address block. Wired into BOTH customer-entry surfaces so
  all three entry paths are covered: `CustomerForm.tsx` (shipping + billing blocks; new
  `applyAddress('shipping'|'billing', …)` uses literal keys, not computed `${prefix}_…`,
  to stay assignable to FormState's boolean-containing shape) and `CustomerCreateModal.tsx`
  (used by the order editor's customer picker AND the appointment wizard's customer step).
  It is a public geocoding call straight from the browser — NOT a Worker data call — so no
  secret/key is involved (security invariants preserved).
- **Appointment-details page:** new `GET /api/appointments/:id` (returns the appointment
  with `customer:customers(*)` + order summary via the existing `APPT_SELECT`; registered
  AFTER the literal `/calendar` and `/order/:orderId` reads per the locked
  literal-before-param routing rule). New `useAppointment(id)` hook. New
  `apps/web/src/pages/calendar/AppointmentDetail.tsx` (`/appointments/:id`) shows the visit
  window, schedule status, and the full customer block with the shipping address rendered
  as a Google Maps search deep link (`https://www.google.com/maps/search/?api=1&query=…`),
  plus email `mailto:`/phone `tel:` links and an order link for installations. Tapping ANY
  calendar chip (`EventChip` now navigates both kinds to `/appointments/:id` instead of
  estimate-chips being inert / installation-chips going to the order) or any under-grid
  section row (`ScheduleSections`) opens it.
- **See All appointments list:** new `GET /api/appointments` (paginated: `?kind=all|estimate|
  installation&page=`, 20/page fixed, newest-first date-desc→time-desc, returns
  `{data,page,page_size,total,total_pages}` via a `count:'exact'` range query; registered
  before `/:id`). New `useAppointmentsList(kind,page)` hook (keepPreviousData for flicker-free
  paging). New `apps/web/src/pages/calendar/AppointmentsList.tsx` (`/appointments`) with
  All/Estimates/Installations filter chips (switching resets to page 1) and bottom
  Prev/Next pagination. A "See All" button was added to the top of `CalendarPage.tsx`.
- Routes `/appointments` and `/appointments/:id` added to `App.tsx` (lazy-loaded, guarded,
  `Layout nav={false}`).
- ⚠️ Not executed in the Cowork sandbox (Windows-built node_modules + stale edited-file
  mount): `pnpm check` (tsc), `pnpm test` (vitest), `pnpm lint` (oxlint). The four NEW web
  files passed an isolated `ts.transpileModule` syntax check; run the full suite on the dev
  machine before deploying.

## 2026-07-12 — Fabric → Material rename, per-type Material lists, calculator hierarchy
Three linked changes, driven by the request to (a) rename "fabric" to "Material"
everywhere, (b) show a different Material list per blind type, and (c) give each blind
type its own calculation module inheriting a shared base.

- **DB (migrations 19–21, all APPLIED live to `lgbxxlwsdeuhdgzrjjen`):**
  - `20260712000019_rename_fabrics_to_materials.sql` — non-destructive rename: table
    `fabrics → materials`, `line_items.fabric_* → material_*` (id/name/price_per_sqm), the
    FK (`line_items_material_id_fkey`), the pk index, and the `fabrics_set_updated_at`
    trigger; rebuilds `update_order_with_items()` against the renamed columns (its old body
    referenced `fabric_*`). Data preserved, so existing order snapshots are untouched.
  - `20260712000020_material_blind_types.sql` — many-to-many join
    (`material_id`, `blind_type_id`, both FK cascade, composite PK), RLS
    `authenticated_full_access`. CONVENTION: a Material with NO links is available for ALL
    blind types.
  - `20260712000021_seed_canonical_blind_types.sql` — aligns `blind_types` to the canonical
    ten (Roller, Zebra, Roman, Sunscreen/Solar, Honeycomb, Shutter, Vertical Sheer, Vertical
    Panel, Vertical Roller, Curtains); renames the legacy "… Blind" rows in place, keeps any
    extra (e.g. "Venetian Blind") at the end. `seed.sql` updated too (materials + the ten
    types) for fresh DBs.
- **Calculator hierarchy (NEW, mirrored api ⇄ web twins):** `apps/{api,web}/src/lib/calculators/`
  — `base.ts` holds the shared "main" formula as `BaseBlindCalculator` (granular override
  hooks `materialCost`/`cassetteCost`/`controlCost` + `applyWidthMinimum`/`applyHeightMinimum`);
  one file per type (`roller.ts`, `zebra.ts`, `roman.ts`, `sunscreen.ts`, `honeycomb.ts`,
  `shutter.ts`, `verticalSheer.ts`, `verticalPanel.ts`, `verticalRoller.ts`, `curtains.ts`)
  each `extends BaseBlindCalculator` and inherits the default UNCHANGED for now (Honeycomb,
  Shutter, Curtains are marked as the ones to be overridden later). `registry.ts`
  (`getCalculator` + `normalizeBlindType`) maps the snapshotted `blinds_type` NAME to a
  calculator — normalising case/punctuation and stripping a trailing "blind" so "Roller
  Blind" and "Roller" both resolve to Roller; unknown/empty → the default base. `index.ts`
  barrels it. `pricing.ts` on both sides became a thin façade: `calculateBlindUnitPrice`
  (type-agnostic default) is kept for back-compat and a new `calculateBlindUnitPriceForType`
  dispatches through the registry.
- **API rename + dispatch:** `routes/orders.ts` (`blindItemSchema.material_id`,
  `resolveLineItems` looks up the `materials` table, snapshots `material_*`, and prices via
  `calculateBlindUnitPriceForType(it.blinds_type, …)`), `routes/public.ts` + `lib/pdf.ts`
  (`material_name`, PDF label "Material:"), and `routes/settings.ts` — the `fabrics` catalog
  was removed from the generic factory and replaced by dedicated Materials routes that
  attach/sync `blind_type_ids` via the join table (GET embeds them, POST/PUT replace them,
  DELETE cascades). Tests updated: `pricing.test.ts` (+ new registry/dispatch block),
  `orders.routes.test.ts` (`MATERIAL`/`materials.select`), `pdf.test.ts`.
- **Web rename + per-type filtering:** `types/index.ts` (`Fabric → Material` with
  `blind_type_ids`, `LineItem.material_*`), `hooks/useSettings.ts` (path `materials`),
  `hooks/useOrders.ts` (`material_id`), `pages/orders/LineItemEditor.tsx` (Material labels,
  `material_id`, new `materialsForType(catalogs, blindsType)` that filters the Material
  dropdown to the selected type — unlinked = all — and clears an invalid Material when the
  type changes; live preview dispatches via `calculateBlindUnitPriceForType(draft.blinds_type,
  …)`), `pages/orders/OrderDetail.tsx` (all refs + bulk edit), `customer-view/CustomerView.tsx`
  (Material label). Settings: `Fabrics.tsx` replaced by a dedicated `Materials.tsx` with a
  blind-type multi-select chip group; `SettingsIndex.tsx` + `App.tsx` route
  `/settings/fabrics → /settings/materials`; generic `CatalogEditor.tsx` doc updated.
- **Verification:** calculators + pricing were runtime-executed and strict-`tsc`-checked in
  isolation (all assertions pass: default math, name normalisation, per-type dispatch,
  default fallback). Full `pnpm check`/`test`/`lint` (web + api) COULD NOT run in the Cowork
  sandbox — the mount served truncated copies of the larger files to every mount-based
  reader (bash `cat`/`wc`, `git add`/`diff`), a sharper recurrence of the documented
  stale-mount issue; Read/Edit tool results (ground truth) confirm every edited file is
  complete and correct. Run on the dev machine before shipping:
  `pnpm --filter api test`, `pnpm --filter web test`, both `tsc --noEmit`, `pnpm --filter web build`.

## 2026-07-12 (later) — Materials UX: two-level blind-type → materials flow
Follow-up to the same-day Material work, per a UX request. The Materials settings section
is now a two-level, per-type flow instead of a flat list with per-material type checkboxes.
- **Materials landing (`pages/settings/Materials.tsx`, rewritten):** now lists the BLIND
  TYPES (with a Material count per type) and is also where blind types are managed
  (add / rename / activate / delete). Each row navigates to that type's Materials.
- **Per-type Materials (`pages/settings/MaterialsForType.tsx`, NEW,
  `/settings/materials/:blindTypeId`):** lists only the Materials LINKED to that type;
  "Add material" creates a Material and links it to this type
  (`blind_type_ids: [thisType]`); edit sends name/price only (omits `blind_type_ids` so
  other links survive); delete removes the Material.
- **Standalone "Blind Types" settings entry REMOVED** — folded into Materials. Deleted
  `pages/settings/BlindTypes.tsx`, dropped the SettingsIndex row and the
  `/settings/blind-types` route; added the `/settings/materials/:blindTypeId` route.
- **Editor filtering tightened to linked-only:** `LineItemEditor.materialsForType()` now
  returns only Materials linked to the selected blind type (dropping the previous
  "unlinked = all types" rule) and an empty list until a type is chosen ("Pick a blind type
  first" placeholder). Migration 22
  (`20260712000022_link_orphan_materials_to_first_type.sql`, APPLIED live) links every
  previously-unlinked Material to Roller so none is orphaned under the new rule.
- The many-to-many schema/API is unchanged (a Material can still belong to several types);
  only the UI/flow and the editor's filter rule changed. Verified: MaterialsForType +
  the calculators still transpile/run clean; the larger files were re-confirmed intact via
  the Read tool after the sandbox mount served truncated copies again. Same dev-machine
  verification steps as above apply.

## 2026-07-12 (later) — CSV bulk import on the per-type Add Material card
`pages/settings/MaterialsForType.tsx` gained a CSV import beside the manual add form.
- **Format:** two columns — Material name, price per m². A leading header row (first row
  whose price column is non-numeric) is skipped; rows missing a name or a valid
  non-negative price are skipped and counted. A `$` prefix and thousands commas in the
  price are tolerated.
- **Parsing:** pure module helpers `parseCsvLine` (quote-aware: names may contain commas;
  `""` is an escaped quote) and `parseMaterialsCsv` (returns `{ valid, skipped }`). No new
  dependency — parsing is hand-rolled; `file.text()` reads the upload.
- **Import:** each valid row is created via the existing `POST /api/settings/materials`
  (reusing `useCreateCatalogItem('materials').mutateAsync`) with
  `blind_type_ids: [currentType]`, so every imported Material is linked to the blind type
  whose page you're on. A toast summarises imported / skipped / failed counts. Frontend-only
  — no backend, DB, or schema change. Parser logic runtime-tested (quoted comma names,
  quoted thousands, header + invalid-row skips); file transpiles clean.

## 2026-07-12 (later) — Blind line-item "color" field (display-only)
A free-text `color` attribute on blind line items, with NO pricing effect, surfaced on the
item detail, the PDF, and the public customer estimate view.
- **DB (migration 23, `20260712000023_line_items_add_color.sql`, APPLIED live):**
  `line_items.color text not null default ''`; `update_order_with_items()` rebuilt to include
  `color` in its INSERT column list and `jsonb_to_recordset` signature (the direct insert path
  in `PUT /:id` already carries the whole row).
- **API (`routes/orders.ts`):** `blindItemSchema.color` (`z.string().max(100).default('')`);
  `resolveLineItems` snapshots `color` on BOTH branches (blind = `it.color`, preset/custom =
  `''`) so every bulk-inserted row keeps the identical column set. `routes/public.ts` adds
  `color` to the sanitized public payload. `lib/pdf.ts` adds `color` to `PdfDocumentData`
  line-item type and renders a `Color: …` attribute line (right after Material); the PDF data
  mapper already spreads `...li`, so no mapper change. `pdf.test.ts` sample exercises it.
- **Web:** `types LineItem.color`, `useOrders BlindItemInput.color`, `LineItemEditor`
  (`BlindDraft.color` + a "Color" text input between the Material/Cassette/Control grid and
  Note — not part of `blindDraftPrice`, so zero pricing impact), `OrderDetail`
  (toDrafts / addBlind / buildPayload carry `color`), and `CustomerView` (public line-item
  type + `Color: …` attribute after Material). Verified: 8/9 changed files transpile clean on
  a full read; `pdf.test.ts` re-confirmed intact via the Read tool (mount truncation). Live
  column confirmed present. Same dev-machine suite before shipping.

## 2026-07-12 (later) — Duplicate line item + default cassette/control on new blinds
Two editor conveniences in `pages/orders/OrderDetail.tsx`, both client-side only (no API/DB
change — the server still recomputes pricing on save):
- **Duplicate line item:** a third row action (Edit · **Duplicate** · Delete, copy-icon) on
  each item in the summary table. `duplicateItem(key)` clones the draft with a fresh
  `nextKey()` (and a copied `panels` array for blinds) and splices the copy in immediately
  after the original. Works for blind, preset and custom items; hidden in read-only like the
  other row actions.
- **Default cassette = Regular, control = Chain:** new module helper
  `findOptionIdByName(options, needle)` (active-only; exact match preferred, else first
  case-insensitive substring match, else ''). `addBlind()` now pre-selects
  `findOptionIdByName(catalogs.cassettes, 'Regular')` and
  `findOptionIdByName(catalogs.controls, 'Chain')` — resolves against the live catalog
  ("Regular Cassette" / "Chain Control") and degrades gracefully to unset if those options
  are renamed/removed. Verified: additions confirmed present and file structurally intact via
  the Read tool (the sandbox mount truncated the transpile read again).

## 2026-07-28 (later) - Label layout: smaller headline type, hardware on one line
Render-only tweak in `apps/web/src/pages/orders/OrderLabels.tsx` (`Label`); `lib/labels.ts`
and its 9-case suite are untouched, so `LabelFields` still carries `cassette` and `control`
as separate strings.
- Order number and dimensions drop from `text-[15pt]` to `text-[11pt]` (both stay bold) - the
  two headline rows were the only reason a long order number or a three-panel dimension
  string could crowd the 3x1.5in stock.
- Cassette and control now share ONE row, joined in the renderer with the same " . " (middle
  dot) separator `buildLabels` already uses for material + colour, with blanks filtered out so
  a unit missing either side still reads clean. Net effect: 7 flow rows instead of 8.
- Verified: web `tsc -b --noEmit` clean, vitest 56/56, oxlint = the same 4 pre-existing
  `LineItemEditor.tsx` warnings. Still NOT verified on physical stock - the legibility of 11pt
  on a thermal label is a shop-floor question no suite can answer.

## 2026-07-28 (later) - Order date on the production label
- **`apps/web/src/lib/labels.ts`:** `LabelOrder` now reads `order_date` (the `YYYY-MM-DD`
  `orders.order_date` column, already on the `Order` type the labels page fetches) and
  `LabelFields` gains `orderDate`. New private `shortDate(iso)` renders month + day only
  ("Jul 21") via `toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })`. The year is
  dropped on purpose - 3in of stock, and the shop only needs the day to separate two in-flight
  orders. The ISO string is split into numeric parts before hitting the Date constructor,
  because parsing the string reads it as UTC and prints the PREVIOUS day west of Greenwich
  (same guard as `CustomerView`'s `receiptDate`). Non-numeric or empty input yields `''`.
- **`OrderLabels.tsx`:** the header row now holds order number + date in a `min-w-0` baseline
  group on the left, with "n of m" pinned right via `shrink-0`. Date is `text-[10pt]` - the
  customer-name size, deliberately smaller than the 11pt bold order number.
- **Tests:** `labels.test.ts` helper carries `order_date: '2026-07-21'`; two new cases cover
  the month/day format and the local-vs-UTC + malformed-input behaviour. Suite 9 -> 11 cases.
- Verified: web `tsc -b --noEmit` clean, vitest **58/58** (5 files), oxlint = the same 4
  pre-existing `LineItemEditor.tsx` warnings.

## 2026-07-29 - Activity log collapsed to the newest 10 rows
Render-only change in `apps/web/src/pages/orders/OrderDetail.tsx`; no hook, route, or type
touched. `GET /api/orders/:id/logs` still returns up to 200 rows newest-first, so the client
slice is purely presentational.
- New module constant `LOG_PREVIEW_COUNT = 10` plus `logsExpanded` state. The Activity Log
  section renders `logs.slice(0, LOG_PREVIEW_COUNT)` while collapsed and the full array when
  expanded. Because the API already sorts `created_at` descending, `slice(0, 10)` IS the
  newest ten - no client-side sort was added, and none should be (that ordering is the
  route's contract).
- Below the list, a text button appears ONLY when `logs.length > LOG_PREVIEW_COUNT`, labelled
  `Show {logs.length - 10} more` / `Show less`, carrying `aria-expanded`. Styled as the
  existing `text-brand-600` text-action treatment (`hover:underline`, `self-start`) rather
  than a bordered button - it is inline page furniture, not a stage action.
- The empty state ("No activity recorded yet.") and the row markup are unchanged; the list is
  now wrapped in a fragment so the toggle is a sibling of the `<ul>` inside the same flex
  column.
- Verified: web `tsc -b --noEmit` clean, vitest 56/56 (5 files), oxlint = the same 4
  pre-existing `LineItemEditor.tsx` warnings. Note the suite reported 56, not the 58 the
  previous entry claims - on-disk `labels.test.ts` holds 9 cases, so the two order-date cases
  described above are NOT in the working tree.

## 2026-07-29 — Bottom rail option (settings catalog, priced per metre of width)
Full-stack feature, briefs and reports in `.superpowers/sdd/2026-07-29-bottom-rail/`, branch
`feat/bottom-rail`. Every blind line item now carries a **bottom rail** — the weighted bar at
the foot of the blind — chosen from a settings-managed catalog and charged per linear metre of
width, on exactly the same basis as the existing cassette.

- **Migration 28** (`supabase/migrations/20260729000028_bottom_rail_options.sql`) adds
  `bottom_rail_options`, mirroring its `cassette_options` sibling column for column
  (`price_per_m numeric(10,2) not null check (price_per_m >= 0)`, `active`, `sort_order`, the
  `set_updated_at` trigger, RLS + `authenticated_full_access`), seeded with `Regular` and
  `Pear`. It also adds the `line_items` snapshot triple `bottom_rail_id` / `bottom_rail_name` /
  `bottom_rail_price_per_m` — name and price copied onto the row so renaming or repricing a
  catalog option can never rewrite a historical order, the same rule the material, cassette and
  control snapshots already follow.
- **WHY both seeds are priced 0.** Pricing is recomputed server-side on every save, so a
  non-zero seed would silently raise the total of EVERY existing order the moment anyone
  re-saved it — a price rise nobody chose, landing on invoices that were already sent. Seeding
  at 0 makes the rail a no-op until the shop deliberately sets a price in Settings → Bottom
  Rail Options; only orders saved after that point pick it up, and orders already saved keep
  their stored totals either way.

## 2026-07-30 — Blind popup restructured into Basics / Options / Details sections

- **What changed.** `BlindEditForm` (`apps/web/src/pages/orders/LineItemEditor.tsx`) — the form
  behind the add-blind and edit-blind popup — was a single flat 11-field stack. It is now three
  captioned sections separated by a hairline splitter:
  1. **Basics** — blind type, room, panel widths (+ Panel button), height.
  2. **Options** — Material + Color on one row (`sm:grid-cols-2`), Cassette + Control + Bottom
     rail on the next (`sm:grid-cols-3`). The old single `sm:grid-cols-2 lg:grid-cols-4` option
     row is gone; Color moved up out of its own full-width slot to sit beside Material.
  3. **Details** — note, quantity stepper, the live unit/total readout, then the action buttons.
- **New local components.** `FormSection` (uppercase caption + `gap-3.5` stack) and
  `FormSplitter` (`<hr>` on `border-border-light`). Both are module-private — deliberately NOT
  exported, so the four pre-existing `react(only-export-components)` oxlint warnings in this
  file do not grow to six. `border-border-light` (`#e4e4e7`) is the existing inner-divider token,
  a step lighter than the `border-border` card outline, so the splitter reads as a pause inside
  one card rather than as a second card edge. The price row's top rule was moved to the same
  token for consistency.
- **`footer` prop.** `BlindEditForm` takes an optional `footer?: ReactNode` rendered at the end
  of the Details section. `OrderDetail.tsx`'s edit popup hoists its Cancel / Save changes pair
  into an `actions` const and passes it as `footer` for blinds; `FlatEditForm` is wrapped in a
  fragment with `{actions}` after it, keeping the preset/custom popup byte-identical to before.
  **WHY a prop and not a save button inside the form:** save/cancel semantics differ per host
  (`cancelEdit` deletes a never-saved new item via `pendingNewKey`), so the form stays free of
  save logic and the host keeps owning it — the prop only moves where the buttons *render*.
- **Not touched:** `BlindDraft`, `blindDraftPrice`, `BulkEditForm`, and every API/pricing path.
  Pure presentation change; no field was added, removed, or renamed. "Material" keeps its name
  (see the 2026-07-12 Fabric → Material rename).
- **Verified (real runs, 2026-07-30):** web `pnpm check` (`tsc -b --noEmit`) clean; vitest
  **60 passed (60)** across **5 passed (5)** files; oxlint = exactly the 4 pre-existing
  `LineItemEditor.tsx` `react(only-export-components)` warnings (lines 70/77/86/114 —
  `materialsForType`, `parsePositive`, `blindDraftPrice`, `flatDraftPrice`), none new.
- **WHY the historical rows are backfilled to Regular.** The API makes `bottom_rail_id`
  REQUIRED on `blindItemSchema`, and the order edit path re-sends every line item on every
  save. Without a backfill, each historical order would fail validation the next time it was
  touched, and an operator would have to hand-pick a rail for every blind on it before it could
  be saved at all. The migration therefore sets every existing `item_type = 'blind'` row to
  Regular at 0. Preset and custom rows keep `NULL`, exactly as they already do for cassette and
  control.
- **`update_order_with_items()` rebuilt.** The atomic edit path inserts an explicit column
  list, so BOTH the insert list AND the `jsonb_to_recordset` signature have to name the three
  new columns — miss either and the rail is silently dropped on every edit with no error, just
  a NULL where the snapshot should be. Body copied from migration 23 with the columns added
  after cassette.
- **`bottomRailCost(widthCm, pricePerM)` on `BaseBlindCalculator`**, in BOTH twins
  (`apps/api/src/lib/calculators/base.ts` and `apps/web/src/lib/calculators/base.ts`):
  `(widthCm / 100) * pricePerM`, charged on the post-`applyWidthMinimum` width so a
  below-minimum blind is billed for the same rail length it is billed material for. Kept as its
  own hook rather than folded into `cassetteCost` so one blind type can diverge on the rail
  without disturbing the cassette. `calculateUnitPrice` now sums material + cassette + bottom
  rail + control, which is why all TEN blind-type subclasses inherit the charge with zero edits
  — not one of them overrides the hook. `bottom_rail_price_per_m` is REQUIRED, not optional, on
  `BlindPricingInputs`: an optional field would let a caller quietly omit the rail and
  under-price the blind, whereas a required one makes tsc name every construction site.
- **Routes:** `GET|POST /api/settings/bottom-rail-options` plus `PUT|DELETE /:id`, produced by
  the existing catalog route factory in `settings.ts` — no bespoke handler. `resolveLineItems`
  (`routes/orders.ts`) looks the option up alongside material/cassette/control, throws
  "Selected bottom rail option no longer exists." on a stale id, and snapshots name and price
  onto the row; non-blind rows carry all three keys as explicit `null` so the insert payload
  stays rectangular.
- **Surfaces:** `Bottom rail: …` on the estimate PDF between Cassette and Control
  (`lib/pdf.ts`); `bottom_rail_name` — NAME ONLY, never the id and never the price — on the
  sanitized `/public/estimate/:token` payload and the customer view's attribute line; a twelfth
  `Bottom rail` column on the Order Overview table; and `Cassette · Bottom rail · Control` on
  the production label's hardware row (`labels.ts` gains `bottomRail`, `OrderLabels.tsx` joins
  the three with the middle dot it already used).
- **Editor:** a fourth `OptionSelect` in `LineItemEditor.tsx` (the option row is now
  `sm:grid-cols-2 lg:grid-cols-4`), wired into the live unit-price preview, the bulk-edit
  panel, and the save payload. `addBlind()` pre-selects
  `findOptionIdByName(catalogs.bottomRails, 'Regular')`, the same graceful-degradation helper
  already used for the default cassette and control. New `/settings/bottom-rail` CRUD page
  (`pages/settings/BottomRailOptions.tsx`), the `BottomRailOption` type, the three `LineItem`
  fields, `BlindItemInput.bottom_rail_id`, and a `'bottom-rail-options'` `CatalogPath` member.
- **Verified (real runs, 2026-07-29):** api `pnpm check` (`tsc --noEmit`) clean + vitest
  **124 passed (124)** across **6 passed (6)** files; web `npx tsc -b --noEmit` clean + vitest
  **60 passed (60)** across **5 passed (5)** files; oxlint = exactly the 4 pre-existing
  `LineItemEditor.tsx` `react(only-export-components)` warnings, none from this feature. The
  `BlindPricingInputs`-onward api/web twin `diff` printed nothing, so the calculators have not
  drifted.
- ✅ **`20260729000028_bottom_rail_options.sql` APPLIED** to `lgbxxlwsdeuhdgzrjjen` — run
  manually by the maintainer on 2026-07-30. `bottom_rail_options`, the three `line_items`
  snapshot columns, the Regular backfill, and the rebuilt `update_order_with_items()` are all
  live, so saving an order no longer 400s. Both rails are still priced 0 (see above).

## 2026-07-30 (later) — Production label prints hardware as shop codes

The label's hardware row now prints
`Cassette: R · Bottom Rail: P · Control: MB` instead of the three full catalog names. The
codes are the shorthand the shop already uses at the bench, and they are what makes the row
fit: at 10pt on 3in stock roughly 40 characters survive `truncate`, and three real names
("Fabric Wrapped", "Regular", "Motorized (Bluetooth)") overflowed it and clipped the control.

- **Where:** `apps/web/src/lib/labels.ts`. `LabelFields` loses `cassette` / `bottomRail` /
  `control` and gains a single pre-assembled `hardware` string, so wording stays in the field
  builder and `OrderLabels.tsx` only places it — the module's standing rule. The renderer's
  own `[cassette, bottomRail, control].join(' · ')` is gone.
- **Mapping** (`CASSETTE_CODES` / `BOTTOM_RAIL_CODES` / `CONTROL_CODES`, first pattern wins,
  matched against the SNAPSHOTTED name so a renamed catalog never rewrites an old label):
  - Cassette — Regular `R`, Fabric Wrapped `W`, Square `S`, **No Cassette `-`** (a dash, not a
    dropped segment: the shop must see the question was answered, not left blank).
  - Bottom rail — Regular `R`, Pear `P`.
  - Control — Chain `R` (the shop's "regular" control), Cordless `C`, Safety-Wand `SW`,
    Motorized (Bluetooth) `MB`, Motorized (Non-Bluetooth) `M`. **The non-Bluetooth pattern MUST
    stay above the Bluetooth one** — its name contains the word, so pattern order is the only
    thing keeping the two motors apart.
- **Unmapped names degrade to their first letter uppercased**, so an option added in Settings
  after this table was written still prints something distinguishable instead of vanishing.
  A part with no name at all drops its whole `Caption: code` segment; all three missing yields
  `''`.
- **Captions are spelled out** because a code alone is ambiguous across parts — `R` is Regular
  on a cassette and Chain on a control — and the shop reads the label by caption, not position.
- **New catalog row:** migration `20260730000029_control_option_cordless.sql` adds the
  `Cordless` control (price 0, sorted last, idempotent by name) — the shop sells it but had no
  option for it, so `C` now has a real option behind it.
- **Verified (real runs, 2026-07-30):** web `npx tsc -b --noEmit` clean; vitest **61 passed
  (61)** across **5 passed (5)** files (labels gains a code-table case per live catalog name);
  oxlint = exactly the 4 pre-existing `LineItemEditor.tsx` `react(only-export-components)`
  warnings, none from this change.
- ✅ **`20260730000029_control_option_cordless.sql` APPLIED** to `lgbxxlwsdeuhdgzrjjen` on
  2026-07-30. `Cordless` is live (active, `price_per_item` 0, `sort_order` 4) and therefore
  already in the blind popup's Control dropdown — that select is data-driven
  (`options={catalogs.controls}`), so no web change was needed to surface it. Price stays 0
  until the shop sets one in Settings.

## 2026-07-31 - Full UI redesign: soft dashboard visual language
Feature/improvement across `apps/web` only. Spec:
`docs/superpowers/specs/2026-07-31-ui-redesign-design.md`; plan:
`docs/superpowers/plans/2026-07-31-ui-redesign.md`.

- **Retokenization is the whole lever.** `src/index.css`'s `@theme` block was rewritten:
  Plus Jakarta Sans replaces IBM Plex Sans (IBM Plex Mono STAYS for money and order
  numbers), brand moves indigo `#2A4FCF` to blue `#2563EB`, the page goes `#FAFAFA` to
  `#F6F7F9`, shadows become two-layer, and radius goes from a flat 2px to
  `sm 8 / md 10 / lg 14 / xl 16 / 2xl 20 / pill 9999`.
- **CRITICAL invariant: no `@theme` token NAME was deleted, only its value.** The old
  system flattened every radius token to 2px, so the codebase says `rounded-sm` almost
  everywhere; retokenizing reshaped the entire app with no markup change. Pages that this
  work never opened still reference `bg-brand-600`, `text-text-primary`,
  `bg-surface-sunken`, `border-border` and `rounded-sm`. Deleting a name breaks them
  silently. New names ADDED: `--color-scheduled`, `--color-scheduled-tint`,
  `--color-info-tint`, `--color-success-strong`, `--radius-pill`.
- **Semantic colour rule:** hue encodes state, never decoration. blue=info/sent,
  violet=scheduled/in progress, amber=payment owed, emerald=ready/paid, rose=expired/
  destructive, slate=draft. The `OrderStatus` mapping lives in `src/lib/statusStyles.ts`
  (`statusLabel`, `statusPill`) — JSX-free so it is unit-testable, 8 new cases. Components
  MUST NOT hard-code status colour; change it there.
- **`installed` vs `ready`:** both are emerald. They are told apart by FILL (`installed` is
  solid, `ready` is tinted) rather than by spending a second hue on a meaning users already
  read as "good".
- **New primitive layer `src/components/ui/`:** `Pill`, `Card`/`CardHeader`/`CardBody`/
  `CardFooter` (+`CardAccent`), `Button`, `Field` (+`inputClass`), `Modal`, `StatTile`,
  re-exported from `ui/index.ts`. Pages compose these instead of repeating class strings.
- **Cards carry BOTH a shadow and a hairline border.** Not redundant: the app is used on
  phones outdoors, where a soft shadow alone can vanish in daylight on a low-contrast
  screen.
- **Shell:** Sidebar 220px→248px, white, with a FILLED brand pill for the active section
  (replacing the tint + 2px left border). `Layout`'s `lg:pl-[248px]` MUST stay equal to the
  rail width. BottomNav's active tab echoes it as a tinted pill. `PageHeader` gained
  optional `eyebrow` and `subtitle` props.
- **Orders list** gained four desktop summary tiles, rendered ONLY on the unfiltered
  default view (`all` tab, empty search). `useOrderList` filters SERVER-side, so on any
  other tab a count taken from `orders` would describe the filter, not the business.
- **Settings hub** became a grid of hued destination tiles; each destination owns an accent
  it keeps on its own page.
- **Deliberate non-conversions** (each would have been a refactor, not a restyle):
  `OrderDetail`'s hand-rolled `<section>` wrappers keep their structure and use a local
  `SectionIcon` instead of `CardHeader`; `EventChip` is NOT a `Pill` (a pill is a
  non-interactive span, a chip is a full-width navigating button that must truncate);
  `DatePicker` keeps its own sheet because its `z-40` is load-bearing under the `z-50`
  customer modal.
- **`CustomerCreateModal`** moved onto `Modal` and thereby GAINED Escape dismissal, body
  scroll lock and focus handling it never had. Its external props are unchanged.
- **Watch out:** `rounded-full` used to render as a 2px SQUARE. Every existing use was
  audited; all were genuine circles (progress dots, toggle knob, remove control) that are
  now correct.
- **Out of scope, still open:** `pages/customer-view/*` inherits the tokens but got no
  layout pass; email templates and PDF output keep the OLD indigo brand colour.
- **Verified (real runs, 2026-07-31):** web `tsc -b --noEmit` clean; web vitest **69 passed
  (69)** across 6 files; api vitest **124 passed (124)**; oxlint = exactly the 4 pre-existing
  `LineItemEditor.tsx` `react(only-export-components)` warnings, none new. Live computed
  styles confirmed in the dev server: Plus Jakarta Sans loaded and applied, page `#F6F7F9`,
  card radius 16px with the two-layer shadow, control radius 10px, input min-height 44px
  preserved. NOT yet verified: on-screen layout at 375px and lg+ (the browser pane was not
  displayed, so no composited frame or geometry was available).

## 2026-08-01 - Customer tracker gains an "Awaiting Payment" step + a quoted 50% deposit

The public order tracker went from four steps to five, and the e-Transfer block now states
the amount to send while the order is waiting for its first payment.

- **Tracker (`apps/web/src/pages/customer-view/OrderProgress.tsx`):** steps are now
  `Confirmed → Awaiting Payment → In Production → Ready → Installed`. `awaiting_payment`
  used to hide behind "Confirmed" (the old doc argued it would read as a demand); the owner
  wants the payment wait to be a visible milestone, so it owns step 2.
- **"Confirmed" matches NO status on purpose.** Confirming is an event; the status it
  produces is `awaiting_payment`. Its `match` array is empty, so it can never be the current
  step and — at index 0 — always renders done. The unknown-status fallback moved from index
  0 to index 1 for the same reason (a matchless step must not be highlighted).
- **Deposit is server-computed.** `GET /public/estimate/:token` now serves `deposit_due`
  (`apps/api/src/routes/public.ts`, local `depositDue()` helper = `round2(total / 2)`).
  Rule 1 — no money figure originates in the browser.
- **The 50% rule now has TWO consumers that MUST agree:** `depositDue()` in `public.ts` and
  the `round2(total / 2)` candidate test in `apps/api/src/lib/etransferMatch.ts`. If the
  deposit fraction ever changes, change both — otherwise the figure quoted to the customer
  stops auto-matching the e-Transfer that arrives for it.
- **Payment block (`apps/web/src/components/PaymentSection.tsx`):** new optional
  `depositDue` prop renders a highlighted "Deposit due now (50% of total)" amount above the
  recipient address, and switches the lead line to "Please send this deposit…". Absent, the
  component is byte-for-byte its old self.
- **The "Order confirmed!" success banner is GONE**, and the payment block took its slot —
  directly under the company header, above the tracker. Rationale: confirmation is already
  evident from the page (tracker, "Order" instead of "Estimate", no Confirm button), so the
  banner spent the most valuable position on a thank-you while the amount and the address —
  the only things the customer still has to act on — sat below the totals. `justConfirmed`
  state is deleted; `handleConfirm` now treats 200 and 409 identically (both mean the
  confirmation exists) and just re-reads the payload.
- **The payment block is AMBER, not neutral.** Card, heading (`⚠ HOW TO PAY`), deposit
  amount and hairlines all use the `warning` / `warning-tint` tokens, whose documented
  meaning in `index.css` is exactly "awaiting payment, action needed". The section only ever
  mounts while money is owed, so the hue is unconditional — no state toggles it. `danger`
  (red) was NOT used: it is reserved for expired / overdue / destructive, and a customer who
  confirmed an hour ago is not late. The recipient-address line switched from
  `surface-sunken` to white — a sunken grey reads as recessed against the tint, and it is
  the one string the customer must copy.
- **"Paid in full — thank you!" did NOT move.** It stays under the totals block, where it
  reads as the closing line of the money section; nothing is owed, so it is not an action.
- **Shown in exactly one window:** `CustomerView` passes the amount only when
  `status === 'awaiting_payment' && amount_paid === 0`. After any payment lands the amount
  to send is the balance, which the totals block already states — no figure in two places.
- **Forward-compatible:** `deposit_due` is optional in the web type, so a web deploy ahead
  of the Worker omits the deposit block instead of rendering `$NaN`.
- **Verified (real runs, 2026-08-01):** api `tsc --noEmit` clean; api vitest **125 passed
  (125)** (one new case: 113 → 56.50, and 113.55 → 56.78 for the rounding). Web `tsc -b
  --noEmit` clean; web vitest **69 passed (69)**; oxlint = exactly the 4 pre-existing
  `LineItemEditor.tsx` `react(only-export-components)` warnings, none new. (The `buildLabels`
  middle-dot failure seen mid-task was pre-existing on `main` and is now resolved on disk.)
  NOT verified: on-screen rendering of the 5-step row at 375px — five labels in equal grid
  tracks is tighter than four, so the tracker deserves a look on a narrow phone.

## 2026-08-01 (later) - Customer view: line items collapse behind a disclosure arrow
- `apps/web/src/pages/customer-view/CustomerView.tsx` gained a module-scoped `LineItemRow`
  component. The line-items card used to render every item's title/qty/total row PLUS all of
  its `itemContent` attribute lines (panels, material, color, cassette, bottom rail, control,
  note) unconditionally, so a 6-window order was a wall of specs the customer had to scroll
  past to reach the totals.
- Each row is now a `<button aria-expanded aria-controls>` whose children are, in order, a
  chevron `<svg>` at the LEFT edge (points right when collapsed, `rotate-90` when open - same
  stroke-icon style as `PageHeader.tsx`'s back chevron and the older terms disclosure), then
  title, qty, line total. The attribute lines live in a `hidden`-toggled panel below it,
  indented `ml-[26px]` so they hang under the title, not under the arrow.
- **First item open, the rest collapsed** (`defaultOpen={i === 0}`), so the affordance is
  self-evident without the customer having to discover the arrow.
- **Rows are independent, not a single-open accordion** - customers compare two windows side
  by side more often than they read one at a time. Open state is per-row `useState`, which is
  safe only because this list is never sorted or filtered; it is rendered once per payload.
- **Items with no attributes** (`item_type !== 'blind'`, whose `attrs` is always `[]`) render
  as a plain non-interactive row with no arrow, plus `pl-[26px]` dead space (18px glyph + 8px
  gap) so their titles and totals stay in the same columns as the expandable rows.
- No API/DB/PDF change - the public payload and the PDF layout are untouched.
- **Verified (real runs, 2026-08-01):** web `tsc -b --noEmit` clean; web vitest **69 passed
  (69)**; oxlint = exactly the 4 pre-existing `LineItemEditor.tsx` `react(only-export-components)`
  warnings, none new. NOT verified: on-screen rendering on a real phone.

## 2026-08-01 (later) - "Customer View" button: staff preview of the customer's page
- `OrderDetail.tsx`'s `headerActions` gained an eye-icon **Customer View** button between
  Download and Delete, opening `/customer/:token?preview=1` in a new tab. Neutral-styled like
  Download (`border-border-input bg-surface`), so the bar keeps exactly two coloured actions
  (Save green, Send blue) and the eye does not compete with them. Label hidden below `sm:`.
- **New endpoint `POST /api/orders/:id/public-token`** (`routes/orders.ts`, registered beside
  `/:id/send-invoice`). Returns the existing `public_token`, or mints `crypto.randomUUID()`
  and persists it. Exists because `public_token` is normally created by a SEND, and previewing
  BEFORE sending is the whole point of the button. Idempotent and inert: never changes
  `status`, never emails, and a second call returns the same token and logs nothing. A first
  mint writes one staff log, `Customer view link created.`, because it brings a
  customer-reachable URL into existence.
- **Popup-blocker workaround (the non-obvious part):** `handleCustomerView` opens the tab
  SYNCHRONOUSLY (`window.open('', '_blank')`) inside the click handler, then sets
  `tab.location.href` once the token resolves. A `window.open` issued after an `await` is
  rejected by every mainstream blocker. If the blocker refuses anyway (`tab === null`), a
  second `window.open` with the real URL is attempted rather than failing silently; on error
  the blank tab is closed and the message goes to a toast.
- **Preview mode in `CustomerView.tsx`** (`?preview=1`, read via `useSearchParams`) changes
  exactly four things and nothing else:
  1. the `status === 'draft'` guard is skipped, so an unsent order renders as the customer
     will see it instead of the "link isn't ready yet" card. The guard stays live for real
     customers, so a leaked draft token still says nothing;
  2. Confirm and both cancellation controls are inert;
  3. the "customer opened their page" ping never fires;
  4. a `bg-info-tint` banner states all of the above.
- **Why the actions had to become inert:** the page is otherwise byte-identical to the
  customer's, so a staff member clicking "Confirm Estimate" to see what it looks like would
  genuinely confirm the order on the customer's behalf — a state the customer cannot reverse.
- `CancellationRequest` gained a `disabled` prop kept SEPARATE from `busy`. `busy` also swaps
  its labels to "Working…"/"Sending…", which in a preview would read as a request stuck
  in flight rather than one that is switched off. Same reason the Confirm button's label stays
  "Confirm Estimate" in preview instead of "Confirming…".
- **The `expired` guard is deliberately NOT skipped:** an expired estimate really does show
  the customer an expiry card, so a faithful preview must show it too.
- **Verified (real runs, 2026-08-01):** api `tsc --noEmit` clean; api vitest **136 passed**
  at this point (3 new `public-token` cases: mints + logs once, returns the existing token
  with no `orders.update` and no log, 404 unknown id). Web `tsc -b --noEmit` clean; web vitest
  **69 passed (69)**; oxlint = exactly the 4 pre-existing `LineItemEditor.tsx` warnings.
  NOT verified: the in-app click-through — every route is behind `ProtectedRoute` and no
  Supabase session was available to the agent.

## 2026-08-01 (later) - Customer activity logs, rendered light blue
- **Migration 30** (`20260801000030_customer_view_logs.sql`, applied to the live project):
  `order_logs.source text not null default 'staff' check (source in ('staff','customer'))`
  and `orders.customer_viewed_at timestamptz`. The default is what makes this a no-backfill
  change: every historical row and every existing Worker insert stays correct untouched.
- **Why `customer_viewed_at` and not a log search:** "log the first open only" needs a
  reliable has-this-happened flag. Searching prior log rows for the message text would break
  silently the day the wording changes; a column cannot.
- `logOrderEvent` in BOTH `routes/orders.ts` and `routes/appointments.ts` gained an optional
  4th parameter `source: 'staff' | 'customer' = 'staff'`. Defaulting means all 22 existing
  call sites are unchanged. The two copies stay duplicated by design (route modules do not
  import from one another); `routes/public.ts` now has a third copy that hard-codes
  `'customer'`, since nothing on the token'd public surface is ever a staff action.
- **New endpoint `POST /public/estimate/:token/view`.** Stamps `customer_viewed_at` and writes
  `Customer opened their order page.` — but only on the first open, never for a `draft`, and
  always answering `200 { data: { ok: true } }` even when it wrote nothing. This is telemetry:
  a customer's page must never surface an error because a log failed. 404 only for a malformed
  or unknown token, worded identically to its neighbours so nothing leaks.
- **`public.ts` previously wrote NO logs at all** — a customer confirming their estimate or
  requesting a cancellation left no trace in the trail. Three `source: 'customer'` entries were
  added: `Customer confirmed the estimate.`, `Customer requested cancellation.`,
  `Customer withdrew their cancellation request.` The customer's free-text cancellation note is
  deliberately NOT interpolated into the message; staff already get it by email and on
  `orders.cancel_request_note`.
- **Client ping guarded three ways** (`CustomerView.tsx`): skipped entirely when `preview`;
  a `useRef` absorbs StrictMode's double mount; a `localStorage` key per token suppresses the
  refresh and the post-confirm reload. Net cost is **one extra request per device, ever** —
  which is what keeps the page inside the existing `/public` budget of 5 req/min/IP (a first
  visit that also confirms is 4). The `/public` rate limit was NOT changed.
- **Rendering:** `OrderLog.source` is OPTIONAL in the web type on purpose — a web deploy ahead
  of the Worker must render old rows as staff, not crash. Customer rows get `bg-info-tint`
  (`#eff6ff`, the existing token at `index.css:73`); no new colour was introduced. `rounded-md
  px-2 py-1` is applied to EVERY row, tinted or not, so the two columns never shift alignment.
- **Verified (real runs, 2026-08-01):** api `tsc --noEmit` clean; api vitest **133 passed** at
  this point (8 new: first open stamps + logs, second open no-ops, draft no-ops, malformed
  token 404s with zero DB calls, unknown token 404s, plus one per customer action). Web `tsc -b
  --noEmit` clean; web vitest **69 passed (69)**; oxlint = the 4 pre-existing warnings.
  NOT verified: the blue row on screen, and the ping firing from a real browser — both need a
  logged-in session.

## 2026-08-01 (later) - Customer view: terms fully collapsed behind a disclosure arrow
**Supersedes the 5-line-clamp entry immediately below, which shipped and was then replaced
the same day.** The clamp was the wrong call: a few visible lines of legal text are no more
useful than none, and a clamped preview still spends the vertical space the change exists to
reclaim. Terms are now collapsed COMPLETELY, closed by default.
- `TermsSection` in `pages/customer-view/CustomerView.tsx` is now a plain disclosure: the
  heading row is the button (chevron + `TERMS & CONDITIONS`), and the body is a `hidden`-
  toggled `<p>` indented `ml-[26px]` so it hangs under the heading, not under the arrow.
- **The chevron, its `rotate-90` open state and the row shape are copied from `LineItemRow`**
  in the same file, so the page's two disclosures read as one control rather than two
  different ideas about expanding.
- `hidden` rather than unmounting (also matching `LineItemRow`): the panel keeps its identity
  so `aria-controls="terms-body"` always points at a real element in either state.
- **All measurement code is gone** — no `ResizeObserver`, no `useLayoutEffect`, no
  `overflowing` state, no `line-clamp-5`. A full disclosure needs to know nothing about how
  tall the text is, which also removes the one code path the previous version could not
  verify in this environment.
- **Verified in a real browser (2026-08-01)**, same read-only setup as before (live order
  `c54ba5dc…`, 6,233 chars of terms, `?preview=1`, future expiry so nothing was written):
  closed by default — `hidden: true`, body `offsetHeight` **0**, `aria-expanded="false"`,
  chevron unrotated. Opened: body **2718px**, `aria-expanded="true"`, chevron `rotate-90`,
  `white-space: pre-wrap` preserved. Closed again: back to `hidden`, `aria-expanded="false"`,
  chevron unrotated. **The section itself is 76px collapsed vs 2802px open** — that 2,726px
  is exactly the space that was burying the confirm button. No console errors.
  web `tsc -b --noEmit` clean; vitest **78/78**; oxlint = the 4 pre-existing warnings.

## 2026-08-01 (later, SUPERSEDED) - Customer view: terms clamped to 5 lines behind "Show more"
- New module-scoped `TermsSection` in `pages/customer-view/CustomerView.tsx`. The terms block
  used to render `terms_snapshot` in full; the shop's terms run ~6,200 characters, which on a
  375px phone is a 2,558px wall of fine print sitting between the totals and the cancellation
  block / confirm button.
- Collapsed state is `line-clamp-5`. **The class is written out literally and must stay that
  way** — Tailwind v4 scans source for whole class names, so an interpolated
  `line-clamp-${N}` would never be emitted. (Same trap as the `print:break-after-page`
  note in `bug_fixes.md` 2026-07-28.)
- **The toggle is shown only when the text actually overflows**, measured on the rendered
  element (`scrollHeight > clientHeight + 1`), not guessed from a character count — how many
  lines a string occupies depends on viewport width, and a "Show more" that reveals nothing is
  worse than none. A `ResizeObserver` re-measures on rotation/resize.
- **Measurement is skipped while expanded.** Expanded, `scrollHeight === clientHeight`, which
  would read as "not overflowing" and unmount the very control needed to collapse it again.
  The flag from the last collapsed measurement stands until the text is collapsed anew.
- `useLayoutEffect`, not `useEffect`: measuring after paint shows one frame of clamped terms
  with no toggle under them.
- `whitespace-pre-wrap` is preserved alongside the clamp, so the shop's paragraph breaks
  survive. Toggle carries `aria-expanded` + `aria-controls="terms-body"`.
- **Verified in a real browser (2026-08-01)** — this is the one customer-facing route that is
  NOT behind `ProtectedRoute`, so it could actually be driven. Against live order
  `c54ba5dc…` (6,233 chars of terms, `sent`, future expiry so `effectiveStatus` writes
  nothing) at 375x812 with `?preview=1` (so the view-ping never fired and nothing was written
  to production): collapsed `clientHeight` **80px = exactly 5 x 16px** line-height with
  `scrollHeight` 2558 and `line-clamp: 5`; toggle rendered reading "Show more",
  `aria-expanded="false"`. After activating it: **2558px, `line-clamp: none`, "Show less",
  `aria-expanded="true"`**. After collapsing again: **back to 80px, re-clipped, and the button
  SURVIVED** reading "Show more" — the expanded-measurement guard doing its job. No console
  errors. web `tsc -b --noEmit` clean; vitest **78/78**; oxlint = the 4 pre-existing warnings.
- ⚠️ **NOT verified, and not verifiable in that environment:** the `ResizeObserver` re-measure
  path, and the short-terms-mean-no-toggle case. The Browser pane was not compositing
  (`document.visibilityState === 'hidden'`, `requestAnimationFrame` never fired), which
  suspends the rendering pipeline that DELIVERS ResizeObserver callbacks — an independent
  probe observer registered 0 hits across four real height changes. The synchronous
  `useLayoutEffect` measurement is unaffected, which is why the clamp itself verified fine.
  No order in the database has short-but-non-empty terms to exercise the negative case
  (the only other tokened order has `terms_snapshot` of length 0, so the section does not
  render at all).

## 2026-08-01 (later) - Customers can be created without a first or last name
- `customers.first_name` / `last_name` are `text not null` with no length floor
  (migration 7), so empty string was ALREADY legal at the DB level — **no migration needed**.
  The requirement lived entirely in Zod and in two forms.
- `routes/customers.ts`: both name fields dropped their `.min(1)`. `createSchema` no longer
  uses `.required({ first_name, last_name })`; it applies a whole-object `.refine` demanding at
  least one of name / email / phone, message `Enter a name, email or phone number.` A customer
  met on site is often just a phone number, and inventing a placeholder name made those rows
  HARDER to find later, not easier.
- **The UPDATE schema is deliberately left unrefined.** An address-only PATCH must not be
  forced to restate an identifier it is not touching, and staff may blank every identifying
  field on an existing customer if they choose.
- `firstZodIssue` in that file gained a carve-out: a whole-object refinement has an EMPTY
  `issue.path`, and the old `path.join('.') || 'payload'` would have surfaced
  `payload: Enter a name, email or phone number.` Refinement messages are already written as
  complete sentences, so they are now returned verbatim; field issues keep their prefix.
- **New twin modules `lib/customerName.ts` on BOTH sides** (same convention as
  `pricing.ts` / `totals.ts` — change one, change the other):
  - `displayName(c)` — "First Last" (either half may be absent) → email → phone →
    `Unnamed customer`. Never returns `''`, because callers render it straight into documents
    and lists where a blank looks like a bug.
  - `greetingName(c)` — Worker only. First name → last name → `there`. Split from
    `displayName` because "Hi a@b.com" reads worse than "Hi there"; a document wants the most
    identifying string, a salutation does not.
  - Neither escapes. Every email call site still passes the result through `escapeHtml`,
    exactly as it did with the raw column.
- **18 web display sites** were routed through `displayName` (order list + detail + overview +
  manufacturer copy, customer list incl. its avatar `initials`, all six calendar/appointment
  surfaces, printed labels, the create modal's success toast) and **8 Worker sites**
  (4 email greetings in `orders.ts`, 2 in `appointments.ts`, 3 name strings in `public.ts`,
  the PDF's `customerName`). The spec had named only four; the rest would have rendered a
  nameless customer as an empty string on the calendar and on printed labels.
- **`CalendarEvent.customer` was widened** to carry `email` and `phone`, and the two calendar
  selects in `appointments.ts` now fetch them. Without this a phone-only customer's chip would
  read `Unnamed customer` — the calendar would be useless for exactly the customers this
  feature exists to support. Neither field is displayed as such.
- **`CustomerView.tsx` is the one place that falls through to the placeholder** and should:
  the public payload carries no email or phone by design (`routes/public.ts` sanitizer), and a
  customer's own page must not print their contact details back at them as a name.
- `AppointmentWizard`'s post-create search term clears itself when `displayName` returns the
  placeholder, since that string matches no customer and would strand the picker on 0 results.
- **Verified (real runs, 2026-08-01):** api `tsc --noEmit` clean; api vitest **158 passed**
  (13 `customerName` cases + 9 new `customers.routes` cases: email-only, phone-only, first-only
  and last-only creates accepted; fully blank and whitespace-only creates 400 with the exact
  message; `.strict()` still rejects unknown fields; address-only and name-blanking PATCHes
  accepted). Web `tsc -b --noEmit` clean; web vitest **78 passed (78)** (9 new `displayName`
  cases, `labels.test.ts` unchanged and green); oxlint = the 4 pre-existing warnings.
  NOT verified: creating a nameless customer through the real UI, and the resulting PDF/email.

## 2026-08-02 - Warranty certificate: auto-issued when the balance clears

Paying an order off now emails the customer a **Warranty Certificate PDF**. 10 years on
products; 2 years on a motorised blind's motor and its moving parts. Plan
`docs/superpowers/plans/2026-08-01-warranty-document.md`.

- **Trigger is the money, not the lifecycle stage.** `issueWarrantyIfPaid` (new
  `apps/api/src/lib/warrantyIssue.ts`) runs after `recordOrderPayment` in BOTH payment
  entry points — `POST /orders/:id/payments` and the e-Transfer webhook — the same way
  `recordOrderPayment` itself is shared. Installation state is irrelevant: the owner chose
  the paid-in-full date as the coverage start.
- **Migration 31 (NOT applied):** `orders.warranty_sent_at timestamptz` +
  `orders.warranty_starts_on date`. Two columns on purpose. The stamp is the idempotency
  guard; the start date is snapshotted so a resend — or a staff download years later —
  reproduces identical expiry dates. Deriving the start from "now" at render time would
  silently move a customer's coverage window on every regeneration.
- **`warranty_starts_on` is persisted BEFORE the send**, breaking the email-then-persist rule
  deliberately: the date an order was paid in full is a fact about the order, not about the
  email, and a failed send must not lose it. `warranty_sent_at` still follows the rule.
- **A warranty failure never fails a payment.** In the automatic paths the payment is already
  committed when the warranty runs, so `issueWarrantyIfPaid` NEVER throws — every outcome is a
  return value. A failure writes `Warranty email failed: …` to the activity trail and leaves
  the stamp null; the payment route still returns 201 and the webhook still returns
  `{ status: 'applied' }` (otherwise the Gmail Apps Script would retry an applied transfer).
- **Motorised = `/motor/i`** on a blind's snapshotted `control_name` (catalog: `Motorized
  (Bluetooth)` / `(Non-Bluetooth)`), or on a preset/custom row's description (motor kits sold
  separately). A motorised blind lands in BOTH lists: the blind keeps 10 years, only the motor
  drops to 2. The certificate's motorised section is omitted entirely when there is no motor.
- **`addYears` clamps leap days** — `2028-02-29 + 10y` = `2038-02-28`, never rolling into
  March. Pure string maths, no local-timezone `Date` round-trip.
- **New modules:** `lib/warranty.ts` (pure term policy), `lib/warrantyPdf.ts` (certificate),
  `lib/warrantyEmail.ts` (template), `lib/warrantyIssue.ts` (the shared side effect).
- **Three additive exports rather than refactors:** `pdf.ts` now exports its page constants,
  `Cursor`, `money`, `drawRight` and `addressLines`; `email.ts` exports its shell/block
  helpers. Nothing moved — `email.ts` is already past the 800-line guideline, so the warranty
  template had to live beside it, and a certificate that did not share those primitives would
  drift from the invoice's look.
- **Two small relocations, both to prevent a lib→route dependency:** `toBase64` moved from
  `routes/orders.ts` to `lib/pdf.ts`, `formatDateLong` from `routes/orders.ts` to
  `lib/timeText.ts` (whose stated remit is exactly that). No behaviour changed.
- **Manual recovery paths:** `POST /orders/:id/warranty` (force resend; 409 while money is
  owed, 400 no email, 502 on provider rejection) and `GET /orders/:id/warranty-pdf` (staff
  download, no email required — it delivers nothing). Both surface in a warranty strip inside
  the Payments panel that appears only once the balance is settled.
- **Deliberate non-behaviours:** deleting a payment does NOT retract an issued warranty; a $0
  order never auto-triggers (no payment exists) and needs the manual button; a customer with
  no email is skipped with `Warranty not emailed — no email address on file.` on the trail and
  nothing stamped, so the button works once an address is added.
- **Known residual race:** two payments settling the same order within the same instant could
  both pass the `warranty_sent_at` check and send twice. Accepted — a duplicate email is
  cheaper than a claim-then-fail that silently sends nothing.
- **Verified (real runs, 2026-08-02):** api `tsc --noEmit` clean, api vitest **186 passed / 11
  files** (11 `warranty`, 4 `warrantyPdf`, 4 `warrantyEmail`, 9 new `orders.routes` cases);
  web `tsc -b --noEmit` clean, web vitest **78 passed**; oxlint = the same 4 pre-existing
  warnings. NOT verified: the real Resend delivery, the rendered PDF opened by eye, and the
  panel strip in a running browser (no Supabase session available to the agent).

### 2026-08-03 — scope narrowed to PARTS ONLY (owner's decision)

The first draft promised "defects in materials **and workmanship**". It does not. The shop
supplies parts and replacements free within the stated periods; **labour is never covered and
the standard service fee is payable on every visit**, including one where the part itself is
free. Amends the bullets above wherever they say otherwise.

- **Stated three times on the certificate**, deliberately: `PARTS_ONLY_BANNER` sits directly
  under the coverage summary (read before the expiry dates), the first paragraph of
  `WARRANTY_TERMS` opens with "covers PARTS ONLY", and the second says workmanship and labour
  are NOT covered. The terms heading became "WHAT THIS WARRANTY COVERS — AND WHAT IT DOES NOT".
  Repetition is the point: this is the line a customer argues at the door.
- **Also stated in the EMAIL, not just the attachment.** Fine print under the checklist reads
  "Parts only. Workmanship and labour are not covered — our standard service fee applies to
  every visit…". A customer who never opens the PDF must still know a call-out costs money.
- **Every checklist line names a PART, not a repair** — "Replacement parts for 10 years on
  blinds, fabric and hardware". A ✓ beside the word "workmanship" would have promised free
  labour for a decade.
- **No figure for the service fee anywhere.** It is a live price; a certificate that freezes it
  for ten years is worse than one that omits it. A test asserts no `$n` appears in the terms.
- **`WARRANTY_TERMS` and `PARTS_ONLY_BANNER` are now exported** from `lib/warrantyPdf.ts` for
  exactly one reason: the rendered PDF bytes are opaque, so the promise the shop is legally
  exposed on cannot otherwise be regression-tested. 4 new tests assert "workmanship"/"labour"
  appear ONLY inside a negation, that a service fee is stated, that parts are free, and that no
  dollar figure is quoted. 2 new email tests assert the fine print and that the checklist is
  workmanship-free.
- **Verified (real runs, 2026-08-03, in a worktree on `feat/customer-view-and-logs`):** api
  `tsc --noEmit` clean, api vitest **192 passed / 11 files** (warrantyPdf 4→8, warrantyEmail
  4→6). Web untouched by this change.

## 2026-08-03 - Responsive shell rewrite: collapsible rail, phone hamburger, fluid page track

Web-only. Replaces the `Sidebar` (lg+) + `BottomNav` (<lg) pairing with ONE navigation
component covering every width, and puts every page header and page body on a single
fluid horizontal track.

### Navigation
- **`BottomNav.tsx` DELETED.** With it goes `Layout`'s `nav` prop and the `nav={false}`
  on 20 routes in `App.tsx`. The prop existed to suppress the tab bar on detail/form
  pages whose own sticky action bars occupied the same strip — which is precisely how
  every detail page, and every tablet, ended up with no navigation but a back arrow.
- **`Sidebar.tsx` rewritten** to render one item list in two forms:
  - `md+` — fixed rail, collapsible between 248px (labelled) and 72px (icons). BOTH
    tablet and desktop get the control; only the default differs.
  - `<md` — full-screen overlay opened by the header hamburger. `role="dialog"`,
    `aria-modal`, Esc to close, body scroll locked while open, dismissed on route change
    (keyed on `pathname`, so programmatic navigation closes it too).
- **`SidebarToggle.tsx` (new)** — the phone hamburger. Rendered by `PageHeader` for the
  17 pages that use it, and by `OrderList` (which hand-rolls its header). `md:hidden`,
  because from `md` up the rail carries its own collapse control.
- **`hooks/useSidebar.ts` (new)** — Zustand slice holding `collapsed` (persisted to
  `localStorage` under `bn.sidebar.collapsed`) and `mobileOpen` (deliberately NOT
  persisted). The boot rule is extracted as the pure `resolveInitialCollapsed(stored,
  wideViewport)` and tested — a stored choice outranks the viewport default in BOTH
  directions, which is the part a naive "collapsed unless wide" version gets wrong.
  Default when nothing is stored: expanded at >=1280px, collapsed below.

### Layout primitives (`index.css`)
- **`--sidebar-w` is the single source of truth for rail width.** `.app-shell-rail` sets
  `width` from it, `.app-shell-main` sets `padding-inline-start` from it; `Layout` stamps
  `data-rail="icons|expanded"` on `.app-shell` and the media query resolves the value.
  This retires the long-standing paired measurement (`Sidebar`'s `w-[248px]` +
  `Layout`'s `lg:pl-[248px]`) — there is no second copy left to drift.
- **`.page-container`** — the one horizontal track: full width, gutters stepping
  16 -> 24 -> 32px, capped at `var(--page-max, 1600px)`, centred beyond it. Re-exported
  from `PageHeader` as `PAGE_CONTAINER`. A page needing a narrower body sets
  `[--page-max:48rem]` on the SAME element rather than adding a second `max-w-*`
  utility — two max-width utilities in one class list resolve by Tailwind's internal
  sort order, not by written order, so the markup cannot express which should win.
- `padding-inline-start` / `margin-inline` / `padding-inline` throughout, so RTL mirrors
  without a second rule. Width transition suppressed under `prefers-reduced-motion`.

### Order screen (`OrderDetail.tsx`)
- Body is now `.page-container`, becoming `xl:grid-cols-[minmax(0,1fr)_360px]` at 1280px.
  `xl` rather than `lg` because the rail is a THIRD column: at 1024px the shell already
  spends up to 248px on nav, and splitting the rest into a form column plus a rail leaves
  the form too narrow for its two-up date fields. `minmax(0,1fr)` is what lets the form
  track shrink below its content's intrinsic width.
- **The five document actions moved out of `PageHeader`'s right slot** into a toolbar at
  the top of the page body, where they have the full content width and `flex-wrap`.
  The header keeps only the StatusBadge.
- The toolbar and `PageHeader` pin together inside one sticky block (`md+` only), whose
  measured height is published as `--order-head-h` via `ResizeObserver` — same pattern as
  `--action-bar-h` — so the summary rail can stick below it without a hard-coded offset.
- Summary rail is a card in the grid's second track (was a full-bleed panel welded to the
  viewport edge with a bare `border-l`, which floated oddly once the grid gained a gutter).
- Sticky bottom action bar is now `xl:hidden` (was `lg:hidden`) and carries
  `app-shell-main`, so on a tablet it starts where the rail ends instead of under it.

### Other pages
- `OrderList` header is one row at every width (was a mobile-only `<h1>` plus a separate
  `lg:flex` desktop row, so a tablet got no "New Order" button at all). Status tiles are
  two-up from `sm`, four-up from `lg` (were `lg:grid` only — invisible on tablets).
- `PageHeader`, `OrderList`, `CustomerList`, `SettingsIndex`, `CalendarPage`,
  `AppointmentsList`, `AppointmentDetail`, `CustomerForm`, `OrderOverview`,
  `ManufacturerCopy`, `CatalogEditor` and the five settings pages all moved onto
  `.page-container`.
- Sticky "+ New" bars in `OrderList` and `CustomerList` moved from `bottom-14` (clearing
  the tab bar that no longer exists) to `bottom-0` plus the safe-area inset.

### Verified
Web `tsc` clean; vitest **88/88 (9 files)**; oxlint at the same 4 pre-existing
`LineItemEditor.tsx` warnings; production build clean. Layout geometry measured in-browser
at 375 / 768 / 1280 / 1920 in both rail states — `scrollWidth === innerWidth` at every one,
header and body content edges aligned at every one. See `bug_fixes.md` 2026-08-03 for the
defects this closes and for what is NOT yet verified.

## 2026-08-04 - Estimate/Invoice PDF: "View your order online" button

The PDF is now self-sufficient. A customer holding only the attachment — and staff who
downloaded it from the order screen — can reach the live customer order page without the
email that carried it.

### What was added
- `PdfDocumentData.viewUrl?: string | null` (`apps/api/src/lib/pdf.ts`). When set,
  `buildDocumentPdf` prints a centered CTA between the totals (or the invoice
  payments/balance tail) and the Terms & Conditions block. When null/omitted the whole
  block is skipped, so nothing changes for a document with no public token.
- `drawLinkButton(doc, cur, url, label, bold)` — exported alongside `Cursor`, `money`,
  `drawRight` and `addressLines` as part of this module's shared PDF toolkit. Filled
  `BRAND` rectangle + centered white bold label, covered by a real PDF `/Link` annotation
  with a `/URI` action (`PDFString.of(url)` — a bare JS string would be coerced to a
  `PDFName` by `context.obj`). `Border [0,0,0]` suppresses the viewer's default link
  outline.
- `BRAND = rgb(0.145, 0.388, 0.922)` = `#2563eb` = the web app's `--color-brand-600`, the
  fill behind every primary button ("Send", "Save"). The printed CTA reads as the same
  affordance the customer clicks in the app. Keep the two in sync if the token moves.
- The button spans the totals column exactly — flush right, `TOTALS_W` (220pt) wide, the
  same track as Subtotal/Total/Balance due. `TOTALS_W` is now a shared export instead of
  the literal `220` that `buildDocumentPdf` used for `labelX`, so the two cannot drift.
  Owner review killed the first pass: it was centered on the page, filled `INK`, and
  repeated the URL underneath in 8pt muted as a print fallback. All three are gone —
  centered read as a floating banner beside the right-aligned money, and the raw URL was
  visual noise.
- The whole block is reserved with ONE `cur.ensure(...)` before any drawing: the
  annotation is attached to `cur.page`, so a page break in the middle would leave the
  clickable region on the previous page.

### Wiring (`apps/api/src/routes/orders.ts`)
- `toPdfData(order, company, terms, viewUrl)` takes the URL as a 4th parameter. It is
  passed in, not derived, so the mapper stays free of `c.env` and of any DB write.
- `POST /:id/send` and `POST /:id/send-invoice` pass the `viewUrl` they already build for
  the email body — one link, one token, both channels.
- `GET /:id/pdf` (the staff Download button) now applies the same reuse-or-mint rule as the
  send routes and `POST /:id/public-token`: an order with no `public_token` gets one minted,
  persisted, and logged once as "Customer view link created." A link printed on a document
  that leaves the building has to resolve. A download of an order that already has a token
  writes nothing.

### Verified
api `tsc --noEmit` clean; api vitest **196/196 (11 files)**. Four new `pdf.test.ts` cases
assert the link by re-parsing the saved bytes with pdf-lib and reading the annotation's URI
and `/Rect` — the bytes cannot be string-searched, since `doc.save()` packs annotation
dictionaries into a Flate-compressed object stream, and the `/Rect` is the only thing that
can assert the button's alignment on otherwise opaque output. The alignment case pins
`x2 === PAGE_W - MARGIN` and `x2 - x1 === TOTALS_W`.

## 2026-08-04: Order editor — expandable customer card + separate dates card

### New files
- `apps/web/src/pages/orders/OrderHeaderCards.tsx` — `CustomerCard` and `OrderDatesCard`,
  extracted out of `OrderDetail.tsx`'s single "customer + dates" header card.
- `apps/web/src/lib/expiryTerms.ts` — `ExpiryPresetId`, `EXPIRY_PRESETS`,
  `expiryFromPreset(orderDate, preset)`. Kept OUT of the component file on purpose: a
  `.tsx` that exports non-components trips oxlint's `react(only-export-components)`
  fast-refresh warning (see the 4 standing ones in `LineItemEditor.tsx`).
- `apps/web/src/lib/expiryTerms.test.ts` — 6 cases, incl. the month-boundary and
  end-of-month clamp ones.

### `CustomerCard`
- Title row is the SAME picker as before (opens the existing searchable customer bottom
  sheet, still owned by `OrderDetail`), now flex-1 with a separate 44px chevron toggle
  beside it. Two controls, not one: tapping the name changes the customer, tapping the
  chevron expands the record. The toggle renders only when a customer is selected —
  there is nothing to reveal otherwise.
- Expanded panel lists the whole `Customer` row as READ-ONLY fields: first/last name,
  email, phone, shipping line1/line2/city/province/postal, then billing — collapsed to
  "Same as shipping address." when `billing_same_as_shipping`. Rendered as
  `<input readOnly>` rather than text so values stay selectable/copyable on touch and
  keep the surrounding form's field affordance. Nothing here writes back; customer edits
  remain in the Customers module.

### `OrderDatesCard`
- Order date + expiry date + order number moved here, one card below the customer card.
  Order # travelled with the dates because the customer card is now customer-only.
- New expiry-term chips: On receipt / 1 day / 3 days / 7 days / 15 days / 1 month.
- Term selection lives in `OrderDetail` as `expiryPreset` (`ExpiryPresetId | null`), and
  the existing auto-expiry effect gained a first branch: a selected term is re-applied
  whenever the order date moves, so expiry tracks it. No term + `!expiryManual` still
  falls back to `company.default_expiry_days` (14). Picking a date straight from the
  expiry `DatePicker` clears the term and pins the date. Hydrating a saved order keeps
  its stored expiry (`expiryManual = true`, no term) — only the resolved date is
  persisted, terms are editor-only state.
- `expiryFromPreset` clamps "1 month" to the end of a shorter month: `setMonth` alone
  rolls Jan 31 into Mar 3, so an overflowed day is pulled back with `setDate(0)`.

### Verified
web `tsc --noEmit` clean; web vitest **94/94 (10 files)**; `oxlint` = the 4 pre-existing
`LineItemEditor.tsx` warnings only. NOT exercised in a browser — `/orders/:id` is behind
`ProtectedRoute` and no Supabase session was available.

## 2026-08-04: Customer view — terms acceptance gate on Confirm Estimate

`apps/web/src/pages/customer-view/CustomerView.tsx` only.

- The fixed confirm bar now carries a checkbox above the button: "I have read and agree to
  the Terms & Conditions." `Confirm Estimate` is disabled until it is ticked
  (`canConfirm = !preview && !confirming && (!requiresTerms || termsAccepted)`), and
  `handleConfirm` re-checks before POSTing so the gate does not depend on the disabled
  attribute alone.
- `requiresTerms = Boolean(estimate.terms)`. A shop with no terms configured — or a payload
  from an older Worker that omits the field — keeps the ungated button. The gate must never
  be able to make an estimate un-confirmable.
- The tick is in the BAR, not in the terms card: the terms section is collapsed by default
  and can sit a screen above, so a checkbox there is one the customer never reaches.
- `TermsSection` no longer owns its open state — `open`/`onToggle` are props, and the
  section got `id="terms"` + `scroll-mt-4`. The checkbox label's "Terms & Conditions" link
  sets `termsOpen` and `scrollIntoView`s the section, so the text is always reachable from
  the gate.
- Page bottom padding is `pb-40` when the bar carries the checkbox (was/stays `pb-28`
  without it, `pb-8` once confirmed) — the bar grew by a row.
- Staff preview (`?preview=1`) disables the checkbox as well as the button; nothing on that
  page may be actuated on the customer's behalf.
- **Scope note:** the gate is UI-side. Nothing is persisted — no `terms_accepted_at`, no
  snapshot of the terms text the customer saw. `POST /public/estimate/:token/confirm` is
  unchanged and still accepts a bare POST. Recording acceptance server-side is a separate
  change (migration + route + payload) if the business wants evidence rather than a prompt.

### Verified
web `tsc --noEmit` clean; web vitest 94/94; `oxlint` = the 4 pre-existing
`LineItemEditor.tsx` warnings. NOT exercised in a browser: `/customer/:token` needs a real
capability token and the dev web app points at the LIVE Worker, so a click-through would
risk confirming a real customer's estimate.

## 2026-08-04: Customer card details rendered as plain text (owner revision)

Revises the same-day entry above. `apps/web/src/pages/orders/OrderHeaderCards.tsx` only.

- `DetailField` (the labelled `<input readOnly>` rows) is GONE. The expanded panel now
  reads like an address label:

  ```
  John Doe
  123-456-7890
  johndoe@gmail.com

  Shipping Address:            Billing Address:
  123 Main Street, Toronto, ON 123 Another Street, Toronto, ON
  X0X X0X Canada               X0X X0X Canada
  ```

- Local `addressLines({line1,line2,city,province,postal})` folds address line 2 INTO the
  street line (a two-line block stays two lines) and appends "Canada" only behind a
  non-empty postal code. Returns `[]` for an empty address, which is `AddressBlock`'s
  signal to render nothing rather than a dangling caption. Same name and shape as the api
  `pdf.ts` helper but a different join — not shared: `pdf.ts` is Worker-side and puts city
  on its own line for print.
- Billing is rendered only when `billing_same_as_shipping` is false; the "Same as shipping
  address." sentence is gone too, per the owner ("nothing else if the billing and shipping
  address same"). The grid takes `sm:grid-cols-2` only when a billing block exists, so a
  lone shipping block does not sit in a half-width column.
- Contact lines are `displayName` / phone / email with blanks dropped.

### Verified
web `tsc --noEmit` clean; `oxlint` = the 4 pre-existing `LineItemEditor.tsx` warnings.
Test suite untouched by this revision (94/94 at the previous run). Still not exercised in
a browser — `/orders/:id` is behind `ProtectedRoute`.

---

## Curtains hem allowance (2026-08-10)

Curtains now charge a per-panel making allowance on top of the fabric leg:

```
unit = (width_m x pleat x price_per_m)          -- fabric, fullness applies
     + panels x HEM_ALLOWANCE_M x price_per_m   -- hems, fullness does NOT apply
     + panels x control_price_per_item
     + installation_price
```

`HEM_ALLOWANCE_M = 0.5` running metres, declared as a named constant in both
`apps/api/src/lib/blindTypes/curtains.ts` and its web twin.

Two decisions worth keeping:

- **Per panel COUNT, not summed width.** An intermediate revision of this change read
  `item.panels.reduce((a, b) => a + b, 0)` — the total width in cm — and multiplied THAT
  by 0.5, which priced the standard 300cm test curtain at $15,300 instead of $320. The
  pinned test `charges the hem allowance per panel, not per metre of width` splits one
  300cm panel into two 150cm panels and asserts the delta is exactly one allowance; it
  fails if the summed-width reading ever returns.
- **Outside the fullness multiplier.** A hem is cut on the finished panel, so gathering
  the curtain more does not widen it. `does not multiply the hem allowance by the pleat
  fullness` pins this.

The 100cm width minimum still lifts the WIDTH only — the allowance is added after it.

### Verified
api 244/244, web 135/135, both `tsc --noEmit` clean, `oxlint` clean.

---

## Line item price adjustments (2026-08-10)

Three consultant-facing capabilities on order line items, plus one tightening.

### Price override

A blind, or a preset carrying `preset_id`, can have its server-calculated unit price
replaced by a consultant-typed figure.

- `line_items.unit_price` keeps meaning **the price CHARGED**, so every existing reader
  (PDF, manufacturer copy, customer page, totals) stayed correct untouched. The new
  nullable `base_unit_price` holds the calculated figure and is non-null ONLY while an
  override is in effect — `base_unit_price is not null` is the single answer to "is this
  overridden?", with no second boolean that could disagree with it.
- **Reset** = the client stops sending the override; the Worker re-prices from today's
  catalog. There is no frozen snapshot to go stale.
- `show_original_price` (default true) controls the struck-through original on customer
  surfaces. Both `toPdfData` and `/public/estimate/:token` STRIP the figure when it is
  false — a PDF text layer is extractable whether or not the number was drawn, and the
  public route is unauthenticated, so hiding with CSS would not be hiding.
- Staff surfaces mark an overridden price with an amber dot (editor list + overview
  tables). The customer's signal is the strikethrough, never the dot.

### Titled flat items

`preset` and `custom` items gained `title` plus a multi-line `description` (textarea;
newlines print as separate lines). `addPreset` no longer concatenates the catalog name and
description into one string. Legacy rows have `title = ''`, and EVERY surface falls back to
`description` for the heading — otherwise historical orders would print unnamed items.

### Add-ons

`line_items.addons` is `[{label, price}]`, capped at 10, each price added **ONCE** to
`line_total` — never multiplied by quantity. Each price is rounded to the cent
individually before summing, matching the `numeric(10,2)` it is stored in; summing first
and rounding once would quote a total the database cannot hold.

### Presets became server-priced

`preset_id` is snapshotted and the Worker reads the price from `preset_line_items`,
batched with the other catalog lookups. This tightens AI_GUIDELINES rule 1 — presets used
to be client-priced — and is what gives an overridden preset a default to reset TO.

**Known limitation:** rows saved before this have `preset_id = null`. They keep their
historical client-sent `unit_price` and cannot be overridden until re-picked from the
preset sheet. `buildPayload` still sends `unit_price` for those, and the schema still
accepts it.

### The money carve-out

`unit_price_override` and `addons[].price` are the only client money fields beyond a
custom item's own `unit_price`. Both are clamped in `apps/api/src/routes/orders.ts`, the
add-on object is `.strict()` so a future `taxable`/`cost` field cannot ride along, and
every change is written to the order activity log by `describePriceChanges`. A calculated
price moving on its own (a catalog rate rose) logs nothing — nobody typed it.

### New modules

- `apps/api/src/lib/lineItemAdjustments.ts` + `apps/web/src/lib/lineItemAdjustments.ts` —
  a TWIN pair like `pricing.ts`/`totals.ts`, byte-identical below the file header. Verify
  with a diff from the first export when touching either.
- `apps/api/src/lib/lineItemAuditLog.ts` — api-only, deliberately NOT in the twin file,
  because log diffing has no browser side and its presence there would make the twin claim
  untrue.
- `apps/web/src/pages/orders/blindForms/PriceBlock.tsx` — replaces `PriceReadout`, shared
  by all 11 blind forms and `FlatEditForm`. Shows the calculated price ALWAYS, including
  while overridden.

### Schema shape

`flatItemSchema` split into `presetItemBase` + `customItemBase`; the union has three
members. Cross-field rules (title-or-description required; a preset needs `preset_id` or
`unit_price`) live on a `superRefine` at the union level, because
`z.discriminatedUnion` rejects `.refine()`d members — they become `ZodEffects`.

### Verified
api 289/289, web 164/164, both `tsc --noEmit` clean, `oxlint` clean.
Migration 31 written but NOT applied — see below.

## 2026-08-11: blind-type scoping for the four option catalogs

**What.** Cassette, bottom rail, control and installation options each carry the blind
types they are offered for, picked as toggle chips on their settings page. A blind type
uses a hardware slot exactly when at least one ACTIVE option of that catalog is scoped to
it; otherwise the line-item form hides the dropdown and the cost leaves the price. In the
same change, Installation stopped being a Curtains-only attribute and became a real
line-item slot beside cassette / bottom rail / control.

**Why.** Which slots a type used was a code constant — `BaseBlindType.requiredCatalogs`,
overridden to `['control']` by Curtains. Turning a cassette off for a type meant a code
change, a deploy and a test edit. It is data now.

**How.** Migration 35 adds four join tables shaped exactly like `material_blind_types`
(`cassette_option_blind_types`, `bottom_rail_option_blind_types`,
`control_option_blind_types`, `installation_option_blind_types`).
`apps/api/src/lib/optionScoping.ts` answers "does this type use this slot" for the Worker;
`slotsForType` / `optionsForType` in `apps/web/src/pages/orders/lineItemDrafts.ts` answer
it for the editor. `requiredCatalogs` is DELETED from both `base.ts` twins and from
`curtains.ts`.

**The convention trap.** EMPTY MEANS NONE here — the OPPOSITE of `material_blind_types`,
where an unlinked Material is available for every type. Empty-means-all would make it
impossible to switch a slot off, which is the entire feature. That is why migration 35's
backfill is mandatory rather than cosmetic: it seeds cassette + rail to every type except
Curtains, control to every type, installation to Curtains only — reproducing the old
hardcoded behaviour exactly, so applying the migration changed nothing a user could see.

**The second trap.** `line_items.attributes` had its three `installation_*` keys STRIPPED
by the same migration, after copying them into the new columns. `curtains.ts` no longer
declares `installation_id`, its `attributeSchema` is strict, and the editor re-parses a
re-opened order's blob — a key left behind would be a 400 on the second save. (In practice
no production row carried one: the migration moved 0 rows.)

**Order of checks in `resolveLineItems` is load-bearing.** Existence checks run BEFORE the
slot gates. Deleting an option cascades its scoping links away, so the slot goes quiet in
the same breath — checking slots first would report a deleted cassette as "this type does
not take a cassette."

**Deliberately NOT enforced.** The Worker checks that a chosen option EXISTS, not that it
is scoped to the type. This mirrors Materials (the UI filters, the Worker does not) and
keeps a re-save working after an option is unscoped mid-life. An unknown `blinds_type` —
free text from before the dropdown — resolves to no scoping row and is left unconstrained
entirely, or every pre-dropdown order would become unsavable.

**Also changed.** `control_id` is nullable in the payload schema (a type with no control
scoped prices it at 0); `BlindPricingInputs` gained a required
`installation_price_per_item` charged flat per blind by `installationCost`; the settings
catalog factory grew an optional `links` config plus `syncCatalogLinks` /
`flattenCatalogLinks`, and its create schema is now `.strict()` so a scoping list sent to
an unscoped catalog is a 400 instead of a silent strip; Installation prints on the PDF,
the customer page, the order overview and the shop label (`INSTALLATION_CODES`: Rod = R,
Track = T).

### Verified
api 308/308, web 175/175, both `tsc --noEmit` clean, `oxlint` clean, `vite build` clean.
Migration 35 applied to the live project and its backfill verified by query.

## 2026-08-11: per-option price basis, and one hardware cost function

**What.** Every cassette, bottom rail, control and installation option chooses how its
price is charged — per m, per m², per unit or per panel — from a dropdown beside the price
in Settings. The four hardware cost paths in the pricing engine collapsed into one.

**Why.** The basis was a code constant, one per catalog: a cassette was always per linear
metre, a control always per panel, an installation option always a flat charge. The shop
buys some of these by the square metre and some by the unit, and there was no way to say so.

**How.** Migration 36 renames `price_per_m` / `price_per_item` to `price` on all four
catalogs and adds `price_basis text` with a check constraint, defaulted per catalog to the
constant it replaces. `line_items` gains a `*_price_basis` sibling for each rate snapshot.
In the pricing twins, `PriceBasis` + `HardwareCharge` are new, `BlindPricingInputs` swaps
its four scalar price fields for one `hardware: Partial<Record<CatalogSlot, HardwareCharge>>`
map, and `cassetteCost` / `bottomRailCost` / `controlCost` / `installationCost` are replaced
by a single `hardwareCost(charge, ctx)` switch.

**Every default reproduces the old constant**, so applying migration 36 could not move a
price — which matters because pricing is recomputed on every save and a mismatched default
would have silently repriced every order on its next edit.

**`calculateUnitPrice` is no longer an override point.** `materialCost` widened to
`(item, widthCm, heightCm)` and is now the only leg a blind type may diverge on. Curtains
overrides that and nothing else; it used to re-implement the entire formula, including its
own copies of the control and installation maths, which is exactly where a basis change
would have drifted.

**Behaviour change, deliberate:** Curtains no longer silently ignores a cassette or bottom
rail. None is scoped to it, so this is unreachable from the UI — but if one ever were
scoped, it is charged rather than dropped. `pricing.test.ts` pins the new number (854) on
both sides.

**The bug the refactor surfaced.** `blindDraftPrice` built its hardware map from whatever
ids the draft held, so a stale id left behind by a previous blind type got charged in the
preview — a price the Worker would then reject, since it refuses an id for an unused slot.
The map is now gated on `slotsForType` as well as on the id. Caught by the existing
"ignores a stale id for a slot the type does not use" test, which only became reachable
once Curtains stopped ignoring hardware.

**Also:** the settings catalog factory gained a shared `hardwareSchema` (all four are the
same shape now), which is what lets `resolveLineItems` resolve them through ONE
`hardwareLookup` instead of four calls differing only in a price column. The `CatalogEditor`
row readout renders each row's own unit (`$12.00 per m²`) rather than a page-wide
`priceLabel`, which would contradict any row not on the catalog's original basis.

**Where a basis is interpreted:** exactly one place, `BaseBlindType.hardwareCost`. The
switch is exhaustive, so adding a fifth basis makes the compiler point at everything that
needs saying — the Zod enum, the check constraint, the `PriceBasis` unions in both twins
and in `apps/web/src/types`, and `BASIS_OPTIONS` in the editor.

### Verified
api 315/315, web 183/183, both `tsc --noEmit` clean, `oxlint` clean, `vite build` clean.
Migration 36 applied to the live project; renames, defaults and the line-item backfill
verified by query (0 mismatches).

## Estimate visits bookable without a customer email (2026-08-13)

The appointment wizard's customer step used to disable every customer with no email
address and label the row "No email — cannot be emailed the booking". Those two-line rows
(name + email) also made the list read as ragged: disabled rows sat at 40% opacity next to
full-opacity ones and the overflow scrollbar rode on top of the row borders.

**Now:** the picker lists NAMES ONLY (`truncate`, one line per row, `pr-1` on the scroll
container so the scrollbar clears the borders), no row is disabled, and
`CustomerCreateModal` is no longer opened with `requireEmail` from this flow.

**API (`apps/api/src/routes/appointments.ts`):**
- `POST /` kind='estimate' — the `!customer.email` 400 is gone. The public token is still
  minted and the row is still inserted `confirmed`; the send is simply skipped when there
  is no address. Email-then-persist ordering is unchanged for customers who DO have one.
- `POST /:id/propose` — same skip, but only for `kind='estimate'`. Installations keep the
  400: their whole flow is the customer answering the proposal.
- `POST /` kind='installation' is untouched — an installation still requires an email.

The success toast reads the SAVED row's joined customer (not the local selection, which is
null on the repropose path) and says "no email on file, nothing sent" when nothing went
out. The reminder cron already skipped null emails (`lib/reminders.ts`), so nothing there
changed.

### Verified
api 290/290 (new test: books a no-email customer with NO Resend stub installed, so any
send attempt would fail the request), web 164/164, both `tsc --noEmit` clean, `oxlint`
clean.

## Bulk edit restricted to one blind type (2026-08-15)

Bulk edit used to accept any selection of blind items, mix types included, and offered
EVERY option of every catalog — the whole materials list, all four hardware dropdowns,
unfiltered. The parent then quietly dropped whatever the item's type did not use
(`slotsForType`), so a consultant could pick a Roller cassette with three Zebra rows
selected and get no feedback that it landed on none of them. Worse, a material or option
scoped to another type could be written onto an item outright, which the Worker rejects on
save (`apps/api/src/lib/optionScoping.ts`).

**Now the selection must be blinds of ONE type**, and the form is scoped to that type
exactly like the per-item form.

### The rule lives in one pure function

`bulkEditSelection(items, selected)` in `apps/web/src/pages/orders/lineItemDrafts.ts`
returns either `{ ok: true, blindsType, keys }` or `{ ok: false, reason }`, with `reason`
one of `empty` | `non_blind` | `no_type` | `mixed_types`, checked in that order. Three
call sites read the same verdict, which is why it is a function and not three inline
conditions:

- the toolbar's Edit button (enablement AND the `title` that names which rule is broken —
  "Select blinds of the same type — options differ per type"). The verdict ALSO rides on the
  count line in a few words ("3 selected · mixed blind types", "2 selected · Roller"),
  because a phone has no hover and a `title` alone would leave a disabled button unexplained;
- the popup (heading reads "Editing 3 Roller items"; it renders `null` if the selection
  stopped qualifying while the sheet was open);
- `applyBulkEdit`, which re-reads the verdict instead of trusting the open sheet and skips
  any item whose `blinds_type` is not the resolved one.

A blind with no type chosen yet is `no_type`, not a group: there is no scope to offer
options from. A legacy free-text type name IS a group like any other — the form simply
finds nothing scoped to it.

### The form renders per type

`BulkEditForm` (`apps/web/src/pages/orders/LineItemEditor.tsx`) now takes `blindsType` and
uses the same three scoping helpers the item form does: `materialsForType` for the material
list, `slotsForType` to decide WHICH hardware dropdowns exist, `optionsForType` to fill
them. A slot the type does not use is not rendered at all rather than greyed out — Curtains
shows Material / Control / Installation and nothing else. When a type has neither materials
nor slots the form says so and points at Settings instead of showing four empty dropdowns.

### Applying a bulk edit RESETS the price override

`applyBulkEditToDraft(draft, state, uses)` (also in `lineItemDrafts.ts`) is what one item
becomes. Beyond writing the chosen ids it clears `unit_price_override` on every item it
actually changes.

**Why:** an override replaces the calculated unit price on both sides (`applyPriceAdjustments`
in the web preview, `resolveLineItems` in the Worker). It is typed against the options the
item had at the time — so an overridden line would keep its old figure after a bulk material
or hardware change, and the whole point of the bulk edit would go void on exactly the lines
someone had already negotiated. The consultant sees the new options on the item and the old
money on the total, with nothing saying why.

**What is NOT reset:** add-ons and `show_original_price`. An add-on sits on top of the price
rather than replacing it, so a re-price does not invalidate it.

**No-op safety:** the function returns the SAME draft object when nothing applies (all fields
on "No change", or the only chosen id belongs to a slot the type does not use), so a run can
never drop an override as a side effect of touching nothing. The form's intro states the
reset in words before the consultant picks anything.

It keeps the `slotsForType` gate even though the selection is now single-type: the ids come
from state that a re-render cannot re-validate, and an id for an unused slot is a 400 on save.

`BulkEditState` moved from `LineItemEditor.tsx` to `lineItemDrafts.ts` for this — it is a
draft model consumed by a pure function, which is that module's stated responsibility, and
the form now imports the type instead of owning it.

### Files

- `apps/web/src/pages/orders/lineItemDrafts.ts` — `bulkEditSelection`, `applyBulkEditToDraft`,
  `BulkEditState`, `BulkEditSelection`, `BulkEditBlocker`.
- `apps/web/src/pages/orders/LineItemEditor.tsx` — `BulkEditForm` takes `blindsType`, filters,
  and states the override reset in its intro.
- `apps/web/src/pages/orders/OrderDetail.tsx` — toolbar verdict + hint, `openBulkEdit` guard,
  `applyBulkEdit` delegating to `applyBulkEditToDraft`, popup heading and self-close.
- `apps/web/src/pages/orders/lineItemDrafts.test.ts` — 13 cases (7 selection, 6 application).

### Verified
web `tsc --noEmit` clean, tests 205/205 (13 new), `oxlint` exit 0, `vite build` clean. No API,
schema or pricing surface touched — the override is cleared in the DRAFT, so the Worker simply
receives `unit_price_override: null` and prices the line from the catalog as it always has.

## Bulk measurement capture — widths and heights before any details (2026-08-15)

Adding blinds used to be one window at a time through the full blind popup: type, material,
four hardware dropdowns, measurements, price. On site that inverts the actual job — the
consultant walks the house with a tape first and picks fabrics afterwards, usually sitting
down with the customer. Every window therefore cost a round trip through a form that asks
for eight things when only two are known.

**"Add Measurements in Bulk"** (third dashed button under the item list, beside "Add
Standard Blind") opens a popup of `Room / Width / Height` rows. OK appends **one blind line
item per completed row**, with no blind type, no material and no per-type option — only the
house default hardware a single new blind already gets. The details are then filled in per
item, or across several at once with the existing bulk edit.

### Files (web only — no API, no schema, no pricing surface)

- **`apps/web/src/pages/orders/lineItemDrafts.ts`** — the whole rule set, pure and JSX-free:
  `MeasurementRow`, `newMeasurementRow`, `measurementRowState`, `countMeasurementRows`,
  `measurementRowsToDrafts`. Also gained `newBlindDraft` + `BlindDraftDefaults` and the
  `NO_ADJUSTMENTS` constant (moved out of `OrderDetail.tsx`, which now imports it).
- **`apps/web/src/pages/orders/LineItemEditor.tsx`** — `BulkMeasureForm`, the only form in
  that file that CREATES drafts rather than editing them.
- **`apps/web/src/pages/orders/OrderDetail.tsx`** — the button, the `bulkMeasure` sheet,
  `openBulkMeasure` / `applyBulkMeasure`, `measureRows` state, and the `blindDefaults` memo.
- **`apps/web/src/pages/orders/lineItemDrafts.test.ts`** — 16 new cases.

### A half-filled row is REFUSED, never skipped

`measurementRowState` classifies each row as `blank` (nothing typed — ignored, which is what
lets the popup open with five rows), `ready` (width AND height are positive numbers), or
`incomplete` (anything else: one measurement only, a room name with no measurements, a zero
/ negative / non-numeric value).

`incomplete` is the whole point of having states. A width typed without its height is a
measurement someone took up a ladder; dropping it silently would leave the order one window
short with nothing on screen to say so, and the omission would surface at manufacture. So the
popup marks those rows red, says how many need attention, and **disables OK entirely** until
they are completed or cleared. `measurementRowsToDrafts` skips them as the second half of the
same rule — it is never reached with one present.

Treating "room name but no numbers" as incomplete is deliberate: typing a room is intent to
measure it.

For the same reason, this is the one sheet on the order screen that CONFIRMS before closing
with content (`closeBulkMeasure`): its rows exist nowhere else until OK is pressed, and a
backdrop tap is easy to make by accident on a tablet.

### One draft factory for both paths

`newBlindDraft(key, defaults)` is now the single definition of "a brand-new blind", used by
both the "Add Standard Blind" button and the measurement rows. The house defaults
("Regular" cassette, "Regular" bottom rail, "Chain" control) are resolved ONCE per render in
`OrderDetail`'s `blindDefaults` memo and passed in — the pure module holds no catalog lookup
by name, and the two paths cannot drift into seeding different hardware. A test asserts a
measurement item equals `newBlindDraft` plus the measurements and nothing else.

Width lands as the item's SINGLE panel. A blind that needs several panels is split afterwards
in the item form ("+ Panel"): a panel breakdown is a specification detail, not a measurement,
and putting it in the popup would defeat one-row-per-window.

### Deliberate omissions

- **The item editor does NOT open afterwards.** Ten new items would mean ten popups, which is
  exactly the round trip this replaces.
- **No blind type dropdown in the popup**, not even a "same type for all" convenience. It
  would invite specifying while measuring through a form laid out for neither, and bulk edit
  already applies a type's material and options across many items.
- **Items created this way are not saveable yet** — `buildPayload` still demands a type and
  material and names the first item missing one. That is correct: they are measurements, not
  finished line items.

### Verified

web `tsc -b --noEmit` clean, vitest **221/221** (16 new), `oxlint` exit 0, `vite build` clean
with `border-danger` and the row grid template present in the emitted CSS. NOT seen in a
browser — the order editor is behind `ProtectedRoute`.

## Line-item visibility — the eye toggle (2026-08-17)

A line item can now be HIDDEN: it stays in the order editor with its price on screen, but
leaves the order total and every customer- and production-facing surface. The use case is a
line the consultant wants to keep on file (a quoted-then-dropped blind, an option the
customer is still deciding on) without it being charged, printed, cut or labelled.

**Schema (`supabase/migrations/20260817000037_line_items_uid_hidden.sql`):**
- `line_items.hidden boolean not null default false` — the flag. Defaulting to false means
  no existing item or already-issued document changes.
- `line_items.uid uuid not null default gen_random_uuid()` — a STABLE per-item identity.
  Saving an order replaces its line items wholesale (delete-all + bulk insert), so `id` is
  reborn on every save and `position` moves on any insert or reorder. `uid` is minted by
  the Worker, round-trips through the client, and is what makes a per-item diff possible at
  all. Indexed (`line_items_uid_idx`).

**Worker (`apps/api/src/routes/orders.ts`):**
- `identityFields` (`uid` optional uuid, `hidden` defaulting to false) is spread into all
  three line-item schemas, which stay `.strict()`. Both row builders in `resolveLineItems`
  carry both columns, keeping the uniform column set the PostgREST bulk insert requires.
- Hidden items are still PRICED and stored — un-hiding restores the exact figure — but
  `calculateTotals` is fed `rows.filter((r) => !r.hidden)` in both create and update.
- `PUT /:id` refuses a visibility change on a CONFIRMED order (400 "Visibility can only be
  changed before the order is confirmed."): once the order is an invoice, hiding a line
  would move a total the customer was already quoted. The diff is by `uid`, never by
  position, so adding, removing and reordering items on a confirmed order stay legal. A
  brand-new item may join a confirmed order but not arrive already hidden. `/unconfirm` is
  the way back.
- Hidden rows are filtered out at each document assembly point: `toPdfData` (estimate and
  invoice), the `buildWarrantyCoverage` call in `/:id/warranty-pdf`, and the same call in
  `lib/warrantyIssue.ts` (the automatic certificate).
- `routes/public.ts` drops them from the public estimate / customer-view payload, so
  `CustomerView.tsx` needed no change.

**Web:**
- `LineItem` gains `uid`/`hidden`; `ItemIdentityFields` (in `hooks/useOrders.ts`) is
  extended by all three payload types; both draft shapes carry `uid: string | null` (null =
  never saved, so the field is omitted and the Worker mints one) and `hidden`.
- `OrderDetail` hydrates both fields, seeds them on new items, sends them on every payload
  push, and filters hidden drafts out of the live totals preview — the twin of the Worker's
  filter. `duplicateItem` mints a FRESH uid on the clone: two rows sharing one identity
  would make the visibility diff ambiguous.
- The row shows an eye / eye-off button (disabled with an explanatory title once the order
  is confirmed), mutes to 55% opacity, gains a "Hidden" chip and strikes through its price.
- `lib/labels.ts` filters inside `buildLabels`, BEFORE the total is counted, so the "n of m"
  on a printed label matches the bundle actually printed. `ManufacturerCopy.tsx` filters
  before `buildManufacturingPlan`, so no stock is allocated for an item that was not sold.

## Duplicating an order (2026-08-17)

`POST /api/orders/:id/duplicate` copies an order into a NEW draft: same customer, discount
and line items (with their `hidden` flags and hand-entered adjustments), fresh order number,
`order_date` = today, expiry from `company_settings.default_expiry_days`, and fresh uids.
Not copied: payments, the activity trail, the appointment/installation, warranty state, the
public token, `cut_done`, and any cancellation request.

**How:** the route does NOT copy rows. `lib/orderDuplicate.ts` (pure, no DB, no `c.env`)
maps the stored rows back into a `POST /orders` payload, which is then parsed through
`orderSchema` and run through the ordinary create path — so a duplicate is priced from
TODAY's catalog, exactly like any other write, and a row written under an older schema fails
as a readable 400 instead of slipping past validation on age alone.

- `stripCatalogSnapshots(blindsType, attrs)` removes each `CatalogRef`'s `nameKey`/
  `valueKey` from a stored attribute blob. Those keys are written by `resolveCatalogRefs`
  AFTER validation and are deliberately undeclared in the strict `attributeSchema`, so
  feeding a stored blob back verbatim would be a 400.
- Only the money a client may legitimately dictate travels: a hand-entered override
  (present exactly when `base_unit_price` is set), the add-on list, and a custom or
  legacy-preset item's own typed price. A custom item never receives an override — the
  create path rejects the field on it.
- The create path itself was extracted to `createOrderFromInput(sb, input, logMessage)` and
  is now shared by `POST /` and `POST /:id/duplicate`, so the two cannot drift.
- A catalog row deleted since the source order was written surfaces the ordinary message
  ("Selected material no longer exists.").
- Both orders get a log line: `Duplicated from <n>.` on the copy, `Duplicated to <n>.` on
  the source.

**Web:** `useDuplicateOrder` (invalidates the SOURCE order's logs as well as caching the
copy), a Duplicate action in the order toolbar (saved orders only — the Worker duplicates
from the database, not from unsaved screen state), and a per-row action on the order list.
List rows are whole-row `<button>`s, so that action is an absolutely-positioned SIBLING with
its own mutation instance, which keeps the pending state on the clicked row alone.

### Verified
api 337/337 (new: `orderDuplicate.test.ts` 8 cases; duplicate route happy path / 404 /
deleted-catalog 400; visibility gate 5 cases; hidden excluded from totals, from the public
payload, and from the PDF), web 223/223 after merging `main` (bulk measurement capture and
the single-type bulk edit), both `tsc --noEmit` clean, `oxlint` clean,
`vite build` clean. The PDF test inflates the content streams and decodes pdf-lib's hex
string literals, so the "not printed" assertion cannot pass vacuously.

## 2026-08-20 - Address autocomplete re-enabled, with a selection lock

Change in `apps/web/src/components/AddressAutocomplete.tsx` only — no call-site, prop, or
`lib/addressSearch.ts` change, exactly as the 2026-08-01 shutdown entry in `bug_fixes.md`
predicted.

**Re-enabled:** `ADDRESS_SEARCH_ENABLED = true`. Search-as-you-type is live again on both
customer-entry surfaces (`CustomerForm.tsx` shipping + billing, `CustomerCreateModal.tsx`):
3+ characters, debounced 300 ms, Photon results, tap/Enter fills line 1 + city + province +
postal code in one go. The operator asked for it back knowing the field-accuracy complaint
that closed it; the accuracy of Photon's data itself was not touched.

**Selection lock (the new behaviour):** a `selectionLocked` ref, set in `choose()` and
released only inside the input's own `onChange`. While locked the debounce `useEffect`
returns before building a term, the `onFocus` re-open is suppressed, and an in-flight
response that resolves after the pick is dropped. So once an address has been chosen the
field is inert — no dropdown, no request — until the consultant types or deletes a
character, at which point lookup resumes normally.

**Why a lock and not the old one-shot `skipNextSearch` flag.** The auto-filled line 1 IS a
valid search term, so the naive component re-queries the address it just filled and re-opens
the list over a finished field. The previous flag suppressed exactly one effect run, which
mis-fires twice: if the chosen `line1` equals the text already in the field the debounced
value never changes, the effect never runs, and the flag survives to swallow the consultant's
NEXT genuine search; and a blur/refocus could still re-open the stale list. Keying the lock
to real edit events instead of to effect runs removes both cases.

### Verified
web `tsc -b --noEmit` clean, `oxlint` clean, vitest 336/336. NOT verified: live typing
against Photon in the running app — `/customers/new` is behind `ProtectedRoute` and no
signed-in session was available in this environment.

## 2026-08-20 - Manual any-stage order status transition

The order lifecycle used to be movable only along whitelisted paths: five forward routes
that each 409'd unless the current status was one they accepted (`/in-progress` took only
`awaiting_payment`; `/mark-sent` and `/confirm` only `draft`/`sent`, and `/mark-sent` also
rejected a lapsed `expiry_date`), plus `/revert` for strictly-earlier targets. The Progress
timeline mirrored that whitelist in an `ADVANCE_TARGETS` map and rendered the rest disabled.
Real jobs do not follow it — an order marked installed by mistake, a walk-in that starts at
Ready without ever being emailed, an expired estimate that becomes a live job the same day.

**API — `POST /api/orders/:id/status`** (`apps/api/src/routes/orders.ts`). Body
`{ to }`, `.strict()`, restricted to the six timeline stages. NO direction guard, NO
`EDITABLE` guard, NO expiry guard. 409 only on a no-op (already in the target status), 404
on a missing order, 400 on any other status. `expired` is accepted as a SOURCE and needs no
special handling on the server, because reconciliation reads the TARGET index only. Logs
`Status manually changed from <from> to <to>.`

**Timestamp reconciliation (`stageMetadataUpdate`).** The target's index in `STAGE_ORDER`
decides every stamp in both directions: a stage at or before the target counts as passed, so
`sent_at` / `confirmed_at` / `installed_at` are filled with `now()` when missing and left
alone when already set (re-entering a stage must not rewrite when it first happened); a stage
after the target is nulled. Landing below `ready` deletes the order's installation
appointment — the same stale-visit rule `/revert` applies. `review_requested_at` is
deliberately excluded: a customer who already got the review email must not get it again
after a re-install. Stamping `installed_at` matters beyond display — it drives the
post-installation review-request cron.

**Guarded routes unchanged.** `/mark-sent`, `/confirm`, `/in-progress`, `/ready`,
`/installed`, `/revert` keep their semantics: they are also driven by the payment path, the
customer-facing confirm, and the email flows, where the guards still carry weight. The new
route never emails and never touches payments, warranty state, `cut_done_at`, or the
cancellation request.

**Web.** `useSetOrderStatus()` replaces `useRevertOrder` in `hooks/useOrders.ts`;
`useMarkSent` and `useMarkInProgress` were removed with it, since the timeline was their only
caller (the Worker routes remain). In `OrderDetail.tsx`, `ADVANCE_TARGETS`, `canAdvanceTo`,
`handleAdvance` and `handleRevert` collapse into one `handleSetStatus`, and every stage node
except the current one renders an enabled button — back-arrow below, check above, one confirm
dialog whose copy names the consequence on a backward move. `stageIndex`/`curIdx` moved above
the handler so the move direction and the node styling share one definition.

### Verified
api 112/112 in `orders.routes.test.ts` (8 new cases: draft to installed stamps all three;
installed to draft clears all three and deletes the appointment; expired to awaiting_payment
keeps an existing `sent_at`; a target of ready or later keeps the appointment; the log line;
409 no-op with no write; 400 on `expired`; 404), web 336/336, both `tsc --noEmit` clean,
`oxlint` clean. NOT verified: the timeline clicked in the running app — `/orders/:id` is
behind `ProtectedRoute` and no signed-in session was available in this environment.

## 2026-08-20 - Per-option prices on the customer's documents

Every hardware option a blind carries now prints what it ADDED TO THE LINE beside its name,
on the estimate/invoice PDF and on the public customer page: `Cassette: Standard — $28.00`.
An option that added nothing prints its name alone — "$0.00" beside a choice tells a customer
nothing the missing figure does not already say. Material, Color and a blind type's own
attribute lines stay bare: material is the fabric the blind is made of rather than an extra
chosen on top (and is the leg the internal presentation table fits its rounding into), and
colour carries no charge at all.

**`apps/api/src/lib/optionBreakdown.ts` (new).** `optionLineAmounts(item)` rebuilds the
`hardware` map from the item's own SNAPSHOT columns (`<slot>_id`, the rate column, and
`<slot>_price_basis`), feeds it to `getBlindType(blinds_type).describeUnitCosts` — the same
call that produced `unit_price`, so no price basis is ever interpreted twice — and returns
`round2(leg × quantity)` per slot. Line-level, not per-blind: the figure sits beside an option
on a document whose money column is the line total. `material_price_per_sqm` is passed as 0
because only the hardware legs are read back out.

Absent-vs-zero is preserved exactly as `resolveLineItems` and the web twin define it: a slot
is ABSENT when its id is null (no such option), and a pre-migration-36 row carrying an id with
a null basis is also absent — the rate alone cannot say what was charged, and guessing would
invent money on a historical document. A chosen option costing nothing is `0`, which is a
different fact and reaches the document as a named option.

Twin of the hardware half of `apps/web/src/lib/optionBreakdown.ts` (which serves the internal
Order Presentation table from the full `LineItem` type). Both read the same columns under the
same rule; a change to that rule lands on both sides.

**PDF** (`apps/api/src/lib/pdf.ts`). `itemContent` calls `optionLineAmounts(li)` and appends
` — $x.xx` to the four hardware lines. `PdfDocumentData['line_items']` gained the id / rate /
basis columns as OPTIONAL — warranty and receipt payloads are assembled elsewhere and an older
assembled object simply prints its option names bare. `toPdfData` already spreads the whole
row, so no route change was needed.

**Public page** (`apps/api/src/routes/public.ts` → `CustomerView.tsx`). The Worker sends a new
`option_prices: { cassette?, bottom_rail?, control?, installation? }` per line item. Computed
server-side for the same reason every other figure on that payload is: the page holds no
catalog and may not derive money (rule 1), and the endpoint is unauthenticated, so the rate
columns and price bases stay on the server — a customer is shown what a choice cost them, not
the shop's price list. `PublicLineItem.option_prices` is optional, so a page served by an
older Worker renders the names bare.

### Verified
api 380/380 (12 new: 8 in `optionBreakdown.test.ts` covering each basis, both dimension
minimums, cent rounding, zero-vs-absent, the null-basis legacy row, non-blind items and
PostgREST string columns; 4 in `pdf.test.ts` for the rendered lines; 1 in
`public.routes.test.ts` asserting `option_prices` is sent while `price_basis` and the rate
columns never appear in the response bytes), web 336/336, both `tsc --noEmit` clean, `oxlint`
clean. NOT verified in a browser: the customer page needs a live order token and the running
Worker, neither available in this environment.

## 2026-08-25 - Per-item price lock from the moment an estimate is sent

Sending an estimate quotes a customer a price, but that price stayed a COMPUTATION: every
`PUT /api/orders/:id` ran `resolveLineItems` over today's catalog and today's formula code, so
reopening a sent estimate — or a confirmed invoice — and pressing Save was enough to re-price
it. A pricing-formula change, or a material's price edited in Settings, silently rewrote money
the customer had already been quoted and, once confirmed, was paying against.

The lock takes effect at SEND, not at confirmation: quoting the figure is the shop's
commitment, and confirming is only the customer accepting one already made.

Migration 39 (`20260825000039_line_items_price_lock.sql`) adds two columns to `line_items`:

- `locked_base_price numeric(10,2)` — the frozen CALCULATED unit price (pre-override,
  pre-add-on). NULL means live-priced, which is every item of a draft/sent estimate.
- `locked_inputs_fingerprint text` — canonical JSON of the pricing inputs that produced it.

**The rule** (`apps/api/src/lib/priceLock.ts`, twinned by `apps/web/src/lib/priceLock.ts`).
`pricingFingerprint(input)` encodes ONLY what feeds the formula: blind type, panels, height,
the four hardware ids, the material id and the type's own attribute inputs; for a flat item,
`preset_id` plus the typed figure a legacy preset or custom item carries. Quantity, add-ons,
the manual override, visibility, room name, colour and notes are excluded on purpose — they
keep applying live on top of the frozen base. Numbers are canonicalised to 4 dp (so `200` and
`200.00` agree across a PostgREST round-trip), empty-string ids collapse to null, attribute
values are TAGGED by type (`n:2` vs `s:2`), attribute keys are sorted, and the Worker's own
snapshot keys (`pleat_name`, `pleat_multiplier`) are stripped — a catalog edit that moves a
pleat multiplier must not read as the consultant having changed the item. Text, not a hash: an
unrecognised old fingerprint simply fails to match and re-prices that item once, and a support
question about why a price moved is answerable by reading the column.

On save of an order at any locked status — `sent`, `expired`, or any confirmed stage, `draft`
being the only live-priced one (`PUT /:id` passes `buildLockMap(existing.line_items)` into
`resolveLineItems`):

- fingerprint matches → the frozen price is reused, together with the catalog snapshot columns
  that explain it (rates, bases, resolved attributes). No lookup and no slot-scoping gate runs
  for that item, so an option deleted from Settings can neither move the price nor block the
  save.
- fingerprint differs, or the item is new → priced from today's catalog and re-locked at that
  figure. This is the deliberate door through which a formula change still reaches a quoted
  order: only for the item someone actually edited. (Chosen over "frozen until unlocked" so the
  editor stays live where a consultant is genuinely re-specifying a window.)

**Lifecycle.** `freezeOrderPrices` writes `base_unit_price ?? unit_price` (the CALCULATED
figure — freezing the overridden one would apply the override twice on the next save) onto
every item not already locked, BEFORE the status moves, so a failure fails the transition
rather than leaving an order that re-prices itself. Called from `POST /:id/send` (after the
email succeeds, keeping the email-then-persist ordering), `POST /:id/mark-sent`,
`POST /:id/confirm` (a no-op for an order that was sent, but a draft confirmed over the phone
must not arrive live-priced), and `POST /:id/status` / `/revert` whenever the target stage is
`sent` or beyond. Already-locked items are skipped by an `.is('locked_base_price', null)`
filter, so a later stage change is never a re-quote. `/send` and `/mark-sent` write an
"Item prices locked at send." order-log line.

Release happens ONLY when an order returns to `draft`: `/status` and `/revert` targeting draft
call `clearOrderPriceLocks`, and reviving a lapsed estimate in `PUT /:id` re-inserts its rows
live-priced (the revive decision moved above the pricing for exactly this). `POST /:id/unconfirm`
and an accepted cancellation request deliberately do NOT release — both land the order back on
`sent`, where the customer still holds the estimate that quoted those figures. A duplicated
order is a new draft and inherits no lock, matching its existing "today's catalog" rule.

**Editor** (`lineItemDrafts.ts`). `PriceAdjustmentDraft` gained `lock: PriceLock | null`, filled
from the two columns in `toDrafts` and never sent back (the payload schema is `.strict()`).
`blindDraftPrice` consults the lock BEFORE the catalog — a locked item previews at its quoted
price even when its material has since been deleted, the one case the formula path refuses to
price at all — and `flatDraftPrice` does the same. `isPriceLocked(draft)` drives a
padlock beside the row's total in `LineItemRow` ("Price locked when the estimate was sent"),
which disappears the moment an input is edited and the price goes live again. A duplicated draft clears `lock` along with `uid`.

Persistence helpers (`freezeOrderPrices`, `clearOrderPriceLocks`, `buildLockMap`,
`lockInputFromRow`) live in `apps/api/src/lib/priceLockStore.ts` so the fingerprint module
stays pure and twinnable.

### Verified
api 429/429 (16 in `priceLock.test.ts`, 13 new route tests: frozen through a doubled material
price, a SENT estimate holding before any confirmation, a draft still live-priced, a revived
estimate returning to live pricing in the same save, only the edited item re-priced,
quantity/add-ons/override still live on top, a locked item saved after its material was
deleted, a later addition priced then locked, the freeze on `/send` and on `/mark-sent`, the
confirm-time freeze taking the calculated figure on an overridden item, locks KEPT through
`/unconfirm`, released only by a status move to draft, and a catalog-priced preset holding at
its quoted figure), web 425/425 (16 mirrored fingerprint tests — including a canonical-shape
assertion pinned to the same literal on both sides — plus 6 preview tests), `tsc` clean both
sides, `oxlint` clean. NOT verified in a browser: needs the migration applied and a sent
order.

**Deployment order matters**: the migration must be applied BEFORE the Worker is deployed —
the insert writes both columns on every save, so a Worker running against the old schema
would fail every order write.

## 2026-08-25 — Orders list paginated at 15 per tab

`apps/web/src/pages/orders/OrderList.tsx` (one file; no API, hook or query-key change).

Every status tab (All / Active / Awaiting Payment / In Progress / Ready / Installed /
Expired) now renders at most `PAGE_SIZE = 15` orders, with a pager anchored bottom-right
under the list — a range label ("1–15 of 42"), Previous, "Page N of M", Next — inside a
`<nav aria-label="Orders pagination">`. It is hidden entirely when the tab fits on one page,
so a dead "Page 1 of 1" control never appears.

Paging is CLIENT-side over the tab result already in the TanStack cache: `GET /api/orders`
returns the tab's rows in one capped response (`.limit(100)` in
`apps/api/src/routes/orders.ts`), so a page change costs no request, no spinner and no
`keepPreviousData` flicker. Two consequences worth keeping in mind:

- The desktop summary tiles still count the WHOLE `orders` array, not the visible page, so
  they keep describing the tab rather than the slice — the same honesty rule the module
  header already stated for the `all`-tab-only restriction.
- The pager can only page through what the server sent. Past 100 orders on a tab the list is
  already truncated upstream; making the pager reach further is a server-paging change
  (`limit`/`range` + a total count on the envelope), not a UI one.

`page` is state; the RENDERED page is derived and clamped —
`currentPage = Math.min(page, totalPages)` — so a result set that shrinks under the user (a
refetch, a status change moving a row off the tab, a search narrowing) can never leave them
staring at an empty page that no longer exists. Changing tab (`selectTab`) or typing in
search resets to page 1. Both layouts consume the same `pageOrders` slice: the `<lg` card
stack and the `lg+` table.

## 2026-08-25 — Delete action on every orders-list row

`apps/web/src/pages/orders/OrderList.tsx` (one file; no API, hook or schema change — the
`useDeleteOrder` hook and `DELETE /api/orders/:id` both already existed and are reused
untouched).

Duplicate and Delete now sit side by side on every row, in a single absolutely-positioned
`RowActions` strip overlaying the row's right edge. Both breakpoints render the SAME strip
and differ only in geometry (`h-11 w-11` icons at `right-1.5 top-2.5` on the card stack,
`h-9 w-9` centred at `right-2` on the desktop table), so the pair cannot drift apart on one
layout while staying aligned on the other. Row right padding went `pr-14` → `pr-24` on both
the card and the table row to clear the wider strip — the strip overlays content, it never
pushes it.

Delete confirms BY ORDER NUMBER (`Delete BN-1042 permanently? Its line items and payments are
removed.`) because it sits one icon away from a harmless Duplicate and overlays a row that is
itself one click from opening the order. Deletion cascades to line items and payments
(`ON DELETE CASCADE`) and is not undoable. The wording mirrors `OrderDetail`'s Delete and both
call the same endpoint — the list is not a looser path to deletion than the order page.

`DeleteButton` owns its own mutation and pending state, exactly as `DuplicateButton` does: one
mutation lifted to the list would grey out every row's icons while a single order was being
deleted. Nothing navigates on success — `useDeleteOrder` drops the detail cache entry and
invalidates the list, so the row simply leaves. Both buttons are rendered as SIBLINGS of the
row, not children: the row is itself one big `<button>` and cannot legally contain another.

### Verified
`tsc` clean, `oxlint` clean, web 425/425 (unchanged — `OrderList` still has no covering
tests). NOT seen in a browser: the dev server stops at the Supabase login wall.

## 2026-08-26 — Customer edit requests ("Request Edit" beside Confirm)

The public estimate page previously offered a customer exactly one forward action — Confirm —
and one backward action that only exists AFTER confirming (request cancellation). A customer
who wanted a change had to leave the page, and the ask never reached the order record. There
is now a **Request Edit** button to the LEFT of Confirm that opens a dialog, files a free-text
message against the order, and surfaces it on the staff order page.

**Migration 41** (`20260826000041_order_edit_requests.sql`) adds `order_edit_requests`
(`id`, `order_id` → orders ON DELETE CASCADE, `message`, `created_at`, `resolved_at`), an index
on `(order_id, created_at desc)`, a partial index on `order_id where resolved_at is null`
backing the open-count cap, and the standard `authenticated_full_access` RLS policy (anon gets
nothing).

A TABLE, not columns on `orders` — deliberately the opposite call from migration 27's
`cancel_requested_at`. That one is a single optional side-conversation per order; an edit
request is a COLLECTION, several of which can be open and each resolved independently.
`resolved_at` is the whole lifecycle (null = open, set = handled, never cleared), so the rows
double as the history. No `resolved_by`: the app has no per-user attribution anywhere else on
an order, and `order_logs` already records that the resolution happened.

**Public route** `POST /public/estimate/:token/edit-request` (`apps/api/src/routes/public.ts`).
Accepted ONLY while the order is `sent` — the pre-confirmation window in which the customer's
action bar exists at all — with `effectiveStatus` applied first so a lapsed estimate reads as
expired here exactly as it does on the page. The message is trimmed and TRUNCATED to 1000
chars rather than rejected (a customer should not be bounced for a limit they were never
shown); empty-after-trim is 400. A per-order cap of **5 OPEN requests** is counted immediately
before the insert; the read-then-insert race is benign and documented as such — the cap exists
to stop a wall of messages, not as an invariant worth a trigger. The trail entry is
`'Customer requested changes.'` with the message deliberately NOT interpolated, matching how
the cancellation note is handled. **No email is sent** — a deliberate choice: the order page
and the activity trail carry it. `GET /public/estimate/:token` gained `edit_requests`, read
back to the customer so a sent message never appears to vanish. `loadByToken`'s select had to
become ONE string literal — supabase-js parses the select at the TYPE level and a concatenated
string widens to `string`, collapsing the whole row type to a parse error.

**Staff routes** (`apps/api/src/routes/orders.ts`): `GET /:id/edit-requests` (newest first,
resolved included, limit 200) and `POST /:id/edit-requests/:requestId/resolve`. The resolve
UPDATE is guarded on `resolved_at is null` AND `order_id`, so a stale tab cannot re-stamp a
request a colleague closed and a request id from another order cannot be resolved through this
order's URL. When nothing matches, a follow-up read distinguishes 404 (not this order's) from
409 (already resolved) rather than collapsing both into "not found". It returns the REFRESHED
list, so the card re-renders in one round-trip instead of flickering through an empty state.

**Web — customer**: new `pages/customer-view/EditRequestDialog.tsx`, presentational over the
shared `ui/Modal` (so the unauthenticated page inherits the tested Escape/backdrop/scroll-lock/
focus handling rather than reimplementing it), with the body markup in the customer page's own
idiom. `onSubmit` REJECTS on failure — that contract is what keeps a failed send from clearing
the typed message, while a resolved promise closes the dialog. The draft resets on OPEN, not on
close, so a filed message is never re-presented as unsent. `CustomerView.tsx` splits the fixed
bar into `flex-1` / `flex-[2]`: Request Edit outlined on the left, Confirm unchanged on the
right — one primary decision with an escape hatch, not a choice between equals. Request Edit is
NOT gated on the terms tick (asking a question is not assent) and does NOT block Confirm. Both
inert under `?preview=1`. A "Your change requests" list renders what the customer sent.

**Web — staff**: new `pages/orders/EditRequestsCard.tsx`, amber, showing only UNRESOLVED
requests and disappearing when the last is closed — a to-do list, not an archive. Amber not
red: red is spoken for on that page by the cancellation banner, the one thing that must be
answered before anything else. Mounted in `OrderDetail.tsx` below that banner, above the
timeline, OUTSIDE the read-only fieldset (resolving is not an edit to the order). `resolvingId`
is tracked per row so resolving the third request does not blank the other two's buttons.
`useOrderEditRequests` / `useResolveEditRequest` in `hooks/useOrders.ts`; the resolve response
is written straight into the cache and only the LOGS query is invalidated — the order itself
did not change.

### Verified
`tsc` clean both workspaces, `oxlint` clean, api 447/447 (429 → +13 public, +5 orders), web 425/425
(unchanged — the new components have no covering tests, matching the rest of the page). The
migration is written but NOT applied to the live Supabase project; the routes 500 until it is.

## 2026-09-02 — Customer edit mode (read-only by default, pen to edit)

**Why.** `/customers/:id` opened straight into a live form. Looking a customer up — a phone
number before calling, an address before driving — is the common visit, and every one of them
was a chance to change the record by accident. There was also no way to correct a customer
from the order editor: a wrong number noticed while writing up an order meant abandoning the
editor for the customers module and navigating back.

**Web — customers page** (`pages/customers/CustomerForm.tsx`). The route now opens READ-ONLY,
rendering the new `pages/customers/CustomerDetailView.tsx`: the same three sections as the
form, as label/value rows with an em dash for blanks, email as `mailto:` and phone as `tel:`
(this app is used on a phone, in the field). Label/value rather than disabled inputs — a
greyed-out box reads as broken, not as read-only. A pen button in the `PageHeader` right slot
enters edit mode, and the header shows the customer's `displayName` under a `CUSTOMER` eyebrow
instead of "Edit Customer". Entering edit SEEDS the form from the freshly loaded record, which
replaced the old `loaded` flag and its effect — the form can no longer show a stale copy of a
customer saved a moment ago. Saving an existing customer returns to the VIEW with the refreshed
record rather than bouncing to the list (creating still goes to the list). Cancel prompts only
when `isCustomerFormDirty`. Delete moved inside edit mode: the default state of the screen is
something to read, and a destructive control does not belong there. `/customers/new` is
unchanged.

Linked values (`mailto:`/`tel:`) are laid out as a CENTRED inline-flex. The base layer gives
every anchor the 44px tap-target minimum, so left as inline text they sat at the top of a 44px
box and dumped 21px of slack underneath, which read as a spacing bug next to the 23px text rows.

**Web — order editor.** `CustomerCard` (`pages/orders/OrderHeaderCards.tsx`) gained a pen
between the picker and the disclosure chevron, shown only with a customer selected and
`!readOnly` — the chevron stays in both cases, because reading is always safe. It opens the new
`components/CustomerEditModal.tsx` — `Modal` + the shared field set + `useUpdateCustomer` —
which writes the `customers` row and NOTHING else: the order is neither saved nor dirtied, so
pricing and totals are untouched (rule 1 is not in play). The saved row comes back through
`onSaved` into `setCustomer`, and `useUpdateCustomer`'s existing `onSuccess` refreshes the
detail and list caches, so the customers module reflects the change with no extra plumbing.

**LOCKED — where the dialog is mounted.** `CustomerEditModal` is mounted at `OrderDetail`'s
page tail beside `CustomerCreateModal`, deliberately OUTSIDE the `fieldset disabled={readOnly}`
wrapper. A dialog rendered inside that subtree inherits the disabled fieldset and presents a
form nobody can type into. `readOnly` is currently a vestigial `const readOnly = false`, so the
bug would not bite today and would be baffling the day that constant becomes real.

**Sharing, not duplicating.** The order-side dialog needs the same fields the page has, so the
form was extracted rather than copied a third time: `lib/customerForm.ts` (the pure
`CustomerFormState`, `EMPTY_CUSTOMER_FORM`, `toCustomerFormState`, `toCustomerInput`,
`validateCustomerForm`, `isCustomerFormDirty`) and `components/CustomerFields.tsx` (the Contact
/ Shipping / Billing inputs, `variant` selecting bordered cards on a page or flush sections in
a dialog). `validateCustomerForm` mirrors the server's create refinement in
`apps/api/src/routes/customers.ts`, and now lives in ONE place instead of the two it had drifted
into. `isCustomerFormDirty` skips the billing fields while "same as shipping" is ticked — those
inputs are hidden and their values deliberately retained, so treating them as unsaved changes
would prompt the user to discard nothing.

**Deliberately untouched.** `components/CustomerCreateModal.tsx` keeps its own compact,
billing-less layout — a deliberate difference for a quick add inside a picker, not drift.
And there are NO api, schema, hook or route changes: `PUT /api/customers/:id` and
`useUpdateCustomer` already did everything needed.

See `knowledge/history/bug_fixes.md` (2026-09-02) for the address-autocomplete dropdown fix
this work surfaced.

### Verified
`tsc` clean, `oxlint` clean, web 446/446 (425 → +21 in `lib/customerForm.test.ts`). No api
changes, so the api suite is untouched. The view/edit toggle, all three Cancel paths, the pen's
three visibility states and the modal were exercised in a browser against a seeded query cache.
