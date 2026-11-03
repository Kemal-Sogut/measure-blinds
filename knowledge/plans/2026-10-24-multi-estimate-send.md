# Multi-estimate send — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-estimate email send with one action that emails a
customer **one** link for a chosen set of their estimates and marks every chosen
estimate as sent.

**Architecture:** A new pair of routes on the customers group (`GET
/:id/sendable-estimates`, `POST /:id/send-estimates`) with the selection rules in a
pure, database-free module (`apps/api/src/lib/estimateSend.ts`). The email becomes one
count-aware template and carries no attachment. `POST /api/orders/:id/send` is deleted.
On the web, a picker dialog reachable from the Estimates page's customer group and
from an estimate's own Send button; its decision logic lives in a pure lib module
because this workspace has no component-test harness.

**Tech Stack:** Hono 4 + Zod 3 on Cloudflare Workers, supabase-js 2, Resend via
`fetch`; React 19 + Vite + Tailwind 4 + TanStack Query 5; Vitest both sides.

**Spec:** `knowledge/specs/2026-10-24-multi-estimate-send-design.md`

## Global Constraints

- Every source file starts with the two SPDX/copyright lines (AI_GUIDELINES §10).
- Every exported module, function, type, hook, component and route group carries a
  JSDoc scoring ≥8/10 (AI_GUIDELINES §3), English only.
- Request schemas are `.strict()`; a client-supplied money field must be **rejected**,
  never stripped (AI_GUIDELINES §1).
- Email-then-persist: the email goes out before any status write; a failed email writes
  nothing (AI_GUIDELINES §2).
- Every user-supplied string interpolated into email HTML goes through `escapeHtml`.
- New server logic goes in new files — `apps/api/src/routes/orders.ts` (2,813 lines) and
  `apps/web/src/pages/orders/OrderDetail.tsx` (~3,170) are already over the 800-line
  limit (AI_GUIDELINES §6). Files stay under 800 lines, functions under ~100.
- Literal Hono routes are registered **before** `/:id` routes in the same group
  (AI_GUIDELINES §8). `/:id/sendable-estimates` and `/:id/send-estimates` are param
  routes and must sit beside the existing `/:id/public-link`, above `PUT /:id`.
- No migration, no schema change.
- Web tests are pure-function tests in `apps/web/src/lib/*.test.ts`; this workspace has
  no jsdom or testing-library. Do not add one.
- Verification per AI_GUIDELINES §9: `pnpm check`, `pnpm test` (api), plus `pnpm lint`
  (web) — 0 errors / 0 warnings.

## Review Focus

Inputs the spec implies but names no test for; each line's test is attached to the task
that owns the code.

1. **An estimate confirmed by the customer between dialog open and send.** The picker's
   list is a snapshot; the customer may press Confirm on `/c/:token` meanwhile. Sending
   must refuse with 400 and write nothing — never flip an `awaiting_payment` order back
   to `sent`. (Task 1, Task 4)
2. **An estimate that lapsed between dialog open and send** (a send across midnight, or
   a long-open dialog). Must refuse, since `applyDefensiveExpiry` would flip it to
   `expired` on the next read and the customer link would hide what the email
   announced. (Task 1, Task 4)
3. **A customer soft-deleted between dialog open and send.** Must 404 before any email —
   `ensureCustomerToken` does not filter `deleted_at`, so the route has to. (Task 4)
4. **The same send pressed twice** (double tap, retry after a timeout). The second must
   not re-freeze prices, must not move `sent_at`, and must not change what the customer
   already holds. (Task 4)
5. **A note containing HTML and a note at the 1000-character limit.** The note is the
   one free-text field in the email; `<script>` must arrive escaped and 1001 characters
   must 400. (Task 2, Task 4)

---

### Task 1: Selection rules (pure)

**Files:**
- Create: `apps/api/src/lib/estimateSend.ts`
- Create: `apps/api/src/lib/estimateSend.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:

```ts
/** The order columns the send route reads for each candidate row. */
export interface SendCandidateRow {
  id: string;
  order_number: string;
  title: string | null;
  customer_id: string;
  status: string;
  expiry_date: string;
  /** Number of line items on the row — 0 cannot be sent. */
  item_count: number;
  public_token: string | null;
  terms_snapshot: string | null;
}

/** A validated selection, split by what each row needs. */
export interface SelectionPlan {
  /** Rows that were `draft`: status write + freeze, in request order. */
  toSend: SendCandidateRow[];
  /** Rows already `sent`: named in the email, never written. */
  toAnnounce: SendCandidateRow[];
}

export function planSelection(
  rows: SendCandidateRow[],
  orderIds: string[],
  customerId: string,
  today: string
): { plan: SelectionPlan } | { error: string };

/** `Estimate emailed to a@b.com (1 of 3 in one send).` */
export function sendLogLine(email: string, index: number, total: number): string;
```

- [ ] **Step 1: Write the failing tests** in `apps/api/src/lib/estimateSend.test.ts`

```ts
const row = (over: Partial<SendCandidateRow> = {}): SendCandidateRow => ({
  id: 'a1', order_number: 'M2010-1', title: null, customer_id: 'c1',
  status: 'draft', expiry_date: '2026-12-31', item_count: 2,
  public_token: null, terms_snapshot: null, ...over,
});

// splitting
it('puts drafts in toSend and sent rows in toAnnounce, in request order', ...)
//   rows [draft a1, sent a2], ids ['a2','a1'] → toSend ids ['a1'], toAnnounce ids ['a2']
it('rejects an id with no row', ...)            // error: 'One of the selected estimates no longer exists.'
it('rejects a row of another customer', ...)    // customer_id 'c2' → 'belongs to another customer'
it('rejects a confirmed row', ...)              // status 'awaiting_payment' → 'cannot be sent'  [Review Focus 1]
it('rejects an expired status row', ...)        // status 'expired'
it('rejects a row whose expiry is before today', ...) // expiry '2026-10-23', today '2026-10-24'  [Review Focus 2]
it('rejects a row with no line items', ...)     // item_count 0
it('rejects an empty id list', ...)
it('accepts a row whose expiry is exactly today', ...)

// log line
it('names the email address and the position in the send', ...)
//   sendLogLine('a@b.com', 1, 3) === 'Estimate emailed to a@b.com (1 of 3 in one send).'
```

Error strings are user-facing; write each one once in the test and reuse it in the
implementation verbatim.

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && pnpm vitest run src/lib/estimateSend.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `apps/api/src/lib/estimateSend.ts`**

`planSelection` walks `orderIds` in order (so the plan's order is the consultant's),
looks each up in a `Map` built from `rows`, and returns the **first** failure as
`{ error }`. No database, no clock — `today` is passed in.

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/api && pnpm vitest run src/lib/estimateSend.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/estimateSend.ts apps/api/src/lib/estimateSend.test.ts
git commit -m "feat(api): selection rules for a multi-estimate send"
```

---

### Task 2: The estimates email

**Files:**
- Modify: `apps/api/src/lib/email.ts` (replace `buildEstimateEmailHtml` and its
  `EstimateEmailInputs`; keep `estimateEmailSubject`)
- Modify: `apps/api/src/lib/email.test.ts` (replace the `buildEstimateEmailHtml` suite
  at ~line 38 and ~line 320; keep the `estimateEmailSubject` suite at ~line 334)
- Modify: `apps/api/src/lib/pdf.ts:550` — comment only, it names the old template

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:

```ts
/** One estimate named in the email — no money, the page holds the figures. */
export interface EstimateEmailLine {
  order_number: string;
  title: string | null;
}

export interface EstimatesEmailInputs {
  /** Same shape `brandFromSettings` returns, as the old inputs used. */
  company: EmailBrand;
  customerFirstName: string;
  message?: string;
  /** The customer link, `/c/:token`. */
  viewUrl: string;
  /** Estimates named in this email, in send order. */
  estimates: EstimateEmailLine[];
  /** How many live estimates the customer link will show after this send. */
  liveCount: number;
}

export function buildEstimatesEmailHtml(i: EstimatesEmailInputs): string;

/** `Your estimate M2010-126 – Option A from X` for one, `Your estimates from X` for several. */
export function estimatesEmailSubject(companyName: string, estimates: EstimateEmailLine[]): string;
```

`EmailBrand` is the existing type of `EstimateEmailInputs['company']` — reuse it under
whatever name the file already gives it rather than introducing a new one.

- [ ] **Step 1: Write the failing tests** in `apps/api/src/lib/email.test.ts`

```ts
describe('buildEstimatesEmailHtml', () => {
  // base: one estimate, liveCount 1, no message
  it('says "Your estimate is ready" for one estimate', ...)
  it('says "Your estimates are ready" for several', ...)
  it('names every estimate by order number, and its title when set', ...)
  it('prints no money', ...)                 // no '$' in the html
  it('states the live count, not the sent count', ...)
    // estimates: 1 entry, liveCount: 3 → contains 'You have 3 estimates'
  it('omits the choice line when liveCount is 1', ...)
  it('links the button and the fallback to viewUrl', ...)   // the `/c/<token>` url
  it('makes no attachment promise', ...)     // not /attached as a PDF/i
  it('escapes the consultant note', ...)     // '<script>' → '&lt;script&gt;'  [Review Focus 5]
  it('escapes a title', ...)                 // 'Option <A>' → '&lt;A&gt;'
});

describe('estimatesEmailSubject', () => {
  it('names the order number and title for one estimate', ...)
    // ['M2010-126','Option A'] → 'Your estimate M2010-126 – Option A from Blinds Nisa'
  it('drops to a plain subject for several', ...)
    // 2 entries → 'Your estimates from Blinds Nisa'
});
```

Delete the two `buildEstimateEmailHtml` blocks and its import in the same edit.

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && pnpm vitest run src/lib/email.test.ts`
Expected: FAIL — `buildEstimatesEmailHtml` / `estimatesEmailSubject` not exported.

- [ ] **Step 3: Implement both in `apps/api/src/lib/email.ts`**

Build the body from the existing helpers — `headingHtml`, `introHtml`,
`messageBlockHtml`, `primaryButtonHtml`, `finePrintHtml`, `linkFallbackHtml`,
`brandedShell` — so the branding stays identical. The estimate list renders as a
`checklistHtml`-style block of escaped `order_number` + `— title`, with no figures. For
one estimate, `estimatesEmailSubject` delegates to the kept `estimateEmailSubject`.
The JSDoc keeps the old template's two rules and drops the third: deliberately
detail-free, confirmation is explicit, **no attachment**. `/:id/send` still imports the
old name at this point, so `pnpm check` is expected to fail until Task 5 — note that in
the commit message, do not "fix" it here.

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/api && pnpm vitest run src/lib/email.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/email.ts apps/api/src/lib/email.test.ts apps/api/src/lib/pdf.ts
git commit -m "feat(api): count-aware estimates email, no attachment promise"
```

---

### Task 3: `GET /api/customers/:id/sendable-estimates`

**Files:**
- Modify: `apps/api/src/routes/customers.ts` (beside `/:id/public-link`, above `PUT /:id`)
- Modify: `apps/api/src/routes/customers.routes.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the dialog's list —

```ts
{ data: Array<{
    id: string; order_number: string; title: string | null;
    status: 'draft' | 'sent'; order_date: string; expiry_date: string; total: number;
  }> }
```

- [ ] **Step 1: Write the failing tests** in `apps/api/src/routes/customers.routes.test.ts`

The file's fake builder ignores filters, so script rows and assert on the **filters the
route asked for** (`db.filters`, as `orders.routes.test.ts` does) plus the mapped shape:

```ts
it('asks for this customer, draft+sent, expiry from today, newest-created first', ...)
//   filters contain ['orders','eq',['customer_id','c1']],
//   ['orders','in',['status',['draft','sent']]], ['orders','gte',['expiry_date', <today>]]
it('drops rows with no line items', ...)      // scripted row with line_items: [] absent from data
it('returns total as a number', ...)          // scripted '1234.50' → 1234.5
it('404s for an unknown or soft-deleted customer', ...)
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && pnpm vitest run src/routes/customers.routes.test.ts`
Expected: FAIL — 404 from an unregistered route.

- [ ] **Step 3: Implement the route**

Read the customer first (`id`, `deleted_at is null`) for the 404. Then select
`id, order_number, title, status, order_date, expiry_date, total, line_items(id)` with
the three filters above, ordered `created_at` descending, and map to the payload,
dropping rows whose `line_items` is empty. The item count is not in the payload — the
server is the only thing that needs it.

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/api && pnpm vitest run src/routes/customers.routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/customers.ts apps/api/src/routes/customers.routes.test.ts
git commit -m "feat(api): list a customer's sendable estimates"
```

---

### Task 4: `POST /api/customers/:id/send-estimates`

**Files:**
- Modify: `apps/api/src/routes/customers.ts`
- Modify: `apps/api/src/routes/customers.routes.test.ts`

**Interfaces:**
- Consumes: `planSelection`, `sendLogLine` (Task 1); `buildEstimatesEmailHtml`,
  `estimatesEmailSubject` (Task 2); `ensureCustomerToken`, `ensureOrderToken`,
  `countActiveEstimates` (`lib/customerLink.ts`); `freezeOrderPrices`
  (`lib/priceLockStore.ts`); `sendEmail`, `brandFromSettings` (`lib/email.ts`); the
  activity-log writer `/:id/send` uses today (`logOrderEvent`) — import it from
  wherever `orders.ts` gets it, or lift it to a lib module if it is local to `orders.ts`.
- Produces:

```ts
// request body
{ order_ids: string[]; message?: string }   // 1..20 unique uuids, message <=1000
// response
{ data: { sent: string[]; announced: string[]; failed: Array<{ id: string; error: string }>;
          customer_token: string } }
```

- [ ] **Step 1: Write the failing tests** in `apps/api/src/routes/customers.routes.test.ts`

Mock `../lib/email` so `sendEmail` is a `vi.fn()` whose calls and throw are scriptable,
as the orders suite does for its own send tests.

```ts
it('sends ONE email and marks every selected draft sent', ...)
//   3 drafts → sendEmail called once; orders update payloads: 3, each
//   { status: 'sent', sent_at: <iso>, terms_snapshot: <terms> }; data.sent has 3 ids
it('writes status before freezing prices', ...)            [Review Focus / spec Q6]
//   the orders update for a row precedes that row's line_items update in db.calls
it('leaves an already-sent row untouched and names it in the email', ...)
//   mixed selection → that id in data.announced, no orders update for it,
//   no line_items update for it, and its order number in the email html
it('counts what the link will show, not what was ticked', ...)
//   countActiveEstimates scripted 3, one id sent → email html contains 'You have 3'
it('returns 502 and writes nothing when the email fails', ...)
//   sendEmail throws → 502, db.updatePayloads.orders undefined, no log inserts
it('400s a customer with no email address before sending', ...)
it('404s an unknown or soft-deleted customer before sending', ...)   [Review Focus 3]
it('400s when a selected estimate was confirmed meanwhile', ...)     [Review Focus 1]
it('400s when a selected estimate expired meanwhile', ...)           [Review Focus 2]
it('rejects a duplicate id, an empty list, 21 ids, and a non-uuid id', ...)
it('rejects an unknown field in the body', ...)   // { order_ids: [...], total: 1 } → 400
it('rejects a 1001-character message', ...)                          [Review Focus 5]
it('reports a row whose status write failed under failed, with 200', ...)
//   opErrors['orders.update'] for the second row → data.sent has 1 id, data.failed has 1
it('is safe to run twice', ...)                                      [Review Focus 4]
//   second call with all rows already `sent`: no orders update, no line_items update,
//   one email, every id under announced
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && pnpm vitest run src/routes/customers.routes.test.ts`
Expected: FAIL — 404 from an unregistered route.

- [ ] **Step 3: Implement the route**

Zod: `z.object({ order_ids: z.array(z.string().uuid()).min(1).max(20), message:
z.string().max(1000).optional() }).strict()` plus a refinement rejecting duplicate ids;
reuse the file's `firstZodIssue` for the 400 text.

Sequence, exactly:

1. Read the customer (`id, first_name, last_name, email`, `deleted_at is null`) → 404.
   Empty email → 400 `'This customer has no email address.'`
2. Read candidate rows for those ids with the columns of `SendCandidateRow`
   (`line_items(id)` collapsed to `item_count`), then `planSelection(...)` with
   `today = new Date().toISOString().slice(0, 10)` → its `error` becomes a 400.
3. `ensureCustomerToken` → 404 when null, 500 on throw; `ensureOrderToken` for every row
   in `toSend` and `toAnnounce` (the link hands these to the detail view).
4. Read `company_settings` for `brandFromSettings` and `terms_and_conditions`.
5. `sendEmail` once — `estimatesEmailSubject`, `buildEstimatesEmailHtml`, **no
   `attachments` field**, `liveCount = countActiveEstimates(sb, customerId, today) +
   toSend.length` (the sent rows have not been written yet, so add them). A throw → 502
   with no write of any kind.
6. Then, for each `toSend` row **sequentially** (`for ... of`, never `Promise.all`):
   update `{ status: 'sent', sent_at, terms_snapshot: row.terms_snapshot ?? companyTerms }`;
   on error push to `failed` and continue to the next row. Then `freezeOrderPrices`; on
   error push to `failed` too. Then `logOrderEvent(sendLogLine(email, i + 1, total))`
   and, when the freeze succeeded, `'Item prices locked at send.'`
7. 200 with `{ sent, announced, failed, customer_token }`.

If the route function grows past ~100 lines, move steps 2–6 into
`apps/api/src/lib/estimateSend.ts` as an exported `runEstimateSend(sb, env, …)` and keep
the handler thin (AI_GUIDELINES §6).

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/api && pnpm vitest run src/routes/customers.routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/customers.ts apps/api/src/routes/customers.routes.test.ts apps/api/src/lib/estimateSend.ts
git commit -m "feat(api): send several estimates in one customer-link email"
```

---

### Task 5: Retire `POST /api/orders/:id/send`

**Files:**
- Modify: `apps/api/src/routes/orders.ts` (route at 1657–1751, its imports at 108–109,
  the module JSDoc line 30)
- Modify: `apps/api/src/routes/orders.routes.test.ts` (the `/send` suites at ~481 and
  ~2827)

**Interfaces:**
- Consumes: nothing. Produces: nothing — this task only removes. `useSendOrder` is
  removed in Task 9, together with its only call site; deleting it here would leave
  `OrderDetail.tsx` uncompilable between tasks.

- [ ] **Step 1: Delete the route, its imports and its doc line**

`countActiveEstimates` keeps a caller (Task 4) and stays in `lib/customerLink.ts`; its
tests stay. `/:id/mark-sent`, `/:id/public-token` and `/:id/send-invoice` are untouched.

- [ ] **Step 2: Delete the `/send` test suites** and any helper that now has no caller.

- [ ] **Step 3: Verify**

Run: `cd apps/api && pnpm check && pnpm test`
Expected: 0 errors, all tests pass — including Task 2's email suite, which could not
compile before this deletion. `apps/web` still calls the now-dead endpoint through
`useSendOrder` and keeps compiling; Task 9 removes both.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/orders.ts apps/api/src/routes/orders.routes.test.ts
git commit -m "refactor(api): remove the single-estimate send route"
```

---

### Task 6: Dialog logic (pure, web)

**Files:**
- Create: `apps/web/src/lib/estimateSelection.ts`
- Create: `apps/web/src/lib/estimateSelection.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:

```ts
/** One row of `GET /api/customers/:id/sendable-estimates`. */
export interface SendableEstimate {
  id: string; order_number: string; title: string | null;
  status: 'draft' | 'sent'; order_date: string; expiry_date: string; total: number;
}

/** Every id, ticked — the dialog opens with all of them selected. */
export function initialSelection(rows: SendableEstimate[]): string[];
/** Adds or removes one id, preserving `rows` order. */
export function toggleSelection(selected: string[], id: string, rows: SendableEstimate[]): string[];
/** `Send estimate` / `Send 2 estimates`; `Send estimates` at zero. */
export function sendButtonLabel(count: number): string;
/** What the consultant is told after a 200 that carries failures. */
export function partialFailureMessage(
  failed: Array<{ id: string; error: string }>,
  rows: SendableEstimate[]
): string;
```

- [ ] **Step 1: Write the failing tests** in `apps/web/src/lib/estimateSelection.test.ts`

```ts
it('ticks every row on open', ...)
it('unticks and re-ticks one id, keeping row order', ...)
it('labels the button with the count', ...)
//   0 → 'Send estimates', 1 → 'Send estimate', 2 → 'Send 2 estimates'
it('names the estimates that were not marked, and says the email went out', ...)
//   failed [{id:'a2',error:'db down'}] → contains 'M2010-2' and 'email was sent'
it('falls back to the id when the failed row is not in rows', ...)
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && pnpm vitest run src/lib/estimateSelection.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `apps/web/src/lib/estimateSelection.ts`**

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && pnpm vitest run src/lib/estimateSelection.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/estimateSelection.ts apps/web/src/lib/estimateSelection.test.ts
git commit -m "feat(web): selection logic for the send-estimates dialog"
```

---

### Task 7: Hooks

**Files:**
- Create: `apps/web/src/hooks/useSendEstimates.ts`

**Interfaces:**
- Consumes: `SendableEstimate` (Task 6); `apiFetch` (`lib/api`); the `Envelope<T>`
  pattern used by `hooks/useCustomers.ts`.
- Produces:

```ts
/** The dialog's list; disabled until a customer id is given. */
export function useSendableEstimates(customerId: string | undefined):
  UseQueryResult<SendableEstimate[]>;

export interface SendEstimatesResult {
  sent: string[]; announced: string[];
  failed: Array<{ id: string; error: string }>; customer_token: string;
}

export function useSendEstimates(): UseMutationResult<
  SendEstimatesResult, Error,
  { customerId: string; orderIds: string[]; message?: string }
>;
```

- [ ] **Step 1: Implement the hooks**

Query key `['customers', customerId, 'sendable-estimates']`, `enabled:
Boolean(customerId)`. The mutation POSTs `{ order_ids, message }` and on success
invalidates `['orders','grouped']`, `['orders','list']` (whatever key `useOrders` uses
for the flat list — read it, do not guess), its own query key, and for every id in
`sent`: `['orders','detail',id]` and `['orders','logs',id]`.

No test: this is TanStack wiring with no logic of its own, and the workspace has no
hook-test harness. Its behavior is covered by Task 4's route tests and Task 6's logic
tests.

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/web && pnpm check`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/hooks/useSendEstimates.ts
git commit -m "feat(web): hooks for the multi-estimate send"
```

---

### Task 8: The dialog, and the Estimates-page entry point

**Files:**
- Create: `apps/web/src/pages/estimates/SendEstimatesDialog.tsx`
- Modify: `apps/web/src/pages/estimates/EstimateGroup.tsx` (group actions, ~131–152)

**Interfaces:**
- Consumes: Task 6's helpers, Task 7's hooks, `CopyLinkField`
  (`apps/web/src/components/CopyLinkField.tsx`), `customerLinkPath`
  (`lib/orderPath.ts`).
- Produces:

```tsx
export interface SendEstimatesDialogProps {
  customerId: string;
  /** Shown in the dialog's intro, e.g. "We'll email jane@x.com". */
  customerEmail: string;
  onClose: () => void;
  /** Called after a send with no failures. */
  onSent?: () => void;
}
export default function SendEstimatesDialog(props: SendEstimatesDialogProps): JSX.Element;
```

- [ ] **Step 1: Build the dialog**

Markup follows the send sheet it replaces (`OrderDetail.tsx` ~3040): fixed overlay,
`items-end lg:items-center`, the same panel classes, backdrop click closes. Contents, in
order: title "Send estimates"; one line naming the email address and saying no PDF is
attached because the link carries everything; the row list; the note textarea
(`maxLength={1000}`, same placeholder); a `CopyLinkField` for the customer link, its
`value` from the mutation's `customer_token` once known, else from
`useCustomerPublicLink` on open (the Estimates page already mints that way); Cancel and
the send button, labelled by `sendButtonLabel`, disabled at zero ticks or while pending.

Each row: a checkbox (`min-h-11` touch target), title when set, `order_number` ·
`shortDay(order_date)`, the total right-aligned mono as `EstimateGroup` prints it, and
for a `status === 'sent'` row a quiet "already on their page" label. Loading and empty
states reuse `Skeleton` / `EmptyState`; the empty case reads "No estimates ready to
send" with the reason (drafts with items, not expired).

On success: `toast.success` naming the count, close, `onSent?.()`. With `failed`
non-empty: `toast.error(partialFailureMessage(...))` and keep the dialog open.

- [ ] **Step 2: Wire the Estimates page**

In `EstimateGroup`, a "Send estimates" button beside "Copy customer link" opens the
dialog with `customer.id` and `customer.email`; it is disabled with the title "This
customer has no email address" when `customer.email` is empty. The dialog renders from
`EstimateGroup`'s own state.

- [ ] **Step 3: Verify**

Run: `cd apps/web && pnpm check && pnpm lint && pnpm test`
Expected: 0 errors, 0 warnings, tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/estimates/SendEstimatesDialog.tsx apps/web/src/pages/estimates/EstimateGroup.tsx
git commit -m "feat(web): pick which estimates to send from the customer group"
```

---

### Task 9: The estimate page's Send button

**Files:**
- Modify: `apps/web/src/pages/orders/OrderDetail.tsx` (`openSend` ~1258, `submitSend`
  ~1274, `handleSendEstimate` ~1281, the send sheet ~3040, the imports at 86/97)
- Modify: `apps/web/src/hooks/useOrders.ts` (remove `useSendOrder`, ~377 — its only
  call site goes in this task)

**Interfaces:**
- Consumes: `SendEstimatesDialog` (Task 8).
- Produces: nothing.

- [ ] **Step 1: Make Send save, then open the dialog**

For an estimate (not `isInvoice`): keep the `customer?.email` guard and the
`await save()` that `handleSendEstimate` does today — the dialog reads rows from the
database, so an unsaved edit would otherwise be emailed and frozen as the old figures.
A failed save opens nothing. Then open `SendEstimatesDialog` with the order's
`customer.id`. The Send button is hidden for an `expired` or confirmed order, as it is
no longer an estimate send.

- [ ] **Step 2: Reduce the send sheet to invoices**

`sheet === 'send'` now only serves `isInvoice`; `submitSend` loses its estimate branch,
`handleSendEstimate` goes, and `openSend`'s token mint stays for the invoice link.
Then delete `sendMut`, its import, and `useSendOrder` in `hooks/useOrders.ts` — the
route behind it is gone (Task 5).

- [ ] **Step 3: Verify**

Run: `cd apps/web && pnpm check && pnpm lint && pnpm test`
Expected: 0 errors, 0 warnings, tests pass. `grep -rn "useSendOrder\|orders/.*\/send'"
apps/web/src` returns nothing.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/orders/OrderDetail.tsx apps/web/src/hooks/useOrders.ts
git commit -m "feat(web): Send on an estimate opens the multi-estimate picker"
```

---

### Task 10: Docs and full verification

**Files:**
- Modify: `knowledge/history/engine_features.md`, `memory-bank/activeContext.md`,
  `memory-bank/progress.md`, `memory-bank/systemPatterns.md`

- [ ] **Step 1: History entry** (AI_GUIDELINES §4) — append a dated `2026-10-24`
  section to `knowledge/history/engine_features.md`: the multi-estimate send, the two
  new customer routes, the removal of `POST /api/orders/:id/send`, estimate emails no
  longer carrying a PDF, status-before-freeze and why, the partial-failure contract,
  and the dialog's two entry points. Link the spec and this plan.

- [ ] **Step 2: Memory bank** (AI_GUIDELINES §5 — overwrite, do not append) — current
  state in `activeContext.md` and `progress.md`; add to `systemPatterns.md`: "Estimate
  sends are per customer over a selected set; the order routes no longer email
  estimates" and "A send writes status before freezing prices, so a half-written row
  errs toward locked".

- [ ] **Step 3: Full verification** (AI_GUIDELINES §9)

```bash
cd apps/api && pnpm check && pnpm test
```
```bash
cd apps/web && pnpm check && pnpm test && pnpm lint
```
Expected: 0 errors, 0 warnings, all tests passing. Record the counts.

- [ ] **Step 4: Confirm the scope held** — `git diff --stat main` touches only the files
  named in this plan.

- [ ] **Step 5: Commit**

```bash
git add knowledge/ memory-bank/
git commit -m "docs: multi-estimate send — history and memory bank"
```

- [ ] **Step 6: Browser check** — start the dev server with the preview tools and
  confirm: a customer with two drafts and one sent estimate shows three ticked rows;
  unticking one and sending marks only the other two; the customer link then lists
  them; an expired estimate never appears in the picker. Needs `apps/web/.env` with the
  Supabase vars — if it is missing, say so rather than claiming the check was done.

No deploy step: the API Worker is deployed by hand (`wrangler deploy` in `apps/api`),
the web Worker by pushing `main`. Neither happens as part of this plan.
