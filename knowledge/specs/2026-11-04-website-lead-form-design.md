# Website lead form → Leads page + automatic customer (2026-11-04)

Supersedes the backend half of `knowledge/plans/2026-10-05-website-lead-capture.md`. That plan's
embeddable form (`apps/web/public/embed/lead-form.js` + `.css`) was built and has been served
in demo mode ever since. The `leads` table, the intake route and the Leads page were never built.
Decisions confirmed with the owner on 2026-11-04 are marked (D).

## Goal

1. The owner pastes a short HTML snippet into WordPress and the form works right away, with no
   other accounts or dashboards to set up first.
2. Every submission is stored as a **lead** and, at the same moment, as a **customer**: the
   matching customer when the email is already known, otherwise a new one.
3. Staff see the leads on a **Leads** page in the app.

## Decisions

| # | Decision |
|---|----------|
| D1 | **Embed**: the two-line hosted embed (`<div id="bn-lead-form" data-api=…>` + `<script src=…/embed/lead-form.js>`). Later fixes reach the site without re-pasting. |
| D2 | **Spam guard that needs no setup**: a honeypot field (`website`), a minimum fill time (`fill_ms` ≥ 3 s, timed by the form), and a per-IP rate limit. A bot that trips the honeypot or the timer gets the normal `201`, so it learns nothing, and nothing is stored. **Turnstile is optional**: when the Worker has a `TURNSTILE_SECRET`, a valid token is required (403 otherwise). The form renders the widget only when the embed has a `data-sitekey`. |
| D3 | **Email match → link, fill blanks**: the match is case-insensitive on `customers.email` among customers that are not soft-deleted, and the most recently updated one wins. Existing data is never overwritten. Only blank fields are filled: the phone, the name (only when first and last are both blank), and the shipping address as ONE block (only when `shipping_address_line1` is blank, so two addresses are never mixed). The lead keeps exactly what the visitor typed. |
| D4 | **No match → new customer** with name, email (lower-cased), phone and shipping address. Billing is the same as shipping. |
| D5 | **Staff alerts**: one `lead_received` row in the existing Notifications feed, plus one email to `company_settings.email` with Reply-To set to the visitor. Both are best effort: the lead is never lost because an alert failed. |
| D6 | **Leads nav item** with a dot and a count while any lead is `new`. |

## Data (migration 52)

`public.leads`: `status` (`new` / `contacted` / `archived`), the submitted `first_name`,
`last_name`, `email`, `phone`, `street`, `unit`, `city`, `province`, `postal_code`,
`coverings text[]`, `window_count`, `message`, `consent`, `source_url`, `customer_id`
(FK → customers, `on delete set null`), `customer_match` (`created` / `matched`),
`email_sent_at`, `created_at`, `updated_at`. RLS is on and only `authenticated` has access. No anon policy.

`notifications`: the kind check gains `lead_received`, and the table gains `lead_id` (FK → leads, cascade).

## API

- `POST /intake/lead`: public and rate-limited. **Not** under `/public`, because the maintenance gate
  there would turn leads away with a 503. CORS allows any origin for `/intake/*` (no credentials
  are involved, and CORS does not protect a public form anyway), so the form keeps working on any
  domain the site moves to. The strict Zod schema mirrors the form's own rules. Order of work:
  validate → honeypot/timer → Turnstile (if configured) → find-or-create customer → insert lead →
  alert row → email (then stamp `email_sent_at`). The response is always `201 {"ok":true}`, which
  says nothing about whether the email already belonged to a customer.
- `GET /api/leads?status=&page=`: newest first, 20 per page, the same pager envelope as
  Notifications, plus `new_count`. Each row carries `customer` (id, name, deleted flag).
- `GET /api/leads/summary` → `{ new_count }` for the sidebar (registered before `/:id`).
- `PUT /api/leads/:id` `{ status }`: strict. (Statuses and further endpoints: see the follow-up below.)

## Web

- `/leads` page. Filter chips (New · Contacted · Archived · All) live in `?status=`, the pager in `?page=`.
  Each card shows the name, when it arrived, a status pill, what they want (coverings and window count)
  and the city. It expands to tel/mailto links, the address, the message, the source page, and a link to
  the customer with a "New customer" or "Existing customer" note. Actions: Mark contacted, Archive, Reopen.
- The Notifications row "New website lead" opens `/leads`.
- The embed gains an optional message box on step 2, `fill_ms`, and a production fallback for its
  stylesheet URL when an optimiser plugin hides `document.currentScript`.

## Out of scope

SMS alerts (the earlier Twilio plan), an auto-reply to the visitor, and UTM capture. (Booking a
visit from a lead was added afterwards; see the follow-up below.)

## Follow-up: handled, delete, propose a visit (2026-11-04, migration 53)

Asked by the owner after the first version:

1. **Propose visit.** One dialog on the Leads page: pick a day and a 30-minute start time, add an
   optional note, Send. The visitor gets a thank-you email with the proposed in-home estimate window
   and Confirm / Request another time buttons (`lib/leadProposal.ts`). The visit is booked as an
   ESTIMATE appointment in `proposed` status (unlike a Calendar booking, which is confirmed at once,
   because the visitor never chose this time), and the lead is marked handled. Email first, then the
   visit, then the lead. A second proposal re-times the same visit (same link).
2. **Row icons on Leads and on the Inbox list**: Handled (a tick in a circle, gray, green on hover) and
   Delete (a bin, gray, red on hover). Leads also get the calendar icon for Propose visit.
3. **Statuses** become the Inbox's `new` / `handled`; `contacted` and `archived` are folded into
   `handled`, and spam is deleted instead. `handled_at` and `appointment_id` are added.

API: `PUT /api/leads/:id { status: 'new' | 'handled' }`, `DELETE /api/leads/:id`,
`POST /api/leads/:id/propose { appointment_date, appointment_time, message? }` → `{ data, emailed_to }`.


## WordPress snippet (paste into an Elementor **HTML** widget)

```html
<div id="bn-lead-form"
     data-api="https://blinds-nisa-api.blindsnisa.workers.dev"
     data-phone="613-699-1837"
     data-email="info@blindsnisa.com"></div>
<script src="https://measure-blinds.blindsnisa.workers.dev/embed/lead-form.js" defer></script>
```

Optional later: add `data-sitekey="<Turnstile site key>"` to the `<div>` **and** set the Worker secret
`TURNSTILE_SECRET`. Set both together: the secret without the site key makes every submission fail with 403.

## Go-live order

1. Migration 52 (`supabase/migrations/20261104000052_leads.sql`) was applied by hand on 2026-11-04.
   Apply migration 53 (`20261104000053_leads_handled_proposal.sql`) together with the API deploy: it
   changes the status CHECK, so an API that still writes `contacted` / `archived` would be refused.
2. Deploy the API (`blinds-nisa-api`), then the web (`measure-blinds`, which serves the embed and the Leads page).
3. Paste the snippet. If a caching or optimiser plugin delays or combines JS, exclude `lead-form.js`.
4. Submit one real test lead. Check the Leads page, the Notifications row and the shop email, then
   propose a visit to yourself and confirm it from the email, then delete the lead (and the test visit).
   The test also creates a customer, so delete that one if it is not wanted.
