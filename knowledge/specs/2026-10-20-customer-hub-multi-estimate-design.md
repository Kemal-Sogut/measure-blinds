# Multiple estimates per customer — grouped Estimates page & customer link

**Date:** 2026-10-20 (revised 2026-10-22)
**Status:** Design approved in conversation; revised 2026-10-22 — the customer hub was
dropped in favour of a customer-grouped Estimates page and a confirmed-only Orders page.

## Problem

A customer often asks for more than one quote ("roller everywhere" vs "zebra in the
living room"). Today each quote is an independent order with its own emailed link, so
the customer sees one estimate at a time and has to ask the shop to "switch to the other
option" — the consultant becomes the go-between for a choice the customer should make
alone.

The staff side has the same gap: the home list is a flat, cross-customer list, so two
options prepared for one customer sit apart and confirmed work is mixed in with quotes.

## Goal

1. The consultant creates as many estimates for a customer as were discussed.
2. The customer opens ONE link, sees every estimate that is still valid, opens one,
   and confirms it whenever they like. Confirming one does not touch the others.
3. The **Estimates** page groups every estimate under its customer (a collapsible row),
   customers ordered by their newest estimate's creation date.
4. The **Orders** page lists confirmed orders only.
5. The staff order page lives at `/<customer-slug>/<order-number>`.

## Non-goals

- No estimate "groups" or option sets. Confirming estimate A does NOT void, expire or
  hide estimate B. B stays live until its own expiry date and can also be confirmed.
- No separate `estimates` table. An estimate is an `orders` row in a pre-confirmation
  status; nothing is copied on confirm.
- No change to pricing, totals, payments, price locks, e-Transfer matching or the
  status lifecycle (AI_GUIDELINES §1 untouched).
- **No change to the Customers pages.** `/customers` and `/customers/:id` stay exactly
  as they are (alphabetical list, read-only detail with edit mode).
- No customer-token revocation/rotation UI (YAGNI; can be added later).
- No auto-generated title or summary label. A blank title is simply not shown.

## Vocabulary

| Term | Meaning (statuses) |
|---|---|
| **Estimate** | Any `orders` row. Pre-confirmation ones are `draft`, `sent`, `expired`. |
| **Active estimate** (customer-visible) | `sent` and not past `expiry_date`. |
| **Order** (confirmed) | `awaiting_payment`, `in_progress`, `ready`, `installed`. |

## Data model — migration 47

`supabase/migrations/20261022000047_customer_hub.sql` (45 and 46 were taken by the inbox work)

- `orders.title text null` — optional consultant-entered label, e.g.
  "Option A – Roller blinds". Check: `char_length(title) <= 120`. Empty string is
  normalised to `null` by the Worker.
- `customers.public_token uuid null unique` — capability token for the customer link.
  Minted lazily (first estimate send, or **Copy customer link**), never regenerated.
- Index `orders_customer_created_idx (customer_id, created_at desc)` for the grouped
  Estimates query.
- No new RLS policies (anon still has nothing; public reads go through the Worker).
- `orders.ts` writes order fields with direct `insert`/`update` calls (the old
  `update_order_with_items` RPC is no longer called by the app), so `title` needs no
  function change — the routes just pass it through.
- The group order needs no stored column: "newest estimate creation date" is
  `max(orders.created_at)` per customer, which the grouped query yields by reading rows
  newest-created first.

## Staff side

### Navigation

Sidebar: **Estimates** (`/`, home), **Orders** (`/orders`, new), **Customers**
(unchanged), then the existing items.

### Estimates page — `/`

Every estimate grouped under its customer.

- **Order of customers:** by the creation date of that customer's newest estimate,
  newest first. A new estimate always puts its customer on top. Editing, sending or
  confirming an older estimate does NOT move the customer.
- **Group row (collapsed by default):** customer name, estimate count, "Newest
  <date>", and a short status summary (e.g. `2 active · 1 order`). Tapping toggles it
  open. While a search term is present, every matching group is expanded.
- **Inside a group:** that customer's estimates, newest-created first — ALL statuses,
  confirmed ones included (their status badge reads as an order stage). Row: title (only
  if set), order number, date, status badge, total; per-row Duplicate and Delete (as on
  today's list). Rows open `/<customer-slug>/<order-number>`.
- **Group actions (shown when open):** **+ New Estimate** for this customer
  (`/orders/new?customer=<id>`), **Copy customer link**, **Customer details**
  (`/customers/:id`).
- **Tabs:** All · Active (`draft`, `sent`) · Confirmed · Expired. A tab filters the
  estimates inside groups; a customer with nothing left in the tab is hidden; the order
  of customers follows their newest estimate within the tab.
- **Search:** customer name or order number (today's matching rules).
- **Paging:** 15 customer groups per page, client-side, pager bottom-right (today's
  pattern). The API reads at most 500 estimate rows, newest-created first, so on a very
  large history the oldest customers fall off the first fetch — acceptable at this
  business's scale and documented in the route.
- **+ New Estimate** in the page header (customer chosen in the editor, as today).

### Orders page — `/orders`

Today's list component, limited to confirmed orders: tabs **All** (every confirmed
stage) · Awaiting Payment · In Progress · Ready · Installed, search, pager, row actions.
No "+ New" button — an order is born by confirming an estimate. Rows open
`/<customer-slug>/<order-number>`. (`/orders` currently redirects to `/`; it becomes this
page.)

### Order page URL — `/<customer-slug>/<order-number>`

- e.g. `/jane-smith/M2010-126`, plus `/present`, `/labels`, `/manufacturer` suffixes.
  The page is the existing `OrderDetail` (and siblings).
- **The order number is authoritative** (it is DB-unique). The slug is cosmetic:
  built from first + last name only (lowercase, ASCII, hyphens, max 60; `customer` when
  there is no name — never the email or phone, which would land in browser history).
  A slug equal to an app path segment (`settings`, `c`, …) is prefixed `customer-`.
  If the URL's slug differs from the canonical one (rename, typo), the page
  `replace`-navigates to the canonical URL.
- React Router ranks static segments first, so `/settings/...`, `/customers/...`,
  `/calendar`, etc. keep winning. Order numbers never collide with those.
- New estimates keep `/orders/new` (`?customer=<id>` preselects). After first save the
  editor navigates to the canonical URL.
- Legacy `/orders/:id[...]` and `/estimates/:id` routes become redirects: load by id,
  then `replace` to `orderPath(order)`.
- One helper, `orderPath(order, suffix?)` in `apps/web/src/lib/orderPath.ts`, builds
  the link wherever the order object (number + customer) is at hand: Estimates and
  Orders rows, the editor's own navigations, duplicate. Places that only hold an order
  id (notifications, calendar, inbox, appointment detail) keep linking to
  `/orders/:id`, which redirects.

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

### Rate limit

`/public/*` is limited per IP across all its routes, previously 5 requests/minute.
Browsing list → estimate → list → estimate is already six, so the budget rises to
**20/minute** (`PUBLIC_RATE_LIMIT` in `public.ts`). Tokens are random UUIDs; the limit
is an abuse brake, not what keeps an estimate private.

### Existing per-estimate links

Links already emailed (`/customer/<order-token>`) keep working unchanged.
`GET /public/estimate/:token` gains `title` in its payload.

## Email & PDF

- `send-estimate` mints `customers.public_token` if absent and links the email button
  and the PDF "Review & confirm online" CTA to `/c/<customer-token>`.
- When the customer has more than one active estimate (counted after this send), the
  email adds one line: "You have N estimates to choose from — open each one and confirm
  the one that suits you."
- Title, when set, appears in the email subject (`Your estimate M2010-126 – Option A from
  …`), in the email intro line (the estimate email is deliberately detail-free and has no
  summary card), and in the PDF's right-hand meta block under the order number. Always
  passed through `escapeHtml` in HTML.
- Only `/send` switches to the customer link. `GET /:id/pdf` and `send-invoice` keep the
  per-order link.
- Email-then-persist ordering is unchanged.

## API changes

| Route | Change |
|---|---|
| `GET /api/orders/grouped?status=&q=` | New. Literal route before `/:id`. `status` ∈ `all`, `active`, `confirmed`, `expired`. Returns customer groups ordered by newest estimate `created_at` desc; orders inside newest-created first; reads ≤500 rows. |
| `GET /api/orders?status=confirmed` | New status value: every confirmed stage (the Orders page's All tab). |
| `GET /api/orders/by-number/:orderNumber` | New. Literal route registered BEFORE `/:id`. Same payload as `GET /:id`. |
| `POST /api/customers/:id/public-link` | New. Mints-if-absent and returns the customer token (Copy customer link). |
| `GET /public/customer/:token` | New, per the payload above. |
| Order create/update schemas | Accept `title` (string ≤120, trimmed, `''`→`null`). Still `.strict()`. |
| `POST /api/orders/:id/send` | Customer-link URL + multi-estimate line + title. |
| `GET /public/estimate/:token` | Adds `title`. |
| Duplicate | Copies `title`; staff edit it to the new option's name. |

Group payload:

```ts
Array<{
  customer: { id: string; first_name: string; last_name: string; email: string; phone: string };
  newest_created_at: string;            // created_at of this customer's newest row in the result
  orders: Order[];                      // list-row shape incl. amount_paid, newest-created first
}>
```

## Error handling & edge cases

- Unknown/malformed customer token → 404, same wording as estimate routes.
- `/c/<token>/<order-number>` where the order is not visible for that customer (draft,
  expired, other customer) → the list with the notice "That estimate is no longer
  available."
- Staff URL with an unknown order number → existing "order not found" state.
- A `sent` order past expiry is filtered from the public list even before the cron
  flips it.
- An order whose customer row is missing (should not happen; FK is `restrict`) is
  grouped under an "Unnamed customer" group keyed by `customer_id`.

## Testing

- **api:** grouping (customer order by newest `created_at`, orders inside newest-first,
  one group per customer, tab filters); `status=confirmed`; `/public/customer/:token`
  (drafts and expired hidden, confirmed shown, unknown token 404, no staff-only fields,
  balance server-computed); `by-number` route and its registration order; `title`
  validation (strict schema still rejects money fields; 121 chars rejected; blank →
  null); send-estimate email with and without title and with 1 vs N active estimates;
  public-link mint is idempotent.
- **web:** `customerSlug`/`orderPath`; group summary text; portal rule "one visible item
  opens directly, otherwise list".
- Verification per AI_GUIDELINES §9: `pnpm check`, `pnpm test`, `pnpm lint` in both
  workspaces; migration 47 applied before deploy.

## Files (expected)

- `supabase/migrations/20261022000047_customer_hub.sql` (new)
- `apps/api/src/routes/orders.ts` (title, grouped, confirmed filter, by-number, send link)
- `apps/api/src/lib/orderGroups.ts` (new — pure grouping)
- `apps/api/src/routes/customers.ts` (public-link)
- `apps/api/src/routes/public.ts`, `publicCustomer.ts` (customer route, title in estimate payload)
- `apps/api/src/lib/email.ts`, `apps/api/src/lib/pdf.ts` (title, link, multi line)
- `apps/web/src/App.tsx` (routes)
- `apps/web/src/lib/orderPath.ts` (new)
- `apps/web/src/pages/estimates/EstimatesPage.tsx`, `EstimateGroup.tsx` (new)
- `apps/web/src/pages/orders/OrderList.tsx` (confirmed-only Orders page)
- `apps/web/src/pages/customer-view/CustomerPortal.tsx`, `PortalList.tsx` (new)
- `apps/web/src/pages/orders/OrderDetail.tsx` (title field, URL handling — minimal touch)
- `apps/web/src/components/Sidebar.tsx` (Estimates + Orders)
- `apps/web/src/hooks/useOrders.ts`, `useCustomers.ts`, `types` (title, grouped, by-number, public link)
- `knowledge/history/engine_features.md`, `memory-bank/activeContext.md`,
  `memory-bank/progress.md`, `memory-bank/systemPatterns.md`
