# Multi-estimate send — design (2026-10-24)

> Status: approved in chat 2026-10-24. Plan next (`knowledge/plans/`), then implementation.
> Builds on spec `2026-10-20-customer-hub-multi-estimate-design.md` (the customer link
> `/c/:token` and the Estimates page grouped by customer).

## Intent and why

A customer is normally quoted **several options** — three fabrics, two room
combinations — and each option is its own estimate row. The customer link
(`/c/:token`, migration 47) already lists every live estimate of one customer, and
already hides expired ones, so the *destination* is right.

What is wrong is the *send*. `POST /api/orders/:id/send` sends exactly one estimate:
it flips that one row to `sent` and emails a link. The other options stay `draft`,
and a draft is invisible on the customer link
(`lib/customerPortal.isPortalVisible`). So the consultant sends option A, the email
says "you have estimates to choose from", and the customer opens the page and sees
one card. Getting all three out means opening each estimate and pressing Send three
times, which sends three emails for one conversation.

The consultant's unit of work is **the customer**, not the estimate row. Sending
should be one action over a chosen set of that customer's estimates, producing one
email.

## Goals

- One send action that marks **every selected** estimate as sent.
- The consultant **chooses** which of the customer's estimates go out; everything
  valid starts selected and is unticked to exclude.
- One email per send, carrying the **customer link** (`/c/:token`) and **no
  attachment**.
- Reachable both from the customer's row on the Estimates page and from an
  individual estimate's page.
- A failed email changes nothing in the database.

## Non-goals

- No way to un-share a sent estimate. Once sent and unexpired it stays on the
  customer link until its expiry date. (Asked directly; the consultant does not need
  it.)
- No per-estimate note — one note for the whole email.
- No change to how the customer link filters what it shows (`customerPortal.ts` is
  untouched).
- No change to invoices, receipts, installation proposals, or the `/send-invoice`
  path.
- No PDF attached to the estimate email any more. PDFs stay available from the staff
  page (`GET /api/orders/:id/pdf`) and the customer page.

## Anti-goals (ways this fails even if it ships)

- Marking estimates as sent when the email did not go out. The consultant would
  believe a customer has figures they never received.
- Emailing a customer from an action whose name does not say "send" — advancing a
  lifecycle stage must never put mail in an inbox (the existing `/mark-sent` rule).
- Sending one email per selected estimate.
- Freezing prices on estimates that were not sent.

## Constraints

- AI_GUIDELINES §2 **email-then-persist**: the status write happens only after Resend
  confirms. This now spans several rows — see "Failure" below.
- AI_GUIDELINES §1: the Worker owns money. Nothing in this feature computes or accepts
  a price.
- AI_GUIDELINES §6: `apps/api/src/routes/orders.ts` (2,813 lines) and
  `apps/web/src/pages/orders/OrderDetail.tsx` (~3,170 lines) are already over the
  800-line limit. New server logic goes in **new files**, not into `orders.ts`; the
  dialog is a new component, not more of `OrderDetail.tsx`.
- Hono literal routes before `/:id` routes in the same group (AI_GUIDELINES §8).
- Tokens are minted lazily and never regenerated (`lib/customerLink.ts`), so links
  already emailed keep working.

## What the consultant sees

**Entry points** (both wanted):

1. Estimates page, inside an open customer group, next to "+ New Estimate" and
   "Copy customer link": a **Send estimates** button
   (`apps/web/src/pages/estimates/EstimateGroup.tsx`).
2. An estimate's own page: the existing **Send** button **saves the open estimate
   first** (`await save()`, exactly as `handleSendEstimate` does today) and then opens
   the same dialog, with the just-saved estimate ticked along with its siblings
   (`apps/web/src/pages/orders/OrderDetail.tsx`). Saving first is not optional: the
   dialog reads rows from the database, so without it the email would announce — and
   the send would freeze — figures the consultant can no longer see. A failed save
   aborts, and the dialog does not open. *(Builder's call: resolves reviewer Q1.)*
   The Send button stays hidden on an `expired` or confirmed order, as it is not an
   estimate send; reviving via expiry date remains the path back.

**The dialog** lists that customer's **valid** estimates — status `draft` or `sent`,
`expiry_date >= today`, at least one line item — newest-created first, each showing
title (when set), order number, issue date, total, and current status. Confirmed
orders, expired estimates and itemless drafts are not listed at all. Every row starts
**ticked**; the consultant unticks what should not go. Below the list: the optional
note box the current send sheet already has, a **copy-link field** carrying the
customer link, then the send button, which names the count ("Send 2 estimates").

A row that is **already `sent`** is listed with a quiet "already on their page" label,
and its tick means only "name it again in this email". Unticking it does **not** take
it off the customer link — un-sharing is a non-goal, and the label exists so the
control cannot be read as doing something it does not do. *(Builder's call: resolves
reviewer Q4.)*

The copy-link field is carried over from the send sheet this dialog replaces: it is
the deliberate path for consultants who pass the link over WhatsApp or SMS instead of
emailing, and the order page would otherwise lose it. It copies the customer link
(`/c/:token`), not a per-order link. *(Builder's call: resolves reviewer Q5.)*

The dialog refuses to send with nothing ticked, and refuses to open for a customer
with no email address (the message the current send sheet already uses). `GET
/api/orders/grouped` already returns `customer.email`, so the Estimates page needs no
extra field for that check.

## What the send does

In order:

1. Validate the selection server-side (ids belong to this customer, status in
   `draft`/`sent`, not past expiry, at least one line item). Any id failing → **400,
   nothing sent**. The item-count guard is new on the server: today only the web
   disables Send for an itemless estimate (`sendDisabled`), so an empty draft could be
   emailed by any other caller. *(Builder's call: resolves reviewer Q7.)*
2. Mint the customer's link token if absent (`ensureCustomerToken`), and each selected
   order's own token if absent (`ensureOrderToken`) — the customer link hands those to
   the detail view.
3. Send **one** email to the customer: the customer link, the note, no attachment.
4. Only then, per selected estimate, **in this order**:
   - write `status='sent'`, `sent_at=now()` and `terms_snapshot` (when absent) for
     rows that were `draft`; an already-`sent` row keeps its original `sent_at` (a
     re-announcement is not a new send), and is skipped here entirely;
   - freeze line-item prices (`freezeOrderPrices`) — **only** for rows that were
     `draft`; a `sent` row is already frozen;
   - append activity-log lines: `Estimate emailed to <email> (1 of N in one send).`
     and, when just frozen, `Item prices locked at send.`

   **The status write comes before the freeze**, which is the reverse of today's
   `/send`, and the reason is the partial-failure case. `holdsPriceLock` is false for
   `draft`, so a row left `draft` **with** frozen items would be silently re-priced by
   the next `PUT /api/orders/:id` — unfreezing figures a customer already holds by
   email. A row left `sent` with **unfrozen** items is the safe half-write instead:
   `sent` holds the lock, so nothing re-prices, and a retry of the same send completes
   the freeze. *(Builder's call: resolves reviewer Q6.)*

### The email

**One** template for every send, N=1 included: `buildEstimatesEmailHtml` **replaces**
`buildEstimateEmailHtml` in `apps/api/src/lib/email.ts`, which is deleted along with
its tests. It cannot stay as the N=1 body: its fine print and JSDoc promise "The full
estimate is also attached as a PDF", and this feature removes the attachment, so
keeping it would email a promise the send no longer honours. Its only caller is the
`/:id/send` route this design removes. `apps/api/src/lib/pdf.ts` documents itself as
mirroring that wording — update the comment there, not the PDF's own CTA. *(Builder's
call: resolves reviewer Q2.)*

- Heading: "Your estimate is ready" / "Your estimates are ready".
- Intro naming the company, and for N > 1 a line saying there are N options to look
  through and that confirming one places that order.
- **N is what the customer link will actually show after this send**, not the number
  ticked: `countActiveEstimates(sb, customer_id, today)` read *after* the status
  writes. Unticking an already-`sent` option leaves it on the page, so a count of
  ticks would under-report what the customer is about to see and read as a bug.
  `countActiveEstimates` therefore stays (it loses its `/send` caller and gains this
  one). *(Builder's call: resolves reviewer Q3.)*
- The consultant's note, when given (`messageBlockHtml`).
- One button to `/c/:token` — "Review & confirm your estimate(s)".
- A plain list of what was sent: title (when set) and order number per estimate, **no
  money** (the figures live on the page; this keeps the "deliberately detail-free"
  rule of the existing template).
- Fine print: nothing is ordered until the customer confirms online; Request Edit on
  the same page for changes.
- Subject: for one estimate, today's `estimateEmailSubject` (order number + title) is
  kept; for several, `Your estimates from <Company>`.

`estimateEmailSubject` (the N=1 subject) stays and keeps its tests — it is a subject
string with no attachment claim in it. Only the HTML body template is replaced.

## Failure

Email first, persistence after (AI_GUIDELINES §2). A failed email → 502 and **no row
changed**: nothing marked sent, nothing frozen, retry is safe.

Persistence after a successful email is **not** atomic across rows — Supabase REST has
no multi-statement transaction here. If a later row's write fails, the response is a
partial result: HTTP 200 with `{ data: { sent: [...ids], failed: [{ id, error }] } }`,
and the dialog tells the consultant which estimates did not get marked and that the
email did go out. Retrying the same send is safe: an already-`sent` row is
re-announced without changing `sent_at`. This is deliberate, and it is the opposite
trade from "mark nothing" — the customer already holds the email, so the database must
be pushed toward matching that, not away from it.

Per-row writes run **sequentially**, not with `Promise.all`, so a mid-way failure
leaves a known prefix rather than an arbitrary subset.

## API

**`GET /api/customers/:id/sendable-estimates`** (new, in
`apps/api/src/routes/customers.ts` — 214 lines, room to grow)

What the dialog lists. Returns, newest-created first:

```ts
{ data: Array<{
    id: string; order_number: string; title: string | null;
    status: 'draft' | 'sent'; order_date: string; expiry_date: string; total: number;
  }> }
```

Filter: `customer_id = :id`, `status in ('draft','sent')`, `expiry_date >= today`, and
at least one line item. 404 when the customer does not exist or is soft-deleted.

**`POST /api/customers/:id/send-estimates`** (new, same file; logic in a new
`apps/api/src/lib/estimateSend.ts`)

```ts
// body, .strict() per AI_GUIDELINES §1 — no money fields, ever
{ order_ids: string[];      // 1..20 uuids, unique
  message?: string }        // <=1000 chars, same as sendMessageSchema
```

Responses: `200 { data: { sent: string[], failed: Array<{id,error}>, customer_token } }`
· `400` invalid selection / expired row / wrong customer / no email address ·
`404` unknown customer · `502` email failed (nothing written) · `500` token mint failed.

**`POST /api/orders/:id/send`** is **removed**, and the web hook `useSendOrder` with
it. It is the single-estimate path this feature replaces, and leaving it in place would
leave one send that attaches a PDF and one that does not. *(This is the one call in
this document that deletes an existing endpoint — flagged for the user.)*

`POST /api/orders/:id/mark-sent` is untouched — status-only, no email, still the
Progress-timeline control.

## Modules

**New**
- `apps/api/src/lib/estimateSend.ts` — pure: validates a selection against rows read
  from the database (ownership, status, expiry), splits "needs freezing" from "already
  sent", builds the per-estimate log lines. Unit-tested without a database.
- `apps/web/src/pages/estimates/SendEstimatesDialog.tsx` — the picker; takes a
  customer id + name, owns tick state and the note box.
- `apps/web/src/hooks/useSendEstimates.ts` — `useSendableEstimates(customerId)` query
  + `useSendEstimates()` mutation; invalidates `['orders','grouped']`, the flat list,
  and each sent order's detail and log caches.

**Modified**
- `apps/api/src/routes/customers.ts` — the two routes above.
- `apps/api/src/lib/email.ts` — `buildEstimatesEmailHtml` replaces
  `buildEstimateEmailHtml`; count-aware subject; `estimateEmailSubject` kept.
- `apps/api/src/lib/pdf.ts` — comment only: it describes itself as mirroring the old
  template's attachment wording.
- `apps/api/src/routes/orders.ts` — remove `/:id/send`.
- `apps/api/src/routes/orders.routes.test.ts` — retire the `/send` suites.
- `apps/web/src/pages/estimates/EstimateGroup.tsx` — "Send estimates" group action.
- `apps/web/src/pages/orders/OrderDetail.tsx` — Send saves, then opens the dialog; the
  estimate branch of `openSend`/`submitSend` and the send sheet's estimate mode give
  way to it, and the sheet's copy-link field moves into the dialog. The invoice
  branch of the same sheet is untouched.
- `apps/web/src/hooks/useOrders.ts` — remove `useSendOrder`.
- `knowledge/history/engine_features.md`, `memory-bank/activeContext.md`,
  `memory-bank/progress.md`, `memory-bank/systemPatterns.md` (AI_GUIDELINES §4, §5).

No migration. No schema change — the feature uses `orders.status`, `orders.sent_at`,
`orders.public_token`, `orders.terms_snapshot` and `customers.public_token` as they are.

## Testing

**api**
- selection validation: id of another customer → 400; expired or confirmed id → 400;
  empty array → 400; 21 ids → 400; duplicate ids → 400.
- happy path, 3 drafts: one `sendEmail` call, three rows `sent`, three price freezes,
  log lines per row.
- mixed selection (2 drafts + 1 already `sent`): the sent row keeps its original
  `sent_at` and is not re-frozen.
- email throws → 502, every row still `draft`, no freeze, no log line.
- a row write fails after a good email → 200 with that id under `failed`.
- customer with no email → 400 before any send.
- itemless draft → 400, and absent from `sendable-estimates`.
- `sendable-estimates`: excludes other customers' drafts, excludes expired, excludes
  confirmed, excludes itemless, newest-created first, unknown customer 404.
- email HTML: 1 vs N wording, note escaped, no attachment field, link is `/c/:token`.
- the email's N counts what the link will show: 1 ticked draft for a customer who
  already holds 2 live sent estimates reads "3".
- strict body: a money field in the payload is rejected (not stripped).

**web**
- dialog: all rows ticked on open, untick removes from payload, send disabled at zero
  ticks, count in the button label.
- already-`sent` rows carry the "already on their page" label.
- partial failure surfaces which estimates were not marked.
- `EstimateGroup` renders the new action; `OrderDetail`'s Send saves before the dialog
  opens, and a failed save opens nothing.

Verification per AI_GUIDELINES §9: `pnpm check`, `pnpm test`, `pnpm lint` in both
workspaces, 0 errors / 0 warnings.

## Left to the builder

- Dialog layout and wording details, within the existing component vocabulary
  (`min-h-11` touch targets, the surface/border tokens `EstimateGroup` uses).
- Whether the picker's rows reuse the estimate-row markup from `EstimateGroup` or get
  their own simpler row.
- Exact log-line phrasing, as long as it records the email address and the fact that
  the send covered several estimates.
- Cache-invalidation specifics in the new hook.
