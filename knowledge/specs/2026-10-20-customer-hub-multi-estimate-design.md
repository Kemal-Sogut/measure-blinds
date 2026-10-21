# Customer hub & multiple estimates per customer

**Date:** 2026-10-20
**Status:** Design approved in conversation; awaiting spec review before the implementation plan.

## Problem

A customer often asks for more than one quote ("roller everywhere" vs "zebra in the
living room"). Today each quote is an independent order with its own emailed link, so
the customer sees one estimate at a time and has to ask the shop to "switch to the other
option" — the consultant becomes the go-between for a choice the customer should make
alone.

The staff side has the same gap: there is no single place that shows everything created
for one customer. The customer record is a contact card; the work lives in a flat,
cross-customer list.

## Goal

1. The consultant creates as many estimates for a customer as were discussed.
2. The customer opens ONE link, sees every estimate that is still valid, opens one,
   and confirms it whenever they like. Confirming one does not touch the others.
3. The customer page becomes the staff hub for that customer: dashboard tiles, all
   their estimates, their confirmed orders.
4. The staff order page lives at `/<customer-slug>/<order-number>`.

## Non-goals

- No estimate "groups" or option sets. Confirming estimate A does NOT void, expire or
  hide estimate B. B stays live until its own expiry date and can also be confirmed.
- No separate `estimates` table. An estimate is an `orders` row in a pre-confirmation
  status; nothing is copied on confirm.
- No change to pricing, totals, payments, price locks, e-Transfer matching or the
  status lifecycle (AI_GUIDELINES §1 untouched).
- No customer-token revocation/rotation UI (YAGNI; can be added later).
- No auto-generated title or summary label. A blank title is simply not shown.

## Vocabulary

| Term | Meaning (statuses) |
|---|---|
| **Estimate** | Any `orders` row. Pre-confirmation ones are `draft`, `sent`, `expired`. |
| **Active estimate** (customer-visible) | `sent` and not past `expiry_date`. |
| **Order** (confirmed) | `awaiting_payment`, `in_progress`, `ready`, `installed`. |

## Data model — migration 45

`supabase/migrations/20261020000045_customer_hub.sql`

- `orders.title text null` — optional consultant-entered label, e.g.
  "Option A – Roller blinds". Check: `char_length(title) <= 120`. Empty string is
  normalised to `null` by the Worker.
- `customers.public_token uuid null unique` — capability token for the customer link.
  Minted lazily (first estimate send, or **Copy customer link**), never regenerated.
- `customers.last_activity_at timestamptz not null default now()` — drives the
  customer list order (see *Customer list order*). Backfilled as
  `greatest(customers.created_at, max(orders.updated_at))`; index
  `customers_last_activity_idx (last_activity_at desc)`.
- Trigger `orders_bump_customer_activity` (AFTER INSERT OR UPDATE on `orders`) sets the
  owning customer's `last_activity_at = greatest(last_activity_at, now())`. Skipped when
  the only change is the auto-expiry flip (`status` `sent` → `expired` with nothing else
  changed), so the nightly cron never reshuffles the list. When an order is moved to a
  different customer, the NEW customer is bumped.
- No new RLS policies (anon still has nothing; public reads go through the Worker).
- `public.update_order_with_items` (latest definition in
  `20260811000036_option_price_basis.sql`) writes order fields from `p_fields`; it must
  be redefined in migration 45 to also write `title`. The create path inserts directly
  from `orders.ts` and just gains the column.

## Staff side

### Navigation

- Sidebar item **Orders** is renamed **Estimates**. The list at `/` is otherwise
  unchanged: same tabs (All / Active / Awaiting Payment / In Progress / Ready /
  Installed / Expired), search, pager, Duplicate/Delete, **+ New Estimate** (renamed
  from + New Order). Page title becomes **Estimates**.
- **Customers** stays in the sidebar and is the per-customer hub.

### Customer list order — `/customers`

The list is sorted by **most recent estimate activity first**: creating an estimate, or
saving/sending/confirming/paying on any of a customer's estimates, moves that customer
to the top. A brand-new customer with no estimates sits at the top too (their
`last_activity_at` is their creation time) until other activity passes them.

- `GET /api/customers` orders by `last_activity_at desc`, then `last_name`,
  `first_name` as tie-breakers (replacing today's alphabetical order). Search (`?q=`)
  keeps the same order.
- Each row shows a muted "Last activity <relative date>" line so the order reads as
  intentional, not random.
- The order is server-side, so the existing `LIST_LIMIT` cap keeps the most recently
  active customers rather than the first letters of the alphabet.

### Customer page — `/customers/:id`

`CustomerForm` keeps create (`/customers/new`) and edit mode only; the read state
becomes a new `CustomerDashboard` with one component per tab.

- **Header:** name, `tel:` / `mailto:` links, one-line shipping address, pen button
  (enters the existing edit mode), **Copy customer link**, **+ New Estimate**.
- **Stat tiles:** Active estimates (count of `sent`, unexpired), Orders (confirmed
  count), Balance owing (Σ balance over confirmed orders), Lifetime total (Σ total over
  confirmed orders). All figures come from server-computed order totals/balances.
- **Tabs** (`?tab=`, default `estimates`):
  - **Estimates** — every `orders` row for the customer, newest first. Row: title (only
    if set), order number, date, status badge, total. Confirmed rows keep their status
    badge, which already reads as an order stage. Row actions: open, **Duplicate**
    (the fast way to build "Option B" from "Option A").
  - **Orders** — confirmed rows only, with status and balance.
  - **Appointments** — existing `CustomerAppointmentsCard` data (`GET
    /api/appointments?customer_id=`).
  - **Details** — the existing `CustomerDetailView`.
- **+ New Estimate** opens the order editor with this customer preselected.

### Order page URL — `/<customer-slug>/<order-number>`

- e.g. `/jane-smith/M2010-126`, plus `/present`, `/labels`, `/manufacturer` suffixes.
  The page is the existing `OrderDetail` (and siblings).
- **The order number is authoritative** (it is DB-unique). The slug is cosmetic:
  `slugify(displayName(customer))` (lowercase, ASCII, hyphens; `customer` when empty).
  If the URL's slug differs from the canonical one (rename, typo), the page
  `replace`-navigates to the canonical URL.
- React Router ranks static segments first, so `/settings/...`, `/customers/...`,
  `/calendar`, etc. keep winning. Order numbers never collide with those.
- New estimates keep `/orders/new` (`?customer=<id>` preselects). After first save the
  editor navigates to the canonical URL.
- Legacy `/orders/:id[...]` and `/estimates/:id` routes become redirects: load by id,
  then `replace` to `orderPath(order)`.
- One helper, `orderPath(order, suffix?)` in `apps/web/src/lib/orderPath.ts`, replaces
  every hard-coded `/orders/${id}` link (list rows, notifications, calendar, duplicate,
  customer tabs).

### Title field

Optional text input in Order Details ("Title (optional)", placeholder
"e.g. Option A – Roller blinds"). Blank means not rendered anywhere.

## Customer side

### Customer link — `/c/<customer-token>`

`GET /public/customer/:token` returns the customer's **visible** items: active
estimates and confirmed orders. Drafts and expired estimates are never returned.

- **Exactly one visible item** → the page renders that item directly (today's estimate
  page, no list in front of it).
- **Otherwise** → a list with two sections:
  - **Estimates** — card per active estimate: title (if set), order number, date,
    "Valid until", total, and a **View** button. There is no confirm on the card; the
    customer confirms from inside the estimate after reading it.
  - **Your orders** — card per confirmed order: title (if set), number, current stage,
    balance, **View**.
  - Zero visible items → a short "Nothing to review right now — contact us" state with
    company phone/email.
- **View** goes to `/c/<customer-token>/<order-number>`, which renders the existing
  `CustomerView` content plus a "← All your estimates" link (shown only when the list
  has more than one item). Confirm, Request Edit, cancellation request and payment info
  behave exactly as today.
- After confirming, the estimate moves from **Estimates** to **Your orders** on the
  next load. The other estimates are untouched.

### How it plugs into the existing public API

The list payload includes each visible order's own `public_token` (minted if a sent
order somehow lacks one). The detail view then calls the existing
`/public/estimate/:token` endpoints unchanged — confirm, view, edit-request,
cancel-request, cancel-withdraw. The customer token exposes nothing the customer could
not already open from their individual estimate emails.

`CustomerView.tsx` (1,088 lines) is not grown: a new `CustomerPortal` page owns the list
and routing and renders `CustomerView` for the detail, passing the order token in.

### Payload — `GET /public/customer/:token`

Rate-limited like `/public/*`; `TOKEN_RE` check; 404 with the same wording as its
neighbours for unknown tokens. Sanitized:

```ts
{
  company: { company_name, logo_url, email, phone },
  customer: { first_name },
  items: Array<{
    order_number: string;
    title: string | null;
    status: 'sent' | 'awaiting_payment' | 'in_progress' | 'ready' | 'installed';
    order_date: string;
    expiry_date: string;
    total: number;
    balance: number;       // server-computed: total − Σ payments
    public_token: string;
  }>;
}
```

Expired-but-still-`sent` rows are filtered by `expiry_date` (same rule as
`effectiveStatus`) so the list never offers a stale estimate.

### Existing per-estimate links

Links already emailed (`/customer/<order-token>`) keep working unchanged.
`GET /public/estimate/:token` gains `title` in its payload.

## Email & PDF

- `send-estimate` mints `customers.public_token` if absent and links the email button
  and the PDF "Review & confirm online" CTA to `/c/<customer-token>`.
- When the customer has more than one active estimate (counted after this send), the
  email adds one line: "You have N estimates to choose from — open each one and confirm
  the one that suits you."
- Title, when set, appears in the email subject (`Estimate M2010-126 – Option A …`), the
  email card heading and the PDF heading. Always passed through `escapeHtml` in HTML.
- Email-then-persist ordering is unchanged.

## API changes

| Route | Change |
|---|---|
| `GET /api/orders/by-number/:orderNumber` | New. Literal route registered BEFORE `/:id`. Same payload as `GET /:id`. |
| `GET /api/orders?customer_id=` | New optional filter (combines with existing tab/search). |
| `POST /api/customers/:id/public-link` | New. Mints-if-absent and returns the customer token (Copy customer link). |
| `GET /public/customer/:token` | New, per the payload above. |
| `GET /api/customers` | Ordered by `last_activity_at desc`, then name. Rows include `last_activity_at`. |
| Order create/update schemas | Accept `title` (string ≤120, trimmed, `''`→`null`). Still `.strict()`. |
| `POST /api/orders/:id/send` | Customer-link URL + multi-estimate line + title. |
| `GET /public/estimate/:token` | Adds `title`. |
| Duplicate | Copies `title`; staff edit it to the new option's name. |

## Error handling & edge cases

- Unknown/malformed customer token → 404, same wording as estimate routes.
- `/c/<token>/<order-number>` where the order is not visible for that customer (draft,
  expired, other customer) → falls back to the list with a toast "That estimate is no
  longer available."
- Staff URL with an unknown order number → existing "order not found" state.
- A `sent` order past expiry is filtered from the public list even before the cron
  flips it.
- Customer delete is already `on delete restrict` while orders exist; unaffected.

## Testing

- **api:** `/public/customer/:token` (drafts and expired hidden, confirmed shown, unknown
  token 404, no staff-only fields, balance server-computed); `by-number` route and its
  registration order; `customer_id` filter; `title` validation (strict schema still
  rejects money fields; 121 chars rejected; blank → null); send-estimate email with and
  without title and with 1 vs N active estimates; public-link mint is idempotent;
  customer list ordered by `last_activity_at desc` with name tie-break.
- **db (manual SQL check after applying migration 45):** inserting an order bumps its
  customer; a staff save bumps it; the `sent → expired` flip alone does not; moving an
  order to another customer bumps the new one.
- **web:** `slugify`/`orderPath`; canonical-slug redirect; portal rule "one visible item
  opens directly, otherwise list"; dashboard tile math from fixture orders.
- Verification per AI_GUIDELINES §9: `pnpm check`, `pnpm test`, `pnpm lint` in both
  workspaces; migration 45 applied before deploy.

## Files (expected)

- `supabase/migrations/20261020000045_customer_hub.sql` (new)
- `apps/api/src/routes/orders.ts` (title, by-number, customer filter, send link)
- `apps/api/src/routes/customers.ts` (public-link, list order)
- `apps/web/src/pages/customers/CustomerList.tsx` (last-activity line)
- `apps/api/src/routes/public.ts` (customer route, title in estimate payload)
- `apps/api/src/lib/email.ts`, `apps/api/src/lib/pdf.ts` (title, link, multi line)
- `apps/web/src/App.tsx` (routes)
- `apps/web/src/lib/orderPath.ts` (new)
- `apps/web/src/pages/customers/CustomerDashboard.tsx` + tab components (new)
- `apps/web/src/pages/customers/CustomerForm.tsx` (read state hands off to dashboard)
- `apps/web/src/pages/customer-view/CustomerPortal.tsx` (new)
- `apps/web/src/pages/orders/OrderDetail.tsx` (title field, URL handling — minimal touch)
- `apps/web/src/pages/orders/OrderList.tsx`, `components/Sidebar.tsx` (rename, links)
- `apps/web/src/hooks/useOrders.ts`, `useCustomers.ts`, `types` (title, by-number,
  customer filter, public link)
- `knowledge/history/engine_features.md`, `memory-bank/activeContext.md`,
  `memory-bank/progress.md`, `memory-bank/systemPatterns.md`
