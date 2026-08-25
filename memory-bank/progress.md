# Progress

> This file reflects CURRENT state only — no dated history. Overwrite it each time state
> changes; don't append entry after entry. Full change/bug history lives in
> `knowledge/history/engine_features.md` and `knowledge/history/bug_fixes.md`.

## What Works

**Order lifecycle:** draft → sent → awaiting_payment → in_progress → ready → installed
(+ expired), auto-expiry on sent (only `sent` orders lapse). Editing an `expired` estimate's
expiry date to today-or-later revives it to `draft` (never straight to `sent` — a fresh `/send`
is the only path back) inside `PUT /api/orders/:id`, mirroring the `< today` rule that expired
it; a still-past date leaves it expired, and no non-expired status is ever rewritten there.
Confirmation is reversible by staff only, and only pre-payment. Payments ledger with a derived balance (never stored); the PDF is an Estimate until
the first payment, then an Invoice. Production starts automatically only when the ledger
reaches the 50% deposit (`recordOrderPayment` gates awaiting_payment → in_progress on
`round2(total/2)`; shared by the staff route and the e-Transfer webhook) — a sub-deposit
payment is recorded but does not advance, and staff may still advance an under-deposited
order by hand. Deleting the LAST payment reverts in_progress → awaiting_payment; dropping
below 50% while some payment remains does not (manual/threshold advances are not auto-undone).
Order duplication re-prices from the current catalog and leaves payments/logs/appointment/
warranty/public-token behind. Delete stays guarded (draft/expired only), but the STAGE itself
no longer is: `POST /api/orders/:id/status` sets any of the six stages from any status,
timeline-driven, with `sent_at`/`confirmed_at`/`installed_at` reconciled off the target stage
index and the installation appointment dropped below `ready`. It never emails and never
touches the payment ledger; the guarded routes (`/confirm`, `/ready`, `/installed`, `/revert`,
`/mark-sent`, `/in-progress`) remain for the email, payment, and customer-confirm flows.

**Customer-facing:** a permanent public order-summary page (not one-shot) with a 5-step
tracker (Confirmed → Awaiting Payment → In Production → Ready → Installed), the quoted 50%
deposit, e-Transfer instructions, cancellation request/withdraw, installation confirm/
request, and collapsible line items/terms. The "HOW TO PAY" block is windowed to when the
customer actually owes a transfer (`showHowToPay`): shown while the deposit is outstanding,
hidden once the 50% is in and the order is in production/ready, and shown again at
installation if a balance remains. Its single figure follows the same split — the server's
`deposit_due` ("Deposit due now (50% of total)") up front, the server's `balance`
(total − paid, "Pay your balance") once installed and owing — via `PaymentSection`'s general
`amountDue` descriptor; the balance is the one figure deliberately shown twice (totals block +
payment box, beside the address). Confirming scrolls the page back to the top (Confirm sits
in the fixed bottom bar). Confirm is gated behind a Terms checkbox (UI-only — see Known
Issues).

**Blind types & pricing:** ten canonical blind types as modules (`lib/blindTypes/`, twinned
api/web); Curtains is the one type with a genuinely divergent formula (fabric per running
metre × pleat fullness + per-panel hem allowance + a fixed installation charge). Every
type's extra inputs live in `line_items.attributes` jsonb, validated by a per-type
`.strict()` Zod schema server-side. Hardware slots (cassette/bottom rail/control/
installation) are scoped per blind type via join tables (an option with no types linked is
offered nowhere) and priced via a shared basis (per m / m² / unit / panel) interpreted in
one function. Per-blind-type saved defaults (Settings → Defaults) auto-fill a new item's
options and are what every type-change path resets through (`applyTypeDefaults`).

**Line items:** stable `uid` + `hidden` flag (hiding mutes an item everywhere — totals, PDF,
customer page, labels, cut sheet — while keeping it editable); price overrides with an
optional "show original" strikethrough and up to 10 custom `{label, price}` add-ons; a typed
panel-width shorthand (`118.5+118` = two panels) in both the single-item form and bulk-add
rows. `LineItemList`/`LineItemRow` render a 3-dot menu (Show/Hide, Duplicate, Move up/down),
an expandable detail panel, and a drag handle for reordering (`@dnd-kit`, pointer/touch only).

**Bulk entry/edit:** `BulkAddSheet` is the only bulk-entry path — one section per blind type
with shared per-section config, many measurement rows, one fully-specified line item per row;
usable before a blind type/material is chosen (measure first, configure later). Each
measurement row is two lines (room name + ✕ remove above; Width/Height at
`grid-cols-[3fr_2fr]` below) — split this way 2026-08-20 because the 44px "+" panel-shorthand
button reserves ~48px on the width field alone, and an even one-line split left its value
unreadably truncated on a phone. Bulk edit can change blind type (resetting to that type's
defaults) and colour, and clears a manual price override only when something that actually
feeds the price changed. A selection no longer has to share a type: only an empty or
non-blind selection is refused, and when the selected rows disagree about their type — or
none has one yet — the popup offers Blind type and Colour ALONE, revealing that type's
material/hardware dropdowns once one is picked. Picking a type always resets each selected
item onto that type's saved defaults, including items already on it, so a unified run leaves
every row identical; leaving it on "No change" over a mixed selection edits colour only.

**Documents & communications:** branded estimate/invoice PDFs (pdf-lib) with a clickable
"View your order online" link matching the app's brand blue (`#2563eb`) throughout — button,
web, and email templates now agree. Each blind's four hardware options print what they added
to the LINE beside their names on both the PDF and the public customer page
(`Cassette: Standard — $28.00`); a zero-cost option prints its name alone, and material,
colour and blind-type attributes carry no figure. The amounts come from
`apps/api/src/lib/optionBreakdown.ts` (`optionLineAmounts`) — snapshot columns back through
`describeUnitCosts`, × quantity, rounded — and reach the unauthenticated page as
`option_prices` on the public payload, never as rates or price bases. Warranty certificates issue automatically on paid-in-full
(10y products / 2y motorised parts, parts-only — no workmanship cover), resendable, staff-
downloadable. Payment receipt emails per payment. 13 responsive HTML email templates.
Production labels (browser `window.print()`, one 3x1.5in label per unit of quantity, shop-code
hardware line). Manufacturer Copy cut sheet (aluminium 1-D bin packing, fabric 2-D shelf
packing, both keyed off live Material catalog data, overridable stock length as a what-if).

**Order Presentation (`/orders/:id/present`):** the customer-facing view a consultant turns
toward the customer in person, reached from a "Present to Customer" action directly below
Confirm on the UNCONFIRMED stages only (draft, sent, expired); it saves before navigating,
same tab. One row per blind, one column per option type carrying that option's money, plus
`<tfoot>` totals per column that track a stackable filter bar (AND across option types, OR
within one; every value harvested from the order's own line items with a blind count). Unused
option columns and the Adjustment column drop out; hidden items are excluded; an option that
adds nothing prints its bare name. Per-option money comes from the new public
`BaseBlindType.describeUnitCosts()` — `calculateUnitPrice` is now the SUM of that breakdown,
so a price basis is still interpreted in exactly one place. Cells are fitted to the stored
price so `Σ cells + adjustment === line_total` exactly on every row. The filter-tracking
overall total and the server-authoritative order strip (subtotal/discount/HST/total, never
recomputed) are deliberately separate numbers.

**Material usage dialog (trigger row above the discount control at both breakpoints;
`MaterialUsageDialog.tsx`, rendered once for the page):** internal-only — never shown to a
customer, never printed, absent from the PDF, the public customer view,
`/orders/:id/present`, and `/orders/:id/overview`. Shows billed material quantity, rate, and
material-leg revenue per material, grouped by material AND rate unit (m² / running metre),
hidden lines dropped and preset/custom/incomplete lines counted as excluded rather than
priced; a note surfaces billed-vs-measured area when minimums inflated it. Two discounting
instruments, **both of which are pure discount math — neither touches a line item**:
- **Per material.** Each row's rate box is prefilled with the catalog rate and has a reset
  button inside it. Typing a lower rate and pressing "Discount $X" adds
  `(catalog rate − typed rate) × that material's billed quantity` to the order's fixed
  discount. A rate above the catalog rate is clamped to $0.00 with the button disabled.
- **Across the order.** A `$/m²` rate (and, only when a Curtains line is present, a separate
  `$/m` rate) applied over every material at once, plus a "Remove $X" button.

Both compose through `applyGiveBackPart`: **additive, keyed and reversible.** A second Apply
sits on top of the first, re-applying one row swaps that row's own figure rather than
stacking, Reset takes exactly that row's figure back out, and a hand-typed discount is the
base it all sits on. **The contributions map is session state** — after a reload the discount
is a plain dollar figure and Reset can no longer undo an earlier session. Applying switches a
percentage discount to fixed (discarding the percentage), with a warning. Using both
instruments on the same fabric double-counts it; the dialog warns in red.

Backed by a new public `BaseBlindType.describeMaterialUsage()` (both twins) alongside
`describeUnitCosts`, which Curtains overrides to report running metres; deliberately NOT the
source of `materialCost` (bit-identity risk to historical orders) — the two are held
together by a consistency test in both `pricing.test.ts` suites instead. See
`knowledge/history/engine_features.md`, 2026-08-22 (two entries), for the full rationale.

**Settings/catalogs:** Materials (per-blind-type, many-to-many linking), cassette/bottom-rail/
control/installation option catalogs (scoped per type, price + basis), per-type defaults,
company info + logo, Terms & Conditions, e-Transfer details.

**Platform:** installable PWA (`display: standalone`, derived icon set from one source SVG);
pull-to-refresh in standalone mode (query invalidation, never a hard reload); one responsive
shell for every width (collapsible rail at `md+`, full-screen overlay below, one
`.page-container` fluid track); calendar surface over the installation/estimate-visit
scheduling domain, whose appointment-detail page carries an "Add order" shortcut
(`/orders/new?customer=<id>`, pre-fills the customer via `useCustomer`); Photon address
autocomplete live on both customer-entry surfaces (`ADDRESS_SEARCH_ENABLED = true` in
`AddressAutocomplete.tsx`), dormant after a suggestion is picked until the field is edited.

## What's Left / Known Issues
- **The Material usage dialog has never been rendered inside the real order page.** This is
  a harder blocker than the general "no real device" gap below: the dev server boots, but
  `apps/web/src/lib/supabaseClient.ts` throws `Missing VITE_SUPABASE_URL or
  VITE_SUPABASE_ANON_KEY` at module init because no `apps/web/.env` exists in this
  worktree (only `.env.example`), so the app never renders past a blank page — no login
  screen, no route, nothing to click at all. The code passed type-check, both
  `pricing.test.ts`/`materialUsage.test.ts` suites, and lint (0 errors, 0 warnings), and the
  dialog itself has been driven in a throwaway component harness (see below) — but no one has
  seen the trigger row in the real totals rail, the mobile totals card, or a save round-trip.
  Needs
  `apps/web/.env` populated (`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` for project
  `lgbxxlwsdeuhdgzrjjen`) plus a valid login and `apps/api/.dev.vars` before this can be
  driven end to end.
- **No real device has ever driven the app itself.** Every staff route sits behind
  `ProtectedRoute`, so verification to date is types + tests + production builds, occasionally
  a signed-in desktop-Chrome session, or (twice, 2026-08-20) a throwaway component-level Vite
  harness — for the bulk-add row, and for the Order Presentation table and filter bar — never
  the live app on a real phone/tablet. This is the standing gap behind nearly every "verify
  before field use" note below. The Presentation page's own shell (data fetch, order-total
  strip, other-items section, print layout) has therefore never been rendered at all; only its
  two child components have.
- Bulk-add's newest UI still has real gaps beyond the row-width fix above: the live
  panel-shorthand split has not been tried on an actual iOS decimal keypad, and the card/row
  contrast pass and wider popups have never been rendered and looked at by a human or an
  agent, in-app or otherwise.
- White input fill (`#ffffff`) against the sunken measurement-row background (`#f1f2f5`) is
  only 1.12:1 contrast — flagged, not yet addressed.
- No `KeyboardSensor` on line-item drag reorder (pointer/touch only); the row menu's Move
  up/down is the only keyboard/screen-reader reorder path.
- No API route test for `GET`/`PUT /api/settings/blind-type-defaults`.
- Defaults page: a sibling field's already-in-flight PUT can still land a stale value if
  another field's save is rejected mid-request (partial mitigation via `pendingWrites` +
  `nextDraftForSave`).
- Terms acceptance on the customer page is a UI gate only — no `terms_accepted_at`, no
  snapshot of which terms text was shown at confirm time.
- `OrderDetail.tsx` (~3,170 lines) and `apps/api/src/routes/orders.ts` (~2,220 lines) are
  well past the 800-line file-size guideline — standing violations to reduce opportunistically
  (AI_GUIDELINES §6/§8), and have grown since first flagged rather than shrunk.
- Address autocomplete is fully built but off by a single flag — re-enabling needs a
  deliberate call, not code work.
- Live email delivery, live e-Transfer webhook matching, and printed labels on physical
  hardware have working code paths and tests but no confirmed real-world run on record.

## Decision Evolution (durable, still governing)
| Decision | Why |
|----------|-----|
| Server-authoritative money | Client sends measurements + catalog option ids only; the Worker fetches prices, snapshots them, computes every total. Zod schemas reject client-supplied money fields. |
| No anon RLS on business tables | Public estimate reads go only through the Worker (service-role, token lookup); the anon key grants zero data access. |
| Snapshot pricing on line items | Material/hardware names + prices are stored at save time so a later catalog edit or rename never rewrites a historical order's total or printed name. |
| Hardware scoping is DATA, not code | Which slots a blind type uses lives in `<catalog>_blind_types` join tables, so the shop can turn a slot off per type from Settings with no deploy. Empty links = no types offered (opposite of Materials' "empty = every type" convention — both conventions are deliberate and both are live). |
| Per-option price basis | How a hardware option is charged (per m / m² / unit / panel) lives on the catalog row, interpreted by one function — not hardcoded per type. |
| pdf-lib, not @react-pdf | @react-pdf's WASM cannot run in workerd. |
| UNIQUE order_number + retry | Count-based generation can race under concurrent saves. |
| Email-then-persist | Any status change that announces something by email persists only after the send succeeds, so a bounced email never leaves the record claiming it went out. |
| Twin api/web modules | `pricing.ts`/`totals.ts`/`blindTypes/*`/etc. are mirrored files with mirrored test suites — the shared-package refactor was deliberately deferred; the mirrored suites are the drift alarm. |
| Catalog seeds must be identities | Pricing recomputes server-side on every save, so a newly seeded value (multiplier/price) applies retroactively to old orders on their next save — seed 0/1, let the shop set real values. |
