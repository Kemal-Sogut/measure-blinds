# Customer edit requests

**Date:** 2026-08-26
**Status:** Approved — ready for implementation

## Problem

The public order page (`/customer/:token`) offers a customer exactly two
actions before they commit: **Confirm Estimate**, and — after confirming —
**Request cancellation**. There is nothing in between. A customer who wants a
change ("make the kitchen blind cordless", "drop the bay window") has to leave
the page and phone the shop, and that message never reaches the order record.

## Goal

Let the customer send the shop a free-text change request from the estimate
page, and surface it on the staff order page where the order is actually
edited.

## Non-goals

- Staff replying to the customer through the app. The amended estimate is the
  answer; staff follow up by phone or email as they do today.
- Structured edits (a customer can never mutate line items, options or money —
  AI_GUIDELINES rule 1 is untouched).
- Notifying the shop by email. Deliberately excluded: the order page and the
  activity trail carry the request.

## Eligibility

Accepted only while the order is `sent` — the pre-confirmation window in which
the fixed action bar (and therefore the button) exists at all. Once confirmed,
the bar is gone and the existing cancellation flow takes over. Enforced in the
Worker, not the DB, so the rule lives beside the other public-surface guards.

## Data model

New table, not columns on `orders`. Unlike `cancel_requested_at` (one optional
side-conversation per order, migration 27), this is a **collection** — a
customer may send several requests and each is resolved independently.

`supabase/migrations/20260826000041_order_edit_requests.sql`:

```sql
create table public.order_edit_requests (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders (id) on delete cascade,
  message     text not null,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz            -- null = still needs an answer
);
```

- Index `(order_id, created_at desc)` for the newest-first reads.
- Partial index on `order_id where resolved_at is null` for the open-count cap.
- RLS: `authenticated` full access, anon nothing — the same single-org policy
  as `order_logs`. The Worker's service role bypasses it.

There is no `resolved_by`: the activity trail already records who acted, and
the staff app has a single-org permission model with no per-user attribution
anywhere else on the order.

## API

### Public (token'd, rate-limited, behind the maintenance gate)

`POST /public/estimate/:token/edit-request` — body `{ message }`.

- 404 malformed or unknown token.
- 400 when `message` is empty after trim; truncated to 1000 chars.
- 409 unless `status === 'sent'`, worded for a customer.
- 409 when the order already has `MAX_OPEN_EDIT_REQUESTS` (5) unresolved rows.
  This is the per-order cap; the group's 5-req/min/IP limiter sits on top.
- On success: insert, then a best-effort
  `logOrderEvent(sb, order.id, 'Customer requested changes.', 'customer')` —
  the message text is NOT interpolated into the trail, matching how the
  cancellation note is handled.

`GET /public/estimate/:token` — payload gains
`edit_requests: [{ id, message, created_at, resolved_at }]`, oldest-first, so
the customer sees what they sent and whether it has been handled. Sanitized
like every other field in that payload.

### Staff (`/api/*`, JWT-verified)

`GET /api/orders/:id/edit-requests` — newest first, limit 200. Mirrors
`GET /api/orders/:id/logs`.

`POST /api/orders/:id/edit-requests/:requestId/resolve` — stamps `resolved_at`,
guarded on `resolved_at is null` so a stale tab cannot re-resolve. 404 unknown
row, 409 already resolved. Logs `'Change request marked resolved.'` as staff.
Returns the refreshed list so the card needs no second round-trip.

Both are registered inside the existing `/:id` param group. No literal-vs-param
ordering hazard: the literal segment is a suffix, not the first segment.

## Web — customer

`apps/web/src/pages/customer-view/EditRequestDialog.tsx` (new): presentational
modal over `components/ui/Modal`. Textarea, live character counter, Cancel /
Send. Every network call, error and eligibility decision stays in
`CustomerView.tsx` — the same split as `CancellationRequest.tsx`.

`CustomerView.tsx`:
- The fixed bottom bar becomes a flex row: **Request Edit** (outlined
  secondary, `flex-1`) to the LEFT of **Confirm Estimate** (`flex-[2]`).
  Confirm keeps its visual weight and its terms gate; Request Edit is never
  gated on the terms tick, because asking a question is not assent.
- Both controls inert under `?preview=1`, like every other action on the page.
- A "Your change requests" list in the page body shows what has been sent and
  whether each is still pending. Without it the customer has no evidence the
  message arrived.

## Web — staff

`apps/web/src/pages/orders/EditRequestsCard.tsx` (new): amber card listing open
requests newest-first — date, message, **Mark resolved**. Renders nothing when
there are none. Resolved rows drop off the card; the activity trail is the
permanent history.

Amber, not red. Red is reserved on that page for the cancellation banner, which
is the one thing that must be answered before anything else proceeds.

Placement in `OrderDetail.tsx`: directly below `cancelRequestBanner`, above the
Progress timeline, inside the form column and OUTSIDE the `readOnly` fieldset —
resolving a request is not an edit to the order.

`hooks/useOrders.ts` gains `useOrderEditRequests(id)` and
`useResolveEditRequest()`. `types/index.ts` gains `OrderEditRequest`.

## Testing

- `apps/api/src/routes/public.routes.test.ts`: empty message 400, over-length
  truncation, wrong-status 409, cap 409, success inserts + logs, unknown token
  404, and `edit_requests` present in the GET payload.
- `apps/api/src/routes/orders.routes.test.ts`: list returns newest-first,
  resolve stamps `resolved_at`, double-resolve 409, unknown row 404.
- `pnpm check`, `pnpm test`, `pnpm lint` in both workspaces.

Pricing and totals are untouched, so the mirrored web/api pricing suites are
not in scope.

## Documentation

JSDoc on every new module, component, hook, type and route group (rule 3).
`knowledge/history/engine_features.md` gains a dated entry. `memory-bank/`
`activeContext.md`, `progress.md` and `systemPatterns.md` are updated as
current-state snapshots, not appended to.
