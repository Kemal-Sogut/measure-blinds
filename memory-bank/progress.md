# Progress

> This file reflects CURRENT state only — no dated history. Overwrite it each time state
> changes; don't append entry after entry. Full change/bug history lives in
> `knowledge/history/engine_features.md` and `knowledge/history/bug_fixes.md`.

## What Works

**Order lifecycle:** draft → sent → awaiting_payment → in_progress → ready → installed
(+ expired), auto-expiry on sent. Confirmation is reversible by staff only, and only pre-
payment. Payments ledger with a derived balance (never stored); the PDF is an Estimate until
the first payment, then an Invoice. Order duplication re-prices from the current catalog and
leaves payments/logs/appointment/warranty/public-token behind. Revert (backward-only) and
delete (draft/expired only) are both guarded.

**Customer-facing:** a permanent public order-summary page (not one-shot) with a 5-step
tracker (Confirmed → Awaiting Payment → In Production → Ready → Installed), the quoted 50%
deposit, e-Transfer instructions, cancellation request/withdraw, installation confirm/
request, and collapsible line items/terms. Confirm is gated behind a Terms checkbox
(UI-only — see Known Issues).

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
defaults) and colour, restricted to a single selected blind type per run, and clears a manual
price override only when something that actually feeds the price changed.

**Documents & communications:** branded estimate/invoice PDFs (pdf-lib) with a clickable
"View your order online" link matching the app's brand blue (`#2563eb`) throughout — button,
web, and email templates now agree. Warranty certificates issue automatically on paid-in-full
(10y products / 2y motorised parts, parts-only — no workmanship cover), resendable, staff-
downloadable. Payment receipt emails per payment. 13 responsive HTML email templates.
Production labels (browser `window.print()`, one 3x1.5in label per unit of quantity, shop-code
hardware line). Manufacturer Copy cut sheet (aluminium 1-D bin packing, fabric 2-D shelf
packing, both keyed off live Material catalog data, overridable stock length as a what-if).

**Settings/catalogs:** Materials (per-blind-type, many-to-many linking), cassette/bottom-rail/
control/installation option catalogs (scoped per type, price + basis), per-type defaults,
company info + logo, Terms & Conditions, e-Transfer details.

**Platform:** installable PWA (`display: standalone`, derived icon set from one source SVG);
pull-to-refresh in standalone mode (query invalidation, never a hard reload); one responsive
shell for every width (collapsible rail at `md+`, full-screen overlay below, one
`.page-container` fluid track); calendar surface over the installation/estimate-visit
scheduling domain; address autocomplete built but switched off
(`ADDRESS_SEARCH_ENABLED = false` in `AddressAutocomplete.tsx`).

## What's Left / Known Issues
- **No real device has ever driven the app itself.** Every staff route sits behind
  `ProtectedRoute`, so verification to date is types + tests + production builds, occasionally
  a signed-in desktop-Chrome session, or (once, 2026-08-20) a throwaway component-level Vite
  harness for the bulk-add row — never the live app on a real phone/tablet. This is the
  standing gap behind nearly every "verify before field use" note below.
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
