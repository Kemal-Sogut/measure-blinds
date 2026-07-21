# Customer Order Summary, Status Tracking & Cancellation Requests — Design

Date: 2026-07-21 · Status: approved by user

## Goal

Two changes to the public, token-gated customer page (`/customer/:token`, the
same link already emailed with the estimate):

1. The page becomes a permanent **order summary**. Today it dead-ends at a
   one-line "You've already confirmed this estimate" card the moment the order
   leaves `sent`. After this change the customer always sees the full summary,
   and once confirmed also sees **where the order is** in the lifecycle — a
   live tracker, so no status-update emails are needed. A confirmation still
   cannot be undone by the customer; they may only **request** that it be
   cancelled. An open request raises a red warning above the Progress card on
   the staff order page, with **Confirm** and **Deny**.
2. The customer sees **e-Transfer payment details** on that summary.

## Decisions (confirmed with user)

- **Cancellation window:** the request button appears only while the order is
  `awaiting_payment` with zero payments recorded. Accepting reuses the existing
  `/unconfirm` rule verbatim (`awaiting_payment → sent`, refused once money is
  in), so no new money-adjacent lifecycle rules enter the system. This matches
  the standing invariant in `projectbrief.md`: "A confirmation may be reversed
  by the user only while the order is `awaiting_payment` (before any payment)."
- **Banner placement:** staff page only. The customer page shows a neutral
  "cancellation requested — we'll be in touch" notice; a red alarm on the
  customer's own page would read as an error.
- **Withdrawal:** the customer may withdraw their own pending request.
- **e-Transfer source:** new `company_settings` columns, edited in
  Settings → Company Info. Replaces the `blindsnisa@gmail.com` literal
  currently hardcoded in `components/PaymentSection.tsx`.
- **Staff emails:** the business IS notified by email when a customer opens or
  withdraws a cancellation request. No status emails go to the customer — the
  tracker replaces them.
- **Customer tracker stages:** four customer-facing steps — Confirmed ·
  In Production · Ready · Installed. Internal names (`draft`, `sent`) are never
  shown.
- **e-Transfer visibility:** from confirmation until the balance reaches zero.
- **Money on the summary:** paid-to-date and balance are shown, both computed
  server-side (AI_GUIDELINES Rule 1).
- **Component split:** additive only — new files for the new concerns, no
  existing logic relocated (see §6).

## 1. Schema — migration 27

`supabase/migrations/20260721000027_order_cancel_request_etransfer.sql`

```sql
alter table public.orders
  add column cancel_requested_at timestamptz,
  add column cancel_request_note text not null default '';

alter table public.company_settings
  add column etransfer_email text not null default '',
  add column etransfer_instructions text not null default '';
```

The cancellation request lives as columns on `orders`, following the existing
`install_status` / `install_response_note` precedent rather than introducing a
new table — it is a single optional side-conversation per order, never a
history.

`cancel_requested_at IS NULL` means no open request. Resolving the request —
accept **or** deny — clears it back to NULL. `order_logs` is the audit trail,
consistent with every other lifecycle event.

Both `company_settings` columns are `not null default ''` so the existing
singleton row needs no backfill.

## 2. State machine

```
customer confirms ──► awaiting_payment            (unchanged, still one-shot)
                          │
   customer requests cancellation (this stage only, zero payments)
                          ▼
                cancel_requested_at = now()       ORDER STATUS UNCHANGED
                    │            │            │
       staff Confirm│  staff Deny│            │customer withdraws
                    ▼            ▼            ▼
              status → sent   request cleared, order stays awaiting_payment
```

The customer never mutates order status — only the request flag. Order status
changes remain a staff action exclusively.

**Denial is silent to the customer.** The pending notice simply disappears from
their page; no email is sent. This is a deliberate consequence of "no update
emails to the customer" and is the most likely candidate for a follow-up
change.

## 3. API — public routes (`apps/api/src/routes/public.ts`)

### 3.1 `GET /estimate/:token` — extended payload

`loadByToken` gains a `payments(amount)` embed. The sanitized response gains:

| Field | Source |
| --- | --- |
| `amount_paid` | summed server-side from the payments embed |
| `balance` | `orders.total − amount_paid`, server-side |
| `cancel_requested_at` | `orders.cancel_requested_at` |
| `company.etransfer_email` | `company_settings` |
| `company.etransfer_instructions` | `company_settings` |

Money is never sent by, or trusted from, the client (Rule 1). The payload stays
sanitized — no payment rows, dates or methods are exposed, only the two
aggregates.

### 3.2 `POST /estimate/:token/cancel-request`

- **Body:** `{ note?: string }`. The note is capped at 500 characters, the same
  cap the install-change note already uses.
- **Guards:** 404 unknown/malformed token · 409 unless the order is
  `awaiting_payment` **and** has zero payments · 409 if a request is already
  open (idempotent-safe, no duplicate notifications).
- **Effect:** stamps `cancel_requested_at = now()` and stores the note.
  DB-guarded on `.eq('status','awaiting_payment')` so a racing payment cannot
  slip past the check.
- **Notification:** best-effort internal email to `company_settings.email`,
  same try/catch shape as the existing confirmation notice — failure is logged
  and never blocks the customer.

### 3.3 `POST /estimate/:token/cancel-withdraw`

- 404 unknown token · 409 when no request is open.
- Clears `cancel_requested_at` and `cancel_request_note`.
- Same best-effort internal notification, flagged as a withdrawal.

Both new routes inherit the existing `/public` rate limiter (5 req/min/IP)
registered by `app.use('*', rateLimit(5, 60_000))`.

## 4. API — staff route (`apps/api/src/routes/orders.ts`)

### `POST /:id/cancel-request/resolve`

- **Body:** `{ accept: boolean }`, zod `.strict()` — mirrors the existing
  `/cut-done { done: boolean }` shape.
- **Guards:** 404 unknown order · 409 when no request is open · when
  `accept` is true, the existing unconfirm preconditions apply (must be
  `awaiting_payment`; refused once a payment exists).
- **`accept: true`:** clears the request AND applies the unconfirm transition
  (`status → 'sent'`, `confirmed_at → null`).
- **`accept: false`:** clears the request only; status untouched.
- Both call `logOrderEvent` ("Cancellation request accepted — confirmation
  reversed." / "Cancellation request denied.") and return the refreshed detail
  via `readDetail` + `sumPayments`.

`DETAIL_SELECT` is already `'*, line_items(*), customer:customers(*),
payments(*)'`, so the two new order columns flow through with no query change.

### Settings

`apps/api/src/routes/settings.ts` — the company schema gains
`etransfer_email` and `etransfer_instructions`.

## 5. Email — `apps/api/src/lib/email.ts`

One new builder, `buildCancellationNoticeHtml`, added to the **internal
notifications** section at the bottom of the file (below
`buildAppointmentNoticeHtml`). It is plain staff-facing markup in the style of
`buildInstallationNoticeHtml` — deliberately NOT part of the "Customer Emails"
branded design system, because it is never seen by a customer.

```ts
export interface CancellationNoticeInputs {
  orderNumber: string;
  customerName: string;
  total: number;
  /** true = the customer withdrew a previous request */
  withdrawn: boolean;
  /** the customer's reason (request only) */
  note?: string;
}
```

Headline `⚠️ Cancellation requested` / `↩️ Cancellation request withdrawn`.
Every dynamic string passes through `escapeHtml` (Rule 2) — the note is
customer-supplied free text and is the reason that matters here.

## 6. Web — customer page (`apps/web/src/pages/customer-view/`)

Additive-only split. Nothing that exists today moves to another module; the two
new concerns get their own files, and `CustomerView.tsx` keeps its fetch and its
existing summary markup.

| File | Status | Responsibility |
| --- | --- | --- |
| `CustomerView.tsx` | modified (~410 lines) | fetch, state, terminal states, existing summary markup |
| `OrderProgress.tsx` | **new** | pure presentational 4-step tracker; takes a status, renders nothing else |
| `CancellationRequest.tsx` | **new** | pure presentational request / pending / withdraw UI; takes callbacks |
| `components/PaymentSection.tsx` | modified | e-Transfer details from settings + balance; hardcoded email removed |

**The key behavioral change** is in `CustomerView.tsx`: the `status !== 'sent'`
branch currently returns the dead-end `Message` card. It is replaced by the full
summary plus `OrderProgress`, `PaymentSection` and `CancellationRequest`. The
existing summary JSX is lifted out of the `sent`-only branch so both paths
render it — a restructure within the same file, required by the feature itself,
not a cross-module move.

`expired` and not-found keep their existing terminal `Message` cards.

The e-Transfer block renders when the order is confirmed and `balance > 0`.

### 6.1 Tracker stage mapping

`OrderProgress.tsx` maps internal status to the four customer-facing steps.
The tracker renders only once the order is confirmed, so `draft` and `sent`
never reach it.

| Order status | Step shown as current | Customer-facing label |
| --- | --- | --- |
| `awaiting_payment` | 1 | Confirmed |
| `in_progress` | 2 | In Production |
| `ready` | 3 | Ready |
| `installed` | 4 (all complete) | Installed |

`expired` is unreachable here — an expired order is caught by the terminal
`Message` card before the tracker renders.

## 7. Web — staff page & settings

- `pages/orders/OrderDetail.tsx` — a red banner immediately above the existing
  `timelineCard`, rendered only when `existing.cancel_requested_at` is set. It
  shows the customer's note and two buttons, **Confirm** and **Deny**, wired to
  the resolve route. Placed outside the disabled fieldset, like the Progress
  card it sits above.
- `hooks/useOrders.ts` — `useResolveCancelRequest()`, invalidating through the
  same `useCacheOrder` callback every other lifecycle mutation uses.
- `pages/settings/CompanyInfo.tsx` — e-Transfer email + instructions inputs.
- `types/index.ts` — `Order` gains `cancel_requested_at: string | null` and
  `cancel_request_note: string`; the company settings type gains the two
  e-Transfer fields.

## 8. Testing

**`apps/api/src/routes/public.routes.test.ts`**
- extended payload shape: `amount_paid`, `balance`, `cancel_requested_at`,
  e-Transfer fields present and money correct against a seeded ledger
- cancel-request: happy path stamps the column; 409 when status is `sent`;
  409 when a payment exists; 409 when a request is already open; 404 on a
  malformed token; note truncated at 500 chars
- cancel-withdraw: happy path clears; 409 with no open request

**`apps/api/src/routes/orders.routes.test.ts`**
- resolve `accept:true` → status `sent`, `confirmed_at` null, request cleared
- resolve `accept:true` refused (409) once a payment exists
- resolve `accept:false` → request cleared, status still `awaiting_payment`
- resolve with no open request → 409
- unknown order → 404

Nothing in this change touches `pricing.ts` or `totals.ts`, so the mirrored
web/api money suites are unaffected and need no edits.

## 9. Verification (AI_GUIDELINES Rule 9)

`pnpm check`, `pnpm test`, `pnpm lint` in **both** workspaces, targeting
0 errors / 0 warnings. Migration 27 must be applied to the live Supabase
project `lgbxxlwsdeuhdgzrjjen` before deploying either Worker.

## 10. Documentation obligations

- `knowledge/history/engine_features.md` — new feature entry (Rule 4)
- `memory-bank/activeContext.md` and `progress.md` — current focus + status
  (Rule 5)
- JSDoc on every new module, component, hook, route group and exported type,
  scored ≥ 8/10 (Rule 3)
- SPDX + copyright header on every new `.ts`, `.tsx` and `.sql` file (Rule 10)

## Out of scope

- Notifying the customer that a request was denied (see §2).
- Cancelling an order outright, or any refund flow. "Cancellation" here means
  reversing the *confirmation* back to `sent`, nothing more.
- Online card payment. e-Transfer details are display-only text.
- Any change to the appointment/installation public page
  (`/appointment/:token`), which keeps its own separate flow.
