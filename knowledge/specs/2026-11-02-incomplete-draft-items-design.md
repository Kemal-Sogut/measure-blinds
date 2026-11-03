# Incomplete draft items

**Date:** 2026-11-02
**Status:** Design approved in conversation; awaiting spec review.

> **Post-merge note (2026-11-03):** the single-estimate `POST /api/orders/:id/send` this spec names was replaced
> on main by the multi-estimate send (`POST /api/customers/:id/send-estimates`), gated the same way — see
> `knowledge/history/engine_features.md` 2026-11-02.

## Problem

A blind line item cannot be saved until every option its type needs is chosen — material,
each scoped hardware slot (cassette, bottom rail, control, installation) — and its
measurements are entered. On site, some of those decisions cannot be made yet. Bulk add
already creates such items on purpose (`apps/web/src/pages/orders/bulkAdd.ts`, "DELIBERATELY
PERMISSIVE"), but the save then refuses them, and because the order page has no
unsaved-changes guard, leaving the page loses everything else that was entered.

Two gates block the save today, mirroring each other:

- Web: `buildPayload` in `apps/web/src/pages/orders/OrderDetail.tsx` returns the first
  missing field as a toast ("Item 3: choose a control option.").
- API: `blindItemSchema` requires `material_id`, positive `panels` and `height_cm`
  (`apps/api/src/routes/orders.ts`), and `resolveLineItems` rejects any scoped slot left
  empty ("Item 3: a control option is required.").

The database is not a blocker: `line_items.material_id`, `height_cm` and every hardware
column are already nullable.

## Goal

1. A **draft** order saves with blind items that are missing options and/or measurements.
2. Such an order **cannot leave draft** — not by email, mark-sent, confirm, a timeline
   stage move, or a downloaded PDF — until every item is complete.
3. Nothing about a complete order changes: same pricing, same messages, same flows.
4. Nobody reads a misleading total: incomplete items are flagged wherever a total is shown.
5. Leaving the order page with unsaved edits asks first.

## Non-goals

- No relaxation for orders outside `draft`. A `sent` or confirmed order stays exactly as
  strict as today.
- No relaxation for preset/custom items (title-or-description, quantity, price rules
  unchanged).
- Typed garbage is still rejected: a width of `12a` or `-5`, an unparseable override, an
  invalid attribute value. Only BLANK is newly allowed.
- Quantity stays required (bulk add and the single-item form both default it to 1).
- No stored completeness flag/column and no migration. Completeness is derived (see §1).
- No router migration to a data router for the leave guard (see §7).

## Invariant

> **An incomplete item can only exist on a `draft` order.** Hidden items included.

Every gate below enforces this one sentence. Because of it, everything downstream of
draft — the public estimate page and customer link, price locks, invoices, payments,
receipts, warranty, manufacturing, edit requests, notifications — only ever sees complete
orders and needs no change.

## Design

### 1. One completeness rule — `lineItemCompleteness.ts` (twins)

New pure module in BOTH `apps/api/src/lib/lineItemCompleteness.ts` and
`apps/web/src/lib/lineItemCompleteness.ts`, with mirrored test suites (same twin
discipline as `pricing.ts` / `totals.ts`).

```ts
/** A field noun: 'blind type', 'width', 'height', 'material', 'cassette', 'bottom rail',
 *  'control option', 'installation option', or a type's required-attribute noun
 *  (e.g. 'back fabric'). */
type MissingField = string;

function missingFields(item: CompletenessInput, scope: CompletenessScope): MissingField[];
function firstIncompleteMessage(items: CompletenessInput[], scope): string | null;
```

- `CompletenessInput`: `blinds_type`, `panels` (`(number | null)[]`), `height_cm`,
  `material_id`, the four slot ids, `attributes`, `item_type`, `room_name`.
- `CompletenessScope`: `isKnownType(name)`, `usesSlot(name, slot)` — the API passes the
  existing `loadSlotScoping` result, the web wraps `slotsForType(catalogs, …)`.
- Rules for a blind item, in this order (the order is the message order):
  1. `blinds_type` blank → `'blind type'`. **Behaviour change, approved:** today a blind with
     a blank type and a material can be sent; it now blocks until a type is picked.
  2. no panels, or any panel null/≤0 → `'width'`.
  3. `height_cm` null/≤0 → `'height'`.
  4. `material_id` null → `'material'`.
  5. For a KNOWN type only: each slot the type uses with a null id → its noun. Unknown
     non-blank types (legacy free text, deleted types) stay unconstrained, as today.
  6. Each key in `getBlindType(type).requiredAttributes()` that is blank → that key's
     noun. `requiredAttributes()` is the hook the Dual Shades plan
     (`knowledge/plans/2026-11-02-dual-shades.md`) introduces on `BaseBlindType`
     (`[]` by default); whichever change lands first adds it, the other reuses it.
- Preset/custom items are always complete (their own rules still run at parse time).
- `firstIncompleteMessage` returns `"Item N (Room): choose a control option."` — the same
  wording `buildPayload` uses today, prefixed by the room name when present, so the user
  sees the message they already know.

Derived, not stored: the rule is evaluated against the CURRENT blind-type scoping. If a
type gains a slot in Settings, its existing drafts become incomplete and the send gate
catches it — which is correct, and a stored flag would have missed.

### 2. Saving — API (`apps/api/src/routes/orders.ts`)

`blindItemSchema` accepts BLANK where it used to require a value:

- `material_id: z.string().uuid().nullable().default(null)`
- `height_cm: z.number().positive().max(1000).nullable().default(null)`
- `panels: z.array(z.number().positive().max(1000).nullable()).max(10)` — a blank panel is
  `null` (the panel COUNT is preserved); an empty array is allowed. Still `.strict()`.

`POST /` and `PUT /:id`:

- After parsing, compute `firstIncompleteMessage` over the payload.
- `POST /` creates a draft, so incomplete items are allowed.
- `PUT /:id` allows incomplete items ONLY when the stored status is `draft`, or when this
  same save revives an expired estimate to draft (`reviveToDraft`). Otherwise → 400 with
  the message. Sent/confirmed orders therefore keep today's strictness (the message text
  changes from "a control option is required" to "choose a control option" — same meaning).

`resolveLineItems` — an incomplete blind item:

- Skips the formula and every catalog lookup for the MISSING ids (present ids are still
  resolved, and a present id that no longer exists is still "Selected … no longer exists").
- The slot-gate's "does not take a cassette" half (id sent for a slot the type does not
  use) stays in force; only the "is required" half is removed, because completeness owns
  that now.
- Stores snapshots as null for whatever is missing, `line_total: 0`.
- Keeps hand-entered money so nothing typed is lost: `addons` stored as sent; an override
  stored as `unit_price = override`, `base_unit_price = 0`; no override →
  `unit_price = 0`, `base_unit_price = null`. `line_total` is forced to 0 either way, so the
  item contributes nothing to the subtotal. When the item is later completed, the normal
  path prices it; `describePriceChanges` sees overridden→overridden with the same
  `unit_price` and logs nothing spurious.
- Emits the SAME column set as every other row (locked pattern: uniform bulk-insert
  columns). Lock columns null (drafts are never locked).

### 3. The gates — leaving draft

New helpers in `apps/api/src/lib/orderCompleteness.ts` (`incompleteMessageFor(sb, rows)`,
`loadIncompleteMessage(sb, orderId)`) feed stored rows and today's slot scoping to
`firstIncompleteMessage`; a route-local `leaveDraftRefusal(sb, order, rows?)` wraps them.

**Every gate runs only while the order's CURRENT status is `draft`** (refined while planning).
A sent or confirmed order is complete by the invariant and is never re-judged: otherwise a
later Settings change (a type gaining a slot) would block the PDF, a resend or a stage move on
an order confirmed long ago — a regression against today's behaviour.

Called, before any side effect (before the email, before `freezeOrderPrices`, before the
status write), returning `400 { error: message }`:

| Route | Condition |
|---|---|
| `POST /:id/send` | order is `draft` |
| `POST /:id/mark-sent` | order is `draft` |
| `POST /:id/confirm` | order is `draft` (it accepts a draft today) |
| `POST /:id/status` | order is `draft` and `to` is `sent` or later |
| `GET /:id/pdf` | order is `draft` (a PDF can be handed over, so it counts as sending) |
| `PUT /:id` | the order is not / does not stay `draft` (see §2); judged in `resolveLineItems` only for items not held by a price lock, exactly as today's slot gate |

Not gated, by the invariant: `/send-invoice`, `/payments*`, `/in-progress`, `/ready`,
`/cut-done`, `/installed`, `/warranty*`, `/unconfirm`, `/revert`, and every `/public/*`
route. `/revert` and `/status` → `draft` move backwards and need no check.

`POST /:id/duplicate` stays allowed (it creates a draft). `toDuplicateInput`
(`apps/api/src/lib/orderDuplicate.ts`) must map a null `height_cm` to `null` (today
`Number(null)` → 0, which fails `.positive()`) and keep null panel entries.

### 4. Lists — incomplete badge instead of a total

`GET /api/orders` and `GET /api/orders/grouped` add `incomplete_items: number` to every
DRAFT order in their result: one extra `line_items` select for the draft ids on the page
(only the completeness columns), one `loadSlotScoping`, then `missingFields` per item.
Non-draft orders get `0` without a query.

Web, wherever a draft's total is listed — `pages/estimates/EstimateGroup.tsx`,
`pages/orders/OrderList.tsx`, `pages/calendar/AppointmentWizard.tsx` — a row with
`incomplete_items > 0` shows an amber **Incomplete** badge (title: "2 items incomplete")
in place of the dollar figure. The count includes hidden items, because the badge means
"cannot be sent yet".

### 5. Editor — `OrderDetail.tsx`

- `buildPayload` moves out to `apps/web/src/pages/orders/orderPayload.ts` (pure, testable;
  shrinks the 3,170-line standing violation). It no longer returns on BLANK fields; it
  still returns on typed garbage, invalid override, and preset/custom rules. Blank widths
  become `null` entries, blank height/material → `null`. It takes `status` and, when the
  order is not a draft, runs `firstIncompleteMessage` and returns it — so a sent order's
  save fails client-side with the same message the API would give.
- `toDrafts` maps a null panel entry back to `''` (not `"null"`).
- Each incomplete item row in `LineItemList` / `LineItemRow` gets an amber chip:
  **Incomplete · material, control option**. Price cell shows `—` (already the case,
  `blindDraftPrice` returns null).
- Pricing panel: when any item is incomplete, an amber line under the total —
  "Total excludes 2 incomplete items" (counts VISIBLE items only — a hidden item is
  already excluded from the total; it still blocks Send, per the invariant). The staff editor still shows the total; staff need
  the running figure.
- Send, Progress-timeline moves to Sent or later (the web's only path to mark-sent/confirm),
  and Download PDF run `firstIncompleteMessage` first, only while the order is a draft, and toast it without a request. The API remains the
  authority.

### 6. Present to Customer — `OrderPresentation.tsx`

Allowed on an incomplete draft (in-person discussion is exactly when the open choices get
made). For each incomplete item:

- Every missing cell (material, hardware, size) reads **To be decided**.
- No unit price, add-on, or line total is shown for that row.

When ANY visible item is incomplete, the totals block (subtotal, discount, HST, total, and
the Paid/Balance rows) is replaced by one line: **"Total available once every item is
complete."** — a $0 row among twenty is too easy to miss, so a partial total is never
shown to a customer. The Price breakdown toggle keeps working for the complete rows.

### 7. Unsaved-changes guard — order page

The app uses `<BrowserRouter>`, not a data router, so React Router's `useBlocker` is not
available; moving to `createBrowserRouter` is out of scope.

New hook `apps/web/src/hooks/useLeaveGuard.ts`, used by `OrderDetail` while the editor is
dirty (current drafts differ from the last loaded/saved order):

- `beforeunload` → the browser's own "Leave site?" prompt on tab close/refresh.
- A capture-phase `click` listener on `document` for same-origin `<a href>` navigations
  (sidebar, breadcrumbs, row links): `window.confirm("You have unsaved changes. Leave
  without saving?")`; cancel → `preventDefault`.
- Known limit, accepted: the browser Back button is not intercepted.
- The guard is OFF during the app's own save-then-navigate flows (Present, Send, first save
  of a new order's URL change), so it never prompts on a navigation the app started.

"Dirty" is a comparison of `buildPayload`-shaped snapshots (the saved order vs the current
editor state), so a reopened order is clean until something is actually edited.

## Affected areas — reviewed

| Area | Effect |
|---|---|
| Complete orders | Unchanged behaviour and pricing. Message wording on a non-draft save changes from "a X option is required" to "choose a X option". |
| Bulk add / bulk edit | Unchanged. Bulk add's "fill in later" now actually saves. |
| Live preview / totals (web) | Unchanged — incomplete items already preview at $0. Server now also stores $0, so they agree. |
| Price lock (`priceLockStore.ts`) | Unchanged. Freeze only runs when leaving draft, which is gated first. |
| Activity log (`lineItemAuditLog.ts`) | No spurious entries (override preserved as base 0; see §2). |
| Material usage report | Unchanged — already skips items `blindDraftInputs` cannot resolve. |
| Manufacturing / Manufacturer copy | Unchanged — confirmed orders only by the invariant; code already tolerates nulls. |
| Duplicate | `toDuplicateInput` null-safe for height and panels. |
| Customer page, customer link, edit requests, notifications, e-Transfer | Unaffected — only ever see `sent`+ orders. |
| PDF (`pdf.ts`) | Unchanged code; the route is gated. |
| Blind-type scoping changes in Settings | Existing drafts may become incomplete; caught at send, by design. |
| Blank blind type | Now incomplete (approved behaviour change). |
| Dual Shades plan | Shares `requiredAttributes()`; no conflict in ordering. |
| Types (`apps/web/src/types/index.ts`) | `LineItem.panels` becomes `(number \| null)[]`; `Order` gains optional `incomplete_items`. tsc enumerates every reader of `panels`, each of which already filters `w > 0` or must be updated. |

## Testing

- `lineItemCompleteness.test.ts` (api + web twins, identical cases): each rule, rule order,
  unknown type unconstrained, blank type incomplete, `requiredAttributes`, preset/custom
  always complete, message wording with and without room name.
- `orders.routes.test.ts`:
  - `POST /` and `PUT /:id` (draft) accept a blind with null material, null height, null
    panel, missing scoped slot; row stored with null snapshots and `line_total 0`; order
    total excludes it.
  - Override + add-ons on an incomplete item round-trip; completing it logs no price change.
  - `PUT /:id` on a `sent` order with an incomplete item → 400.
  - `/send`, `/mark-sent`, `/confirm`, `/status` (to `sent` and to `installed`), `GET /pdf`
    → 400 with the message, and NO email, freeze, or status write happened.
  - `/status` → `draft` with incomplete items stays allowed.
  - `/duplicate` of an incomplete draft succeeds.
  - Complete-order regression: every existing test in the file passes unchanged except the
    reworded non-draft message.
  - `GET /` and `/grouped` return `incomplete_items`.
- `orderPayload.test.ts` (web): blank vs garbage per field; non-draft status returns the
  completeness message; null panel round-trip with `toDrafts`.
- Presentation: totals block hidden when an item is incomplete (component test or
  throwaway harness, as previous presentation work did).
- Verification per AI_GUIDELINES §9: `pnpm check`, `pnpm test`, `pnpm lint` in both
  workspaces.

## Knowledge updates on completion

`knowledge/history/engine_features.md` (feature entry), `memory-bank/activeContext.md`,
`memory-bank/progress.md`, `memory-bank/systemPatterns.md` (the invariant, as a locked
pattern), and a correction to the `bulkAdd.ts` doc comment that says `buildPayload` "is
the real gate".
