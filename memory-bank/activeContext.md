# Active Context

> This file reflects CURRENT state only — no dated history. Overwrite it each time state
> changes; don't append. Full change history lives in `knowledge/history/engine_features.md`
> and `knowledge/history/bug_fixes.md`.

## Where things stand (as of 2026-08-22)
Working branch `claude/competent-neumann-16a922`, off `main` at `be8972d` (per-option prices
on the customer's documents — now committed on `main`, not in-flight; see below). This
branch adds the internal Material usage DIALOG to the order editor — fabric quantity and
rate per material, a per-material editable rate that reprices the lines using it, and the
order-wide $/m² (and, for Curtains, $/m) give-back that writes the fixed discount — plus
the `describeMaterialUsage` blind-type method behind it. Open on PR #39. Full detail,
including the `materialCost` vs. `describeMaterialUsage` bit-identity rationale and the
per-material rate design, is in `knowledge/history/engine_features.md`, 2026-08-22 (two
entries); the approved design for the original panel is
`knowledge/specs/2026-08-21-material-usage-discount-design.md`. Verified: web `pnpm check`
clean, `pnpm test` 397/397 (24 files), `pnpm lint` 0/0; api `pnpm check` clean, `pnpm test`
391/391 (19 files). **Not verified in a browser** — no `apps/web/.env` exists in this
worktree, so `supabaseClient.ts` throws at module init before React mounts any route and
the dialog has never been seen on screen (see "Next steps" below). Not merged, not deployed.

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
- **The Material usage dialog has never been rendered.** This worktree has no
  `apps/web/.env` (only `.env.example`), so `apps/web/src/lib/supabaseClient.ts` throws
  `Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY` at module init and the app never
  gets past a blank page — no login screen, no route, nothing to click. The code passed
  type-check, both test suites, and lint, but nobody has seen the trigger row, the dialog
  opening, the per-material rate box / reset button / "Apply to N lines" flow moving the
  order total, the give-back writing the discount field, the mobile bottom-sheet layout, or
  the two-rate-input case (a `running_m` row present alongside a `sqm` one). Needs
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
