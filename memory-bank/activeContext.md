# Active Context

## Current Focus — 2026-08-09: Blind types are modules (own inputs, own form, own documents)
Owner request: "different calculation logic usually requires different inputs — more or
less, but the UI should be different… each UI of the blinds adding form can be edited
separately." Branch `refactor/blind-type-modules`, 10 commits. Full detail in
`engine_features.md` 2026-08-09.

- **NOTHING HAS DIVERGED YET, and that is the intended end state of this branch.** All ten
  types still price by the base formula and declare zero attributes, so no price moved and
  no form changed. The machinery is proven by a throwaway subclass in `attributes.test.ts`,
  not by a real blind type. The first divergence needs the owner's actual formula and is a
  two-file change per type: `lib/blindTypes/<type>.ts` (BOTH twins) + `blindForms/<Type>Form.tsx`.
- **Standing hazards a future session must not trip over:**
  1. **The twins.** `apps/{api,web}/src/lib/blindTypes/*` must stay byte-identical below the
     import lines. Verify with `diff <(tail -n +4 api/…) <(tail -n +4 web/…)`; only `base.ts`
     and `registry.ts` legitimately differ, and only in their twin-reference sentences.
  2. **`public.ts` sends `attribute_lines`, never `attributes`.** That route is
     unauthenticated. Replacing the explicit field list with a spread publishes every future
     internal-only field automatically and retroactively.
  3. **Two registries.** `lib/blindTypes` (pricing, no React) and `pages/orders/blindForms`
     (UI). `getBlindForm` keys on the canonical label returned by `getBlindType`, so aliases
     resolve once — do not reintroduce a hand-copied alias list.
  4. **`attributeSchema` is `z.ZodTypeAny`**, not `z.ZodType<BlindAttributes>` — Zod schema
     types are not covariant in their output. Numeric fields need `z.coerce.number()`
     because drafts hold strings.
  5. **`lineItemDrafts.ts` must stay JSX-free.** Moving plain functions back into
     `LineItemEditor.tsx` reintroduces the four `react/only-export-components` warnings and
     breaks Fast Refresh on every form edit.
- **Migration 29 is APPLIED** to `lgbxxlwsdeuhdgzrjjen` (by the maintainer, 2026-08-09).
- **`apps/web` lint is now 0 warnings**, down from the 4 long-standing
  `react/only-export-components` ones — the `lineItemDrafts.ts` split removed them.
- **Verified:** web 116/13, api 214/13, `pnpm check` clean, production build clean. The blind
  popup and the order item rows were both diffed in a signed-in browser against the
  pre-refactor build and are byte-identical (6826 and 2647 chars).
- **Deliberately deferred:** the api ⇄ web twin duplication grew and was NOT addressed; a
  shared workspace package is a separate architectural decision (AI_GUIDELINES §7/§8). The
  mirrored test suites remain the only drift alarm.

## Prior focus — 2026-08-03: Responsive shell rewrite (rail, hamburger, fluid page track)
Owner report: "mobile and tablet views are still broken, ui is not responsive", with a
sketch of the target order screen (collapsible menu | main with a save/edit header |
summary). Full detail in `engine_features.md` and `bug_fixes.md`, both 2026-08-03.
- **`BottomNav.tsx` is DELETED and so is `Layout`'s `nav` prop.** One `Sidebar` now covers
  every width: collapsible rail at `md+`, full-screen overlay below. The old split
  (sidebar at `lg+`, tab bar below, tab bar suppressed by `nav={false}` on all 20
  detail/form routes) is what left tablets — and every detail page — with no navigation
  but a back arrow. This reverses the old "bottom nav preferred over hamburgers" note that
  lived in `BottomNav`'s doc comment; the owner chose the hamburger explicitly.
- **Rail width is `--sidebar-w` and nothing else.** The `Sidebar` `w-[248px]` + `Layout`
  `lg:pl-[248px]` paired measurement is RETIRED — see `systemPatterns.md`. Do not
  reintroduce a literal.
- **`.page-container` is the only page container**, with an overridable `--page-max`.
  Narrow a body with `[--page-max:48rem]`, never with a second `max-w-*` on the same
  element — two max-width utilities resolve by Tailwind's sort order, not written order.
- **On the order screen `lg:` no longer means anything structural** — the summary rail and
  the sticky action bar now switch at `xl` (1280), because the nav rail is a third column
  and 1024px cannot carry all three.
- **The five document actions moved out of `PageHeader` into a wrapping toolbar in the page
  body.** In the header they overflowed from `sm` up and were silently eaten by
  `overflow-x-clip` — Delete was invisible, not visibly broken.
- **`truncate` was the CAUSE of the item-row overflow, not a guard against it.** A truncated
  box still reports its longest unbroken word as its min-content width. `wrap-anywhere` is
  the fix; `break-words` would NOT have been.
- **Verified:** web `tsc` clean, vitest **88/88 (9 files)**, oxlint at the same 4 pre-existing
  `LineItemEditor.tsx` warnings, production build clean. Geometry measured in-browser at
  375/768/1280/1920 in both rail states: `scrollWidth === innerWidth` and header/body edges
  aligned at every one.

- **Order screen is capped at 1000px, not 1600px** — `[--page-max:1000px]` is set on the page
  ROOT so the sticky head, the body grid and the fixed action bar all inherit one track.
  Summary rail narrowed 360px -> 320px and the grid gap 32px -> 24px to suit. Measured at
  1280 and 1600: track exactly 1000px, form + rail 936px, centred in the space the nav rail
  leaves. Setting `--page-max` per-container instead of on the root is how the header and
  body would drift apart again.

### Verified interactively (2026-08-03, later — signed-in session)
`/orders/:id` at 390 / 768 / 1280 / 1600, both rail states: zero page overflow, no element
past the viewport, all `.page-container` tracks identical width AND left edge. Rail toggle
flips `data-rail`, labels, `aria-label` and the `localStorage` key. Phone hamburger opens a
full-viewport `role="dialog"` with all four links, locks body scroll, sets `inert` on the
content column; Escape and a nav click both close it and restore both. Long preset
description wraps to two lines at 390px instead of truncating.

### Next steps / deliberately deferred
1. **Real iOS Safari is still owed** — `dvh`, `visualViewport` and the overlay's safe-area
   inset cannot be exercised in desktop Chrome. Everything else in the list above is now
   confirmed against a live session.
2. **`OrderLabels.tsx` deliberately keeps `max-w-lg`** — it is print-sheet geometry, not a
   responsive page body. Do not migrate it to `.page-container`.
3. **`pages/customer-view/*` still has no layout pass** (unchanged from the 2026-07-31 note).
   It is outside the authenticated shell, so it did not inherit any of this.
4. When measuring rail geometry, force a settled read — `.app-shell-rail`/`.app-shell-main`
   animate width for 200ms and an immediate measurement returns the pre-transition value.

## Prior focus — 2026-08-02 (later): Mobile layout repair on the order screen
Spec `docs/superpowers/specs/2026-08-02-mobile-design-design.md` (note: `docs/` is
gitignored, so the spec is local only). Full detail in `bug_fixes.md` 2026-08-02.
- **Reported on iPhone Safari:** item rows off the right edge with edit/delete unreachable,
  the item popup "too big" with edges off-screen, text boxes zooming on tap, and the bottom
  action bar burying content.
- **The 16px form-control rule in `index.css` is UNLAYERED on purpose.** Tailwind's utilities
  layer beats `@layer base`, so moving it into the base layer silently reverts the zoom fix.
- **Sheets are capped in `dvh`, never `vh`.** iOS resolves `vh` against the large viewport, so
  `90vh` hides a sheet's footer behind the URL toolbar. Eight sheets in `OrderDetail` now share
  the `SHEET_PANEL` constant; `InstallationSection` and `ui/Modal` match it. The hand-rolled
  sheets were NOT migrated onto `ui/Modal` — that stays a separate, deliberate refactor.
- **`useKeyboardOpen()` (new, `hooks/useKeyboardOpen.ts`)** watches `visualViewport` so the
  fixed action bar can slide away while the keyboard is up. 150px threshold, chosen to clear
  Safari's 60–90px toolbar collapse. The bar also publishes `--action-bar-h` via
  `ResizeObserver`, replacing the constant `pb-40` that was wrong at most lifecycle stages.
- **Two hypotheses were measured and DISPROVED** — `<select>` min-content width blowing out
  the popup, and the item row being geometrically too wide. Neither reproduces in Chrome at
  375px or 320px. See `bug_fixes.md` before re-deriving either. Focus zoom is now the leading
  explanation for the unreachable buttons.
- **Verified:** web tsc clean + vitest **74/74 (7 files)**; oxlint at the same 4 pre-existing
  `LineItemEditor.tsx` warnings; 16px controls and zero horizontal overflow confirmed in a
  375px browser.

### Next steps / deliberately deferred
1. **Nothing was checked on a real iPhone.** `/orders/:id` is behind `ProtectedRoute` with no
   Supabase session available, and `dvh` + `visualViewport` cannot be exercised in desktop
   Chrome regardless. Owed: the item rows, the popup, the keyboard-hide, all on iOS Safari.
2. **If the buttons are still unreachable after the zoom fix**, the cause is something the
   agent could not see — capture the page at fault (`document.documentElement.scrollWidth` vs
   `window.innerWidth` on the phone) rather than re-testing the two disproved theories.
3. **`CustomerCreateModal`, `CatalogEditor`, `AppointmentWizard`** inherit the 16px rule but
   got no layout work. A sweep migrating the remaining hand-rolled sheets onto `ui/Modal` is
   worth doing and is out of scope here.

## Current Focus — 2026-08-03: Warranty narrowed to PARTS ONLY
⚠️ **The warranty code is NOT on `main`.** It lives on `feat/customer-view-and-logs` at
`897f97b "warranty cards"`, plus this amendment, made 2026-08-03 in a worktree at
`C:/Users/kemal/AppData/Local/Temp/claude/warranty-wt`. `main` carries the sidebar/mobile work
instead; anyone looking for `lib/warranty*.ts` on main will not find it.

- **Owner's decision: no workmanship cover.** The shop supplies parts and replacements free
  within the stated periods; labour is never covered and the standard service fee applies to
  every visit, including one where the part itself is free.
- Stated three times on the certificate (banner under the coverage summary, first term, and the
  exclusions) and once in the email's fine print — a customer who never opens the PDF must
  still know a call-out costs money. Checklist lines name PARTS, never repairs.
- **No dollar figure for the service fee** anywhere: it is a live price and the certificate must
  not freeze it for ten years. A test enforces that.
- `WARRANTY_TERMS` and `PARTS_ONLY_BANNER` are exported from `lib/warrantyPdf.ts` purely so the
  promise can be regression-tested — rendered PDF bytes are opaque.
- **Verified:** api tsc clean + vitest **192/192 (11 files)** (warrantyPdf 4→8, warrantyEmail
  4→6). Web untouched by this change.

## Prior focus — 2026-08-02: Warranty certificate on paid-in-full
Plan `docs/superpowers/plans/2026-08-01-warranty-document.md`. Full detail in
`engine_features.md` 2026-08-02.
- **Clearing the balance emails a Warranty Certificate PDF.** 10 years on products, 2 years on
  a motorised blind's motor and moving parts. Triggered by the money, not the lifecycle stage
  — the owner chose the paid-in-full date as the coverage start, so installation is irrelevant.
- **`issueWarrantyIfPaid` (`lib/warrantyIssue.ts`) is called from BOTH payment paths**, after
  `recordOrderPayment`, exactly like the payment helper itself is shared. It NEVER throws: the
  payment is already committed when it runs, so a failed warranty logs `Warranty email failed:
  …` and still returns 201 / `{ status: 'applied' }`.
- **Migration 31 is written but NOT APPLIED** — `orders.warranty_sent_at` +
  `orders.warranty_starts_on`. Applying it is the owner's call. Nothing else in this change
  can work until it is applied.
- **`warranty_starts_on` is snapshotted before the send** so resends and staff downloads print
  identical expiry dates. `warranty_sent_at` still follows email-then-persist.
- **Additive exports, not refactors:** `pdf.ts` and `email.ts` now export their primitives so
  the certificate and its email reuse the invoice's look. `toBase64` and `formatDateLong` moved
  out of `routes/orders.ts` into `lib/pdf.ts` and `lib/timeText.ts` — a lib module must not
  import from a route module.
- **Manual recovery:** `POST /orders/:id/warranty` (resend) and `GET /orders/:id/warranty-pdf`
  (download), surfaced in a warranty strip in the Payments panel that appears only once the
  balance is settled.
- **Verified:** api tsc clean + vitest **186/186 (11 files)**; web tsc clean + vitest
  **78/78**; oxlint at the same 4 pre-existing `LineItemEditor.tsx` warnings.

### Next steps / deliberately deferred
1. **Apply migration 31** to `lgbxxlwsdeuhdgzrjjen`, then deploy the Worker BEFORE the web app
   so the UI never reads columns the API cannot return.
2. **Nothing was exercised in a browser or against real Resend.** Owed: a real final payment
   on a test order, the delivered email, the PDF opened by eye, and the panel strip on screen.
3. **`WARRANTY_TERMS` is a constant in `lib/warrantyPdf.ts`**, not a Settings field. If the
   shop wants to edit the legal wording without a deploy, that is a
   `company_settings.warranty_terms` column + a Settings textarea — deliberately out of scope.
4. **`public.routes.test.ts` "truncates an overlong note to 500 characters" is flaky** under a
   full parallel run (it lets a real fetch reach api.resend.com). Passes in isolation.
   Pre-existing, untouched by this change.

## Prior focus — 2026-08-01 (later): Customer View, customer logs, nameless customers, address search off
Four changes on branch `feat/customer-view-and-logs`. Spec
`docs/superpowers/specs/2026-08-01-customer-view-and-logs-design.md`, plan
`docs/superpowers/plans/2026-08-01-customer-view-and-logs.md` (both untracked — `.gitignore`
covers `docs/`). Full detail in `engine_features.md` + `bug_fixes.md` 2026-08-01 (later).
- **Customer View button** on the order top bar opens `/customer/:token?preview=1`.
  `POST /api/orders/:id/public-token` mints or reuses the token so a never-sent draft can be
  previewed. The tab is opened SYNCHRONOUSLY before the await — a `window.open` after an
  await is killed by popup blockers.
- **Preview mode is inert on purpose.** Confirm and the cancellation controls are disabled and
  a blue banner says so; without it, a staff member clicking "Confirm Estimate" to see how it
  looks would confirm the order for real, and the customer cannot undo that.
- **`CancellationRequest` gained `disabled`, kept separate from `busy`** — `busy` also rewrites
  its labels to "Working…", which in a preview reads as stuck rather than switched off.
- **Migration 30 APPLIED** to `lgbxxlwsdeuhdgzrjjen`: `order_logs.source` (default `'staff'`,
  so no backfill) + `orders.customer_viewed_at`. Verified against `information_schema`.
- **`public.ts` used to write no logs at all.** It now records the customer's confirm,
  cancellation request and withdrawal, plus a first-open-only `Customer opened their order
  page.` from the new `POST /public/estimate/:token/view`. Customer rows render on
  `bg-info-tint` in the trail.
- **The `/public` rate limit was NOT raised.** The view ping fires once per device ever
  (localStorage + `useRef` + server-side `customer_viewed_at`), so a first visit that also
  confirms is 4 requests against the budget of 5.
- **Names are now optional on customers** — the DB columns were already `not null` with no
  length floor, so this needed NO migration, only Zod. A create still refuses a row with no
  name, email AND phone. The UPDATE schema stays unrefined so an address-only PATCH works.
- **Twin `lib/customerName.ts` on both sides** (`displayName`, plus `greetingName` on the
  Worker). Change one, change the other — same rule as `pricing.ts` / `totals.ts`.
- **Address autocomplete is OFF** behind `ADDRESS_SEARCH_ENABLED = false`;
  `lib/addressSearch.ts` and all three call sites are untouched, so re-enabling is one line.
  This supersedes the 2026-07-11 entry below, which describes it as live.
- **Verified:** api tsc clean + vitest **158/158**; web tsc clean + vitest **78/78**; oxlint at
  the same 4 pre-existing `LineItemEditor.tsx` warnings.

### Next steps / deliberately deferred
1. **Nothing was exercised in the running app.** Every staff route is behind
   `ProtectedRoute` and the agent had no Supabase session. Owed: the Customer View
   click-through on a draft and on a sent order, the blue log row on screen, creating a
   phone-only customer, and confirming no `photon.komoot.io` request fires from the address
   field.
2. Neither Worker is deployed. `wrangler deploy` is pending for both — and the Worker MUST
   go out after migration 30, which is already live, so that ordering is safe.
3. `orders.customer_viewed_at` is written but never displayed. If staff want "customer opened
   this on X", the column is already there.

## Current Focus — 2026-08-01: "Awaiting Payment" step + quoted 50% deposit
The public customer tracker now has FIVE steps —
`Confirmed → Awaiting Payment → In Production → Ready → Installed` — and the e-Transfer
block states the deposit to send. Full detail in `engine_features.md` 2026-08-01. Branch
`main`.
- **Reversed an earlier decision.** `OrderProgress`'s old doc argued `awaiting_payment` must
  hide behind "Confirmed" because it "would read as a demand". The owner wants it visible;
  the doc has been rewritten so nobody re-argues the old position from the comment.
- **"Confirmed" matches no status** (empty `match`, index 0 → always done). Confirming is an
  event, not a state; the state it produces is `awaiting_payment`. The unknown-status
  fallback is index 1, not 0, so the matchless step is never highlighted.
- **`deposit_due` is served by the Worker**, not derived in the browser (rule 1). Its 50%
  rule must stay in step with `lib/etransferMatch.ts`, which recognises an arriving
  e-Transfer by that same `total / 2` — a mismatch would break auto-matching.
- **One window only:** the amount shows while `awaiting_payment` AND `amount_paid === 0`.
  After that the balance in the totals block is the figure that matters.
- **No confirmation banner any more.** "Order confirmed!" is deleted and the payment block
  sits in its place, directly under the header. The page already announces the confirmation
  structurally (tracker, "Order" wording, no Confirm button), so the prime slot goes to the
  only thing left to act on. `justConfirmed` is gone; 200 and 409 from the confirm POST are
  now the same path.
- **Amber, by the token's own definition.** The payment card uses `warning` /
  `warning-tint`, which `index.css` labels "awaiting payment, action needed". Red (`danger`)
  stays reserved for expired / overdue / destructive — do not escalate this block to it.
- **Verified:** api tsc clean + vitest 125/125; web tsc clean + vitest 69/69 + oxlint at the
  4 pre-existing warnings.

### Next steps / deliberately deferred
1. **Look at the tracker at 375px** — five equal grid tracks is tighter than four, and
   "Awaiting Payment" is the longest label in the row.
2. The deposit fraction is a hard-coded 50% in two api files; if the shop ever wants it
   configurable it belongs in `company_settings`, next to the e-Transfer address.

## Current Focus — 2026-07-31: Full UI redesign (soft dashboard language)
`apps/web` was re-skinned end to end. Spec
`docs/superpowers/specs/2026-07-31-ui-redesign-design.md`, plan
`docs/superpowers/plans/2026-07-31-ui-redesign.md`, full detail in `engine_features.md`
2026-07-31. Branch `feat/ui-redesign`.
- **What changed:** Plus Jakarta Sans (IBM Plex Mono kept for money/order numbers), brand
  blue `#2563EB`, 16px cards with a shadow AND a hairline, a semantic hue-encodes-state
  palette, and a new `src/components/ui/` primitive layer.
- **The lever:** rewriting `@theme` radius/colour tokens reshaped the whole app, because the
  old system flattened every radius to 2px and the codebase says `rounded-sm` everywhere.
  **No token NAME may be deleted** — untouched pages still reference them.
- **Status colour has ONE home:** `src/lib/statusStyles.ts`. Do not hard-code status hues in
  components.
- **Paired measurement:** `Sidebar`'s 248px width and `Layout`'s `lg:pl-[248px]`.
- **Also fixed en route:** the web suite had been red at 1/61 on `main` — `buildLabels` joined
  material and colour with an em dash while its test and JSDoc said middle dot. Test and doc
  corrected to the code; see `bug_fixes.md` 2026-07-31.
- **Verified:** web tsc clean, web vitest 69/69, api vitest 124/124, oxlint at the 4
  pre-existing `LineItemEditor.tsx` warnings.

### Next steps / deliberately deferred
1. **On-screen check still owed** at 375px and lg+ across every route — the automated run
   could confirm computed styles but not composited layout.
2. `pages/customer-view/*` inherits the new tokens but had NO layout pass.
3. Email templates and PDF output still use the OLD indigo `#2A4FCF`; brand colour is now
   inconsistent across channels.
4. `OrderDetail.tsx` remains a standing size violation (~2,450 lines); the redesign wrapped
   it but did not split it.

## Current Focus — 2026-07-30 (later): Label hardware row printed as shop codes
The production label's hardware row now reads
`Cassette: R · Bottom Rail: P · Control: MB` instead of three full catalog names. Details in
`engine_features.md` 2026-07-30 (later).
- **Why codes:** at 10pt on 3in stock about 40 characters survive `truncate`, and the real
  names ("Fabric Wrapped", "Regular", "Motorized (Bluetooth)") overflowed and clipped the
  control.
- **Where:** `apps/web/src/lib/labels.ts` only. `LabelFields` drops `cassette` / `bottomRail` /
  `control` for one pre-assembled `hardware` string, so `OrderLabels.tsx` places text it no
  longer words. No API, pricing, or schema path touched.
- **Order-sensitive table:** in `CONTROL_CODES` the `non-bluetooth` pattern MUST stay above
  `bluetooth` — the non-Bluetooth motor's name contains the word. Unmapped names fall back to
  their first letter uppercased; "No Cassette" prints `-` on purpose.
- **Verified (real runs, 2026-07-30):** web `npx tsc -b --noEmit` clean; vitest **61/61**
  (5 files); oxlint = the same 4 pre-existing `LineItemEditor.tsx` warnings, none new.
- ✅ Migration `20260730000029_control_option_cordless.sql` APPLIED to
  `lgbxxlwsdeuhdgzrjjen` on 2026-07-30. `Cordless` is live at price 0, sorted last, and shows
  in the blind popup's Control select without a web change — that select renders whatever
  `/api/settings/control-options` returns.

## Prior focus — 2026-07-30: Blind popup split into Basics / Options / Details
Presentation-only pass over `BlindEditForm` (`apps/web/src/pages/orders/LineItemEditor.tsx`),
the form behind both the add-blind and edit-blind popups. Details in `engine_features.md`
2026-07-30.
- **Three sections, hairline splitters.** `FormSection` (uppercase caption + field stack) and
  `FormSplitter` (`<hr>` on the neutral `border-border-light` token) are module-private on
  purpose — exporting them would add two more `react(only-export-components)` oxlint warnings
  to the four this file already carries.
- **Layout the shop asked for:** Basics = type / room / panel widths / height. Options =
  Material + Color on one row, Cassette + Control + Bottom rail on the next. Details = note,
  quantity, price readout, save button. The old `sm:grid-cols-2 lg:grid-cols-4` option row and
  the full-width Color field are gone.
- **`footer?: ReactNode`** puts the host's buttons inside the Details section. `OrderDetail.tsx`
  hoists its Cancel / Save changes pair into an `actions` const, passes it as `footer` for
  blinds, and renders it after `FlatEditForm` for preset/custom items (unchanged there). The
  form still owns NO save logic — `cancelEdit` deleting a never-saved item via `pendingNewKey`
  stays in the page.
- **No data change.** `BlindDraft`, `blindDraftPrice`, `BulkEditForm`, and every API/pricing
  path are untouched; no field added, removed, or renamed. "Material" keeps its name.
- **Verified (real runs, 2026-07-30):** web `pnpm check` clean; vitest **60/60** (5 files);
  oxlint = the same 4 pre-existing `LineItemEditor.tsx` warnings, none new.
- ✅ The bottom-rail migration `20260729000028` was applied manually on 2026-07-30, so the
  order-save 400 that blocked the 2026-07-29 focus is cleared.

## Prior focus — 2026-07-29: Bottom rail option (priced per metre of width)
Full-stack feature on branch `feat/bottom-rail`; briefs and per-task reports in
`.superpowers/sdd/2026-07-29-bottom-rail/`, details in `engine_features.md` 2026-07-29. Every
blind line item now carries a **bottom rail** (Regular / Pear) picked from a settings-managed
catalog and charged per linear metre of width, on the same basis as the existing cassette.
- **`bottom_rail_options`** mirrors `cassette_options` column for column
  (`price_per_m numeric(10,2) not null check (price_per_m >= 0)`), and `line_items` gains the
  snapshot triple `bottom_rail_id` / `bottom_rail_name` / `bottom_rail_price_per_m` so
  renaming or repricing an option never rewrites a historical order.
- **Seeded at 0 deliberately.** Pricing is recomputed server-side on save, so a non-zero seed
  would silently raise the total of every existing order the moment it was re-saved. The rail
  costs nothing until someone sets a price in Settings.
- **Historical blind rows backfilled to Regular** because the API makes `bottom_rail_id`
  required — without the backfill every historical order would be unsavable until an operator
  picked a rail for each of its blinds. Preset/custom rows stay `NULL`, as they already do for
  cassette and control.
- **`bottomRailCost` is a hook on `BaseBlindCalculator`** in BOTH twins — `(width / 100) *
  price_per_m` on the post-`applyWidthMinimum` width — so all ten blind-type subclasses inherit
  the charge with no edits. `bottom_rail_price_per_m` is REQUIRED on `BlindPricingInputs`, so
  tsc names any call site that forgets it. Don't fold it into `cassetteCost`; the separate hook
  is what lets one blind type diverge on the rail alone.
- **Surfaces:** `GET|POST /api/settings/bottom-rail-options` (+ `PUT|DELETE /:id`) via the
  catalog route factory; `/settings/bottom-rail` CRUD page; a fourth `OptionSelect` in the
  blind editor (single + bulk, `Regular` default on new blinds); `Bottom rail:` on the estimate
  PDF; a twelfth column on Order Overview; `Cassette · Bottom rail · Control` on the label. The
  public payload and customer view carry `bottom_rail_name` ONLY — never the id, never the
  price.
- **Verified (real runs, 2026-07-29):** api `tsc --noEmit` clean + vitest **124/124** (6 files);
  web `npx tsc -b --noEmit` clean + vitest **60/60** (5 files); oxlint = exactly the 4
  pre-existing `LineItemEditor.tsx` warnings. The `BlindPricingInputs`-onward api/web twin
  `diff` printed nothing.
- ✅ **`supabase/migrations/20260729000028_bottom_rail_options.sql` APPLIED** to project
  `lgbxxlwsdeuhdgzrjjen` — run manually by the maintainer on 2026-07-30. `resolveLineItems` now
  finds `bottom_rail_options`, so saving an order works and both Workers are safe to deploy.
- ⚠️ **Both rails are priced 0.** The rail costs nothing until someone sets a price in Settings
  → Bottom Rail Options. Orders already saved keep their stored totals; only orders saved after
  the price change include it.
- ⚠️ **Label truncation is untested on paper.** The cassette / bottom rail / control row is
  `truncate`d at 10pt on 3in stock, about 40 characters. Three long catalog names will clip the
  control. If the physical print shows it, give the bottom rail its own row — there is vertical
  slack — rather than shrinking the type.
- ⚠️ **The blind form is now four selects wide** (`sm:grid-cols-2 lg:grid-cols-4`). Unverified
  on a real tablet in portrait; check it on the field device.
- ⚠️ Pre-existing, untouched: `apps/web` still has no `check` script (§9's `pnpm check` silently
  does nothing there); `.gitignore:15` still ignores `supabase/`, so migrations need
  `git add -f`.

## Prior focus — 2026-07-28: Production label printing (browser-only)
Full-stack feature, spec `docs/superpowers/specs/2026-07-28-label-printing-design.md`, plan
`docs/superpowers/plans/2026-07-28-label-printing.md` (details in `engine_features.md`
2026-07-28). Originally shipped with two print paths; the queued print-agent half was removed
the same day at the owner's request (see below) — only the browser path remains.
- Every blind line item produces its own 3x1.5in production label — one per unit of quantity,
  numbered across the WHOLE order ("3 of 7") — for the shop to fix behind the cassette before it
  ships. SINGLE print path: `window.print()` from the browser to a Windows-installed Bluetooth
  printer on the shop PC.
- **`apps/web/src/lib/labels.ts`** is now the single implementation (no API-side twin):
  `buildLabels(order)` expands blind line items into `LabelFields[]`, numbered before any
  filtering. Every field is `''` rather than absent so the renderer never leaves a dangling label
  line.
- **`/orders/:id/labels`** (`OrderLabels.tsx`, new tab): `@page { size: 3in 1.5in; margin: 0 }`
  scoped inside the component so it cannot leak onto the Letter-sized cut sheet or Overview page.
  One checkbox selection, single Print button.
- **REMOVED 2026-07-28** (owner decided the shop PC covers printing and an iPad path is
  unneeded): the TSPL renderer (`apps/api/src/lib/labelTspl.ts`), the API-side twin
  `apps/api/src/lib/labels.ts`, the `print_jobs` queue migration (never applied live, so deleted
  outright rather than reversed), `POST /api/orders/:id/print-label`, the `/agent/*` routes
  (`printAgent.ts`, `PRINT_AGENT_SECRET`), the `useEnqueuePrintLabels` hook, and the whole
  `apps/print-agent/` pnpm workspace. `pnpm-lock.yaml` regenerated to drop the workspace's
  importer entry.
- **Verified after the removal (real runs):** api `tsc --noEmit` clean + vitest **116/116**
  (6 files); web `npx tsc -b --noEmit` from inside `apps/web` clean + vitest **56/56** (5 files);
  oxlint shows exactly the 4 pre-existing `LineItemEditor.tsx` warnings, none from this feature.
- **Layout revision 2026-07-28 (later)** — owner-requested, renderer-only (`Label` in
  `OrderLabels.tsx`; `labels.ts` and its suite untouched): order number and dimensions are now
  `text-[11pt]` instead of `15pt`, and cassette + control share one " · "-joined row instead of
  two rows. 7 flow rows instead of 8. Re-verified: web `tsc -b --noEmit` clean, vitest 56/56,
  oxlint unchanged (same 4 pre-existing warnings).
- **Order date added 2026-07-28 (later)** — `LabelOrder` reads `order_date`, `LabelFields`
  carries `orderDate`, and the header row prints it at `text-[10pt]` right of the order number
  (month + day only, "Jul 21"; no year — the stock is 3in wide). `shortDate()` splits the ISO
  parts before constructing the Date so the label does not print the previous day. Suite now
  58/58.
- **Trailing blank page fixed 2026-07-28 (later)** — `print:break-after-page` was on every
  label including the last, so the preview ended with an empty page (one wasted die-cut label
  per batch). `Label` now takes a `pageBreak` prop and the page drives it from `lastPrinted`,
  the last SELECTED index — not a CSS `:last-child`, which breaks as soon as trailing labels
  are deselected. Breaks now sit strictly between printed labels. Details in `bug_fixes.md`.
- ⚠️ The label layout has never been exercised on physical hardware. No test in any suite can
  tell you a label is legible — and the 11pt headline rows make that first physical print more
  important, not less.
- ⚠️ The browser print path relies on `print:break-after-page` to make each label its own
  physical label, but in `OrderLabels.tsx` those label elements sit inside a `flex flex-col`
  container, and forced page-break behaviour inside flex containers has historically been
  unreliable in Chrome. If it does not fire, a multi-label order prints as one long overflowing
  page instead of separate labels. The first physical test print MUST therefore be a THREE-label
  order, not a one-label order — a single label cannot reveal this failure at all. Also worth
  watching on that first print: whether the last label emits a trailing blank page, which would
  waste one die-cut label per batch.
- ⚠️ Nothing is deployed. Both Workers still need `wrangler deploy`.

## Prior focus — 2026-07-25: Recalculable aluminium bar length (Manufacturer Copy)
Web-only feature, no API/schema/pricing touched (details in `engine_features.md`
2026-07-25):
- The aluminium cut list is no longer locked to a 6 m bar. A numbers-only "Aluminium bar
  length" field above the aluminium sections on `/orders/:id/manufacturer` re-packs the
  bars live against whatever stock is on the rack.
- **`planAluminumCuts` already took a `stock` param — it was dead.**
  `buildManufacturingPlan` called it without one and the oversize warning interpolated
  `ALUMINUM_STOCK_CM`, so 600 was effectively hardcoded. It now takes
  `aluminumStockCm: number | null = ALUMINUM_STOCK_CM` and threads it into both.
- **`resolveAluminumStockCm()` is the ONE fallback rule** (blank/NaN/0/negative/Infinity →
  600) and is shared by the planner and the page so the displayed length can never differ
  from the packed length. Don't re-implement it at a call site.
- **The override is view-only page state** — never persisted to the order, never sent to
  the API. It's a what-if calculator. Kept as raw TEXT so blank ≠ 0 and `"5."` can be typed.
- Numbers-only is done with a `numericOnly()` sanitizer on a plain `inputMode="decimal"`
  input (the codebase convention), deliberately NOT `<input type="number">` — that accepts
  `e`/`+`/`-` and blanks its `value` on browser-invalid text, hiding typos.
- Field is `print:hidden`; the length reaches paper through the meta line ("Aluminium bars
  are 5.5 m (custom length).") and each "Bar N · 5.5 m" heading. `AluminumGroup.stockCm`
  exists so the stat can be labelled even when all cuts are oversize and `bars` is empty.
- Fabric planning is untouched (roll widths still come from the material catalog) — a test
  asserts `fabricGroups` is identical across two bar lengths.
- Verified here: web `tsc -b` clean, vitest **47/47** (manufacturing 12 → 20), oxlint clean
  besides the 4 pre-existing `LineItemEditor` warnings, `pnpm --filter web build` OK. API
  suite not run — nothing in `apps/api` and no pricing/totals code was touched, so Rule 9's
  both-suites clause does not apply.
- ⚠️ **Not verified in a browser.** The tests cover the planner, not the field's behaviour
  on screen or the print layout. Worth a look on a real order with Roller/Zebra lines.
- ⚠️ Not deployed — `wrangler deploy` for `measure-blinds` still pending.

## Prior focus — 2026-07-21: Responsive emails + email-theme.ts split
API-only feature, spec at `docs/superpowers/specs/2026-07-21-responsive-email-design.md`,
plan at `docs/superpowers/plans/2026-07-21-responsive-emails.md`
(details in `engine_features.md` 2026-07-21):
- All 13 outbound emails (9 customer + 4 internal staff) are now responsive. None were
  before — no template had a `<head>` at all, so there was no viewport meta anywhere and
  webview clients laid every email out at desktop width.
- **Presentation layer split into `apps/api/src/lib/email-theme.ts`.** `email.ts` 817 →
  610 lines, theme 344. `email.ts` re-exports `escapeHtml`/`brandFromSettings`/
  `CompanyBrand`, so the four importing modules were NOT touched.
- **Approach is deliberate and worth preserving:** fluid base + one 600px media block,
  where the media rules are progressive enhancement only. Anything that could overflow a
  320px screen (the `width="640"` attribute, the 280px review CTA, the 50/50 button pair)
  was fixed STRUCTURALLY. Do not convert a structural fix into a media query — the
  layout is required to stay correct in clients that strip `<style>`.
- Outlook desktop keeps 640px through an MSO ghost table, since its Word engine ignores
  `max-width`.
- Internal staff notices got `plainShell`: meta tags + de-duplication, **appearance
  deliberately unchanged**, guarded by a test.
- ⚠️ **First fixed a pre-existing breakage:** commit `ef0f441` had created
  `email-theme.ts` but left the originals in `email.ts` — 19 tsc errors on a CLEAN tree.
  Fixed in `a3096d6` (see `bug_fixes.md`). Run `pnpm check` before trusting a clean tree.
- Verified on this machine: api tsc clean + vitest **181/181** (email.test.ts 20 → 85).
  Web untouched — no pricing/totals code involved, so Rule 9's both-suites clause does
  not apply.
- ⚠️ **RENDERING IS NOT VERIFIED.** The 85 tests assert HTML markup invariants; no test
  can tell you these look right in Gmail, iOS Mail, or Outlook. A live Resend send to a
  real phone is still outstanding — same standing caveat as the denial email below.
- ⚠️ Not yet deployed. `wrangler deploy` for `blinds-nisa-api` still pending.

## Prior focus — 2026-07-21: Public order summary + cancellation requests + e-Transfer
Full-stack feature, spec at
`docs/superpowers/specs/2026-07-21-customer-order-summary-cancellation-design.md`
(details in `engine_features.md` 2026-07-21):
- The token'd customer page is now a PERMANENT order summary, not a one-shot estimate.
  It used to dead-end at "You've already confirmed this estimate"; it now shows a live
  4-step tracker (Confirmed · In Production · Ready · Installed), the balance, e-Transfer
  details, and a cancellation-request block. That tracker is WHY no status-update emails
  go to customers.
- Customers still cannot undo a confirmation. `orders.cancel_requested_at` is a FLAG that
  changes no status — staff answer it on `POST /:id/cancel-request/resolve { accept }`.
  Accepting reuses the unconfirm rule verbatim (awaiting_payment only, refused once a
  payment exists) and emails nobody; denying emails the customer and is
  email-then-persist, so a 502 leaves the request open to retry. A customer with no email
  on file is cleared without a send — a missing address must never trap staff in a
  request they cannot resolve.
- Requests are only offered in the pre-payment window, i.e. exactly when the server could
  grant one. Customers may withdraw their own request.
- e-Transfer details moved from a hardcoded literal in `PaymentSection.tsx` into
  `company_settings` (+ Settings → Company Info); changing the address no longer needs a
  redeploy.
- `CustomerView.tsx` split ADDITIVELY — new `OrderProgress.tsx` and
  `CancellationRequest.tsx`, nothing existing relocated (deliberate: Rule 6 wants new
  files for new concerns, Rules 6/7 forbid moving working code for its own sake).
- Verified on the dev machine: api tsc clean + vitest 114/114, web tsc clean + vitest
  40/40 + oxlint clean (only the 4 pre-existing `LineItemEditor` warnings).
- ⚠️ Migration 27 (`20260721000027_order_cancel_request_etransfer.sql`) NOT yet applied
  to live `lgbxxlwsdeuhdgzrjjen`. Apply it BEFORE deploying either Worker — the public
  read selects `cancel_requested_at` and the e-Transfer columns.
- ⚠️ The denial email has NOT been exercised against live Resend.

## Prior focus — 2026-07-21: Advancing to "Sent" must not email the customer
Bug fix, full-stack (details in `bug_fixes.md` 2026-07-21):
- The Progress-timeline advance arrow under *Sent* called `POST /:id/send` — the emailing
  route — so bookkeeping-only stage moves sent the customer a duplicate "Estimate Ready"
  mail, and were blocked entirely for customers with no email on file.
- New `POST /api/orders/:id/mark-sent`: status-only `draft → sent` following the
  `/confirm` pattern (stamps `sent_at`, logs "Marked as sent (no email)."). It needs no
  customer email and writes NEITHER `public_token` NOR `terms_snapshot` — nothing was
  delivered, so there is no customer link to keep alive and no terms to freeze; a later
  real `/send` mints both lazily. Keeps `/send`'s lapsed-expiry 400 so
  `applyDefensiveExpiry` cannot flip the order straight back to `expired`.
- Web: `useMarkSent()` in `hooks/useOrders.ts`; `handleAdvance` uses it for the `sent`
  target. `useSendOrder` now has exactly ONE call site — `handleSendEstimate`, behind the
  top-bar Send button.
- **Standing invariant** (documented in the OrderDetail module header): the top-bar Send
  button is the only control that emails the estimate; timeline arrows never email.
- Verified: api vitest 90/90 (4 new mark-sent cases assert zero Resend calls), web 40/40,
  both `tsc --noEmit` clean, oxlint clean for touched files. NOT yet exercised against the
  live UI.

## Prior focus — 2026-07-21: Payment receipt emails (per payment, manual)
Full-stack feature, spec at `docs/superpowers/specs/2026-07-21-payment-receipt-email-design.md`
(details in `engine_features.md` 2026-07-21):
- `POST /api/orders/:id/payments/:paymentId/receipt` `{ message? }` emails a branded
  receipt (payment, received date, order total, paid to date, balance remaining OR
  "Paid in full") with a "View your order" CTA to `/customer/:public_token`.
  Email-then-persist: `payments.receipt_sent_at` (migration 26, applied live) is stamped
  only after Resend accepts; 502 leaves the row untouched. Money computed server-side.
- Web: envelope action per payment row + "✓ Receipt sent" indicator + Send/Resend sheet
  (`useSendReceipt()` in `hooks/useOrders.ts`); missing customer email blocks with toast.
- Decisions: manual only (no webhook auto-send), no PDF attachment, resend allowed.
- Verified: api tsc clean + vitest 81/81, web tsc clean + vitest 40/40 + oxlint clean.
  NOT yet sent against live Resend from the UI.
- Incidental fixes forced by verification (see `bug_fixes.md` 2026-07-21): resolved
  committed merge-conflict markers in `apps/api/src/lib/pdf.test.ts` (kept the HEAD side
  matching shipped pdf.ts; dropped branch-side color tests flagged as follow-up), and
  de-time-bombed the `/send` 502 test fixture (relative expiry_date).
- Follow-up CLOSED (branch `claude/nifty-liskov-efa78e`): the dropped color coverage is
  back. `itemContent` is exported from `apps/api/src/lib/pdf.ts` and `pdf.test.ts` asserts
  the SHIPPED attribute order — Panels, Material, Color, Cassette, Control, Note — plus
  trimming and the empty/whitespace/null/absent omission cases. The branch-side tests
  could not be restored verbatim: they used the old `fabric_name` field and assumed
  "Color after Control". api tsc clean, pdf suite 8/8.

## Prior focus — 2026-07-21: Mobile alignment pass on the order page
Web-only UI change (no API/schema/pricing impact — see `engine_features.md` +
`bug_fixes.md` 2026-07-21):
- **One gutter everywhere.** Header, body and the mobile sticky action bar previously used
  8 / 16 / 14px gutters; all three now share `mx-auto w-full max-w-lg` + 16px.
  `PageHeader` keeps its full-bleed hairline but constrains its ROW; the back chevron uses
  `-ml-2.5` so the glyph (not the 44px tap target) aligns with the gutter.
- **Nothing can push the page sideways.** The top-bar `StatusBadge` is hidden below `sm:`
  (~130px for "AWAITING PAYMENT" beside four icon buttons did not fit); the Progress
  timeline moved from `flex` + `flex-1` to a GRID with `repeat(STAGES.length,
  minmax(0,1fr))` tracks (a flex item's auto minimum = its longest word, which was the
  hard floor forcing the overflow); `overflow-x-clip` on the page root as a backstop
  (`clip`, not `hidden`, so the sticky header still works).
- **Record Payment moved into the Payments panel body** (full-width brand button under
  Balance due, same `openPayment()` sheet). The `payment` `StageAction` is gone from
  `stageActions()`, so it no longer appears in the sticky bar or the desktop rail;
  `awaiting_payment` and `installed` now have `primary: null`. The ledger display is
  unchanged (order total, one row per payment, amount paid, balance).
- **Darker card outlines:** `--color-border` `#e4e4e7 → #d4d4d8`, `--color-border-light`
  `#ececee → #e4e4e7`. Order-page inner separators moved onto the light token so a card's
  outline stays a step darker than the rows inside it.
- Verified on the dev machine: web `tsc --noEmit` clean, vitest 40/40, oxlint clean on the
  touched files. ⚠️ NOT verified on a physical phone — re-check on a real device (and at
  320px) before closing.

## Prior focus — 2026-07-20: Order Overview page (new tab) + compact mobile action bar
Web-only UI change (no API/schema/pricing impact — see `engine_features.md` 2026-07-20):
- **Order Overview** button on every post-draft stage (sent/awaiting_payment/in_progress/
  ready/installed/expired) opens the new page `/orders/:id/overview` in a NEW TAB
  (Manufacturer Copy pattern: `window.open(..., '_blank', 'noopener')`, lazy + guarded
  route in `App.tsx`). `pages/orders/OrderOverview.tsx` renders a read-only, print-friendly
  TABLE view from the SERVER row: one `<table>` per blind type (grouped by snapshotted
  `blinds_type`) with one column per field (Room/Width/Height/Material/Colour/Cassette/
  Control/Qty/Unit/Total/Note; `max-w-6xl` container), a trailing "Other Items" table for
  preset/custom lines, per-group
  count + subtotal headers, `overflow-x-auto` for phones, and a totals card
  (subtotal/discount/tax/total, Paid & Balance). (Iterations same day on request:
  bottom sheet → new-tab page → per-type tables.)
- **Mobile sticky action bar capped at 3 rows**: `actions()` refactored into data-driven
  `stageActions()` → `{ primary, secondary }` `StageAction`s. Mobile renders the primary
  alone full-width, secondaries as compact h-10 inline buttons with short labels, ≤3 per
  row (2+2 when exactly 4).
- **Save/Send/Download moved to the TOP BAR** (follow-up same day): `headerActions` in
  `PageHeader.right` next to the StatusBadge — Save GREEN `bg-success`, Send BLUE
  `bg-brand-600`, Download GRAY bordered secondary; h-9, icon-only on phones (labels from
  sm:). Removed from panels/rail (`trailing` gone); draft primary is now Confirm; unsaved
  orders have NO panel actions (rail footer strip hidden via `railActions` null check).
  Mobile bar worst case now 2 rows.
- Verified on the dev machine: web `tsc --noEmit` clean, vitest 40/40, oxlint 0 warnings in
  OrderDetail (also fixed its pre-existing `no-unused-expressions` warning).

## Prior focus — 2026-07-13: Manufacturer Copy (cut sheet) + Material fabric width
New workshop-facing cut planner (see `engine_features.md` 2026-07-13 for the full file list).
- "See Manufacturer Copy" button in the `in_progress` action branch of `OrderDetail.tsx`
  opens `/orders/:id/manufacturer` in a NEW TAB (`window.open(..., '_blank', 'noopener')`).
- The page (`pages/orders/ManufacturerCopy.tsx`, lazy+guarded route in `App.tsx`) computes
  everything client-side via the new PURE module `lib/manufacturing.ts` from the order's line
  items + the live Materials catalog. Print-friendly (Print button → `window.print()`).
- Domain: Roller/Zebra/Sunscreen-Solar are built in-house from 6 m aluminium bars + fabric;
  all other types + preset/custom are ordered from the factory as-is. One blind = one
  aluminium cut (length = panel width) + one fabric piece (panel width × drop); panels ×
  quantity expand.
- Aluminium = 1-D bin packing (FFD) into 6 m bars, per blind type. Fabric = 2-D shelf packing
  (FFDH) at the roll width — the machine cuts HEIGHT across the FULL width per course, tallest
  piece sets the cut, shorter pieces trimmed (top offcut), leftover width = side offcut.
  Default roll width 300 cm when a material has none.
- Fabric pieces are grouped by DISTINCT FABRIC CODE = material **+ colour** (`material_id|color`)
  — the same material in two colours is two separate rolls, never cut together (roll width
  still from the material catalog). Aluminium grouped by blind-type profile.
- **New `materials.width_cm`** (migration 24, nullable, manufacturing input only — NO pricing
  effect, NOT snapshotted onto line items; read live). Added to `settings.ts` material schema
  and the `MaterialsForType.tsx` add/edit forms + optional 3rd CSV column.
- **Cut-done milestone** (migration 25, `orders.cut_done_at`): REVERSIBLE toggle
  `POST /:id/cut-done` `{ done: boolean }` (confirmed-only; on stamps now/keeps date, off
  clears) + `useSetCutDone`; a `role="switch"` footer control on `ManufacturerCopy.tsx`
  reflects the state and shows "Cuts completed on <date>" when on.
- ⚠️ Migrations 24 AND 25 NOT yet applied to live `lgbxxlwsdeuhdgzrjjen`; and `pnpm
  check/test/lint` (web + api) NOT run in the sandbox — the mount served BYTE-STUB copies of
  node_modules AND the pnpm store this session (even `tsc.js`/`vitest.mjs` were stubs). Logic
  was runtime-verified via standalone Node ports (worked example + colour grouping passed).
  Apply both migrations and run the full suites on the dev machine before deploying.

## Prior focus — 2026-07-12: Material rename + per-type Materials + calculator hierarchy
Three linked changes (see `engine_features.md` 2026-07-12 for the full file list):
1. **Fabric → Material everywhere** — DB (table `fabrics → materials`,
   `line_items.fabric_* → material_*`, FK, trigger, `update_order_with_items` RPC),
   API (`orders.ts`/`settings.ts`/`public.ts`/`pdf.ts` + tests), web (types, hooks,
   `LineItemEditor`, `OrderDetail`, `CustomerView`, settings `Fabrics.tsx → Materials.tsx`,
   route `/settings/fabrics → /settings/materials`), and the PDF label ("Material:").
2. **Different Material list per blind type** — many-to-many `material_blind_types` join.
   The Materials settings section is a TWO-LEVEL flow (updated later same day): the landing
   (`Materials.tsx`) lists BLIND TYPES (and manages them — add/rename/activate/delete, with a
   per-type Material count); tapping one opens `MaterialsForType.tsx`
   (`/settings/materials/:blindTypeId`) which lists only that type's linked Materials and
   adds new ones linked to that type. The standalone "Blind Types" settings entry was REMOVED
   (folded in; `BlindTypes.tsx` deleted, route gone). The line-item editor's
   `materialsForType()` now shows ONLY Materials linked to the selected type (linked-only;
   empty until a type is picked). Migration 22 linked previously-unlinked Materials to Roller
   so none is orphaned.
3. **Calculator class hierarchy** — `apps/{api,web}/src/lib/calculators/`: a
   `BaseBlindCalculator` (the current shared formula) + one subclass per canonical type,
   each `extends` it and inherits the default for now (Honeycomb/Shutter/Curtains are the
   ones to override later). A registry dispatches by the snapshotted `blinds_type` name
   (normalised); `pricing.ts` became a façade with `calculateBlindUnitPriceForType`.
Migrations 19–21 APPLIED live to `lgbxxlwsdeuhdgzrjjen`. The ten canonical blind types are
seeded (legacy "… Blind" rows renamed in place; a non-canonical "Venetian Blind" kept at the
end). ⚠️ Full api/web `tsc --noEmit` + `vitest` + `pnpm build` NOT run in the sandbox — the
mount served truncated copies of the larger files (bash/git both affected); calculators +
pricing were runtime- and strict-tsc-verified in isolation. Run the full suites on the dev
machine before deploying.

## Prior focus (still true)

## Current Focus
SECURITY-REVIEW HARDENING (2026-07-07). Full A-to-Z review, then fixes (see
`bug_fixes.md` + `engine_features.md` 2026-07-07 entries for details):
1. **CORS** — `includes('localhost')` matched hostile look-alike origins; now exact/prefix checks.
2. **Payment guards** — `payments.client_key` idempotency (UUID per payment sheet, 23505 →
   idempotent replay) + overpay refusal: 409 `code=OVERPAY` ("This amount will exceed total
   balance.") unless `allow_overpay: true`; UI shows a `window.confirm` pop-up first.
3. **PUT order_date** — falls back to the STORED date, no longer silently re-dates to today.
4. **Atomic edits** — `update_order_with_items` RPC (migration 18, service_role-only) replaces
   the non-transactional update→delete→insert; strand-with-no-items bug closed.
5. **Business timezone** — new `apps/api/src/lib/dates.ts` (`todayBusiness()`, America/Toronto);
   all "today" comparisons (expiry, cron, defaults, webhook paid_on) moved off UTC.
6. **Log actors** — `order_logs.actor_email` written at all 14 `logOrderEvent` call sites,
   shown in the Activity Log UI.
7. **Delete guard** — orders deletable only when `draft`/`expired` (409 otherwise); Delete
   button hidden elsewhere.
Migration `20260707000018_payment_guards_log_actor.sql` APPLIED live. AI_GUIDELINES.md
rewritten for THIS stack (was still the Rust-project version). Both Workers confirmed
deployed (`blinds-nisa-api`, `measure-blinds`).
⚠️ Open security items from the review (user action): verify Supabase public signups are
DISABLED (any authenticated user = full access under current RLS), enable leaked-password
protection, rotate `ETRANSFER_WEBHOOK_SECRET` to a random value.
⚠️ Not run in the sandbox: api/web `tsc --noEmit` + `vitest` — run on the dev machine,
then `wrangler deploy`.

## Prior focus (still true)
ORDERS PAGE IMPROVEMENTS (2026-07-06). Three changes to the Orders module, all
verified with `pnpm --filter api test` (45 passed) + `pnpm --filter web test` (25
passed) + both `tsc --noEmit`:
1. **All Orders tab** — `OrderList.tsx` TABS gained a leading `all` entry;
   `GET /api/orders?status=all` returns every status unfiltered (explicit branch in
   `routes/orders.ts`, not implicit fallthrough).
2. **Editable at any status** — removed the `EDITABLE` (`draft`/`sent`-only) guard from
   `PUT /:id` specifically; `send`/`send-invoice`/`confirm` keep using `EDITABLE` (that's
   a different rule — which orders can be (re)sent/confirmed). `OrderDetail.tsx`'s
   `readOnly` is now hardcoded `false`; a Save button was added to every stage's action
   bar (previously only draft/sent had one). Totals are still fully server-recalculated
   on every save.
3. **Order activity log** — new `order_logs` table (migration
   `20260706000017_order_logs.sql`, applied live) written by a best-effort
   `logOrderEvent()` helper at every mutation point (create/edit/send/confirm/
   payments/lifecycle/install/revert). `GET /:id/logs` + `useOrderLogs` feed an
   "Activity Log" section at the very bottom of `OrderDetail.tsx`, below Delete Order.
See `engine_features.md` (2026-07-06 entry) for the full file list.

## Prior focus (still true)
CALENDAR FEATURE (2026-07-06). A new **Calendar** tab (5th mobile bottom-nav item,
5th desktop sidebar item) surfaces installations over the existing scheduling domain —
no new lifecycle, no schema change. Monthly view only (v1). New read-only endpoint
`GET /api/orders/calendar?from=&to=` (registered BEFORE `GET /:id` — required ordering,
see `knowledge/history/engine_features.md` 2026-07-06). Creating a proposal from the
calendar reuses the SAME emailing `POST /:id/install/propose` via `useProposeInstallation`
— the customer is always emailed, there is no quiet/silent scheduling path. See
`engine_features.md` (2026-07-06 entry) for the full file list.
⚠️ Not executed in the Cowork sandbox: `tsc --noEmit` (web+api), `vitest`, `pnpm build`.
The sandbox's mounted view of the repo was stale/lagging behind edits this session (see
below) — run the dev-machine verification steps listed in `engine_features.md` before
shipping.

## Prior focus (still true)
ORDER MODEL + INSTALLATION SCHEDULING (2026-07-04). Entity is `orders` (was `estimates`);
an "estimate"/"invoice" is just the PDF/email about an order. Lifecycle:
draft → sent → awaiting_payment → in_progress → ready → installed (+ expired).
- Confirmations are reversible by the USER only (awaiting_payment → sent, before payment).
- Orders carry a `payments` ledger; balance = total − Σpayments; PDF flips ESTIMATE→INVOICE
  on the first payment.
- After an order is `ready` the user proposes an installation time; the customer confirms
  or requests another via the token'd public page. Email says "We will be there between
  {start} and {end} on {date} if that works for you." `installed` is a manual user action.
- The order detail page now features a compact line item summary table with checkboxes for bulk operations (edit/delete) and bottom sheet popups for editing individual item details, simplifying the UI and making it an all-around summary.
See engine_features.md (2026-07-04 entries).

✅ Migrations 11 (rename), 12 (payments), 13 (ready/installed + installation fields) are all
APPLIED to the live Supabase project `lgbxxlwsdeuhdgzrjjen`.
⚠️ Tests were updated but could NOT be executed in the Cowork sandbox (Windows-only
node_modules + a flaky mount that truncates edited files). Run api/web `tsc --noEmit` +
`vitest` on the dev machine to confirm green.

## Prior state (still true)
ALL 10 PHASES CODE-COMPLETE (2026-07-03) + UI REDESIGN APPLIED (2026-07-04) from
design/project/Blinds Nisa Redesign.dc.html — IBM Plex, indigo #2A4FCF, 2px corners,
desktop sidebar + table patterns + order editor pricing rail; mobile bottom nav kept.

Remaining items are user/account-dependent (see progress.md): real Resend key + live
email test, `node scripts/e2e.mjs` on the dev machine, physical device pass, deployment
to Cloudflare (then lock CORS to the final Pages domain), weekly backup routine.

Next session: start from README.md + progress.md. If touching pricing/totals, remember
the web and api implementations are twins — change BOTH and their mirrored tests.

## Recent Changes (2026-07-04)
- **Delete Payment**: Added API endpoint and UI with auto-revert logic (`in_progress → awaiting_payment` on empty).
- **Status Advance**: Added one-step forward progression via tick icons on the Progress timeline in `OrderDetail.tsx`.
- **Line Items UI Refactoring**: Replaced large inline cards with a compact summary table. Added bulk delete and bulk edit (for `fabric`, `cassette`, `control` only on blind items). Integrated individual line item editing inside bottom sheet popups using a local copy pattern.

## Recent Changes (2026-07-03)
- Phase 1 verified: fresh install, `tsc --noEmit` clean on api, web builds, Worker bundles via `wrangler deploy --dry-run`
- Applied 5 approved stability improvements to `implementation_plan.md`:
  1. Vitest unit tests for money math (18 tests passing: `pricing.test.ts`, `orderNumber.test.ts`)
  2. UNIQUE index on `estimates.order_number` + Worker retry-on-conflict (planned for Phase 7)
  3. Send flow: `status='sent'` only after Resend succeeds; `public_token` reused on resend
  4. Phase 10 backup routine step (weekly pg_dump — free tier has no PITR)
  5. Wrangler aligned to ^4.20.0 (was ^3.114.0)
- Phase 2: wrote 10 migration files in `supabase/migrations/` + idempotent `supabase/seed.sql`
- Phase 3: implemented `middleware/auth.ts` (jose JWKS verify), `middleware/rateLimit.ts`,
  `lib/supabaseClient.ts`, `hooks/useAuth.ts` (Zustand), `pages/Login.tsx`,
  `components/ProtectedRoute.tsx`, rewrote `lib/api.ts` (token from supabase session, ApiError class),
  wired guards + Login into `App.tsx`, added `requireAuth` on `/api/*` + temp `/api/me` echo route

## Next Steps
- Run `pnpm --filter api test`, `pnpm --filter web test`, and both `tsc --noEmit` to confirm
  the Order + installation work is green (sandbox could not run them)
- Smoke-test the full lifecycle: send estimate → customer confirm (awaiting_payment) →
  reverse → confirm → record payment (in_progress, PDF→Invoice) → Mark Ready → Propose
  Installation (customer confirms/requests time) → Mark Installed
- A real Resend key is needed to actually deliver estimate + installation emails
- Set Worker secrets and `apps/web/.env`; verify login → `/api/orders` flow end-to-end

## Active Decisions
- No anon-role RLS policy for public estimate reads — the Worker (service role) is the only
  path to `/public/estimate/:token`, preventing estimate enumeration with the anon key
- Auth tokens are never manually persisted; `apiFetch` asks supabase-js for the current
  access token per request (auto-refresh included)
- In-memory rate limiter accepted with documented per-isolate limitation (fine at this scale)
- Tailwind CSS v4 with `@theme` tokens; SPDX headers say "Blinds Nisa"

## Important Learnings
- The plan references `IMPLEMENTATION.md` (§ sections) but that file is missing from the repo —
  `implementation_plan.md` is currently the source of truth for phase details
- Money columns are NUMERIC(10,2) everywhere; snapshot option prices onto line_items at save
- Supabase JWKS endpoint: `<url>/auth/v1/.well-known/jwks.json`; issuer `<url>/auth/v1`
- **Hono route registration order matters**: a literal path (`/calendar`) MUST be
  registered before a param path (`/:id`) that would otherwise swallow it — this bit
  the Calendar feature plan review (2026-07-06) and is now a documented pattern for any
  future literal sibling route under `/:id`-heavy route groups.
- **Cowork sandbox mount can go fully stale, not just "flaky"**: during the Calendar
  feature session (2026-07-06), files edited via the Edit/Write tools were confirmed
  correct via the Read tool, but the SAME paths read through the bash tool's mounted
  filesystem view came back truncated at a much earlier byte offset with a stale mtime
  (a full day old). This was consistent across repeated retries/sleeps, not
  intermittent. Treat `tsc`/`vitest`/build runs attempted via the bash tool as
  untrustworthy for confirming the current on-disk state in a Cowork session; the
  Read/Edit/Write tool results are the ground truth. Always hand off real
  compile/test verification to the dev machine.

## 2026-07-11 Update — Address autocomplete + appointment details/list
- **Current focus (done this session):** three calendar/customer enhancements.
  1. Search-as-you-type address autocomplete on every customer-entry surface, auto-filling
     the address block. Provider: free key-less Photon (OSM) — chosen over Google Places to
     avoid an API key/billing and keep the frontend secret-free. Files:
     `lib/addressSearch.ts`, `components/AddressAutocomplete.tsx`; wired into `CustomerForm.tsx`
     and `CustomerCreateModal.tsx`.
  2. Staff appointment-details page `/appointments/:id` (`pages/calendar/AppointmentDetail.tsx`
     + `GET /api/appointments/:id` + `useAppointment`) with the customer address linked to a
     Google Maps search. Any calendar chip / section row now opens it.
  3. "See All" appointments page `/appointments` (`pages/calendar/AppointmentsList.tsx` +
     `GET /api/appointments` paginated + `useAppointmentsList`): kind filter
     (all/estimate/installation), newest-first, 20/page with bottom pagination. "See All"
     button added to the calendar header.
- **Next steps:** run `pnpm check && pnpm test && pnpm lint` (web + api) on the dev machine —
  the Cowork sandbox could not run them (Windows node_modules + stale edited-file mount).
- **Active decision:** address autocomplete is additive/best-effort — geocoder failure
  silently degrades to manual entry, never an error state; manual editing of any field still
  works after an auto-fill.

## 2026-07-29 Update — Activity log preview cap
- **Current focus (done this session):** the order Activity Log at the bottom of
  `pages/orders/OrderDetail.tsx` now renders only the newest 10 rows, with a
  `Show N more` / `Show less` text toggle underneath (module constant `LOG_PREVIEW_COUNT`,
  local `logsExpanded` state).
- **Active decision:** the cap is client-side presentation only. `GET /api/orders/:id/logs`
  keeps its `created_at DESC` + `.limit(200)` contract, so the UI relies on the route's
  ordering for "newest" and adds no client sort. If that ordering ever changes, the slice
  silently shows the wrong end of the trail — change both sides together.
- **Verified on the dev machine:** web `pnpm check` clean, `pnpm test` 56/56, `pnpm lint`
  = the 4 pre-existing `LineItemEditor.tsx` fast-refresh warnings.

## 2026-08-01 Update - Customer view line items are collapsible
- **Current focus (done this session):** the public customer summary
  (`pages/customer-view/CustomerView.tsx`) renders each line item through a new module-scoped
  `LineItemRow`: the title/qty/total row is a disclosure button led by a chevron at the LEFT
  edge (points right collapsed, rotates 90 degrees open), and the item's attribute lines only
  render while open. First item open, rest collapsed.
- **Active decision:** rows toggle independently rather than as a single-open accordion, and
  open state is local per-row `useState`. That is only safe while this list is never sorted or
  filtered - it is rendered once per fetched payload, keyed by index. If the page ever gains
  item sorting/filtering, the state must be lifted and keyed by something stable.
- **Active decision:** rows whose `itemContent` yields no attributes (every non-blind item)
  get no arrow and no tap target, since the panel would be empty.
- **Verified on the dev machine:** web `pnpm check` clean, `pnpm test` 69/69, `pnpm lint` =
  the 4 pre-existing `LineItemEditor.tsx` fast-refresh warnings.

## 2026-08-04: Order-page button on the estimate/invoice PDF
- `PdfDocumentData` gained an optional `viewUrl`; `buildDocumentPdf` draws a clickable
  "View your order online" button between the totals and the Terms block. Omit/null
  `viewUrl` and the block disappears — that is the only way the old output is preserved.
- **The button belongs to the totals column, not the page.** Flush right, `TOTALS_W` (220pt)
  wide — the same track as Subtotal/Total/Balance due — filled with `BRAND` (#2563eb, the
  web `--color-brand-600` behind every primary button). The first pass centered it on the
  page in `INK` with the raw URL printed underneath; the owner rejected all three.
  `TOTALS_W` is exported and used for `labelX` too, so the column and the button cannot
  drift apart.
- Clickability comes from a PDF `/Link` annotation, not from the drawing. Use
  `PDFString.of(url)` for the `/URI` value: `context.obj` turns a plain JS string into a
  `PDFName`, which viewers will not follow.
- **`GET /orders/:id/pdf` now writes.** It mints and persists `public_token` when the order
  has none, so the staff-downloaded document's link resolves. Same reuse-or-mint rule as the
  send routes; minting is logged once. A GET with a side effect is deliberate here — the
  alternative is printing a dead link or no link at all on a draft.
- `toPdfData` takes `viewUrl` as a 4th parameter rather than deriving it, keeping the mapper
  free of `c.env` and of database access. All three call sites updated.
- Verified: api `tsc --noEmit` clean, api vitest 195/195. Web untouched — the Download
  button already just hits this endpoint.

## 2026-08-04: Modal focus loop (mobile keyboard) + line-item row alignment
- `components/ui/Modal.tsx` no longer re-focuses its panel on every render of the page that
  opened it. `onClose` sits behind a ref (callers pass inline arrows), the Escape/scroll-lock
  effect depends on `[open]` only, and panel focus is a separate `[open]`-only effect that
  no-ops when `document.activeElement` is already inside the panel.
- **Why it mattered:** on `/orders/:id` the "+ Add customer" pop-up (`CustomerCreateModal`)
  lost the software keyboard the instant it appeared. `OrderDetail` subscribes to
  `useKeyboardOpen()`, so opening the keyboard re-rendered the page, which re-ran the old
  effect, which blurred the input. Self-reinforcing — the keyboard could never stay up.
- **Constraint for future dialogs:** any effect that moves focus must be idempotent-by-guard;
  re-running one is destructive on mobile. Do not add `onClose` (or any caller-recreated
  prop) to a focus effect's dependency array.
- The order-screen line-item `<li>` is now `sm:items-center` (row and left group), with the
  `mt-0.5` checkbox/badge nudges cancelled at `sm+`. Phones keep `items-start` deliberately:
  item names wrap to several lines there and the checkbox must stay beside the first one.
- Verified on the dev machine: web `pnpm check` clean, `pnpm test` 88/88, `pnpm lint` = the
  4 pre-existing `LineItemEditor.tsx` fast-refresh warnings. Not exercised in a browser —
  every affected route is behind `ProtectedRoute` and no Supabase session was available.

## 2026-08-04: Order editor header split into customer / dates cards
- The one "customer + dates" card in `OrderDetail.tsx` is now two, rendered from the new
  `pages/orders/OrderHeaderCards.tsx`: `CustomerCard` (picker + expandable read-only
  customer record) and `OrderDatesCard` (order date, expiry date, expiry-term chips,
  order number).
- **Active decision (owner):** the expanded customer fields are READ-ONLY. They are real
  `<input readOnly>` elements for copyability, but nothing on the order screen writes to
  the customer row — editing stays in the Customers module.
- Expiry terms (On receipt / 1 / 3 / 7 / 15 days / 1 month) live in `lib/expiryTerms.ts`,
  not in the `.tsx`, so oxlint's `only-export-components` rule stays quiet. Only the
  resolved `expiry_date` is persisted; the chosen term is editor-only state
  (`expiryPreset`) that re-applies its offset whenever the order date changes.
- **Constraint:** `expiryPreset` takes priority over `expiryManual` in the auto-expiry
  effect. Order of the two branches matters — reversing it would freeze the chips.
- **Verified on the dev machine:** web `pnpm check` clean, `pnpm test` 94/94, `pnpm lint` =
  the 4 pre-existing `LineItemEditor.tsx` warnings. Browser check blocked at the login
  gate (no Supabase session).

## 2026-08-04: Terms acceptance gate on the public confirm button
- `CustomerView` gates `Confirm Estimate` behind an "I have read and agree to the Terms &
  Conditions" checkbox in the fixed bottom bar. Guarded twice (disabled button +
  early-return in `handleConfirm`).
- **Constraint:** the gate is skipped entirely when `estimate.terms` is empty, so a shop
  with no terms — or a stale payload — can still confirm. Do not tighten this to an
  unconditional requirement without also guaranteeing the field is always present.
- `TermsSection` is now controlled (`open`/`onToggle` props, `id="terms"`); the checkbox
  label links into it and scrolls it into view. Anything else that wants to open the terms
  should use the same lifted state rather than re-adding local state to the section.
- **Open decision for the owner:** acceptance is NOT recorded — no column, no timestamp, no
  snapshot of the terms version shown. The confirm route is untouched. If the acceptance
  needs to be evidence, that is a migration + `/public/estimate/:token/confirm` change.
- **Verified:** web `pnpm check` clean, `pnpm test` 94/94, `pnpm lint` = the 4 pre-existing
  `LineItemEditor.tsx` warnings. No browser run — the public page needs a live token and
  the dev app talks to the production Worker.

## 2026-08-04 (revision): customer details are plain text, not fields
- Owner rejected the read-only `<input>` rows added earlier the same day. The expanded
  customer card is now plain text laid out like an address label: name / phone / email,
  then "Shipping Address:" with billing BESIDE it (`sm:grid-cols-2`) only when the two
  differ. No boxes, no "Same as shipping" sentence — a matching billing address renders
  nothing at all.
- **Design rule to keep:** unchangeable values on this page get no field affordance. Boxes
  invite edits the order screen cannot perform (customer edits live in the Customers
  module).
- Address formatting: street + unit + city + province on line 1, `postal + " Canada"` on
  line 2. The country word is appended only behind a postal code.
- **Verified:** web `pnpm check` clean, `pnpm lint` = the 4 pre-existing warnings.

## 2026-08-04: expiry chips are re-derived, not remembered

Only `expiry_date` reaches the database, so the chip row is rebuilt from the dates on
hydration via `presetFromDates` (`lib/expiryTerms.ts`). Offsets are distinct — 0/1/3/7/15
days and a calendar month — so the first match is the only match, and the 14-day company
default deliberately matches no chip.

## 2026-08-04: the expiry default is suppressed until an order hydrates

`OrderDetail`'s auto-expiry effect writes `order_date + default_expiry_days` only when
there is no id, or the order has already hydrated. Without that guard it raced the
hydration effect in the same commit — `company` arriving flipped its deps — and clobbered a
hand-picked expiry date.
