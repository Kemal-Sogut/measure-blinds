# Active Context

> This file reflects CURRENT state only — no dated history. Overwrite it each time state
> changes; don't append. Full change history lives in `knowledge/history/engine_features.md`
> and `knowledge/history/bug_fixes.md`.

## Where things stand (as of 2026-08-25)
On `main` at `2781d31` ("material-usage-updated" — the Material usage PER-WINDOW breakdown is
now committed and plain history, `knowledge/history/engine_features.md` 2026-08-25; bulk edit
v3, the Material usage DIALOG and the composing give-backs landed before it, same file
2026-08-25/2026-08-22).

Uncommitted in the worktree, on `main` with no branch or PR yet: **the calendar's under-grid
sections are upcoming-only**, web-only, one file
(`apps/web/src/pages/calendar/ScheduleSections.tsx`), no API/hook/query surface. A local
`hasPassed(date, time)` drops an appointment from the "Estimate appointments" /
"Installation appointments" lists once its 1-hour visit window has ended, so those sections
read as a worklist instead of a growing log. Past appointments are untouched everywhere else:
their chips stay on the month grid above and "See All" (`/appointments`) remains the archive.
Expect a fully past month to show empty sections with chips still on the grid — intended.
Detail in `knowledge/history/engine_features.md`, 2026-08-25. Verified: web `pnpm check`
clean, `pnpm lint` 0/0, `pnpm test` 399/399; api untouched; NOT seen in a browser, and
`ScheduleSections` still has no covering tests. Not deployed.

Also uncommitted, independent of the calendar change and touching one file
(`apps/web/src/pages/orders/MaterialUsageDialog.tsx`): the per-window breakdown committed in
`2781d31` is now COLLAPSED by default, behind a `Per window` disclosure button in a new
non-exported `LineBreakdown` component. Its `open` flag is local `useState` — the one
deliberate exception to the "lift every piece of state" rule in `MaterialUsageDialogProps`,
because the panel renders once inside the dialog and is meant to be forgotten on dismissal.
Aggregation is unchanged, so the 399 tests still cover it; the disclosure itself is
render-only and untested, like the rest of the dialog's UI. NOTE: `apps/web/.env` and
`.env.local` DO exist in this worktree now, so the long-standing "the app can't boot at all"
blocker below is out of date for anyone with a Supabase login.

Also uncommitted, web-only, same one file (`apps/web/src/pages/orders/OrderList.tsx`): **every
orders-list row now carries Delete beside Duplicate**, in a shared `RowActions` strip
(identical at both breakpoints, only the geometry differs; row padding widened `pr-14` →
`pr-24` to clear it). Delete confirms by order number and reuses the existing `useDeleteOrder`
hook and `DELETE /api/orders/:id` — no API, hook or schema change, and no looser rule than the
order page's own Delete. Own pending state per row; nothing navigates on success, the row just
leaves the invalidated list. Detail in `knowledge/history/engine_features.md`, 2026-08-25.

Also uncommitted, web-only, one file (`apps/web/src/pages/orders/OrderList.tsx`): **the orders
list is paginated at 15 per tab**, pager bottom-right under the list (range label, Previous,
"Page N of M", Next), hidden when the tab fits on one page. Paging is client-side over the
tab result already fetched, so no API/hook/query-key change and no request per page; the
summary tiles still count the whole tab, not the page. `page` is state but the rendered page
is derived and clamped to `totalPages`, so a shrinking result can't strand the user on an
empty page; tab switch and search both reset to page 1. KNOWN CEILING: `GET /api/orders`
caps at `.limit(100)`, so the pager cannot reach past the first 100 orders of a tab —
going further is a server-paging change, not a UI one. Detail in
`knowledge/history/engine_features.md`, 2026-08-25. Verified: `tsc` clean; NOT seen in a
browser (the dev server stops at the login wall) and `OrderList` has no covering tests.

**Also uncommitted, and needing its own DATABASE migration applied before deploy:**
customer-facing **maintenance mode** (migration 40,
`supabase/migrations/20260825000040_company_maintenance_mode.sql`). `company_settings` gains
`maintenance_mode boolean not null default false` + `maintenance_message text not null
default ''`. A single `app.use('*')` gate in `apps/api/src/routes/public.ts` — after the rate
limiter, before every handler — answers all eight `/public/*` routes with
`503 { error, maintenance: true, message }` while the flag is on, touching no order or
appointment row; `/api/*` stays open on purpose. Staff flip it on Company Info
(`CompanyInfo.tsx`), where the switch saves IMMEDIATELY rather than waiting for Save, and
`MaintenanceBanner` in `Layout` keeps an amber strip on every authenticated page so the state
is impossible to forget. Customers get a "Back shortly" card via
`apps/web/src/lib/maintenance.ts`, which requires the 503 AND the explicit flag so a real
outage still reads as an error. Verified: api 428/428, web 425/425, `tsc` + `oxlint` clean
both sides; NOT seen in a browser (needs the migration applied). Detail in
`knowledge/history/engine_features.md`, 2026-08-25.

**Also uncommitted, and the one other change here that needs a DATABASE migration applied
before deploy:** the per-item price lock, in force from SEND onward (migration 39,
`supabase/migrations/20260825000039_line_items_price_lock.sql`). `line_items` gains
`locked_base_price` + `locked_inputs_fingerprint`; `POST /:id/send` and `/mark-sent` freeze
every item at its calculated price, `PUT /:id` re-uses the frozen figure while a fingerprint of
that item's pricing inputs still matches, and `/confirm` plus any manual stage move to `sent`
or beyond freeze whatever is not frozen yet. `draft` is the only live-priced status: only
returning an order to draft (manual status change, or reviving a lapsed estimate) releases a
lock — unconfirming does not, since the order lands back on `sent`. New
modules: `apps/api/src/lib/priceLock.ts` (pure fingerprint rule) + its live-preview twin
`apps/web/src/lib/priceLock.ts`, and `apps/api/src/lib/priceLockStore.ts` (freeze/release/read).
Editor drafts carry `lock`, the preview prices from it, and `LineItemRow` shows a padlock while
it holds. Detail in `knowledge/history/engine_features.md`, 2026-08-25. Verified: api 429/429,
web 425/425, both `tsc` clean, `oxlint` clean; NOT seen in a browser. **Apply the migration
before deploying the Worker** — every save writes both columns, so the new Worker against the
old schema would fail every order write.

Note for the next session: `pnpm install` had to be re-run here — `apps/web/node_modules/
typescript` was an empty directory and `pnpm check` died with `Cannot find module …/typescript/
bin/tsc` until it was.

`main` itself is clean and carries, most recently: the fully manual order-lifecycle override
(`POST /api/orders/:id/status`, every Progress-timeline stage a one-click move — merged via
PR #38, `knowledge/history/engine_features.md` 2026-08-20) and per-option prices on the
customer's documents (the four hardware options print what they added to the line beside
their names on the estimate/invoice PDF and the public customer page, via
`apps/api/src/lib/optionBreakdown.ts`'s `optionLineAmounts` and the public payload's
`option_prices`). Both were previously tracked here as in-flight/uncommitted; both are now
plain commits on `main` (`1cf4fea`, `be8972d`).

Live on `main`: server-authoritative pricing with per-type blind modules (Curtains is the one
type with a divergent formula); per-type hardware scoping + price basis; per-blind-type saved
defaults (Settings → Defaults); bulk-add (multi-section, works before a type/material is
chosen) as the only bulk-entry path; bulk edit v2 (type + colour); drag-and-drop line-item
reorder + a 3-dot row menu (Show/Hide, Duplicate, Move up/down); line-item price overrides +
custom add-ons; order duplication; warranty certificates on paid-in-full; payment receipts;
installation scheduling + cancellation requests; the public order-summary/tracker page; PWA
install + pull-to-refresh; the soft-dashboard UI redesign with a shared `components/ui/`
primitive layer.

## Next steps / open work
- **The Material usage dialog has never been seen inside the real order page.** This
  worktree has no `apps/web/.env` (only `.env.example`), so
  `apps/web/src/lib/supabaseClient.ts` throws `Missing VITE_SUPABASE_URL or
  VITE_SUPABASE_ANON_KEY` at module init and the app never gets past a blank page. A
  throwaway component harness verified the dialog's own layout and behaviour (rates,
  additivity, reset, the mobile sheet, the two-rate-input case), but nobody has seen the
  trigger row in the real totals rail or the mobile totals card, and no save round-trip has
  run. The per-window breakdown added on 2026-08-25 inherits this: its aggregation is under
  test, its rendering is not. Needs
  `apps/web/.env` (`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` for project
  `lgbxxlwsdeuhdgzrjjen`), a valid login, and `apps/api/.dev.vars` with the service-role
  key before this can be driven end to end.
- Nothing in this app has been driven on a real phone by a human — every staff route sits
  behind `ProtectedRoute`, so the standing ask across almost every branch has been "verify on
  an actual device." The one exception: on a 2026-08-20 maintainer report that the bulk-add
  measurement row's Width field was unreadable on a phone, the row (`RowFields` in
  `BulkAddSectionCard.tsx`) was rendered through a throwaway Vite entry (component-level, not
  the live app) and confirmed at 375×812 — it is now TWO lines (room name + ✕ above,
  `grid-cols-[3fr_2fr]` Width/Height below) because the 44px "+" panel-separator button eats
  ~48px from whichever field carries it, and the old even one-line split
  (`grid-cols-[4fr_3fr_3fr]`) left under four digits of the width value visible. Everything
  else in bulk-add's newest UI (card/row contrast, wider popups) is still unverified in any
  browser.
- No `KeyboardSensor` on the line-item drag reorder — pointer/touch only; the row menu's Move
  up/down is the only keyboard/screen-reader path.
- No API route test for `GET`/`PUT /api/settings/blind-type-defaults`.
- Defaults page: a sibling field's already-in-flight PUT can still land a stale value if
  another field's save is rejected mid-request (partially mitigated by `pendingWrites` +
  `nextDraftForSave`; fully closing it needs serialized saves or a request-generation token).
- Terms acceptance on the customer page is a UI gate only — not persisted (no
  `terms_accepted_at`, no snapshot of which terms text was shown).
- `OrderDetail.tsx` (~3,170 lines) and `apps/api/src/routes/orders.ts` (~2,220 lines) are well
  past the 800-line guideline (AI_GUIDELINES §6) — reduce opportunistically when already
  working in them, per §8.
- Address autocomplete (`lib/addressSearch.ts` + `AddressAutocomplete.tsx`) is ON again
  (`ADDRESS_SEARCH_ENABLED = true`, 2026-08-20) with a selection lock that keeps the dropdown
  dormant after a pick until the field is typed in or deleted from. The Photon accuracy
  complaint that closed it on 2026-08-01 was accepted, not fixed — expect wrong or missing
  streets for some service-area addresses. Live in-app behaviour is unverified.

## Active decisions / learnings not obvious from the code
- Hono literal routes (e.g. `/calendar`, `/settings/blind-type-defaults`) must be registered
  before `/:id` param routes in the same group, or the param route swallows them.
- `applyTypeDefaults` (`lineItemDrafts.ts`) is the one place a blind-type change resets an
  item's options — three call sites route through it (single-item dropdown, bulk edit,
  bulk-add section).
- `bulkRowHasContent` / `bulkAddHasContent` are the one "has this bulk-add sheet got typed
  content" test — used for the confirm count, the enabled state, and the discard-confirmation
  guard. Don't re-derive it inline.
- Twin files (`lib/pricing.ts`, `lib/totals.ts`, `lib/blindTypes/*`, `lib/customerName.ts`,
  `lib/lineItemAdjustments.ts`) must be edited on both `apps/api` and `apps/web` — see
  AI_GUIDELINES §1.
- `calculateUnitPrice` is now the SUM of `describeUnitCosts()` rather than a parallel
  calculation. Two details are load-bearing and look like style if you don't know why: the
  material leg is destructured OUT of the reduction, and `describeUnitCosts` inserts hardware
  legs in the fixed order `cassette, bottom_rail, control, installation`. Float addition is not
  associative, so this reproduces the historical `material + ((h1 + h2) + h3)` association
  exactly — the refactor is bit-identical, not merely equivalent. Don't "tidy" either one.
- Option cells on the Presentation page are FITTED to `round2(calcUnit × qty)` with the
  material cell absorbing the correction, never summed independently. `line_total` is
  `round2(unit_price × qty) + addonsTotal`, so independently-rounded legs miss it by up to two
  or three cents and would show a phantom adjustment on an ordinary line. Because of the
  fitting, the Adjustment column means only "override and/or add-ons", which is what lets the
  page promise a row that adds up in front of a customer.
- `docs/` is gitignored in this repo. Specs and plans go in `knowledge/specs/` and
  `knowledge/plans/`, NOT the `docs/superpowers/...` default the planning skills suggest.
- `blindDraftInputs(draft, catalogs)` (`lineItemDrafts.ts`) is the priced-inputs assembly
  extracted out of `blindDraftPrice` so a second consumer (the Material usage panel's
  aggregator) shares the exact same completeness gating instead of a looser copy.
  `blindDraftPrice` is now a thin caller of it — reach for `blindDraftInputs` for anything
  that needs a blind draft's `BlindPricingInputs` without wanting the dollar figure.
- `describeMaterialUsage` (blind-type modules) is pinned to `materialCost` by a test, not
  by construction — see `systemPatterns.md`. Don't refactor one to derive from the other.
- Money-triggered side effects (email + a persisted flag) belong in a `lib/` helper called
  from every door that can produce the event (a consultant's own action AND the e-Transfer
  webhook), never inline in one route — see `lib/warrantyIssue.ts`, `lib/payments.ts`.
- The automatic production trigger (awaiting_payment → in_progress) fires only when the ledger
  reaches the 50% deposit (`round2(total/2)`, half-cent epsilon), computed inside
  `recordOrderPayment` by re-reading the ledger AFTER the insert — so both doors and a run of
  smaller payments behave identically. Manual advancement is a SEPARATE route and is
  intentionally not gated ("manual progress below 50% is allowed"). Payment-deletion auto-
  revert stays "only when the ledger is emptied" for the same reason — a manual/threshold
  advance must not be auto-undone.
- The customer page must never derive money (AI_GUIDELINES rule 1): "deposit reached?" on
  `CustomerView` compares `amount_paid` to the server's `deposit_due`, it does not compute
  `total/2` itself. Likewise the "How to pay" figure is always a server field the page merely
  selects and labels — `deposit_due` up front, `balance` (total − paid) once installed —
  through `PaymentSection`'s `amountDue` descriptor; the box never does arithmetic.
- Expiry is symmetric across ONE threshold (`today`, `YYYY-MM-DD` string compare):
  `applyDefensiveExpiry` expires a `sent` order when `expiry_date < today`; `PUT /api/orders/:id`
  revives an `expired` order to `draft` when the edited `expiry_date >= today`. Revive targets
  `draft`, not `sent` (nothing re-sent yet), and only an `expired` order is rewritten. Keep the
  two comparisons in lockstep — a drift between them would leave orders that are neither
  expired nor revivable.
