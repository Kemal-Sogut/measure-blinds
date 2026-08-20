# Active Context

> This file reflects CURRENT state only — no dated history. Overwrite it each time state
> changes; don't append. Full change history lives in `knowledge/history/engine_features.md`
> and `knowledge/history/bug_fixes.md`.

## Where things stand (as of 2026-08-20)
Branch `main`, latest merge PR #35 (`feat/defaults-bulk-lineitems`). Since then, uncommitted on
`main`: the 50%-deposit production gate + customer-page "how to pay" windowing + auto-scroll on
confirm + "Paid to date" removed from the customer view; an "Add order" shortcut on the
appointment detail page that opens `/orders/new?customer=<id>` with the customer pre-filled; the
send-receipt row icon swapped from an envelope to a receipt glyph; and `PUT /api/orders/:id`
reviving an `expired` estimate to `draft` when its expiry date is extended to today-or-later
(all dated 2026-08-20 in `knowledge/history/engine_features.md`, except the cosmetic icon swap).
Verified: web `pnpm check` clean, `pnpm test` 305/305 (20 files), `pnpm lint` (oxlint) 0
warnings/errors; api `pnpm check` clean, `pnpm test` 343/343 (18 files).

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
- Address autocomplete code exists (`lib/addressSearch.ts` + `AddressAutocomplete.tsx`) but is
  switched off (`ADDRESS_SEARCH_ENABLED = false`); re-enabling is a one-line flip.

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
  `total/2` itself.
- Expiry is symmetric across ONE threshold (`today`, `YYYY-MM-DD` string compare):
  `applyDefensiveExpiry` expires a `sent` order when `expiry_date < today`; `PUT /api/orders/:id`
  revives an `expired` order to `draft` when the edited `expiry_date >= today`. Revive targets
  `draft`, not `sent` (nothing re-sent yet), and only an `expired` order is rewritten. Keep the
  two comparisons in lockstep — a drift between them would leave orders that are neither
  expired nor revivable.
