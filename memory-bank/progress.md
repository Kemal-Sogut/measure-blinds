# Progress

## Line item price adjustments (2026-08-10)
Branch `feat/line-item-price-adjustments`, 15 commits from `feat/curtains-pricing`.

**Works:** a consultant can override the calculated unit price of a blind or a
catalog-backed preset, optionally show the customer the original struck through, and reset
to the calculated price at any time; preset and custom items carry a title plus a
multi-line description; any line item can carry up to ten `{label, price}` add-ons whose
prices land once each in the line total. Overridden prices are marked with an amber dot on
staff surfaces, printed with a hand-drawn strikethrough on PDFs (pdf-lib has no such
primitive), and shown struck through on the customer page. Every hand-typed money change
writes its own order-activity line.

Presets are now server-priced from `preset_line_items` via a snapshotted `preset_id`, which
tightens the server-authoritative money rule and is what gives an override a default to
reset to. The three client money fields (`unit_price_override`, `addons[].price`, and a
custom item's own `unit_price`) are the whole carve-out, each clamped and logged.

api 289/16, web 164/14, both `tsc --noEmit` clean, oxlint 0 warnings. `lineItemAdjustments`
twin bodies byte-identical below the header.

**Fixed along the way:** an uncommitted Curtains formula edit was multiplying the SUMMED
PANEL WIDTH by 0.5 instead of the panel count, pricing the standard 300cm test curtain at
$15,300 and leaving the web twin out of sync with the api one. Finished as a per-panel hem
allowance outside the pleat multiplier, mirrored into both twins, with tests pinning both
the per-panel reading and the fullness exclusion.

**Not done:** migration 31 is written but NOT applied — the maintainer applies it, and the
Worker will fail on unknown columns until it is live. Nothing has been rendered in a
browser; `/orders/:id` is behind `ProtectedRoute`.

**Known limitation:** preset items saved before migration 31 have no `preset_id`. They keep
their historical client-sent price and cannot be overridden or reset until re-picked from
the preset sheet — there is no catalog default to return to.

## Curtains pricing (2026-08-10)
Branch `feat/curtains-pricing`, 9 commits from `origin/main` at `4dedf24`. The first use of
the blind-type module scaffold below, and the first type to leave the shared formula.

**Works:** a curtain prices as `width_m × pleat fullness × fabric price per metre`, plus the
per-panel control charge and a fixed installation charge; height is measured but not priced,
and the type has no cassette or bottom rail at all. Two catalogs (`pleat_types`,
`installation_options`, migration 30) are managed through the existing settings route
factory — pleat types from the Curtains materials page, installation options from the
Settings index. `BaseBlindType` gained four generic members (`catalogRefs`,
`requiredCatalogs`, `inputKeys()`, `resolveCatalogRefs()`); `orders.ts` drives all of them
in a loop and still contains no branch on `blinds_type`. The pleat multiplier and the
installation charge are resolved from ids server-side and snapshotted into the `attributes`
jsonb after the strict parse, so neither can arrive from a client — a payload carrying
`pleat_multiplier` is a 400.

`pnpm check` clean, api 242/14, web 133/13, oxlint 0 warnings. Twin bodies byte-identical
for `base.ts` and `curtains.ts`.

**Fixed along the way:** a latent round-trip defect that would have hit any type with a
server-written key — a re-opened order's draft carried the snapshot keys into a `.strict()`
parse, which failed, and the failure signal is `null`, so the item silently lost every
per-type option on its second save. See `bug_fixes.md` 2026-08-10, along with three tests
caught passing before the feature existed.

**Not done:** migration 30 is written but NOT applied — the maintainer applies it. All nine
remaining blind types still inherit the base formula, unchanged.

**Untested with real data:** still true, and now the thing most worth doing. No display
surface has been seen rendering a non-empty attribute list; every test uses a mocked or
throwaway type. Once migration 30 is live, check the estimate PDF, the customer page, the
manufacturer copy and the order item rows, plus the save → reopen → save round trip and one
non-Curtains blind for regression.

**Owner decision pending:** all three pleat multipliers ship at 1.0, so a curtain prices as
flat fabric until the real ratios are entered in Settings. That was chosen over seeding
guessed industry values.

## Blind-type modules (2026-08-09)
Branch `refactor/blind-type-modules`, 10 commits on top of `main`. Touches the DB, the
pricing twins, the order payload, the whole blind form layer, and all four display surfaces.

**Works:** a blind type is now a self-contained module. `apps/{api,web}/src/lib/blindTypes/`
(renamed from `calculators/`) carries the price formula AND an `attributeSchema`,
`defaultAttributes()` and a React-free `describeAttributes()`. Per-type inputs persist in
`line_items.attributes` jsonb (migration 29, applied live), validated server-side in two
stages so an undeclared key — a price above all — is a 400 rather than a silent write.
`pages/orders/blindForms/` holds one hand-written form per type behind a dispatcher, with
shared controls in `fields.tsx` and `DefaultForm` as the permanent fallback for unknown,
inactive and legacy free-text types. Attributes render on the estimate PDF, the customer
page, the manufacturer copy and the order item rows, all through the one formatter.
`/public/estimate/:token` forwards only pre-formatted lines, never the raw blob.

`pnpm check` clean, web 116/13, api 214/13, oxlint **0 warnings** (down from 4 — the
`lineItemDrafts.ts` split removed the long-standing `react/only-export-components` ones),
production build clean. The blind popup and the item rows were diffed in a signed-in browser
against the pre-refactor build: rendered DOM byte-identical, 6826 and 2647 chars.

**Not done, by design (SUPERSEDED 2026-08-10 — Curtains has since diverged, see above):** no
blind type had diverged when this branch landed. Every type priced by the base formula and
declared zero attributes — the scaffold was the deliverable, and the extension points were
proven by a throwaway subclass in `attributes.test.ts` rather than by inventing a pricing
rule. Also deliberately untouched, and still true: the api ⇄ web twin duplication, which
grew here; a shared package is a separate architectural decision, and the mirrored suites
remain the drift alarm.

## Responsive shell rewrite (2026-08-03)
Branch `main`. Web-only; no API, schema, or pricing surface touched.

**Works:** one `Sidebar` for every width — collapsible 248/72px rail at `md+` (both tablet
and desktop), full-screen overlay from a header hamburger below `md`, with Esc, backdrop,
route-change dismissal, body scroll lock and `inert` on the page behind it. Rail width is a
single `--sidebar-w`; the old `Sidebar`/`Layout` paired measurement is gone. `BottomNav` and
`Layout`'s `nav` prop deleted. Every page header and body sits on one fluid `.page-container`
track (gutters 16/24/32px, capped at an overridable `--page-max`). The order screen is fluid
with a summary rail from `xl`, its five document actions moved into a wrapping toolbar in the
body, and its sticky offsets measured via `--order-head-h` rather than hard-coded. Line-item
names wrap with `wrap-anywhere` instead of truncating. `tsc` clean, vitest 88/88 (9 files),
oxlint at the 4 known pre-existing warnings, build clean. Geometry measured in-browser at
375/768/1280/1920 in both rail states: zero horizontal overflow, header/body edges aligned.

The order screen is capped at 1000px via `[--page-max:1000px]` on the page root (so head,
body and action bar share one track); summary rail 320px, grid gap 24px, form + rail = 936px
centred. Verified interactively on a signed-in session at 390/768/1280/1600 in both rail
states: zero overflow, all page tracks identical in width and left edge, rail toggle drives
state + labels + `localStorage`, phone overlay opens full-viewport with scroll lock and
`inert` and closes on Escape and on navigation, long descriptions wrap instead of truncating.

**Not done / known issues:** real iOS Safari is still owed — `dvh`, `visualViewport` and the
overlay's safe-area inset cannot be exercised in desktop Chrome. `pages/customer-view/*` sits
outside the authenticated shell and inherited none of this. `OrderLabels.tsx` keeps its
`max-w-lg` on purpose (print-sheet geometry).

## Mobile layout repair on the order screen (2026-08-02, later)
Branch `main`. Web-only; no API, schema, or pricing surface touched.

**Works:** 16px form controls below `lg` (unlayered rule — Tailwind utilities beat
`@layer base`), so iOS Safari no longer zooms on focus; every bottom sheet on the order screen
capped in `dvh` with the home-indicator inset and `overscroll-contain`; line-item rows break to
two lines below `sm` with 44px action targets; the fixed action bar hides while the keyboard is
up and publishes its measured height as `--action-bar-h` instead of the page guessing `pb-40`.
`tsc` clean, vitest 74/74, oxlint at the 4 known pre-existing warnings.

**Not done / known issues:** nothing was checked on real iOS — `/orders/:id` sits behind
`ProtectedRoute` and desktop Chrome cannot exercise `dvh` or `visualViewport` anyway. The
original "buttons unreachable" report is NOT fully explained: the two obvious geometric
theories were measured and disproved (see `bug_fixes.md`), leaving focus zoom as the leading
cause. If it recurs after this change, capture `scrollWidth` vs `innerWidth` on the phone
rather than re-testing those theories. The remaining hand-rolled sheets still have no
scroll-lock, Escape handling, or focus management — migrating them onto `ui/Modal` is the
follow-up.

## Warranty certificate on paid-in-full (2026-08-02)
Branch `feat/customer-view-and-logs`.
- ✅ Migration `20260802000031_orders_warranty.sql` — `orders.warranty_sent_at` +
  `orders.warranty_starts_on`. **WRITTEN, NOT APPLIED.** Nothing in this feature works until
  the owner applies it. ⚠️ `.gitignore` covers `supabase/`, so the file is on disk, uncommitted.
- ✅ `lib/warranty.ts` + 11 tests — term policy (10y products / 2y motor), `/motor/i`
  classification, leap-clamped `addYears`. Pure: no Supabase, no env, no I/O.
- ✅ `lib/warrantyPdf.ts` + 4 tests — certificate: buyer block, coverage summary, 10-year list,
  a motorised-parts section that is omitted when there is no motor, terms, how to claim. Prints
  no money at all.
- ✅ `lib/warrantyEmail.ts` + 4 tests — branded template; motor row and motor checklist item
  vanish when `hasMotorised` is false.
- ✅ `lib/warrantyIssue.ts` — `issueWarrantyIfPaid`, called from `POST /orders/:id/payments`
  AND the e-Transfer webhook. Never throws; every outcome is a return value.
- ✅ `POST /orders/:id/warranty` (force resend) and `GET /orders/:id/warranty-pdf` (staff
  download) + 9 new `orders.routes.test.ts` cases.
- ✅ Web: `Order.warranty_sent_at` / `.warranty_starts_on`, `useSendWarranty`,
  `downloadWarrantyPdf`, and a warranty strip in the Payments panel shown only once
  `balance <= 0.005`, with its own send sheet.
- ✅ Additive exports on `pdf.ts` and `email.ts`; `toBase64` → `lib/pdf.ts` and
  `formatDateLong` → `lib/timeText.ts` so no lib module imports from a route module.
- ✅ Verified: api tsc clean + vitest **186/186 (11 files)**; web tsc clean + vitest **78/78**;
  oxlint unchanged at 4 pre-existing warnings.
- ⏳ Owed: apply the migration, deploy Worker before web, and exercise it for real — a final
  payment on a test order, the delivered email, the PDF opened by eye, the panel strip on
  screen. None of that was possible without a Supabase session or a live Resend key.
- 📌 Known issue (pre-existing, untouched): `public.routes.test.ts` "truncates an overlong note
  to 500 characters" is flaky in a full parallel run — it lets a real fetch reach
  api.resend.com. Green in isolation and on a rerun.

## Customer View + customer logs + nameless customers + address search off (2026-08-01, later)
Branch `feat/customer-view-and-logs`. Six commits, one per plan task.
- ✅ `apps/web/src/components/AddressAutocomplete.tsx`: `ADDRESS_SEARCH_ENABLED = false`. The
  effect returns early (no debounce, no `AbortController`, no Photon request) and the plain
  input returns AFTER every hook — an early return above `useState` breaks the rules of hooks.
  `lib/addressSearch.ts` and all three call sites untouched; re-enabling is one line.
- ✅ Migration `20260801000030_customer_view_logs.sql` **APPLIED** to `lgbxxlwsdeuhdgzrjjen`
  and confirmed via `information_schema`: `order_logs.source` (`text not null default 'staff'`,
  check `in ('staff','customer')`) and `orders.customer_viewed_at` (nullable timestamptz).
  ⚠️ `.gitignore` covers `supabase/`, so the migration FILE is on disk but not committed.
- ✅ `logOrderEvent` in `routes/orders.ts` and `routes/appointments.ts` takes an optional 4th
  `source` defaulting to `'staff'` — all 22 existing call sites unchanged. `routes/public.ts`
  has its own copy hard-coding `'customer'`.
- ✅ `POST /public/estimate/:token/view`: first open only (guarded by `customer_viewed_at`),
  no-op for drafts, always 200 for a real token, 404 only for a bad/unknown one.
- ✅ `routes/public.ts` now logs the customer's confirm, cancellation request and withdrawal —
  it wrote NO logs before this. The free-text cancellation note is deliberately not
  interpolated into the trail message.
- ✅ `CustomerView` pings once per device (preview check + `useRef` + `localStorage`), so the
  `/public` 5 req/min budget was NOT changed.
- ✅ `OrderLog.source` is optional in the web type (web-ahead-of-Worker safety); customer rows
  get `bg-info-tint`, and `rounded-md px-2 py-1` is on every row so alignment never shifts.
- ✅ `POST /api/orders/:id/public-token` mints or reuses the token; idempotent, no status
  change, no email, one staff log on first mint only.
- ✅ Customer View button in `OrderDetail`'s `headerActions`; the new tab is opened
  synchronously before the await to survive popup blockers.
- ✅ Preview mode (`?preview=1`): renders drafts, disables Confirm + both cancellation
  controls, skips the ping, shows a banner. `expired` still shows the expiry card.
- ✅ `CancellationRequest` gained `disabled`, separate from `busy` (which rewrites labels).
- ✅ Customer names optional: `routes/customers.ts` drops both `.min(1)`, `createSchema` gains
  an at-least-one-of name/email/phone refine. **No migration needed** — the columns were
  already `not null` with no length floor. UPDATE schema left unrefined on purpose.
- ✅ `firstZodIssue` in that file returns refinement messages verbatim (empty `issue.path`
  would otherwise render `payload: Enter a name…`).
- ✅ Twin `lib/customerName.ts` on both sides. 18 web display sites + 8 Worker sites routed
  through it. `CalendarEvent.customer` widened to carry email/phone so a phone-only customer
  is identifiable on a calendar chip.
- ✅ `TermsSection` in `CustomerView`: terms are COLLAPSED ENTIRELY behind a chevron
  disclosure, closed by default — chevron + heading is the button, body is a `hidden`-toggled
  `<p>`. Chevron and `rotate-90` copied from `LineItemRow` so both disclosures on the page
  match. A first attempt clamped to 5 lines instead; replaced same day because a few lines of
  legal text are no more useful than none and still cost the space being reclaimed. All
  measurement code (`ResizeObserver`, `useLayoutEffect`, `line-clamp-5`) is gone with it.
- ✅ Verification (real runs, 2026-08-01): api `tsc --noEmit` clean + vitest **158/158**;
  web `tsc -b --noEmit` clean + vitest **78/78**; oxlint = the 4 pre-existing
  `LineItemEditor.tsx` warnings, none new.
- ✅ The terms disclosure WAS driven in a real browser — `/customer/:token` is the one
  customer-facing route not behind `ProtectedRoute`. Closed by default (body `offsetHeight`
  0) → open 2718px, chevron rotated → closed again; section 76px vs 2802px. No console
  errors. Done with `?preview=1` against a future-expiry order, so nothing was written to
  production.
- ℹ️ Note for future browser work in this environment: the Browser pane does not composite
  (`document.visibilityState === 'hidden'`, `requestAnimationFrame` never fires), so
  `ResizeObserver` / rAF-driven callbacks never dispatch and screenshots fail. Synchronous
  layout reads and click handlers work fine. This is what made the earlier clamp's
  measurement path unverifiable.
- ⬜ **Nothing exercised in the running app** — every staff route is behind `ProtectedRoute`
  and no Supabase session was available. Owed: Customer View click-through (draft + sent),
  the blue log row on screen, creating a phone-only customer, and confirming the address
  field makes no `photon.komoot.io` request.
- ⬜ Neither Worker deployed. `wrangler deploy` pending for `blinds-nisa-api` and
  `measure-blinds`. Migration 30 is already live, so deploying the Worker is safe to do now.
- ⬜ `orders.customer_viewed_at` is written but never displayed anywhere.

## Customer tracker: "Awaiting Payment" step + 50% deposit quoted (2026-08-01)
- ✅ `apps/web/src/pages/customer-view/OrderProgress.tsx`: five steps
  (`Confirmed → Awaiting Payment → In Production → Ready → Installed`). "Confirmed" carries
  an empty `match` — it is an event, never a live status — so it always renders done;
  unknown-status fallback moved to index 1 so that step is never the current one.
- ✅ `apps/api/src/routes/public.ts`: `GET /public/estimate/:token` serves `deposit_due`
  (`round2(total / 2)`). Server-computed per rule 1. **Must stay in step with the identical
  50% test in `lib/etransferMatch.ts`**, or the quoted amount stops auto-matching.
- ✅ `apps/web/src/components/PaymentSection.tsx`: optional `depositDue` prop renders
  "Deposit due now (50% of total)" above the recipient address; without it the component is
  unchanged. `CustomerView` passes it only while `awaiting_payment` and `amount_paid === 0`.
- ✅ `deposit_due` is optional in the web type, so a web deploy ahead of the Worker degrades
  to no deposit block rather than `$NaN`.
- ✅ The one-time "Order confirmed!" banner is REMOVED and the payment block moved into its
  slot (under the header, above the tracker). `justConfirmed` state deleted; `handleConfirm`
  treats 200 and 409 the same and just reloads. "Paid in full — thank you!" stays under the
  totals block.
- ✅ Payment block is amber: `warning` / `warning-tint` tokens on the card, the `⚠ HOW TO PAY`
  heading, the deposit amount and the hairlines. Unconditional — the section only exists
  while money is owed. Not `danger`/red, which the system reserves for expired / overdue /
  destructive.
- ✅ Verification (real runs, 2026-08-01): api `tsc --noEmit` clean, api vitest **125/125**
  (new rounding case: 113 → 56.50, 113.55 → 56.78); web `tsc -b --noEmit` clean, web vitest
  **69/69**, oxlint at the 4 pre-existing `LineItemEditor.tsx` warnings.
- ⬜ Not done: on-screen check of the 5-step row at 375px.

## Label hardware row as shop codes (2026-07-30, later)
- ✅ `apps/web/src/lib/labels.ts`: `LabelFields.hardware` replaces the `cassette` /
  `bottomRail` / `control` name fields with one captioned line —
  `Cassette: R · Bottom Rail: P · Control: MB`. Codes come from three ordered pattern tables
  matched against the SNAPSHOTTED catalog name, so renaming an option never rewrites an old
  label. Missing part = its whole segment dropped; unmapped name = first letter uppercased.
- ✅ Cassette `R`/`W`/`S` and `-` for No Cassette; bottom rail `R`/`P`; control Chain `R`,
  Cordless `C`, Safety-Wand `SW`, Motorized (Bluetooth) `MB`, Motorized (Non-Bluetooth) `M`.
  The non-Bluetooth pattern sits ABOVE the Bluetooth one — its name contains the word.
- ✅ `OrderLabels.tsx` renders `fields.hardware` and no longer joins the parts itself.
- ✅ Verification (real runs, 2026-07-30): web `npx tsc -b --noEmit` clean; vitest **61/61**
  (5 files); oxlint exactly the 4 pre-existing `LineItemEditor.tsx` warnings.
- ✅ `supabase/migrations/20260730000029_control_option_cordless.sql` (Cordless control, price
  0, sorted last, idempotent by name) APPLIED to `lgbxxlwsdeuhdgzrjjen` on 2026-07-30; the
  option is active and appears in the blind popup + bulk-edit Control selects as-is.

## Bottom rail option — priced per metre of width (2026-07-29)
- ✅ Migration `supabase/migrations/20260729000028_bottom_rail_options.sql`: the
  `bottom_rail_options` catalog (`price_per_m numeric(10,2) not null check (price_per_m >= 0)`,
  mirroring `cassette_options`), seeded `Regular` and `Pear` at 0; three `line_items` snapshot
  columns (`bottom_rail_id` / `bottom_rail_name` / `bottom_rail_price_per_m`); a backfill of
  every existing `item_type = 'blind'` row to Regular; and a rebuild of
  `update_order_with_items()` carrying the new columns in BOTH the insert list and the
  `jsonb_to_recordset` signature.
- ✅ Seeded at 0 on purpose — pricing is recomputed server-side on save, so a non-zero seed
  would silently raise the total of every existing order the moment it was re-saved.
- ✅ Historical blind rows backfilled to Regular on purpose — `bottom_rail_id` is required by
  the API, so without the backfill every historical order would be unsavable.
- ✅ `bottomRailCost(widthCm, pricePerM)` on `BaseBlindCalculator` in BOTH twins:
  `(width / 100) * price_per_m` on the post-`applyWidthMinimum` width, its own hook rather than
  part of `cassetteCost`. All ten blind-type subclasses inherit it unmodified.
  `bottom_rail_price_per_m` is REQUIRED on `BlindPricingInputs`.
- ✅ `GET|POST /api/settings/bottom-rail-options` + `PUT|DELETE /:id` via the catalog route
  factory; `bottom_rail_id` required on `blindItemSchema`; name + price snapshotted in
  `resolveLineItems`, with non-blind rows carrying all three keys as explicit `null`.
- ✅ Surfaces: `Bottom rail:` on the estimate PDF between Cassette and Control;
  `bottom_rail_name` (NAME ONLY) on the sanitized `/public/estimate/:token` payload and the
  customer view; a twelfth `Bottom rail` column on Order Overview; `Cassette · Bottom rail ·
  Control` on the production label.
- ✅ Web: `BottomRailOption` type, the three `LineItem` fields, `BlindItemInput.bottom_rail_id`,
  the `CatalogPath` member, a `/settings/bottom-rail` CRUD page, and a fourth `OptionSelect` in
  the blind editor (live price preview, bulk edit, `Regular` default on new blinds).
- ✅ Verification (real runs, 2026-07-29): api `tsc --noEmit` clean + vitest **124/124**
  (6 files); web `npx tsc -b --noEmit` clean + vitest **60/60** (5 files) + oxlint exactly the 4
  pre-existing `LineItemEditor.tsx` warnings. The `BlindPricingInputs`-onward api/web twin
  `diff` printed nothing.
- ✅ **`20260729000028_bottom_rail_options.sql` applied** to project `lgbxxlwsdeuhdgzrjjen`,
  run manually by the maintainer on 2026-07-30. Order saves no longer 400 on the missing table.
- ⬜ **Both rails are priced 0.** The rail costs nothing until someone sets a price in Settings
  → Bottom Rail Options. Orders already saved keep their stored totals; only orders saved after
  the price change include it.
- ⬜ **Label truncation is untested on paper.** The cassette / bottom rail / control row is
  `truncate`d at 10pt on 3in stock, about 40 characters. Three long catalog names will clip the
  control. If the physical print shows it, give the bottom rail its own row — there is vertical
  slack — rather than shrinking the type.
- ⬜ **The blind form is now four selects wide** (`sm:grid-cols-2 lg:grid-cols-4`). Unverified on
  a real tablet in portrait; check it on the field device.
- ⬜ Pre-existing, untouched: `apps/web` still has no `check` script (§9's `pnpm check` silently
  does nothing there); `.gitignore:15` still ignores `supabase/`, so migrations need
  `git add -f`.
- ⬜ Nothing deployed — both Workers still need `wrangler deploy`. The migration prerequisite is
  cleared: `20260729000028_bottom_rail_options.sql` was applied manually on 2026-07-30.

## Production label printing (2026-07-28, browser-only)
- ✅ Browser-only printing: `apps/web/src/pages/orders/OrderLabels.tsx` at `/orders/:id/labels`
  renders one 3x1.5in label per unit of blind quantity and prints via `window.print()` to a
  Windows-installed Bluetooth printer on the shop PC. Scoped `@page { size: 3in 1.5in; margin: 0
  }`, one checkbox selection (per-label reprint), single Print button.
- ✅ `apps/web/src/lib/labels.ts` — single implementation, `buildLabels(order)` expands blind
  line items into `LabelFields[]`, numbered across the whole order before filtering; 9 tests.
- ✅ The queued print-agent path (TSPL renderer, `print_jobs` migration, API enqueue/agent
  endpoints, `apps/print-agent` workspace) was REMOVED at the owner's request in favour of this
  browser-only path — see `docs/superpowers/specs/2026-07-28-label-printing-design.md` update
  note. The unapplied migration was deleted outright (never reached the live database, so there
  was no drift to reverse).
- ✅ Verification after removal: api `tsc --noEmit` clean + vitest 116/116 (6 files); web `npx
  tsc -b --noEmit` clean + vitest 56/56 (5 files) + oxlint exactly the 4 pre-existing
  `LineItemEditor.tsx` warnings (none from this feature).
- ⬜ The label layout has never been exercised on physical hardware — no test can confirm a
  label is legible.
- ⬜ The labels (`OrderLabels.tsx`) sit inside a `flex flex-col` container relying on
  `print:break-after-page` — forced page-break behaviour inside flex containers has historically
  been unreliable in Chrome. If it does not fire, a multi-label order prints as one long
  overflowing page instead of separate labels, so the first physical test print MUST be a
  THREE-label order, not a one-label order (only a multi-label order can reveal this failure).
  Also watch whether the last label emits a trailing blank page, wasting one die-cut label per
  batch.
- ⬜ Nothing deployed — both Workers (`blinds-nisa-api`, `measure-blinds`) still need `wrangler
  deploy`.

## Recalculable aluminium bar length — Manufacturer Copy (2026-07-25)
- ✅ `buildManufacturingPlan(items, widths, aluminumStockCm = ALUMINUM_STOCK_CM)` — the
  third param reaches `planAluminumCuts` AND the oversize warning text, so a warning can no
  longer quote 600 while packing something else.
- ✅ `resolveAluminumStockCm()` exported as the single blank/NaN/0/negative/Infinity → 600
  fallback, shared by the planner and the page.
- ✅ `AluminumGroup.stockCm` so the bar-length label survives an empty `bars` array.
- ✅ `AluminumStockField` on `ManufacturerCopy.tsx`: numbers-only `inputMode="decimal"`
  input + `numericOnly()` sanitizer, live re-pack, Reset shown only while overridden,
  explicit unusable-length notice, `print:hidden`.
- ✅ The three hardcoded "6 m" strings in the JSX replaced by `barLength()` (600 → "6 m",
  550 → "5.5 m"); meta line flags a custom length so the printout is unambiguous.
- ✅ Override is view-only page state — never persisted, never sent to the API.
- ✅ Fabric planning provably unaffected (test compares `fabricGroups` across bar lengths).
- ✅ Verification: web `tsc -b` clean, vitest **47/47** (manufacturing.test.ts 12 → 20, +8),
  oxlint clean besides the 4 pre-existing `LineItemEditor` warnings, web build OK.
- ⬜ **Not verified in a browser** — no test covers the field on screen or the print layout.
- ⬜ Not deployed — `wrangler deploy` for `measure-blinds` pending.

## Responsive emails + email-theme.ts split (2026-07-21)
- ✅ Fixed a pre-existing breakage first: `ef0f441` had created `email-theme.ts` without
  deleting the originals from `email.ts` — 19 tsc errors on a clean tree (`a3096d6`).
- ✅ `apps/api/src/lib/email-theme.ts` (344 lines) owns the presentation layer; `email.ts`
  (610 lines) owns `sendEmail` + the 13 templates. Both under the 800-line limit.
  Re-exports keep all four importing modules untouched.
- ✅ `EMAIL_HEAD`: charset, viewport, `x-apple-disable-message-reformatting`, and one
  `@media (max-width:600px)` block. Applied to customer AND internal shells.
- ✅ Structural fixes (do not depend on `<style>` surviving): fluid card with
  `max-width:640px` + MSO ghost table for Outlook desktop; review CTA capped instead of a
  hard 280px that overflowed the card; `buttonPairHtml` stacks on all viewports; summary
  rows table `width="100%"`.
- ✅ Media-query refinements only: gutters 40→20px, card padding, 49px tap targets,
  heading and confidentiality-note sizing, detail rows stacking.
- ✅ `plainShell` for the 4 internal notices — meta tags + de-duplication, appearance
  unchanged by design and asserted by test.
- ✅ 13-builder table-driven invariant suite; a new template that skips the shell fails.
- ✅ Verification: api tsc clean + vitest **181/181** (email.test.ts 20 → 85, +65).
- ⬜ **Rendering unverified** — tests assert markup, not appearance. Needs a live Resend
  send to a real phone across Gmail / iOS Mail / Outlook.
- ⬜ Not deployed — `wrangler deploy` for `blinds-nisa-api` pending.

## Public order summary + cancellation requests + e-Transfer details (2026-07-21)
- ✅ Migration 27 `orders.cancel_requested_at` + `cancel_request_note`,
  `company_settings.etransfer_email` + `etransfer_instructions` (all defaulted, no
  backfill needed).
- ✅ Public API: `GET /estimate/:token` now returns server-computed `amount_paid` /
  `balance` (payments embed added purely to compute them — no payment row ever leaves the
  Worker), `cancel_requested_at`, and the e-Transfer fields.
  `POST /estimate/:token/cancel-request { note? }` + `/cancel-withdraw`, both guarded and
  rate-limited, with best-effort staff notification on each.
- ✅ Staff API: `POST /:id/cancel-request/resolve { accept, message? }` — accept reverses
  the confirmation (unconfirm rules unchanged, no email); deny emails the customer
  email-then-persist (502 keeps the request open), and a customer with no email is
  resolved without a send.
- ✅ `buildCancellationDeniedHtml` (customer, branded design system) and
  `buildCancellationNoticeHtml` (internal, plain), both fully escaped.
- ✅ Web customer page: permanent summary + `OrderProgress.tsx` 4-step tracker +
  `CancellationRequest.tsx` + rewritten `PaymentSection.tsx`; the post-confirm dead-end
  card is gone. Additive split only — no existing logic relocated.
- ✅ Web staff page: red cancellation banner above the Progress card with Confirm/Deny
  (Deny opens a message sheet); `useResolveCancelRequest()`.
- ✅ Settings: e-Transfer email + instructions; the hardcoded `blindsnisa@gmail.com` is
  gone from the codebase.
- ✅ Verification: api tsc + vitest 114/114 (+24 tests), web tsc + vitest 40/40 + oxlint
  clean.
- ⬜ Migration 27 NOT yet applied to live `lgbxxlwsdeuhdgzrjjen` — apply before deploying.
- ⬜ Denial email not yet exercised against live Resend.
- ⬜ Customer page not yet checked on a physical phone.

## "Mark as sent" split from "Send estimate" (2026-07-21)
- ✅ `POST /api/orders/:id/mark-sent` — status-only `draft → sent`, no email, no customer
  email address required, no `public_token`/`terms_snapshot` write; keeps the lapsed-
  expiry 400 and logs "Marked as sent (no email).".
- ✅ Web `useMarkSent()`; the Progress-timeline advance arrow for *Sent* now uses it, so
  `useSendOrder` has exactly one call site (top-bar Send → `handleSendEstimate`).
- ✅ 4 route tests intercept Resend and assert zero email calls (happy path + 409/400/404
  guards). api vitest 90/90, web 40/40, both tsc clean, oxlint clean for touched files.
- ⬜ Not yet clicked through in the live UI.

## Payment receipt emails (2026-07-21)
- ✅ Migration 26 `payments.receipt_sent_at timestamptz` (nullable, no backfill) —
  applied live to `lgbxxlwsdeuhdgzrjjen`.
- ✅ `POST /api/orders/:id/payments/:paymentId/receipt` `{ message? }`: server-side
  paid-to-date/balance, public_token reuse-or-mint, email-then-persist (502 on Resend
  failure leaves the row untouched), activity log, refreshed detail response.
- ✅ `buildReceiptEmailHtml` in the "Customer Emails" design system — Payment/Received/
  Order total/Paid to date rows; "Balance remaining" or accent "Paid in full".
- ✅ Web: per-row envelope action + "✓ Receipt sent" indicator + Send/Resend sheet
  (`useSendReceipt()`); no-email customers blocked with a toast.
- ✅ Verification: api tsc + vitest 81/81, web tsc + vitest 40/40 + oxlint clean.
- ✅ Incidental: resolved committed conflict markers in `pdf.test.ts`; de-time-bombed
  the `/send` 502 fixture (relative expiry). Follow-up flagged: restore the dropped
  PDF color-line tests against the real attr ordering.
- ⬜ Not yet exercised end-to-end against live Resend from the UI.

## Mobile alignment pass on the order page (2026-07-21)
- ✅ Header, body and mobile sticky action bar share one container + 16px gutter
  (`PageHeader` row constrained to `mx-auto w-full max-w-lg px-4`; back chevron `-ml-2.5`).
- ✅ Horizontal page overflow removed: top-bar `StatusBadge` hidden below `sm:`, Progress
  timeline switched from flex to `minmax(0,1fr)` grid tracks, `overflow-x-clip` backstop,
  `min-w-0`/`truncate`/`break-words` on unbounded rows.
- ✅ "Record Payment" now lives in the Payments panel body; removed from `stageActions()`
  (sticky bar + desktop rail). Ledger display unchanged.
- ✅ Card outlines darkened (`--color-border` `#d4d4d8`); inner dividers on the light token.
- ✅ web `tsc --noEmit`, vitest 40/40, oxlint — all clean.
- ⬜ Not checked on a physical phone yet (incl. a 320px-wide screen).

## Order Overview page (new tab) + compact mobile action bar (2026-07-20)
- ✅ "Order Overview" action on every post-draft stage of `OrderDetail.tsx` — opens the new
  page `/orders/:id/overview` in a new tab (`OrderOverview.tsx`, lazy + guarded route in
  `App.tsx`): read-only, print-friendly TABLE view from the server row — one table per
  blind type (one column per field: Room/Width/Height/Material/Colour/Cassette/Control/
  Qty/Unit/Total/Note; `max-w-6xl` container), an "Other Items" table for preset/custom
  lines, per-group count + subtotal,
  horizontal scroll on phones, + a totals card (subtotal/discount/tax/total, Paid & Balance
  when payments exist).
- ✅ Mobile sticky action bar refactored to a max of 3 button rows: data-driven
  `stageActions()` (`StageAction` descriptors with full + short labels); primary action
  alone full-width, all other actions as compact h-10 inline buttons ≤3 per row.
- ✅ Save/Send/Download moved to the TOP BAR (`headerActions` in `PageHeader.right`, next
  to the StatusBadge): Save green `bg-success`, Send blue `bg-brand-600`, Download gray
  bordered secondary; h-9, icon-only on phones (labels from sm:), same enable rules.
  Removed from the panels/rail; draft primary is now Confirm; unsaved orders have no panel
  actions (rail footer hidden). Mobile bar worst case now 2 rows.
- ✅ Verified on the dev machine: web `tsc --noEmit` clean, vitest 40/40 passed, oxlint
  0 warnings in OrderDetail.tsx (fixed its pre-existing `no-unused-expressions` warning;
  LineItemEditor fast-refresh warnings pre-date this and remain).
- Single-file UI change — no API, migration, or pricing/totals impact.

## Manufacturer Copy (cut sheet) + Material fabric width (2026-07-13)
- ✅ New pure planner `apps/web/src/lib/manufacturing.ts` + `manufacturing.test.ts`: aluminium
  FFD bin-packing into 6 m bars (per blind type); fabric FFDH full-width shelf packing at the
  roll width (default 3 m); `buildManufacturingPlan` splits aluminium / fabric / order-as-is
  and emits utilisation stats + warnings. Runtime-verified (worked example passed).
- ✅ `materials.width_cm` — migration 24 (nullable, `>0`), `Material` type, `settings.ts`
  schema, `MaterialsForType.tsx` add/edit inputs + optional 3rd CSV column + list display.
  Manufacturing input only; NO pricing effect; read live (not snapshotted).
- ✅ Fabric grouping by fabric code = material + colour (`material_id|color`): same material,
  different colour ⇒ separate rolls; +2 tests. Runtime-verified via Node port.
- ✅ `ManufacturerCopy.tsx` page + guarded lazy route `/orders/:id/manufacturer`;
  "See Manufacturer Copy" button in the `in_progress` action branch of `OrderDetail.tsx`
  (opens a new tab); print-friendly.
- ✅ Cut-done milestone — migration 25 (`orders.cut_done_at`), REVERSIBLE toggle
  `POST /:id/cut-done` `{ done: boolean }` (confirmed-only; on keeps original date, off clears)
  + 6 route tests, `useSetCutDone`, `role="switch"` footer control on the Manufacturer page
  (shows "Cuts completed on <date>" when on, persists on re-entry).
- ⏳ Dev machine: APPLY migrations 24 + 25 to live `lgbxxlwsdeuhdgzrjjen`, then `pnpm check`,
  `pnpm test`, `pnpm lint` (web + api) and `pnpm --filter web build`. Sandbox mount served
  byte-stub node_modules AND pnpm store — full suites could not run here.

## Material rename + per-type Materials + calculator hierarchy (2026-07-12)
- ✅ DB migrations 19–21 APPLIED live (`lgbxxlwsdeuhdgzrjjen`): `fabrics → materials` rename
  (table, `line_items.material_*`, FK, trigger, `update_order_with_items` RPC rebuilt);
  `material_blind_types` many-to-many join (RLS on); canonical ten blind types seeded.
- ✅ Calculator hierarchy (api ⇄ web twins): `BaseBlindCalculator` + 10 per-type subclasses
  (each inherits the default for now; Honeycomb/Shutter/Curtains flagged to override later)
  + registry (`getCalculator`/`normalizeBlindType`) + barrel; `pricing.ts` is now a façade
  exposing `calculateBlindUnitPrice` (default) and `calculateBlindUnitPriceForType` (dispatch).
- ✅ "Fabric" → "Material" across API (orders/settings/public/pdf + tests) and web (types,
  hooks, LineItemEditor, OrderDetail, CustomerView, new `Materials.tsx`, routing, CatalogEditor).
- ✅ Per-type Material lists: Materials settings page multi-selects blind types;
  `materialsForType()` filters the editor dropdown (unlinked Material = all types).
- ✅ Verified in-sandbox: calculators + pricing runtime-execute correctly + strict `tsc`
  clean in isolation; new registry/dispatch tests added on both sides.
- ⏳ Dev machine: `pnpm --filter api test`, `pnpm --filter web test`, both `tsc --noEmit`,
  `pnpm --filter web build`, then `wrangler deploy` both Workers. (Sandbox mount served
  truncated file copies — could not run the full suites; Read/Edit confirmed files intact.)

## Security-review hardening (2026-07-07)
- ✅ CORS origin check hardened (no more `includes('localhost')` look-alike bypass)
- ✅ Payment idempotency (`payments.client_key` UNIQUE) + overpay guard (409 OVERPAY +
  "This amount will exceed total balance." confirm pop-up with `allow_overpay` consent)
- ✅ PUT /:id keeps the stored order_date when omitted (no silent re-dating)
- ✅ Atomic order edits via `update_order_with_items` RPC (migration 18, applied live)
- ✅ Business-timezone dates (`lib/dates.ts`, America/Toronto) for expiry/cron/defaults
- ✅ `order_logs.actor_email` + Activity Log attribution UI
- ✅ Order deletion restricted to draft/expired (API 409 + hidden button)
- ✅ New route tests: payments overpay (3), delete guard (4); AI_GUIDELINES.md rewritten
- ⏳ Dev machine: run api/web `tsc --noEmit` + `vitest`, then `wrangler deploy` both Workers
- ⏳ User: confirm Supabase signups disabled, enable leaked-password protection, rotate
  `ETRANSFER_WEBHOOK_SECRET`

## What Works
- ✅ Full auth flow: login → JWT → JWKS-verified Worker calls; protected routes
- ✅ Settings module: company info + logo upload (Storage), all four catalogs, T&C autosave
- ✅ Customers: debounced search, create/edit, billing/shipping toggle, soft delete
- ✅ App shell: dashboard, bottom nav, layout, skeletons, empty states, Inter font
- ✅ Estimates: editor with live per-keystroke pricing, panel splitting, date pickers with
  expiry auto-follow, preset/custom items, discount before 13% HST, sticky action bar;
  list with Waiting/Confirmed/Expired tabs + search
- ✅ Server-authoritative pricing: Worker fetches catalog prices itself, snapshots them,
  recomputes all money; client prices rejected (strict schemas); order numbers unique with
  retry-on-conflict
- ✅ PDF generation (pdf-lib, §10 layout — @react-pdf can't run on Workers) + download endpoint
- ✅ Email flow code: branded templates, HTML-escaped, send-only-then-persist ordering,
  token reuse on resend (LIVE sending pending a real Resend API key)
- ✅ Public customer flow: token view, confirm-exactly-once, deposit screen, rate limiting
- ✅ Expiry automation: daily cron + defensive per-read checks
- ✅ Code-split bundle (public page ~8 kB chunk), security audit clean
- ✅ Tests: 25 web + 28 api unit/integration tests, 7 live DB constraint tests,
  `scripts/e2e.mjs` live E2E runner

## Address autocomplete + appointment details/list (2026-07-11)
- ✅ Address autocomplete: `lib/addressSearch.ts` (Photon/OSM, key-less, Canada-only,
  Ontario-biased) + `components/AddressAutocomplete.tsx` (debounced, keyboard-navigable,
  abortable) wired into `CustomerForm.tsx` (shipping + billing) and `CustomerCreateModal.tsx`,
  so all three new-customer entry paths auto-fill the address block on select.
- ✅ Appointment details: `GET /api/appointments/:id` + `useAppointment` +
  `pages/calendar/AppointmentDetail.tsx` (`/appointments/:id`); customer address is a Google
  Maps search link. Calendar chips (`EventChip`, both kinds now) and section rows
  (`ScheduleSections`) navigate here.
- ✅ See All list: `GET /api/appointments` (paginated 20/page, `?kind=` filter, newest-first,
  `count:'exact'`) + `useAppointmentsList` + `pages/calendar/AppointmentsList.tsx`
  (`/appointments`, filter chips + bottom pagination); "See All" button on the calendar header.
- ⚠️ Full `pnpm check`/`test`/`lint` deferred to the dev machine (sandbox limitation); 4 new
  web files passed an isolated transpile syntax check.

## What's Left (needs the user / real accounts)
- [ ] Resend: create account, verify domain, put real `RESEND_API_KEY` (+ optional
  `RESEND_FROM`) in `.dev.vars` / wrangler secrets — then live-test the send flow
- [ ] Run `node scripts/e2e.mjs` locally (sandbox egress can't reach supabase.co)
- [ ] Physical device pass: iOS Safari + Android Chrome (date pickers, keyboards) —
  automated checks can't replace hands-on-device verification
- [ ] Deployment: wrangler deploy + Cloudflare Pages + lock CORS to the final domain
- [ ] Weekly backup routine (documented in README)

## Calendar feature (2026-07-06)
- ✅ API: `GET /api/orders/calendar?from=&to=` — lightweight events for the monthly grid,
  filtered to active install statuses (`proposed`/`confirmed`/`change_requested`);
  registered before `GET /:id` (route-ordering requirement, regression-tested)
- ✅ API tests: fake DB builder extended with `gte`/`lte`; new calendar describe block
  (route-ordering regression, range/status shape, empty range, 2× 400 cases)
- ✅ Web: `CalendarEvent` type, `useCalendarEvents` hook (direct-import, not barreled),
  `pages/calendar/` (`MonthGrid`, `EventChip`, `InstallProposalWizard`, `CalendarPage`)
- ✅ Nav: Calendar added as a 5th Sidebar item + 5th BottomNav tab; `/calendar` route
- ✅ Wizard reuses the EXISTING emailing `useProposeInstallation` — no quiet endpoint
- ⏳ Not run in the Cowork sandbox: api/web `tsc --noEmit`, `vitest`, `pnpm --filter web
  build` — the sandbox's mounted view of the repo was stale during this session (see
  activeContext.md "Important Learnings"). Run on the dev machine before shipping.

## Order model refactor + installation scheduling (2026-07-04)
- ✅ Estimates → Orders rename across DB (migrations 11+12), API (`/api/orders`), and web
- ✅ Lifecycle draft→sent→awaiting_payment→in_progress→ready→installed (+expired)
  (status `completed` renamed to `ready`, terminal `installed` added — migration 13)
- ✅ User-only reversible confirmations (`/unconfirm`); customer confirm → awaiting_payment
- ✅ Payments ledger + derived balance; PDF flips Estimate→Invoice on first payment
- ✅ Installation scheduling: propose time (email w/ 1-hour window) → customer confirm/request
  on the public page; `/ready`, `/installed`, `/install/propose` + public install endpoints
- ✅ Web: Order list tabs (Ready/Installed), Order detail actions + Payments/Installation
  panels + payment & propose sheets; CustomerView installation confirm/request
- ✅ Migrations 11+12+13 APPLIED to the live project `lgbxxlwsdeuhdgzrjjen`
- ✅ **Line items UI overhaul**: Switched to a compact summary table with edit/delete actions, bulk edit (fabric, cassette, control), and bulk delete functionality via bottom sheet popups.
- ✅ **Order status advance**: Added one-step forward progression tick icons on the Progress timeline.
- ✅ **Delete payment**: Added `/api/orders/:id/payments/:paymentId` endpoint with `in_progress → awaiting_payment` auto-revert.
- ⏳ Run api/web tsc + vitest on the dev machine (sandbox couldn't execute them)

## Current Status
ALL 10 PHASES CODE-COMPLETE as of 2026-07-03. Verified: api tsc clean + 28 tests pass,
web tsc/build clean + 25 tests pass, Worker dry-run bundles (825 KiB gzip), live DB
constraints verified via Supabase MCP, security checklist pass. The 2026-07-04 Order
refactor is code-complete but pending live migration + a local test run.

## Known Issues
- Live email sending untested (placeholder Resend key) — code paths unit/integration tested
- Supabase advisor `rls_policy_always_true` warnings — ACCEPTED single-org design
- `IMPLEMENTATION.md` referenced by the plan is missing from the repo

## Project Decision Evolution
| Date | Decision | Context |
|------|----------|---------|
| 2026-06-27 | Tailwind CSS v4 | New `@tailwindcss/vite` plugin, no PostCSS config |
| 2026-06-27 | SPDX adapted | Headers say "Blinds Nisa" not "Aeon Engine" |
| 2026-06-27 | `jose` for JWT | Edge-compatible JWKS verification |
| 2026-07-03 | Wrangler 4 + Node 22 | Wrangler 4 requires Node 22; Node 20 EOL Apr 2026 |
| 2026-07-03 | Vitest on money math | Both web and api sides pinned by mirrored suites |
| 2026-07-03 | UNIQUE order_number + retry | Count-based generation can race |
| 2026-07-03 | No anon RLS on estimates | Public reads only via Worker; no enumeration |
| 2026-07-03 | Send-then-persist email flow | Failed send leaves the estimate untouched |
| 2026-07-03 | Server-only pricing | Client sends measurements + option ids; `.strict()` schemas |
| 2026-07-03 | createElement PDF (no JSX) | Keeps plan's `pdf.ts` filename, no build change |
| 2026-07-03 | React.lazy route splitting | Public page loads ~8 kB instead of the whole app |
| 2026-07-29 | Activity log capped at 10 rows | Client-side slice + Show more toggle; API keeps its 200-row newest-first contract |
| 2026-07-31 | Soft dashboard UI redesign | `@theme` retokenized (Plus Jakarta Sans, blue `#2563EB`, 16px cards); new `components/ui/` primitive layer; hue encodes state via `lib/statusStyles.ts` |
| 2026-07-31 | No `@theme` token name may be deleted | Untouched pages still reference `rounded-sm`, `bg-brand-600`, `border-border`; only values change |
| 2026-07-31 | `installed` vs `ready` told apart by fill | Both emerald; avoids spending a second hue on a meaning already read as "good" |

## UI redesign status — 2026-07-31

**Done** (branch `feat/ui-redesign`, 19 commits): tokens + typeface; `lib/statusStyles.ts`
with 8 tests; the six `components/ui/` primitives; Sidebar / BottomNav / PageHeader / Layout;
Skeleton + EmptyState; orders list (with desktop summary tiles); order detail sections;
customers; calendar; settings (tile grid); CustomerCreateModal onto `Modal`; login; and the
residual-style sweep, which also caught `ManufacturerCopy` and `OrderLabels` (both omitted
from the plan).

**Verified:** web `tsc -b --noEmit` clean, web vitest 69/69, api vitest 124/124, oxlint at
exactly the 4 pre-existing `LineItemEditor.tsx` warnings. Live computed styles confirmed in
the dev server (font applied, 16px cards, two-layer shadow, 10px controls, 44px input
minimum intact).

**Known open:**
1. On-screen layout at 375px and lg+ is NOT yet eyeballed — the automated pass could read
   computed styles but had no composited frame, so overflow and wrapping are unconfirmed.
2. `pages/customer-view/*` inherits tokens but had no layout pass (deliberate).
3. Email templates and PDF output still use indigo `#2A4FCF` — brand colour is now
   inconsistent across channels.
4. `OrderDetail.tsx` still ~2,450 lines; wrapped, not split.

## 2026-08-04 — Estimate/Invoice PDF carries the customer order-page link

**Works:** every order document (emailed estimate, emailed invoice, staff download) prints a
clickable "View your order online" button pointing at `APP_URL/customer/:public_token`. It
sits in the totals column — flush right, 220pt wide, brand blue `#2563eb`.
`GET /orders/:id/pdf` mints and persists a `public_token` when the order lacks one, so a
draft's downloaded PDF links somewhere real.

**Verified:** api `tsc --noEmit` clean, api vitest 196/196 (11 files). Link and alignment
asserted by re-parsing the rendered PDF and reading the `/Link` annotation's URI action and
`/Rect`. Owner confirmed the first pass visually and asked for the alignment/colour change;
the revision itself is unreviewed on screen.

**Known open:**
1. The warranty certificate (`warrantyPdf.ts`) does NOT carry the button; `drawLinkButton`
   and `BRAND` are exported and ready if that is wanted.
2. `BRAND` in `pdf.ts` duplicates the web token `--color-brand-600` by value — there is no
   shared source, so moving one will silently desync the other.
3. Pre-existing: email templates still use indigo `#2A4FCF`, which the PDF button no longer
   matches.

## 2026-08-04: Mobile keyboard in dialogs + line-item row centring

**Works:** the order screen's "+ Add customer" pop-up keeps the software keyboard up.
`Modal` focuses its panel once per open and skips it when a child already has focus; its
Escape/scroll-lock effect no longer re-runs on every render of the opening page. Every
dialog built on `Modal` benefits, not just `CustomerCreateModal`. Line-item rows are
vertically centred at `sm+` (start-aligned on phones, where names wrap).

**Verified:** web `pnpm check` clean, `pnpm test` 88/88, `pnpm lint` = the 4 pre-existing
`LineItemEditor.tsx` fast-refresh warnings.

**Known open:**
1. Neither fix was exercised in a browser or on a real phone — the routes need a Supabase
   session. The keyboard behaviour in particular is owed a check on real iOS.
2. `Modal` still has no focus TRAP; Tab can leave the panel. Out of scope here, unchanged.

## 2026-08-04: Order editor customer/dates cards

**Works:** `/orders/:id` header is two cards. The customer card keeps the searchable
picker as its title row and expands to the full customer record (contact + shipping +
billing) as read-only fields. The dates card below it holds order date, expiry date, the
new expiry-term chips (On receipt / 1 / 3 / 7 / 15 days / 1 month) and the order number.
A selected term keeps expiry pinned to `orderDate + term`; picking a date directly clears
the term. Saved orders still hydrate with their stored expiry.

**Verified:** web `pnpm check` clean, `pnpm test` 94/94 (6 new `expiryTerms` cases),
`pnpm lint` = the 4 pre-existing `LineItemEditor.tsx` fast-refresh warnings.

**Known open:**
1. Not exercised in a browser — `/orders/:id` needs a Supabase session; the dev server
   stops at the login screen. Layout of the chip row on a real phone is unchecked.
2. `OrderDetail.tsx` is still ~2,000 lines despite the extraction.

## 2026-08-04: Terms acceptance on the customer view

**Works:** the public estimate page asks the customer to tick "I have read and agree to the
Terms & Conditions" before `Confirm Estimate` becomes clickable. The tick sits with the
button; its link expands and scrolls to the terms section. Estimates with no terms text
confirm exactly as before, and staff preview leaves both controls inert.

**Verified:** web `pnpm check` clean, `pnpm test` 94/94, `pnpm lint` = the 4 pre-existing
`LineItemEditor.tsx` warnings.

**Known open:**
1. Acceptance is not persisted — UI gate only. No `terms_accepted_at`, no record of WHICH
   terms text was shown. Needs a migration + confirm-route change to become evidence.
2. Not exercised in a browser; the page needs a real capability token and the dev build
   points at the live Worker, so a click-through could confirm a real order.

## 2026-08-04 (revision): customer details render as plain text

**Works:** the expanded customer card shows name / phone / email and an address-label
shipping block, with billing beside it only when `billing_same_as_shipping` is false. No
input boxes, no "same as shipping" sentence — `DetailField` is gone.

**Verified:** web `pnpm check` clean, `pnpm lint` = the 4 pre-existing `LineItemEditor.tsx`
warnings.

## 2026-08-04: Expiry term survives re-opening a saved order

**Works:** `presetFromDates` re-derives the chip from `order_date` + `expiry_date` during
hydration, so re-opening a saved order shows the term it was dated with instead of an empty
chip row. Dates themselves were always persisting correctly — confirmed against the live
rows before changing anything.

**Verified:** web `pnpm check` clean, `pnpm test` 98/98 (4 new cases for the reverse
lookup), `pnpm lint` = the 4 pre-existing warnings.

**Known open:**
1. A hand-picked date that happens to land on a term's offset now shows that term selected,
   which also means moving the order date will move the expiry with it. Intended — the
   dates then genuinely say "15 days after the order date" — but it is a behaviour change
   for orders saved before this.
2. Still not exercised in a browser; `/orders/:id` needs a Supabase session.

## 2026-08-04: Hand-picked expiry dates survive re-opening

**Works:** the company-default expiry no longer runs while a saved order is loading, so a
date chosen in the picker is still there when the order is re-opened from the list. Chips
were never affected — their recompute rule hid the race.

**Verified:** web `pnpm check` clean, `pnpm test` 98/98, `pnpm lint` = the 4 pre-existing
`LineItemEditor.tsx` warnings. The race itself is a mount-timing effect that the unit tests
cannot reach — no browser run, `/orders/:id` needs a Supabase session.
