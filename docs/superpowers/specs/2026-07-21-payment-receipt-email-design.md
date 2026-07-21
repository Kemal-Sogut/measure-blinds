# Payment Receipt Email — Design

Date: 2026-07-21 · Status: approved by user

## Goal

For a specific recorded payment on an order, the consultant can email the
customer a branded receipt with a link to the public invoice/order overview
page.

## Decisions (confirmed with user)

- **Trigger:** manual, per payment row — nothing is emailed automatically.
- **Sent state:** tracked. `payments.receipt_sent_at timestamptz` (nullable);
  the row shows a "receipt sent" indicator and the action becomes "Resend
  receipt". Resending is always allowed.
- **Content:** payment + balance summary (no PDF attachment).
- **UI flow:** confirm sheet first (recipient email, amount/date, optional
  personal message), same pattern as the estimate/invoice send flows.
- **Architecture:** dedicated route; the server computes all money figures
  from the DB (server-authoritative money — AI_GUIDELINES).

## 1. Schema

One migration:

```sql
alter table public.payments add column receipt_sent_at timestamptz;
```

Nullable, no default, no backfill — pre-existing payments show as "not sent".

## 2. API — `POST /api/orders/:id/payments/:paymentId/receipt`

In `apps/api/src/routes/orders.ts`, alongside the other send routes.

- **Body:** `{ message?: string }`, zod `.strict()` (unknown fields → 400).
- **Guards:**
  - payment must exist AND belong to `:id` → else 404
  - order's customer must have an email → else 400 with a clear message
  - `public_token` reused; if absent, minted and persisted exactly like the
    send-invoice route so the CTA link always works
- **Server computes:** paid-to-date = sum of the payments ledger;
  balance = `orders.total − paidToDate`. Nothing money-related from the client.
- **Effects (only after a successful send):**
  - `payments.receipt_sent_at = now()` for that payment
  - activity log: `Receipt for $X.XX emailed to <email>.`
  - returns refreshed order detail (`readDetail` + `amount_paid`), 200
- **Send failure:** 502 with the email service message; `receipt_sent_at`
  stays untouched (state unchanged on failure, same as other send routes).

## 3. Email template — `buildReceiptEmailHtml` in `apps/api/src/lib/email.ts`

Follows the "Customer Emails" design system (branded shell, tinted summary
card, CTA button, fine print, link fallback). All dynamic strings pass
through `escapeHtml`.

- Heading: "We've received your payment"; intro thanks the customer.
- Summary card: eyebrow "Payment receipt", badge = order number; rows:
  Payment `$X.XX`, Received = paid_on date, Order total, Paid to date;
  total line = "Balance remaining" — or, when balance ≤ 0, a
  **"Paid in full"** presentation instead of a zero balance line.
- Optional consultant message block.
- Primary CTA "View your order" → `${APP_URL}/customer/${public_token}`.

Interface:

```ts
export interface ReceiptEmailInputs {
  company: CompanyBrand;
  customerFirstName: string;
  orderNumber: string;
  paymentAmount: number;
  /** Human-formatted paid_on date, e.g. "July 21, 2026" */
  paidOnText: string;
  orderTotal: number;
  paidToDate: number;
  /** orderTotal − paidToDate; ≤ 0 renders as "Paid in full" */
  balance: number;
  viewUrl: string;
  message?: string;
}
export function buildReceiptEmailHtml(i: ReceiptEmailInputs): string;
```

## 4. Web UI — Payments panel in `apps/web/src/pages/orders/OrderDetail.tsx`

- Each payment row gains a small icon action: "Send receipt" — with a subtle
  "receipt sent" check indicator and "Resend receipt" labeling when
  `receipt_sent_at` is set.
- Tapping opens a bottom sheet (existing sheet pattern): recipient email
  (read-only), payment amount + date, optional message textarea, Send button.
  Disabled with an inline hint when the customer has no email.
- Mutation → `POST /api/orders/:id/payments/:paymentId/receipt` with
  `{ message }`; invalidates the order query; success toast
  "Receipt sent to <email>".

## 5. Testing

- Route tests: happy path (sends + stamps `receipt_sent_at` + logs), 404 for
  a payment not on the order, 400 when the customer has no email, email
  failure → 502 and no `receipt_sent_at` stamp.
- Template test: escaping of user strings; paid-in-full variant.
- Existing suites stay green.

## Out of scope

- Auto-send from the e-Transfer webhook
- PDF receipt attachment
- Any behavior change to payment deletion
