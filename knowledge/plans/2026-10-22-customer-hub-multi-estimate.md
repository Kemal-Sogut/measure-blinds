# Multiple Estimates per Customer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a customer receive several estimates on one link and confirm whichever they choose; on the staff side, group every estimate under its customer on the Estimates page and list confirmed work on a separate Orders page.

**Architecture:** No new business table: an "estimate" stays an `orders` row before confirmation and an "order" is the same row after. Migration 47 adds `orders.title`, `customers.public_token` and a grouping index. The Worker gains a customer-token list endpoint that hands out each visible order's existing per-order token, so the detail view reuses today's `/public/estimate/:token` flow unchanged. A new `GET /api/orders/grouped` groups estimates by customer, newest-created estimate first. The SPA's home becomes a customer-grouped Estimates page, `/orders` becomes a confirmed-only Orders page, the customer link `/c/:token` is added, and staff URLs become `/<customer-slug>/<order-number>` resolved by order number (the slug is cosmetic). The Customers pages are untouched.

**Tech Stack:** pnpm monorepo. API: Hono 4 on Cloudflare Workers, Zod 3, supabase-js 2, pdf-lib, Vitest 3. Web: React 19, Vite 8, Tailwind 4 (`@theme` tokens), react-router-dom 6, TanStack Query 5, react-hot-toast, date-fns, Vitest 3, oxlint. DB: Supabase Postgres (project `lgbxxlwsdeuhdgzrjjen`).

**Spec:** `knowledge/specs/2026-10-20-customer-hub-multi-estimate-design.md`

## Global Constraints

Full detail in `AI_GUIDELINES.md`. Every task's requirements implicitly include this section.

- **Branch:** `feat/customer-hub`. Create it from `main` AFTER `feat/inbox-unread` is merged (it owns migration 46 and edits `Sidebar.tsx`). If it is not merged yet, branch from `feat/inbox-unread` instead and say so in the PR.
- **Working directory:** `/Users/kemal/Desktop/measure-blinds`. `pnpm` commands run inside `apps/api` or `apps/web` as stated.
- **SPDX header (rule 10):** every new `.ts`/`.tsx`/`.sql` file begins with exactly:
  ```ts
  // SPDX-License-Identifier: GPL-3.0-only
  // Copyright (c) 2026 Blinds Nisa. All rights reserved.
  ```
  (`--` instead of `//` in SQL). Preserve it on every modified file.
- **JSDoc (rule 3):** every exported module, component, hook, function, type and route group carries a `/** ... */` explaining purpose, behaviour, constraints and integration context. Self-score 0–10; below 8 must be improved before the task is done. The code blocks below show the required docs in short form — expand any that would score below 8.
- **Server-authoritative money (rule 1):** the web never computes a total or balance it shows a customer. Public payloads carry server-computed `total` and `balance`. Order Zod schemas stay `.strict()`; `title` is the only new accepted field.
- **Security (rule 2):** every user string in email HTML goes through `escapeHtml`. Public routes return explicit sanitized objects — never a spread of a DB row. No anon RLS policy.
- **Hono route order (rule 8):** literal routes (`/by-number/:orderNumber`) are registered BEFORE `/:id`.
- **File size (rule 6):** new files stay well under 800 lines. `orders.ts` (~2,685) and `OrderDetail.tsx` (~3,170) are standing violations — add only what each task specifies; new logic goes into new `lib/` modules.
- **Scope (rule 7):** touch only the files each task names.
- **No new dependencies.** Icons are inline `<svg stroke="currentColor">`.
- **Tap targets:** every interactive control is at least 44px tall (`h-11` / `min-h-11`).
- **Verification (rule 9):** in each touched workspace, `pnpm check`, `pnpm test`, `pnpm lint` (web) — 0 errors, 0 warnings.
- **Customer-facing copy (from the spec, verbatim):** card button label `View`; back link `← All your estimates`; multi-estimate email line `You have N estimates to choose from — open each one and confirm the one that suits you.`; missing-estimate notice `That estimate is no longer available.`; empty portal `Nothing to review right now — contact us`.
- **Title:** optional, trimmed, whitespace collapsed, max 120 chars, blank → `null`. When `null` it is rendered NOWHERE (no fallback label).
- **Migration number:** 47 (`supabase/migrations/20261022000047_customer_hub.sql`). It is applied to the live project only in Task 12, and only after the user says yes.
- **Customers pages are out of scope:** `CustomerList.tsx`, `CustomerForm.tsx`, `CustomerDetailView.tsx` and `GET /api/customers` must not change.

## Decision taken during planning (flag in the PR)

The public limiter is `rateLimit(5, 60_000)` per IP across ALL `/public/*` routes (`apps/api/src/middleware/rateLimit.ts`). Browsing a portal (list → estimate A → list → estimate B) is already 6 requests, so customers would hit 429 doing exactly what this feature is for. Task 5 raises the `/public` budget to **20 requests/min/IP** via an exported `PUBLIC_RATE_LIMIT` constant. Tokens are random UUIDs, so the limit is an abuse brake, not what keeps estimates private.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `supabase/migrations/20261022000047_customer_hub.sql` | **new.** `orders.title`, `customers.public_token`, index `orders_customer_created_idx`. | 1 |
| `apps/api/src/lib/orderTitle.ts` (+ `.test.ts`) | **new.** Title normalisation and the PUT patch fragment. | 2 |
| `apps/api/src/routes/orders.ts` | **modify.** `title` in schema/create/update; shared `applyListFilters`; `status=confirmed`; `GET /grouped`; `GET /by-number/:orderNumber`; `/send` uses customer link + title + multi line. | 2, 3, 6 |
| `apps/api/src/lib/orderGroups.ts` (+ `.test.ts`) | **new.** Pure grouping of order rows by customer, newest estimate first. | 3 |
| `apps/api/src/lib/orderDuplicate.ts` | **modify.** Copies `title`. | 2 |
| `apps/api/src/routes/public.ts` | **modify.** `title` in estimate payload; mounts `publicCustomer`; `PUBLIC_RATE_LIMIT`. | 2, 5 |
| `apps/api/src/lib/customerLink.ts` (+ `.test.ts`) | **new.** Mint-if-absent customer and order tokens, link URL, active-estimate count. | 4 |
| `apps/api/src/routes/customers.ts` | **modify.** `POST /:id/public-link` only (list route untouched). | 4 |
| `apps/api/src/lib/customerPortal.ts` (+ `.test.ts`) | **new.** Which orders a customer link shows and the sanitized item shape. | 5 |
| `apps/api/src/routes/publicCustomer.ts` (+ `.routes.test.ts`) | **new.** `GET /public/customer/:token`. | 5 |
| `apps/api/src/lib/email.ts` | **modify.** Title + multi-estimate line in the estimate email; `estimateEmailSubject`. | 6 |
| `apps/api/src/lib/pdf.ts` | **modify.** Optional title line in the meta block; `pdfMetaTitle`. | 6 |
| `apps/web/src/types/index.ts`, `hooks/useOrders.ts`, `hooks/useCustomers.ts` | **modify.** `title`; `OrderTab` (Orders tabs); `EstimateTab`, `OrderGroup`, `useOrderGroups`, `useOrderByNumber`, `useCustomerPublicLink`. | 7 |
| `apps/web/src/lib/orderPath.ts` (+ `.test.ts`) | **new.** `customerSlug`, `orderPath`, reserved first segments. | 7 |
| `apps/web/src/pages/orders/orderRouteId.ts` | **new.** `OrderRouteIdContext` + `useOrderRouteId` (no components, so pages import it without a cycle). | 8 |
| `apps/web/src/pages/orders/orderRoute.tsx` | **new.** `OrderByNumberRoute`, `LegacyOrderRedirect` (components only). | 8 |
| `OrderDetail.tsx`, `OrderPresentation.tsx`, `OrderLabels.tsx`, `ManufacturerCopy.tsx` | **modify.** Read the id via `useOrderRouteId`. | 8 |
| `apps/web/src/pages/orders/OrderRowActions.tsx` | **new.** Duplicate + Delete strip moved out of `OrderList`, shared with the Estimates groups. | 9 |
| `apps/web/src/pages/orders/OrderList.tsx` | **modify.** Becomes the confirmed-only Orders page (`/orders`). | 9 |
| `apps/web/src/pages/orders/OrderTitleCard.tsx` | **new.** Optional title input card. | 9 |
| `apps/web/src/pages/orders/OrderDetail.tsx`, `components/Sidebar.tsx` | **modify.** Title state, `orderPath` navigations; sidebar Estimates + Orders. | 9 |
| `apps/web/src/lib/orderStatus.ts` | **new.** `CONFIRMED_STATUSES`, `isConfirmedStatus`. | 10 |
| `apps/web/src/lib/estimateGroups.ts` (+ `.test.ts`) | **new.** Collapsed-group status summary. | 10 |
| `apps/web/src/pages/estimates/EstimatesPage.tsx`, `EstimateGroup.tsx` | **new.** Home page: customers as collapsible groups of estimates. | 10 |
| `apps/web/src/App.tsx` | **modify.** Staff routes (8), `/` + `/orders` (10), portal (11). | 8, 10, 11 |
| `apps/web/src/lib/portal.ts` (+ `.test.ts`) | **new.** Portal payload types, landing rule, section split. | 11 |
| `apps/web/src/pages/customer-view/CustomerPortal.tsx`, `PortalList.tsx` | **new.** `/c/:token/*`. | 11 |
| `apps/web/src/pages/customer-view/CustomerView.tsx` | **modify.** Optional `token`/`backTo` props; shows `title`. | 11 |
| `knowledge/history/engine_features.md`, `memory-bank/*` | **modify.** Documentation (rules 4, 5). | 12 |

---

### Task 0: Branch

- [ ] **Step 1: Create the branch**

```bash
git switch main && git pull --ff-only && git switch -c feat/customer-hub
```
Expected: `Switched to a new branch 'feat/customer-hub'`. If `feat/inbox-unread` is not merged into `main` yet, run `git switch feat/inbox-unread && git switch -c feat/customer-hub` instead.

---

### Task 1: Migration 47

**Files:**
- Create: `supabase/migrations/20261022000047_customer_hub.sql`

**Interfaces:**
- Produces: `orders.title text null` (≤120), `customers.public_token uuid unique null`, index `orders_customer_created_idx`.

- [ ] **Step 1: Write the migration**

```sql
-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Multiple estimates per customer
-- (knowledge/specs/2026-10-20-customer-hub-multi-estimate-design.md).
--
-- 1. orders.title — optional consultant label ("Option A – Roller blinds")
--    that tells two estimates for the same customer apart. NULL means
--    "not shown anywhere"; the Worker normalises '' to NULL.
-- 2. customers.public_token — capability token behind the one customer
--    link (/c/:token). Minted lazily by the Worker, never regenerated.
--    No anon policy: the Worker reads it with the service role.
-- 3. orders_customer_created_idx — serves the Estimates page, which
--    groups estimates by customer and orders customers by the creation
--    date of their newest estimate (read newest-created first).

alter table public.orders
  add column title text
  constraint orders_title_length check (title is null or char_length(title) <= 120);

alter table public.customers
  add column public_token uuid unique;

create index orders_customer_created_idx
  on public.orders (customer_id, created_at desc);
```

- [ ] **Step 2: Sanity-check the file**

Run: `grep -c "^alter table\|^create index" supabase/migrations/20261022000047_customer_hub.sql`
Expected: `3`. (The SQL is applied to the database in Task 12.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20261022000047_customer_hub.sql
git commit -m "feat(db): migration 47 — order title, customer link token, grouping index"
```

---

### Task 2: API — estimate title

**Files:**
- Create: `apps/api/src/lib/orderTitle.ts`, `apps/api/src/lib/orderTitle.test.ts`
- Modify: `apps/api/src/routes/orders.ts` (`orderSchema` ~line 289; `createOrderFromInput` insert ~line 1071; `PUT /:id` update ~line 1240)
- Modify: `apps/api/src/lib/orderDuplicate.ts` (`toDuplicateInput` ~line 85)
- Modify: `apps/api/src/routes/public.ts` (`GET /estimate/:token` payload ~line 352)
- Test: `apps/api/src/routes/orders.routes.test.ts`, `apps/api/src/lib/orderDuplicate.test.ts`, `apps/api/src/routes/public.routes.test.ts`

**Interfaces:**
- Produces: `ORDER_TITLE_MAX = 120`; `normalizeOrderTitle(v: string | null | undefined): string | null | undefined`; `titlePatch(v: string | null | undefined): { title?: string | null }`. Order rows and `GET /public/estimate/:token` carry `title: string | null`.

- [ ] **Step 1: Write the failing unit tests** — `apps/api/src/lib/orderTitle.test.ts`

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins the estimate-title rules: blank means "no title" (null, rendered
 * nowhere), whitespace is collapsed so a pasted line break cannot reach
 * an email subject, and an absent field on PUT leaves the stored title alone.
 */

import { describe, it, expect } from 'vitest';
import { normalizeOrderTitle, titlePatch, ORDER_TITLE_MAX } from './orderTitle';

describe('normalizeOrderTitle', () => {
  it('keeps undefined as undefined (field not sent)', () => {
    expect(normalizeOrderTitle(undefined)).toBeUndefined();
  });
  it('turns null, empty and whitespace-only into null', () => {
    expect(normalizeOrderTitle(null)).toBeNull();
    expect(normalizeOrderTitle('')).toBeNull();
    expect(normalizeOrderTitle('   \n ')).toBeNull();
  });
  it('trims and collapses inner whitespace', () => {
    expect(normalizeOrderTitle('  Option A \n – Roller  ')).toBe('Option A – Roller');
  });
  it('exposes the 120-char cap', () => {
    expect(ORDER_TITLE_MAX).toBe(120);
  });
});

describe('titlePatch', () => {
  it('is empty when the field was not sent', () => {
    expect(titlePatch(undefined)).toEqual({});
  });
  it('carries the normalised value otherwise', () => {
    expect(titlePatch(' Option B ')).toEqual({ title: 'Option B' });
    expect(titlePatch('')).toEqual({ title: null });
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run (in `apps/api`): `pnpm vitest run src/lib/orderTitle.test.ts`
Expected: FAIL — cannot resolve `./orderTitle`.

- [ ] **Step 3: Implement** — `apps/api/src/lib/orderTitle.ts`

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Estimate title rules (migration 47, `orders.title`).
 *
 * A title is an optional consultant label ("Option A – Roller blinds")
 * that tells two estimates for the same customer apart on the customer
 * page, the customer's link, the estimate email subject and the PDF.
 * NULL means "no title": every surface renders nothing rather than a
 * fallback, so normalising blank input to NULL here is what keeps an
 * empty box from printing an empty heading.
 *
 * Whitespace is collapsed (not just trimmed) because the title is placed
 * in an email subject, where a pasted newline would be a header-injection
 * shaped bug even though Resend rejects it.
 */

/** Matches the DB check `char_length(title) <= 120`. */
export const ORDER_TITLE_MAX = 120;

/**
 * Normalises a title from a request body.
 *
 * @returns `undefined` when the field was absent (leave the stored value
 *          alone), `null` when blank, otherwise the cleaned string.
 */
export function normalizeOrderTitle(v: string | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  const cleaned = (v ?? '').replace(/\s+/g, ' ').trim();
  return cleaned === '' ? null : cleaned;
}

/**
 * The `title` fragment for an UPDATE: `{}` when the client did not send
 * the field, so an older client that never heard of titles cannot wipe
 * one on save.
 */
export function titlePatch(v: string | null | undefined): { title?: string | null } {
  const t = normalizeOrderTitle(v);
  return t === undefined ? {} : { title: t };
}
```

- [ ] **Step 4: Run unit tests**

Run: `pnpm vitest run src/lib/orderTitle.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Write failing route tests** — append to `apps/api/src/routes/orders.routes.test.ts` (uses the file's existing `payload()`, `db`, `ENV`, `ordersApp`):

```ts
describe('POST /api/orders — title', () => {
  const post = (body: unknown) =>
    ordersApp.request('/', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }, ENV);

  it('stores a trimmed title', async () => {
    db.orderInsertResults = [{ data: { id: 't1' } }];
    const res = await post({ ...payload(), title: '  Option A  ' });
    expect(res.status).toBe(201);
    expect((db.insertPayloads['orders']?.[0] as Record<string, unknown>).title).toBe('Option A');
  });

  it('stores a blank title as null', async () => {
    db.orderInsertResults = [{ data: { id: 't2' } }];
    await post({ ...payload(), title: '' });
    expect((db.insertPayloads['orders']?.[0] as Record<string, unknown>).title).toBeNull();
  });

  it('stores null when no title is sent', async () => {
    db.orderInsertResults = [{ data: { id: 't3' } }];
    await post(payload());
    expect((db.insertPayloads['orders']?.[0] as Record<string, unknown>).title).toBeNull();
  });

  it('rejects a title over 120 characters', async () => {
    const res = await post({ ...payload(), title: 'x'.repeat(121) });
    expect(res.status).toBe(400);
  });

  it('still rejects client-supplied money next to a title', async () => {
    const res = await post({ ...payload(), title: 'A', total: 1 });
    expect(res.status).toBe(400);
  });
});
```

Append to `apps/api/src/lib/orderDuplicate.test.ts`:

```ts
describe('toDuplicateInput — title', () => {
  it('copies the title so the copy starts as the same option', () => {
    const out = toDuplicateInput({
      customer_id: 'c1', discount_type: 'fixed', discount_value: 0, title: 'Option A', line_items: [],
    }) as Record<string, unknown>;
    expect(out.title).toBe('Option A');
  });
  it('sends null when the source has no title', () => {
    const out = toDuplicateInput({
      customer_id: 'c1', discount_type: 'fixed', discount_value: 0, line_items: [],
    }) as Record<string, unknown>;
    expect(out.title).toBeNull();
  });
});
```
(If `toDuplicateInput` is not yet imported in that file, add `import { toDuplicateInput } from './orderDuplicate';`.)

Append to `apps/api/src/routes/public.routes.test.ts` inside `describe('GET /public/estimate/:token', …)`:

```ts
  it('serves the estimate title, or null when none is set', async () => {
    db.order = { ...sentOrder(), title: 'Option A' };
    let body = (await (await req(`/estimate/${TOKEN}`)).json()) as { data: Record<string, unknown> };
    expect(body.data.title).toBe('Option A');
    db.order = sentOrder();
    body = (await (await req(`/estimate/${TOKEN}`)).json()) as { data: Record<string, unknown> };
    expect(body.data.title).toBeNull();
  });
```

- [ ] **Step 6: Run and confirm failures**

Run: `pnpm vitest run src/routes/orders.routes.test.ts src/lib/orderDuplicate.test.ts src/routes/public.routes.test.ts -t "title"`
Expected: FAIL — `title` rejected by `.strict()` (400) / `undefined` in payloads.

- [ ] **Step 7: Implement**

`apps/api/src/routes/orders.ts`:
1. Import: `import { ORDER_TITLE_MAX, normalizeOrderTitle, titlePatch } from '../lib/orderTitle';`
2. In `orderSchema`, after `customer_id`, add:
   ```ts
   /** Optional estimate label (migration 47); blank → null, absent → untouched. */
   title: z.string().max(ORDER_TITLE_MAX * 4).nullable().optional()
     .refine((v) => (normalizeOrderTitle(v) ?? '').length <= ORDER_TITLE_MAX, {
       message: `Title must be ${ORDER_TITLE_MAX} characters or fewer`,
     }),
   ```
   (The loose `max` bounds the raw body; the refine measures the normalised value, which is what the DB stores.)
3. In `createOrderFromInput`'s `.insert({...})`, add `title: normalizeOrderTitle(input.title) ?? null,` after `customer_id`.
4. In `PUT /:id`'s `.update({...})`, add `...titlePatch(input.title),` after `customer_id: input.customer_id,`.

`apps/api/src/lib/orderDuplicate.ts`, in the object returned by `toDuplicateInput`, after `customer_id`:
```ts
    // The copy is usually the next option for the same customer; the
    // consultant renames it ("Option B") in the editor.
    title: (order.title as string | null | undefined) ?? null,
```

`apps/api/src/routes/public.ts`, in the `GET /estimate/:token` `data` object after `order_number`:
```ts
      // Consultant's label for this option; null renders nothing.
      title: order.title ?? null,
```

- [ ] **Step 8: Run the api suite**

Run (in `apps/api`): `pnpm test && pnpm check`
Expected: all PASS, tsc clean.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/lib/orderTitle.ts apps/api/src/lib/orderTitle.test.ts apps/api/src/routes/orders.ts apps/api/src/routes/orders.routes.test.ts apps/api/src/lib/orderDuplicate.ts apps/api/src/lib/orderDuplicate.test.ts apps/api/src/routes/public.ts apps/api/src/routes/public.routes.test.ts
git commit -m "feat(api): optional estimate title on orders, duplicates and the public estimate"
```

---

### Task 3: API — grouped estimates, confirmed filter, load by order number

**Files:**
- Create: `apps/api/src/lib/orderGroups.ts`, `apps/api/src/lib/orderGroups.test.ts`
- Modify: `apps/api/src/routes/orders.ts` (list route ~line 958–1004; new routes right after it, all before `app.get('/:id'` ~line 1123)
- Test: `apps/api/src/routes/orders.routes.test.ts`

**Interfaces:**
- Produces:
  - `groupOrdersByCustomer<T extends GroupableRow>(rows: T[]): OrderGroup<T>[]` where
    `GroupableRow = { customer_id: string; created_at: string; customer?: Partial<GroupCustomer> | null }`,
    `GroupCustomer = { id: string; first_name: string; last_name: string; email: string; phone: string }`,
    `OrderGroup<T> = { customer: GroupCustomer; newest_created_at: string; orders: T[] }`
  - `GET /api/orders/grouped?status=all|active|confirmed|expired&q=` → `{ data: OrderGroup<OrderRow>[] }` (rows carry `amount_paid`); 400 on another status.
  - `GET /api/orders?status=confirmed` → every confirmed stage.
  - `GET /api/orders/by-number/:orderNumber` → `{ data: Order }` (same shape as `GET /:id`) or 404/400.

- [ ] **Step 1: Write failing lib tests** — `apps/api/src/lib/orderGroups.test.ts`

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins the Estimates page grouping: one group per customer, customers
 * ordered by their NEWEST estimate's creation time (a new estimate puts
 * its customer on top; edits to old ones do not), estimates inside a
 * group newest-created first.
 */

import { describe, it, expect } from 'vitest';
import { groupOrdersByCustomer } from './orderGroups';

const row = (id: string, customer_id: string, created_at: string, first_name = customer_id) => ({
  id, customer_id, created_at,
  customer: { id: customer_id, first_name, last_name: '', email: '', phone: '' },
});

describe('groupOrdersByCustomer', () => {
  it('orders customers by their newest estimate, newest first', () => {
    const groups = groupOrdersByCustomer([
      row('o1', 'alice', '2026-10-01T10:00:00Z'),
      row('o2', 'bob', '2026-10-05T10:00:00Z'),
      row('o3', 'alice', '2026-10-03T10:00:00Z'),
    ]);
    expect(groups.map((g) => g.customer.id)).toEqual(['bob', 'alice']);
    expect(groups[1].newest_created_at).toBe('2026-10-03T10:00:00Z');
  });

  it('lists a customer\'s estimates newest-created first, regardless of input order', () => {
    const [alice] = groupOrdersByCustomer([
      row('old', 'alice', '2026-09-01T00:00:00Z'),
      row('new', 'alice', '2026-10-01T00:00:00Z'),
    ]);
    expect(alice.orders.map((o) => o.id)).toEqual(['new', 'old']);
  });

  it('fills a placeholder customer when the join is missing', () => {
    const [g] = groupOrdersByCustomer([{ id: 'x', customer_id: 'c9', created_at: '2026-10-01T00:00:00Z', customer: null }]);
    expect(g.customer).toEqual({ id: 'c9', first_name: '', last_name: '', email: '', phone: '' });
  });

  it('returns no groups for no rows', () => {
    expect(groupOrdersByCustomer([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run and confirm failure** — in `apps/api`: `pnpm vitest run src/lib/orderGroups.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** — `apps/api/src/lib/orderGroups.ts`

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Groups order rows by customer for the staff Estimates page
 * (`GET /api/orders/grouped`, spec 2026-10-20 rev. 2026-10-22).
 *
 * Customers are ordered by the creation time of their NEWEST estimate,
 * newest first — so creating an estimate always puts its customer on
 * top, while editing, sending or confirming an older one does not move
 * anyone. `created_at` (not `order_date`, which staff can back-date) is
 * the key. Inside a group, estimates are newest-created first.
 *
 * Pure: no I/O, no money. The input is sorted defensively, so callers
 * may pass rows in any order.
 */

/** The customer fields a group header shows. */
export interface GroupCustomer {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
}

/** The minimum a row needs to be grouped. */
export interface GroupableRow {
  customer_id: string;
  created_at: string;
  customer?: Partial<GroupCustomer> | null;
}

/** One customer and their estimates. */
export interface OrderGroup<T> {
  customer: GroupCustomer;
  /** `created_at` of the newest row in this group. */
  newest_created_at: string;
  orders: T[];
}

/** Groups rows by `customer_id`; see the module header for the ordering rules. */
export function groupOrdersByCustomer<T extends GroupableRow>(rows: T[]): OrderGroup<T>[] {
  const sorted = [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  const groups = new Map<string, OrderGroup<T>>();
  for (const row of sorted) {
    let group = groups.get(row.customer_id);
    if (!group) {
      const c = row.customer ?? {};
      group = {
        customer: {
          id: row.customer_id,
          first_name: c.first_name ?? '',
          last_name: c.last_name ?? '',
          email: c.email ?? '',
          phone: c.phone ?? '',
        },
        newest_created_at: row.created_at,
        orders: [],
      };
      groups.set(row.customer_id, group);
    }
    group.orders.push(row);
  }
  return [...groups.values()];
}
```

- [ ] **Step 4: Run lib tests** — PASS (4 tests).

- [ ] **Step 5: Let the route test fake record filter calls**

In `orders.routes.test.ts`: add `filters: Array<[string, string, unknown[]]>;` to `FakeDb`, `filters: []` to the `db` literal, and `db.filters = [];` to `beforeEach`. In `makeBuilder`'s `chain`, before `return builder;`:
```ts
      if (['eq', 'neq', 'in', 'is', 'gte', 'lt'].includes(name)) db.filters.push([state.table, name, args]);
```
Add `'neq'` to the chained-method list.

- [ ] **Step 6: Write failing route tests** (append)

```ts
describe('GET /api/orders/grouped', () => {
  const r = (id: string, customer_id: string, created_at: string, status = 'sent') => ({
    id, customer_id, created_at, status, total: 100, payments: [{ amount: 40 }],
    customer: { id: customer_id, first_name: customer_id, last_name: '', email: '', phone: '' },
  });

  it('groups by customer, newest estimate first, with amount_paid', async () => {
    db.responses['orders.select'] = [
      r('o1', 'alice', '2026-10-01T00:00:00Z'),
      r('o2', 'bob', '2026-10-05T00:00:00Z'),
      r('o3', 'alice', '2026-10-03T00:00:00Z'),
    ];
    const res = await ordersApp.request('/grouped?status=all', {}, ENV);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: Array<{ customer: { id: string }; orders: Array<{ id: string; amount_paid: number }> }> };
    expect(data.map((g) => g.customer.id)).toEqual(['bob', 'alice']);
    expect(data[1].orders.map((o) => o.id)).toEqual(['o3', 'o1']);
    expect(data[0].orders[0].amount_paid).toBe(40);
  });

  it('filters the confirmed tab to confirmed stages', async () => {
    db.responses['orders.select'] = [];
    await ordersApp.request('/grouped?status=confirmed', {}, ENV);
    expect(db.filters).toContainEqual(['orders', 'in', ['status', ['awaiting_payment', 'in_progress', 'ready', 'installed']]]);
  });

  it('400s an unknown tab', async () => {
    expect((await ordersApp.request('/grouped?status=ready', {}, ENV)).status).toBe(400);
  });

  it('is not swallowed by /:id', async () => {
    db.responses['orders.select'] = [];
    await ordersApp.request('/grouped', {}, ENV);
    expect(db.filters).not.toContainEqual(['orders', 'eq', ['id', 'grouped']]);
  });
});

describe('GET /api/orders?status=confirmed', () => {
  it('selects every confirmed stage', async () => {
    db.responses['orders.select'] = [];
    const res = await ordersApp.request('/?status=confirmed', {}, ENV);
    expect(res.status).toBe(200);
    expect(db.filters).toContainEqual(['orders', 'in', ['status', ['awaiting_payment', 'in_progress', 'ready', 'installed']]]);
  });
});

describe('GET /api/orders/by-number/:orderNumber', () => {
  it('loads the order by its number, not as an id', async () => {
    db.responses['orders.select'] = [{ id: 'o1', order_number: 'M2010-126', status: 'draft', expiry_date: '2099-01-01', payments: [{ amount: 10 }] }];
    const res = await ordersApp.request('/by-number/M2010-126', {}, ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data.id).toBe('o1');
    expect(body.data.amount_paid).toBe(10);
    expect(db.filters).toContainEqual(['orders', 'eq', ['order_number', 'M2010-126']]);
    expect(db.filters).not.toContainEqual(['orders', 'eq', ['id', 'by-number']]);
  });

  it('404s for an unknown number', async () => {
    db.responses['orders.select'] = [];
    expect((await ordersApp.request('/by-number/Z0101-126', {}, ENV)).status).toBe(404);
  });

  it('400s for a malformed number', async () => {
    expect((await ordersApp.request('/by-number/bad%20number!', {}, ENV)).status).toBe(400);
  });
});
```

- [ ] **Step 7: Run and confirm failure** — `pnpm vitest run src/routes/orders.routes.test.ts -t "grouped|confirmed|by-number"` → FAIL.

- [ ] **Step 8: Implement in `orders.ts`**

1. Import: `import { groupOrdersByCustomer } from '../lib/orderGroups';`
2. Add `'confirmed'` handling by extracting the list route's filter block into a shared helper placed just above the list route (replace the inline `status` and `q` blocks in `app.get('/')` with `query = await applyListFilters(sb, query, c.req.query('status') ?? '', c.req.query('q') ?? '');`):
```ts
/**
 * The `?status=` and `?q=` filters shared by the flat list (Orders page)
 * and the grouped list (Estimates page), so both match the same rows.
 *
 * status: `all`/empty = no filter; `active` = draft + sent; `confirmed` =
 * every confirmed stage (Orders page "All"); any `LIST_STATUSES` value =
 * that status. q: order number, or a customer first/last name (resolved
 * to ids first), sanitised for PostgREST `or()` (AI_GUIDELINES §2).
 *
 * `query` is a supabase-js filter builder; typed loosely because the
 * builder's generic type differs per select string.
 */
async function applyListFilters(
  sb: SupabaseClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: any,
  status: string,
  rawQ: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  if (status === 'active') query = query.in('status', ['draft', 'sent']);
  else if (status === 'confirmed') query = query.in('status', [...CONFIRMED]);
  else if (LIST_STATUSES.includes(status)) query = query.eq('status', status);

  const q = rawQ.replace(/[,().%*\\]/g, ' ').trim().slice(0, 100);
  if (q) {
    const { data: matches } = await sb
      .from('customers')
      .select('id')
      .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`)
      .limit(50);
    const ids = (matches ?? []).map((m) => m.id);
    query = ids.length
      ? query.or(`order_number.ilike.%${q}%,customer_id.in.(${ids.join(',')})`)
      : query.ilike('order_number', `%${q}%`);
  }
  return query;
}
```
   (Drop the eslint comments if the api has no lint step that needs them — it does not today; keep `any` explicit.) Update the list route's JSDoc to mention `status=confirmed`.
3. Directly after the list route add:
```ts
/** Tabs the grouped Estimates page offers. */
const GROUP_TABS = ['all', 'active', 'confirmed', 'expired'];

/**
 * Hard cap on rows read for grouping. Rows are read newest-created
 * first, so on a very large history the customers whose newest estimate
 * is oldest fall off — acceptable at this business's scale, and the
 * web pages 15 groups at a time over what is returned.
 */
const GROUP_ROW_CAP = 500;

/**
 * Estimates grouped by customer for the staff Estimates page (spec
 * 2026-10-20 rev. 2026-10-22). Customers come newest-estimate-created
 * first; each group's estimates newest-created first (`lib/orderGroups`).
 * Same filters as `GET /` via `applyListFilters`; rows carry the derived
 * `amount_paid` like the flat list. MUST stay registered before `/:id`
 * (AI_GUIDELINES rule 8).
 */
app.get('/grouped', async (c) => {
  const status = c.req.query('status') ?? 'all';
  if (!GROUP_TABS.includes(status)) return c.json({ error: 'Unknown tab' }, 400);
  const sb = createSupabaseAdmin(c.env);
  let query = sb
    .from('orders')
    .select('*, customer:customers(id, first_name, last_name, email, phone), payments(amount)')
    .order('created_at', { ascending: false })
    .limit(GROUP_ROW_CAP);
  query = await applyListFilters(sb, query, status, c.req.query('q') ?? '');

  const { data, error } = await query;
  if (error) return c.json({ error: error.message }, 500);
  const rows = ((data ?? []) as Record<string, any>[]).map((o) => ({
    ...o,
    amount_paid: sumPayments(o.payments),
  }));
  return c.json({ data: groupOrdersByCustomer(rows as Array<Record<string, any> & { customer_id: string; created_at: string }>) });
});

/** Order numbers look like `M2010-126`; anything else is refused before a query. */
const ORDER_NUMBER_RE = /^[A-Za-z0-9-]{1,32}$/;

/**
 * Returns one order by its human order number — the lookup behind the
 * staff URL `/<customer-slug>/<order-number>`. The number is unique (DB
 * index), so it is authoritative; the slug in the web URL is cosmetic.
 * MUST stay registered before `/:id`. Same payload as `GET /:id`,
 * including defensive expiry and amount_paid.
 */
app.get('/by-number/:orderNumber', async (c) => {
  const orderNumber = c.req.param('orderNumber');
  if (!ORDER_NUMBER_RE.test(orderNumber)) return c.json({ error: 'Invalid order number' }, 400);
  const sb = createSupabaseAdmin(c.env);
  const { data, error } = await sb
    .from('orders')
    .select(DETAIL_SELECT)
    .eq('order_number', orderNumber)
    .order('position', { referencedTable: 'line_items' })
    .order('paid_on', { referencedTable: 'payments' })
    .maybeSingle();
  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: 'Order not found' }, 404);
  data.status = await applyDefensiveExpiry(sb, data);
  data.amount_paid = sumPayments(data.payments);
  return c.json({ data });
});
```

- [ ] **Step 9: Run the api suite** — `pnpm test && pnpm check` → PASS, tsc clean (existing list tests must still pass unchanged — the helper preserves behaviour).

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/lib/orderGroups.ts apps/api/src/lib/orderGroups.test.ts apps/api/src/routes/orders.ts apps/api/src/routes/orders.routes.test.ts
git commit -m "feat(api): estimates grouped by customer, confirmed filter, load by order number"
```

---

### Task 4: API — customer link token

**Files:**
- Create: `apps/api/src/lib/customerLink.ts`, `apps/api/src/lib/customerLink.test.ts`
- Modify: `apps/api/src/routes/customers.ts` (new route after `GET /:id`)
- Test: `apps/api/src/routes/customers.routes.test.ts`

**Interfaces:**
- Produces:
  - `ensureCustomerToken(sb: SupabaseClient, customerId: string): Promise<string | null>` (null = no such customer)
  - `ensureOrderToken(sb: SupabaseClient, orderId: string, existing: string | null): Promise<string>`
  - `customerLinkUrl(appUrl: string, token: string): string` → `${appUrl}/c/${token}`
  - `countActiveEstimates(sb: SupabaseClient, customerId: string, today: string, excludeOrderId?: string): Promise<number>`
  - `POST /api/customers/:id/public-link` → `{ data: { public_token: string } }` (404 unknown)

- [ ] **Step 1: Write the failing lib tests** — `apps/api/src/lib/customerLink.test.ts`

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins the mint-if-absent rules for the customer link (and the per-order
 * token the portal hands out): an existing token is reused untouched, a
 * missing one is minted with an `is(public_token, null)` guard, and a lost
 * race reads back the winner instead of returning a token nobody stored.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ensureCustomerToken, ensureOrderToken, customerLinkUrl, countActiveEstimates } from './customerLink';

type Result = { data: unknown; error: null | { message: string }; count?: number };
let script: Record<string, Result[]>;
let log: Array<{ table: string; op: string; calls: Array<[string, unknown[]]> }>;

/** Thenable fake: each `<table>.<op>` pops the next scripted result. */
function fakeSb(): SupabaseClient {
  return {
    from(table: string) {
      const entry = { table, op: 'select', calls: [] as Array<[string, unknown[]]> };
      log.push(entry);
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'update', 'eq', 'neq', 'is', 'gte', 'in']) {
        b[m] = (...args: unknown[]) => {
          if (m === 'update') entry.op = 'update';
          entry.calls.push([m, args]);
          return b;
        };
      }
      const next = (): Result =>
        script[`${table}.${entry.op}`]?.shift() ?? { data: null, error: null, count: 0 };
      b.maybeSingle = async () => next();
      (b as { then: unknown }).then = (ok: (v: unknown) => unknown) => Promise.resolve(ok(next()));
      return b;
    },
  } as unknown as SupabaseClient;
}

beforeEach(() => {
  script = {};
  log = [];
});

describe('ensureCustomerToken', () => {
  it('reuses an existing token without writing', async () => {
    script['customers.select'] = [{ data: { id: 'c1', public_token: 'tok-1' }, error: null }];
    expect(await ensureCustomerToken(fakeSb(), 'c1')).toBe('tok-1');
    expect(log.some((e) => e.op === 'update')).toBe(false);
  });

  it('mints one under an is-null guard when absent', async () => {
    script['customers.select'] = [{ data: { id: 'c1', public_token: null }, error: null }];
    script['customers.update'] = [{ data: { public_token: 'minted' }, error: null }];
    expect(await ensureCustomerToken(fakeSb(), 'c1')).toBe('minted');
    const upd = log.find((e) => e.op === 'update')!;
    expect(upd.calls).toContainEqual(['is', ['public_token', null]]);
  });

  it('reads back the winner when the guarded update lost a race', async () => {
    script['customers.select'] = [
      { data: { id: 'c1', public_token: null }, error: null },
      { data: { public_token: 'winner' }, error: null },
    ];
    script['customers.update'] = [{ data: null, error: null }];
    expect(await ensureCustomerToken(fakeSb(), 'c1')).toBe('winner');
  });

  it('returns null for an unknown customer', async () => {
    script['customers.select'] = [{ data: null, error: null }];
    expect(await ensureCustomerToken(fakeSb(), 'nope')).toBeNull();
  });
});

describe('ensureOrderToken', () => {
  it('returns the existing token untouched', async () => {
    expect(await ensureOrderToken(fakeSb(), 'o1', 'have')).toBe('have');
    expect(log).toHaveLength(0);
  });
  it('mints when missing', async () => {
    script['orders.update'] = [{ data: { public_token: 'new-o' }, error: null }];
    expect(await ensureOrderToken(fakeSb(), 'o1', null)).toBe('new-o');
  });
});

describe('customerLinkUrl', () => {
  it('builds the /c/ link', () => {
    expect(customerLinkUrl('https://app.example', 't')).toBe('https://app.example/c/t');
  });
});

describe('countActiveEstimates', () => {
  it('counts sent, unexpired estimates, excluding one order when asked', async () => {
    script['orders.select'] = [{ data: null, error: null, count: 2 }];
    expect(await countActiveEstimates(fakeSb(), 'c1', '2026-10-22', 'o9')).toBe(2);
    const calls = log[0].calls;
    expect(calls).toContainEqual(['eq', ['status', 'sent']]);
    expect(calls).toContainEqual(['gte', ['expiry_date', '2026-10-22']]);
    expect(calls).toContainEqual(['neq', ['id', 'o9']]);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm vitest run src/lib/customerLink.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `apps/api/src/lib/customerLink.ts`

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Capability tokens behind the customer link (`/c/:token`, migration 47)
 * and the per-order tokens the link hands out.
 *
 * Both are minted lazily and never regenerated, so every link a customer
 * was ever emailed keeps working. Minting uses an `is(public_token, null)`
 * guard on the UPDATE: two concurrent mints produce one stored token, and
 * the loser reads the winner back rather than returning a token that was
 * never persisted (which would put a dead link in an email).
 *
 * Minting a token is NOT covered by the email-then-persist rule
 * (AI_GUIDELINES §2): it announces nothing and changes no status — the
 * `/pdf` download already mints order tokens the same way.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** The customer-facing link for a customer token. */
export function customerLinkUrl(appUrl: string, token: string): string {
  return `${appUrl}/c/${token}`;
}

/**
 * Returns the customer's link token, minting one if absent.
 *
 * @returns the token, or `null` when the customer does not exist.
 * @throws  on a database error, so callers never email a link that
 *          failed to persist.
 */
export async function ensureCustomerToken(
  sb: SupabaseClient,
  customerId: string
): Promise<string | null> {
  const { data: row, error } = await sb
    .from('customers')
    .select('id, public_token')
    .eq('id', customerId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return null;
  if (row.public_token) return row.public_token as string;

  const { data: won, error: upError } = await sb
    .from('customers')
    .update({ public_token: crypto.randomUUID() })
    .eq('id', customerId)
    .is('public_token', null)
    .select('public_token')
    .maybeSingle();
  if (upError) throw new Error(upError.message);
  if (won?.public_token) return won.public_token as string;

  const { data: again, error: reError } = await sb
    .from('customers')
    .select('public_token')
    .eq('id', customerId)
    .maybeSingle();
  if (reError) throw new Error(reError.message);
  return (again?.public_token as string | undefined) ?? null;
}

/**
 * Returns an order's own public token, minting one when `existing` is
 * null. Used by the customer link for a `sent` order that reached the
 * customer without an email (`/mark-sent` writes no token).
 */
export async function ensureOrderToken(
  sb: SupabaseClient,
  orderId: string,
  existing: string | null
): Promise<string> {
  if (existing) return existing;
  const { data: won, error } = await sb
    .from('orders')
    .update({ public_token: crypto.randomUUID() })
    .eq('id', orderId)
    .is('public_token', null)
    .select('public_token')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (won?.public_token) return won.public_token as string;
  const { data: again, error: reError } = await sb
    .from('orders')
    .select('public_token')
    .eq('id', orderId)
    .maybeSingle();
  if (reError || !again?.public_token) throw new Error('Could not create the order link.');
  return again.public_token as string;
}

/**
 * Counts a customer's ACTIVE estimates: `sent` and not past expiry (the
 * same rule as the Worker's defensive expiry). `excludeOrderId` lets
 * `/send` count "the others" before the order being sent flips to `sent`.
 */
export async function countActiveEstimates(
  sb: SupabaseClient,
  customerId: string,
  today: string,
  excludeOrderId?: string
): Promise<number> {
  let q = sb
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', customerId)
    .eq('status', 'sent')
    .gte('expiry_date', today);
  if (excludeOrderId) q = q.neq('id', excludeOrderId);
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return count ?? 0;
}
```

- [ ] **Step 4: Run lib tests**

Run: `pnpm vitest run src/lib/customerLink.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Write failing route tests** — in `customers.routes.test.ts`

Extend the fake: add `updatePayloads: Record<string, unknown[]>` to `FakeDb` and `db`; reset it in `beforeEach`; in `chain`, add
```ts
      if (name === 'update') (db.updatePayloads[state.table] ??= []).push(args[0]);
```
Then append:
```ts
describe('POST /api/customers/:id/public-link', () => {
  it('returns the existing token without writing', async () => {
    db.responses['customers.select'] = [{ id: 'c1', public_token: 'tok-1' }];
    const res = await customersApp.request('/c1/public-link', { method: 'POST' }, ENV);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { public_token: string } }).data.public_token).toBe('tok-1');
    expect(db.updatePayloads['customers']).toBeUndefined();
  });

  it('404s for an unknown customer', async () => {
    db.responses['customers.select'] = [];
    const res = await customersApp.request('/nope/public-link', { method: 'POST' }, ENV);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 6: Run and confirm failure**

Run: `pnpm vitest run src/routes/customers.routes.test.ts`
Expected: FAIL (route 404 for `/c1/public-link`).

- [ ] **Step 7: Implement in `customers.ts`**

The list route is NOT touched (Customers pages are out of scope). Add after `GET /:id`:
```ts
/**
 * Returns the customer's link token (`/c/:token`), minting it on first
 * use — backs "Copy customer link" on the Estimates page's customer groups. Idempotent: an
 * existing token is returned untouched, so links already shared keep
 * working. 404 for an unknown customer.
 */
app.post('/:id/public-link', async (c) => {
  const sb = createSupabaseAdmin(c.env);
  try {
    const token = await ensureCustomerToken(sb, c.req.param('id'));
    if (!token) return c.json({ error: 'Customer not found' }, 404);
    return c.json({ data: { public_token: token } });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Could not create the link' }, 500);
  }
});
```
Import: `import { ensureCustomerToken } from '../lib/customerLink';`

- [ ] **Step 8: Run the api suite**

Run: `pnpm test && pnpm check`
Expected: PASS, tsc clean.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/lib/customerLink.ts apps/api/src/lib/customerLink.test.ts apps/api/src/routes/customers.ts apps/api/src/routes/customers.routes.test.ts
git commit -m "feat(api): mint-if-absent customer link token"
```

---

### Task 5: API — `GET /public/customer/:token`

**Files:**
- Create: `apps/api/src/lib/customerPortal.ts`, `apps/api/src/lib/customerPortal.test.ts`
- Create: `apps/api/src/routes/publicCustomer.ts`, `apps/api/src/routes/publicCustomer.routes.test.ts`
- Modify: `apps/api/src/routes/public.ts` (limiter line ~38; mount after the maintenance middleware)
- Test: `apps/api/src/routes/public.routes.test.ts` (rate-limit test)

**Interfaces:**
- Consumes: `ensureOrderToken` (Task 4).
- Produces: `PORTAL_STATUSES`, `isPortalVisible(row, today)`, `toPortalItem(row, token): PortalItem`; `PUBLIC_RATE_LIMIT = 20`; response
  `{ data: { company: { company_name, logo_url, email, phone }, customer: { first_name }, items: PortalItem[] } }` where
  `PortalItem = { order_number: string; title: string | null; status: PortalStatus; order_date: string; expiry_date: string; total: number; balance: number; public_token: string }`.

- [ ] **Step 1: Write failing lib tests** — `apps/api/src/lib/customerPortal.test.ts`

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins what a customer link may show: live estimates and confirmed
 * orders only (never drafts, never lapsed estimates — even before the
 * cron flips them), with a server-computed balance and nothing else.
 */

import { describe, it, expect } from 'vitest';
import { isPortalVisible, toPortalItem } from './customerPortal';

const TODAY = '2026-10-22';
const row = (over: Record<string, unknown> = {}) => ({
  id: 'o1', order_number: 'M2010-126', title: null, status: 'sent',
  order_date: '2026-10-20', expiry_date: '2026-11-03', total: '113.00',
  public_token: 'tok', payments: [] as Array<{ amount: number | string }>, ...over,
});

describe('isPortalVisible', () => {
  it('shows a sent estimate up to and including its expiry date', () => {
    expect(isPortalVisible(row(), TODAY)).toBe(true);
    expect(isPortalVisible(row({ expiry_date: TODAY }), TODAY)).toBe(true);
  });
  it('hides a sent estimate past expiry', () => {
    expect(isPortalVisible(row({ expiry_date: '2026-10-21' }), TODAY)).toBe(false);
  });
  it('hides drafts and expired', () => {
    expect(isPortalVisible(row({ status: 'draft' }), TODAY)).toBe(false);
    expect(isPortalVisible(row({ status: 'expired' }), TODAY)).toBe(false);
  });
  it('shows every confirmed stage regardless of expiry', () => {
    for (const s of ['awaiting_payment', 'in_progress', 'ready', 'installed']) {
      expect(isPortalVisible(row({ status: s, expiry_date: '2020-01-01' }), TODAY)).toBe(true);
    }
  });
});

describe('toPortalItem', () => {
  it('computes the balance from the ledger and drops the id', () => {
    const item = toPortalItem(row({ status: 'awaiting_payment', payments: [{ amount: '50' }, { amount: 13.5 }] }), 'tok');
    expect(item.total).toBe(113);
    expect(item.balance).toBe(49.5);
    expect(item).not.toHaveProperty('id');
    expect(item).not.toHaveProperty('payments');
    expect(Object.keys(item).sort()).toEqual(
      ['balance', 'expiry_date', 'order_date', 'order_number', 'public_token', 'status', 'title', 'total']
    );
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm vitest run src/lib/customerPortal.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `apps/api/src/lib/customerPortal.ts`

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * What the customer link (`/c/:token`) is allowed to show, and the
 * sanitized shape it shows it in.
 *
 * Visible: `sent` estimates on or before their expiry date (checked here,
 * so a lapsed estimate disappears even before the nightly cron flips it),
 * and every confirmed stage. Never visible: drafts (nothing was sent) and
 * expired estimates. The item is built field by field — never a spread of
 * the row — because the route is unauthenticated; a new column must not
 * become public by accident. Money is server-computed (AI_GUIDELINES §1).
 */

/** Statuses the portal query asks for; expiry is filtered in code. */
export const PORTAL_STATUSES = ['sent', 'awaiting_payment', 'in_progress', 'ready', 'installed'] as const;

/** A status a portal item can carry. */
export type PortalStatus = (typeof PORTAL_STATUSES)[number];

/** The order columns the portal query selects. */
export interface PortalOrderRow {
  id: string;
  order_number: string;
  title: string | null;
  status: string;
  order_date: string;
  expiry_date: string;
  total: number | string;
  public_token: string | null;
  payments?: Array<{ amount: number | string }> | null;
}

/** One card on the customer link. */
export interface PortalItem {
  order_number: string;
  title: string | null;
  status: PortalStatus;
  order_date: string;
  expiry_date: string;
  total: number;
  /** total − Σ payments, to the cent. */
  balance: number;
  /** The order's own token — the detail view calls `/public/estimate/:token` with it. */
  public_token: string;
}

const CONFIRMED: readonly string[] = ['awaiting_payment', 'in_progress', 'ready', 'installed'];

/** True when the customer link may show this row today (`YYYY-MM-DD`). */
export function isPortalVisible(row: Pick<PortalOrderRow, 'status' | 'expiry_date'>, today: string): boolean {
  if (row.status === 'sent') return row.expiry_date >= today;
  return CONFIRMED.includes(row.status);
}

/** Builds the sanitized item; `token` is the (possibly just minted) order token. */
export function toPortalItem(row: PortalOrderRow, token: string): PortalItem {
  const total = Number(row.total);
  const paid = (row.payments ?? []).reduce((acc, p) => acc + Number(p.amount), 0);
  return {
    order_number: row.order_number,
    title: row.title ?? null,
    status: row.status as PortalStatus,
    order_date: row.order_date,
    expiry_date: row.expiry_date,
    total,
    balance: Math.round((total - paid) * 100) / 100,
    public_token: token,
  };
}
```

- [ ] **Step 4: Run lib tests** — `pnpm vitest run src/lib/customerPortal.test.ts` → PASS.

- [ ] **Step 5: Write failing route tests** — `apps/api/src/routes/publicCustomer.routes.test.ts`

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Route tests for `GET /public/customer/:token` against a scripted fake
 * Supabase. Exercised on the sub-app directly, so the rate limiter and
 * maintenance gate in `public.ts` are out of scope here (they are
 * covered by public.routes.test.ts).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const TOKEN = '11111111-1111-4111-8111-111111111111';
const db = {
  customer: null as Record<string, unknown> | null,
  orders: [] as Array<Record<string, unknown>>,
  orderUpdates: [] as Array<Record<string, unknown>>,
};

function makeBuilder(table: string) {
  let op = 'select';
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'in', 'order', 'update']) {
    b[m] = (...args: unknown[]) => {
      if (m === 'update') {
        op = 'update';
        db.orderUpdates.push(args[0] as Record<string, unknown>);
      }
      return b;
    };
  }
  const result = () => {
    if (table === 'customers') return { data: db.customer, error: null };
    if (table === 'company_settings') {
      return { data: { company_name: 'Blinds Nisa', logo_url: null, email: 'biz@example.com', phone: '555' }, error: null };
    }
    if (table === 'orders' && op === 'update') return { data: db.orderUpdates.at(-1), error: null };
    return { data: db.orders, error: null };
  };
  b.maybeSingle = async () => result();
  b.single = async () => result();
  (b as { then: unknown }).then = (ok: (v: unknown) => unknown) => Promise.resolve(ok(result()));
  return b;
}

vi.mock('../lib/supabase', () => ({
  createSupabaseAdmin: () => ({ from: (t: string) => makeBuilder(t) }),
}));

import publicCustomerApp from './publicCustomer';

const ENV = { SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'x', RESEND_API_KEY: 'x', APP_URL: 'http://localhost:5173', ENVIRONMENT: 'test' };
const order = (over: Record<string, unknown>) => ({
  id: 'o', order_number: 'N', title: null, status: 'sent', order_date: '2026-10-20',
  expiry_date: '2099-01-01', total: 100, public_token: 'ot', payments: [], ...over,
});

beforeEach(() => {
  db.customer = { id: 'c1', first_name: 'Jane', email: 'secret@example.com' };
  db.orders = [];
  db.orderUpdates = [];
});

describe('GET /public/customer/:token', () => {
  it('404s a malformed token', async () => {
    expect((await publicCustomerApp.request('/not-a-uuid', {}, ENV)).status).toBe(404);
  });

  it('404s an unknown token', async () => {
    db.customer = null;
    expect((await publicCustomerApp.request(`/${TOKEN}`, {}, ENV)).status).toBe(404);
  });

  it('lists live estimates and confirmed orders, hiding lapsed ones', async () => {
    db.orders = [
      order({ order_number: 'A', title: 'Option A' }),
      order({ order_number: 'B', expiry_date: '2020-01-01' }),
      order({ order_number: 'C', status: 'awaiting_payment', payments: [{ amount: 40 }] }),
    ];
    const res = await publicCustomerApp.request(`/${TOKEN}`, {}, ENV);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { items: Array<Record<string, unknown>>; customer: Record<string, unknown>; company: Record<string, unknown> } };
    expect(data.items.map((i) => i.order_number)).toEqual(['A', 'C']);
    expect(data.items[0].title).toBe('Option A');
    expect(data.items[1].balance).toBe(60);
    expect(data.customer).toEqual({ first_name: 'Jane' });
    expect(Object.keys(data.company).sort()).toEqual(['company_name', 'email', 'logo_url', 'phone']);
  });

  it('mints a token for a sent order that has none', async () => {
    db.orders = [order({ order_number: 'A', public_token: null })];
    const res = await publicCustomerApp.request(`/${TOKEN}`, {}, ENV);
    const { data } = (await res.json()) as { data: { items: Array<{ public_token: string }> } };
    expect(db.orderUpdates).toHaveLength(1);
    expect(data.items[0].public_token).toBe(db.orderUpdates[0].public_token);
  });
});
```

- [ ] **Step 6: Run and confirm failure** — `pnpm vitest run src/routes/publicCustomer.routes.test.ts` → FAIL (module not found).

- [ ] **Step 7: Implement** — `apps/api/src/routes/publicCustomer.ts`

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Public customer link — `GET /public/customer/:token` (spec 2026-10-20).
 *
 * Lists everything a customer may currently act on: live estimates and
 * confirmed orders (rules in `lib/customerPortal`). Each item carries the
 * order's own public token, so the web detail view reuses the existing
 * `/public/estimate/:token` routes for confirm, edit requests and
 * cancellation; this route grants nothing those per-estimate links did
 * not already grant the same customer.
 *
 * Mounted by `public.ts` under `/customer`, AFTER its rate limiter and
 * maintenance gate, so both apply here unchanged. Unknown and malformed
 * tokens get the same 404 wording as the estimate routes, so nothing
 * leaks about which tokens exist.
 */

import { Hono } from 'hono';
import { createSupabaseAdmin } from '../lib/supabase';
import { ensureOrderToken } from '../lib/customerLink';
import {
  PORTAL_STATUSES,
  isPortalVisible,
  toPortalItem,
  type PortalItem,
  type PortalOrderRow,
} from '../lib/customerPortal';
import type { Env } from '../index';

const app = new Hono<{ Bindings: Env }>();

const TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND = 'Estimate not found';

/** The customer's visible estimates and orders, newest first. */
app.get('/:token', async (c) => {
  const token = c.req.param('token');
  if (!TOKEN_RE.test(token)) return c.json({ error: NOT_FOUND }, 404);

  const sb = createSupabaseAdmin(c.env);
  const { data: customer } = await sb
    .from('customers')
    .select('id, first_name')
    .eq('public_token', token)
    .is('deleted_at', null)
    .maybeSingle();
  if (!customer) return c.json({ error: NOT_FOUND }, 404);

  const { data: rows, error } = await sb
    .from('orders')
    .select('id, order_number, title, status, order_date, expiry_date, total, public_token, payments(amount)')
    .eq('customer_id', customer.id)
    .in('status', [...PORTAL_STATUSES])
    .order('order_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) return c.json({ error: error.message }, 500);

  const today = new Date().toISOString().slice(0, 10);
  const items: PortalItem[] = [];
  try {
    for (const row of (rows ?? []) as PortalOrderRow[]) {
      if (!isPortalVisible(row, today)) continue;
      items.push(toPortalItem(row, await ensureOrderToken(sb, row.id, row.public_token)));
    }
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Could not load your estimates.' }, 500);
  }

  const { data: company } = await sb
    .from('company_settings')
    .select('company_name, logo_url, email, phone')
    .eq('id', 1)
    .single();

  return c.json({
    data: {
      company: {
        company_name: company?.company_name ?? '',
        logo_url: company?.logo_url ?? null,
        email: company?.email ?? '',
        phone: company?.phone ?? '',
      },
      customer: { first_name: (customer.first_name as string | null) ?? '' },
      items,
    },
  });
});

export default app;
```

- [ ] **Step 8: Mount it and raise the public budget** — in `apps/api/src/routes/public.ts`

Replace `app.use('*', rateLimit(5, 60_000));` with:
```ts
/**
 * Requests per IP per minute across every `/public/*` route. Raised from
 * 5 to 20 for the customer link (2026-10-22): browsing list → estimate →
 * list → estimate is already six requests. Tokens are random UUIDs, so
 * this is an abuse brake, not what keeps an estimate private.
 */
export const PUBLIC_RATE_LIMIT = 20;

app.use('*', rateLimit(PUBLIC_RATE_LIMIT, 60_000));
```
Immediately after the maintenance `app.use('*', …)` block, add:
```ts
// Customer link (`/public/customer/:token`) — after both gates above.
app.route('/customer', publicCustomerRoutes);
```
with `import publicCustomerRoutes from './publicCustomer';` at the top.

In `public.routes.test.ts`, change the rate-limit test to use the constant:
```ts
import publicApp, { PUBLIC_RATE_LIMIT } from './public';
// …
  it('returns 429 once the per-minute budget is spent from one IP', async () => {
    const ip = '203.0.113.7';
    const statuses: number[] = [];
    for (let i = 0; i <= PUBLIC_RATE_LIMIT; i++) {
      const res = await req(`/estimate/${TOKEN}`, 'GET', ip);
      statuses.push(res.status);
    }
    expect(statuses.slice(0, PUBLIC_RATE_LIMIT).every((s) => s === 200)).toBe(true);
    expect(statuses[PUBLIC_RATE_LIMIT]).toBe(429);
  });
```
(Keep whatever import name the file already uses for the default export; only add `PUBLIC_RATE_LIMIT`.) Update the file-header bullet "returns 429 after the budget is spent" if it mentions 5.

- [ ] **Step 9: Run the api suite** — `pnpm test && pnpm check` → PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/lib/customerPortal.ts apps/api/src/lib/customerPortal.test.ts apps/api/src/routes/publicCustomer.ts apps/api/src/routes/publicCustomer.routes.test.ts apps/api/src/routes/public.ts apps/api/src/routes/public.routes.test.ts
git commit -m "feat(api): public customer link listing live estimates and orders"
```

---

### Task 6: API — send-estimate uses the customer link, title and multi-estimate line

**Files:**
- Modify: `apps/api/src/lib/email.ts` (`EstimateEmailInputs` ~line 309, `buildEstimateEmailHtml` ~line 336)
- Modify: `apps/api/src/lib/pdf.ts` (`PdfDocumentData.order` ~line 53; meta block ~line 588)
- Modify: `apps/api/src/routes/orders.ts` (`toPdfData` ~line 1438; `POST /:id/send` ~line 1545)
- Test: `apps/api/src/lib/email.test.ts`, `apps/api/src/lib/pdf.test.ts`, `apps/api/src/routes/orders.routes.test.ts`

**Interfaces:**
- Consumes: `ensureCustomerToken`, `customerLinkUrl`, `countActiveEstimates` (Task 4).
- Produces: `EstimateEmailInputs.title?: string | null`, `EstimateEmailInputs.activeEstimateCount?: number`; `estimateEmailSubject(orderNumber: string, companyName: string, title: string | null | undefined): string`; `PdfDocumentData.order.title?: string | null`; `pdfMetaTitle(title: string | null | undefined): string | null`.

- [ ] **Step 1: Write failing email/pdf tests**

Append to `email.test.ts` (import `estimateEmailSubject` and `buildEstimateEmailHtml` alongside the file's existing imports; reuse an existing `CompanyBrand` fixture from that file if present, otherwise this one):
```ts
const BRAND = { name: 'Blinds Nisa', logoUrl: null, email: 'biz@example.com', phone: '' } as never;

describe('estimate email — title and choices', () => {
  const base = { company: BRAND, customerFirstName: 'Jane', viewUrl: 'https://x/c/t' };

  it('names the title in the intro, escaped', () => {
    const html = buildEstimateEmailHtml({ ...base, title: 'Option <A>' });
    expect(html).toContain('Option &lt;A&gt;');
  });
  it('prints no title markup when none is set', () => {
    expect(buildEstimateEmailHtml(base)).not.toContain('<strong>null');
  });
  it('adds the choice line only for more than one active estimate', () => {
    expect(buildEstimateEmailHtml({ ...base, activeEstimateCount: 1 })).not.toContain('estimates to choose from');
    expect(buildEstimateEmailHtml({ ...base, activeEstimateCount: 2 })).toContain('You have 2 estimates to choose from');
  });
});

describe('estimateEmailSubject', () => {
  it('omits the title when none is set', () => {
    expect(estimateEmailSubject('M2010-126', 'Blinds Nisa', null)).toBe('Your estimate M2010-126 from Blinds Nisa');
  });
  it('includes the title', () => {
    expect(estimateEmailSubject('M2010-126', 'Blinds Nisa', 'Option A')).toBe('Your estimate M2010-126 – Option A from Blinds Nisa');
  });
});
```
(Check `CompanyBrand`'s real field names in `email.ts` and build `BRAND` with them; drop the `as never` once it type-checks.)

Append to `pdf.test.ts` (add `pdfMetaTitle` to the existing `./pdf` import):
```ts
describe('pdfMetaTitle', () => {
  it('is null for no title', () => {
    expect(pdfMetaTitle(null)).toBeNull();
    expect(pdfMetaTitle('  ')).toBeNull();
  });
  it('drops characters Helvetica cannot encode', () => {
    expect(pdfMetaTitle('Option A 🎉 – Roller')).toBe('Option A – Roller');
  });
  it('truncates long titles with an ellipsis', () => {
    const t = pdfMetaTitle('x'.repeat(80))!;
    expect(t.length).toBe(48);
    expect(t.endsWith('…')).toBe(true);
  });
});
```

- [ ] **Step 2: Run and confirm failure** — `pnpm vitest run src/lib/email.test.ts src/lib/pdf.test.ts -t "title|Subject|pdfMetaTitle"` → FAIL.

- [ ] **Step 3: Implement email changes** — `email.ts`

Add to `EstimateEmailInputs`:
```ts
  /** The estimate's optional title (migration 47); null/absent prints nothing. */
  title?: string | null;
  /**
   * How many live estimates the customer holds counting this one. Above
   * one, the email says there is a choice to make — the link opens the
   * customer's list rather than a single estimate.
   */
  activeEstimateCount?: number;
```
In `buildEstimateEmailHtml`, replace the `introHtml(...)` line with:
```ts
    ${introHtml(`Hi ${name} &mdash; thank you for choosing ${company}. Your estimate${i.title ? ` <strong>${escapeHtml(i.title)}</strong>` : ''} is ready. Tap the button below to review it and, when you&#39;re happy, <strong>confirm it to go ahead with your order</strong>.`)}
    ${(i.activeEstimateCount ?? 1) > 1 ? introHtml(`You have ${i.activeEstimateCount} estimates to choose from &mdash; open each one and confirm the one that suits you.`) : ''}
```
Add below the function:
```ts
/**
 * Subject line for the estimate email. The title is appended after an
 * en dash when set; titles are whitespace-collapsed on write
 * (`lib/orderTitle`), so no newline can reach the header.
 */
export function estimateEmailSubject(
  orderNumber: string,
  companyName: string,
  title: string | null | undefined
): string {
  return `Your estimate ${orderNumber}${title ? ` – ${title}` : ''} from ${companyName}`;
}
```
Update the `buildEstimateEmailHtml` JSDoc: it now may name the title and the number of estimates to choose from (still no figures).

- [ ] **Step 4: Implement PDF changes** — `pdf.ts`

In `PdfDocumentData.order` add:
```ts
    /** Optional estimate title (migration 47), printed under the number. */
    title?: string | null;
```
Add an exported helper near `drawRight`:
```ts
/**
 * The title line for the meta block, made safe for the standard
 * Helvetica font (WinAnsi): characters it cannot encode (emoji, CJK) are
 * dropped rather than letting `drawText` throw and fail the whole PDF.
 * Truncated to 48 characters so it never runs into the company block.
 * `null` means print nothing.
 */
export function pdfMetaTitle(title: string | null | undefined): string | null {
  const safe = (title ?? '')
    .replace(/[^\x20-\x7E -ÿ–—‘’“”•…€]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!safe) return null;
  return safe.length > 48 ? `${safe.slice(0, 47)}…` : safe;
}
```
In the meta block, directly after `drawRight(cur.page, data.order.order_number, …); metaY -= 15;`:
```ts
  const metaTitle = pdfMetaTitle(data.order.title);
  if (metaTitle) {
    drawRight(cur.page, metaTitle, rightEdge, metaY, font, 9, MUTED);
    metaY -= 12;
  }
```

- [ ] **Step 5: Wire `/send`** — `orders.ts`

In `toPdfData`'s `order:` object add `title: order.title ?? null,`.
Import `estimateEmailSubject` from `../lib/email` and `ensureCustomerToken, customerLinkUrl, countActiveEstimates` from `../lib/customerLink`.
In `POST /:id/send`, replace `const viewUrl = \`${c.env.APP_URL}/customer/${publicToken}\`;` with:
```ts
  // The email and the PDF point at the customer's ONE link, which lists
  // every live estimate (spec 2026-10-20). The order keeps its own token
  // too — the link hands it to the detail view, and older emails use it.
  let customerToken: string | null;
  let activeEstimateCount: number;
  try {
    customerToken = await ensureCustomerToken(sb, order.customer_id);
    // Counted before this order flips to `sent`, so add it back.
    activeEstimateCount = (await countActiveEstimates(sb, order.customer_id, today, id)) + 1;
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Could not prepare the link' }, 500);
  }
  if (!customerToken) return c.json({ error: 'Customer not found' }, 404);
  const viewUrl = customerLinkUrl(c.env.APP_URL, customerToken);
```
Replace the `subject:` line with `subject: estimateEmailSubject(order.order_number, company.company_name || 'Blinds Nisa', order.title),` and add `title: order.title ?? null, activeEstimateCount,` to the `buildEstimateEmailHtml({...})` argument.
Update the route JSDoc: link is the customer link; order token still persisted.

- [ ] **Step 6: Write the route test** (append to `orders.routes.test.ts`; reuse the `withResendSpy`-style interception shown in the `mark-sent` block, capturing the request body):

```ts
describe('POST /api/orders/:id/send — customer link', () => {
  it('emails the customer link, titled subject, and the choice line', async () => {
    db.responses['orders.select'] = [{
      id: 'e9', status: 'draft', customer_id: 'c1', order_number: 'M2010-126', title: 'Option A',
      order_date: '2026-10-20', expiry_date: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
      subtotal: 100, discount_amount: 0, taxable_amount: 100, tax_amount: 13, total: 113,
      public_token: null, terms_snapshot: null, line_items: [], payments: [],
      customer: { first_name: 'Jane', last_name: 'B', email: 'jane@example.com', phone: '',
        shipping_address_line1: '', shipping_address_line2: '', shipping_city: '', shipping_province: '',
        shipping_postal_code: '', billing_same_as_shipping: true, billing_address_line1: '',
        billing_address_line2: '', billing_city: '', billing_province: '', billing_postal_code: '' },
    }];
    db.responses['company_settings.select'] = [{ company_name: 'Blinds Nisa', logo_url: null, email: 'x@y.z', phone: '', address: '', hst_number: '', terms_and_conditions: 'T&C' }];
    db.responses['customers.select'] = [{ id: 'c1', public_token: 'cust-tok' }];
    db.responses['orders.count'] = [1];

    let sent: Record<string, unknown> | null = null;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes('api.resend.com')) {
        sent = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ id: 'email_1' }), { status: 200 });
      }
      return realFetch(url as never, init as never);
    }) as typeof fetch;
    try {
      const res = await ordersApp.request('/e9/send', { method: 'POST' }, ENV);
      expect(res.status).toBe(200);
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(sent!.subject).toBe('Your estimate M2010-126 – Option A from Blinds Nisa');
    expect(String(sent!.html)).toContain('http://localhost:5173/c/cust-tok');
    expect(String(sent!.html)).toContain('You have 2 estimates to choose from');
  });
});
```
(If the Resend body uses different keys, read `sendEmail` in `email.ts` and assert on those.)

- [ ] **Step 7: Run the api suite** — `pnpm test && pnpm check` → PASS. The existing `/send` tests must still pass; if one fails only because `customers.select` is unscripted, script `[{ id: 'c1', public_token: 'tok' }]` in that test and set its order's `customer_id: 'c1'`.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/lib/email.ts apps/api/src/lib/email.test.ts apps/api/src/lib/pdf.ts apps/api/src/lib/pdf.test.ts apps/api/src/routes/orders.ts apps/api/src/routes/orders.routes.test.ts
git commit -m "feat(api): estimate email links the customer's list; title in subject, intro and PDF"
```

---

### Task 7: Web — types, hooks, order paths

**Files:**
- Modify: `apps/web/src/types/index.ts` (`Order` ~line 134)
- Modify: `apps/web/src/hooks/useOrders.ts` (`OrderInput` ~line 137; new hooks after `useOrder`)
- Modify: `apps/web/src/hooks/useCustomers.ts`
- Create: `apps/web/src/lib/orderPath.ts`, `apps/web/src/lib/orderPath.test.ts`

**Interfaces:**
- Produces:
  - `Order.title: string | null`; `OrderInput.title?: string | null`
  - `EstimateTab = 'all' | 'active' | 'confirmed' | 'expired'`; `OrderGroup = { customer: { id; first_name; last_name; email; phone }; newest_created_at: string; orders: Order[] }`
  - `useOrderGroups(tab: EstimateTab, term: string): UseQueryResult<OrderGroup[]>` (key `['orders','list','grouped',tab,q]`)
  - `useOrderByNumber(orderNumber: string | undefined): UseQueryResult<Order>` (seeds `['orders','detail',id]`)
  - `useCustomerPublicLink(): UseMutationResult<string, Error, string>` (customer id → token)
  - `type OrderSubPage = 'present' | 'labels' | 'manufacturer'`; `ORDER_SUB_PAGES`; `customerSlug(c)`; `orderPath(order, sub?)`; `customerLinkPath(token)`

- [ ] **Step 1: Write failing tests** — `apps/web/src/lib/orderPath.test.ts`

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins the staff order URL `/<customer-slug>/<order-number>[/<sub>]`:
 * the slug is readable but cosmetic, never carries an email or phone
 * number, and can never collide with an app route.
 */

import { describe, it, expect } from 'vitest';
import { customerSlug, orderPath, customerLinkPath } from './orderPath';

describe('customerSlug', () => {
  it('slugs first + last name', () => {
    expect(customerSlug({ first_name: 'Jane', last_name: 'Smith' })).toBe('jane-smith');
  });
  it('strips accents and punctuation', () => {
    expect(customerSlug({ first_name: 'Zoë', last_name: "O'Brien-Çelik" })).toBe('zoe-o-brien-celik');
  });
  it('falls back to "customer" with no name (never email/phone)', () => {
    expect(customerSlug({ first_name: '', last_name: '' })).toBe('customer');
    expect(customerSlug(null)).toBe('customer');
  });
  it('prefixes slugs that would collide with app routes', () => {
    expect(customerSlug({ first_name: 'Settings', last_name: '' })).toBe('customer-settings');
    expect(customerSlug({ first_name: 'C', last_name: '' })).toBe('customer-c');
  });
  it('caps the length at 60', () => {
    expect(customerSlug({ first_name: 'a'.repeat(100), last_name: '' }).length).toBe(60);
  });
});

describe('orderPath', () => {
  const order = { order_number: 'M2010-126', customer: { first_name: 'Jane', last_name: 'Smith' } };
  it('builds the detail path', () => {
    expect(orderPath(order)).toBe('/jane-smith/M2010-126');
  });
  it('appends a sub-page', () => {
    expect(orderPath(order, 'present')).toBe('/jane-smith/M2010-126/present');
  });
});

describe('customerLinkPath', () => {
  it('builds the portal path', () => {
    expect(customerLinkPath('t')).toBe('/c/t');
  });
});
```

- [ ] **Step 2: Run and confirm failure** — in `apps/web`: `pnpm vitest run src/lib/orderPath.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `apps/web/src/lib/orderPath.ts`

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Staff order URLs: `/<customer-slug>/<order-number>[/<sub-page>]`
 * (spec 2026-10-20).
 *
 * The ORDER NUMBER is authoritative — it is DB-unique and the page loads
 * by it (`GET /api/orders/by-number/:n`). The slug is cosmetic: built from
 * first + last name only (never email or phone, which would end up in
 * browser history and logs), and `OrderByNumberRoute` redirects to the
 * canonical slug when the URL's differs (rename, typo). Slugs that equal
 * a first path segment the app owns are prefixed with `customer-`, so a
 * customer called "Settings" can never shadow `/settings/...`.
 *
 * Callers that hold only an order id link to `/orders/:id`, which
 * redirects here (`LegacyOrderRedirect`).
 */

/** Read-only pages that hang off an order. */
export type OrderSubPage = 'present' | 'labels' | 'manufacturer';

/** Every valid sub-page, for route validation. */
export const ORDER_SUB_PAGES: readonly OrderSubPage[] = ['present', 'labels', 'manufacturer'];

/** First path segments the app routes itself; a slug may never equal one. */
const RESERVED = new Set([
  'login', 'customers', 'orders', 'estimates', 'calendar', 'appointments', 'appointment',
  'notifications', 'inbox', 'settings', 'customer', 'c',
]);

/** Name fields the slug is built from. */
export interface SlugName {
  first_name?: string | null;
  last_name?: string | null;
}

/** Readable, URL-safe, collision-free slug for a customer. */
export function customerSlug(c: SlugName | null | undefined): string {
  const raw = [c?.first_name ?? '', c?.last_name ?? ''].join(' ');
  const slug = raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  if (!slug) return 'customer';
  return RESERVED.has(slug) ? `customer-${slug}`.slice(0, 60) : slug;
}

/** The canonical staff path for an order (and optional sub-page). */
export function orderPath(
  order: { order_number: string; customer?: SlugName | null },
  sub?: OrderSubPage
): string {
  const base = `/${customerSlug(order.customer)}/${encodeURIComponent(order.order_number)}`;
  return sub ? `${base}/${sub}` : base;
}

/** The customer-facing link path for a customer token. */
export function customerLinkPath(token: string): string {
  return `/c/${token}`;
}
```

- [ ] **Step 4: Types and hooks**

`types/index.ts`: in `Order` after `order_number` add
```ts
  /** Optional consultant label (migration 47); null renders nothing. */
  title: string | null;
```
`hooks/useOrders.ts`: in `OrderInput` add `title?: string | null;` (documented). After `useOrder`, add:
```ts
/**
 * One order by its human number — the loader behind the staff URL
 * `/<customer-slug>/<order-number>`. Seeds the by-id detail cache so the
 * page underneath (which reads by id) does not fetch the same order twice.
 */
export function useOrderByNumber(orderNumber: string | undefined): UseQueryResult<Order> {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ['orders', 'by-number', orderNumber],
    queryFn: async () => {
      const order = (
        await apiFetch<Envelope<Order>>(`/api/orders/by-number/${encodeURIComponent(orderNumber!)}`)
      ).data;
      qc.setQueryData(['orders', 'detail', order.id], order);
      return order;
    },
    enabled: Boolean(orderNumber),
  });
}

/** Tabs on the Estimates page (`GET /api/orders/grouped?status=`). */
export type EstimateTab = 'all' | 'active' | 'confirmed' | 'expired';

/** One customer and their estimates, as `GET /api/orders/grouped` returns them. */
export interface OrderGroup {
  customer: { id: string; first_name: string; last_name: string; email: string; phone: string };
  /** Creation time of this customer's newest estimate in the result — the page's sort key. */
  newest_created_at: string;
  /** Newest-created first; rows carry `amount_paid`. */
  orders: Order[];
}

/**
 * Estimates grouped by customer for the Estimates page, customers ordered
 * by their newest estimate's creation date (server-side). Keyed under the
 * list prefix so every mutation that invalidates the order list (create,
 * duplicate, delete, status moves) refreshes the groups too.
 */
export function useOrderGroups(tab: EstimateTab, term: string): UseQueryResult<OrderGroup[]> {
  const q = useDebouncedValue(term.trim(), 300);
  return useQuery({
    queryKey: [...LIST_KEY, 'grouped', tab, q],
    queryFn: async () => {
      const params = new URLSearchParams({ status: tab });
      if (q) params.set('q', q);
      return (await apiFetch<Envelope<OrderGroup[]>>(`/api/orders/grouped?${params}`)).data;
    },
    placeholderData: keepPreviousData,
  });
}
```

(Add `useQueryClient` to the TanStack import if absent.)
`hooks/useCustomers.ts`, add:
```ts
/**
 * Returns the customer's link token, minting it on first use
 * (`POST /api/customers/:id/public-link`). The Estimates page's customer
 * groups copy `${origin}/c/${token}` to the clipboard with it.
 */
export function useCustomerPublicLink(): UseMutationResult<string, Error, string> {
  return useMutation({
    mutationFn: async (customerId: string) =>
      (
        await apiFetch<Envelope<{ public_token: string }>>(`/api/customers/${customerId}/public-link`, {
          method: 'POST',
        })
      ).data.public_token,
  });
}
```
(Match the file's existing `Envelope`/import names.)

- [ ] **Step 5: Verify** — in `apps/web`: `pnpm vitest run src/lib/orderPath.test.ts && pnpm check`
Expected: PASS. `pnpm check` may report every place that builds an `Order` literal without `title` (test fixtures) — add `title: null` to each.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/orderPath.ts apps/web/src/lib/orderPath.test.ts apps/web/src/types/index.ts apps/web/src/hooks/useOrders.ts apps/web/src/hooks/useCustomers.ts
git add -u apps/web/src
git commit -m "feat(web): order title type, grouped/by-number hooks, order paths"
```

---

### Task 8: Web — staff routing by customer slug and order number

**Files:**
- Create: `apps/web/src/pages/orders/orderRouteId.ts`, `apps/web/src/pages/orders/orderRoute.tsx`
- Modify: `apps/web/src/App.tsx` (order routes ~lines 98–115)
- Modify: `OrderDetail.tsx:472`, and the `useParams<{ id: string }>()` line in `OrderPresentation.tsx`, `OrderLabels.tsx`, `ManufacturerCopy.tsx`

**Interfaces:**
- Consumes: `useOrder`, `useOrderByNumber`, `orderPath`, `ORDER_SUB_PAGES`, `customerSlug` (Task 7).
- Produces: `OrderRouteIdContext`, `useOrderRouteId(): string | undefined` (in `orderRouteId.ts`); default `OrderByNumberRoute`, `LegacyOrderRedirect({ sub?: OrderSubPage })` (in `orderRoute.tsx`).

- [ ] **Step 1a: Create `orderRouteId.ts`**

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * How an order page learns which order it shows.
 *
 * `/<customer-slug>/<order-number>` has no uuid in the URL, so
 * `OrderByNumberRoute` resolves the number and supplies the uuid through
 * `OrderRouteIdContext`. Pages call `useOrderRouteId()`, which prefers the
 * context and falls back to a `:id` route param, so `/orders/new` (no
 * provider, no param → `undefined`) keeps its create behaviour.
 *
 * Kept free of components so the order pages can import it without an
 * import cycle through `orderRoute.tsx`.
 */

import { createContext, useContext } from 'react';
import { useParams } from 'react-router-dom';

/** The resolved order uuid; `undefined` outside a by-number route. */
export const OrderRouteIdContext = createContext<string | undefined>(undefined);

/** The current order's uuid: from the context, else the `:id` param. */
export function useOrderRouteId(): string | undefined {
  const fromContext = useContext(OrderRouteIdContext);
  const { id } = useParams<{ id: string }>();
  return fromContext ?? id;
}
```

- [ ] **Step 1b: Create `orderRoute.tsx`**

```tsx
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Routing glue for staff order URLs (spec 2026-10-20).
 *
 * `/<customer-slug>/<order-number>[/<sub>]` is resolved here: the order
 * is loaded BY NUMBER, a non-canonical slug is `replace`-redirected (the
 * slug is cosmetic), and the existing page renders inside an
 * `OrderRouteIdContext` provider (see `orderRouteId.ts`) so it keeps
 * working with the order's uuid exactly as before. `/orders/:id[...]` and
 * `/estimates/:id` are kept as redirects, so ids in notifications, the
 * calendar, the inbox and old bookmarks still land on the right order.
 */

import { Navigate, useLocation, useParams } from 'react-router-dom';
import EmptyState from '../../components/EmptyState';
import { ListSkeleton } from '../../components/Skeleton';
import { useOrder, useOrderByNumber } from '../../hooks/useOrders';
import { ORDER_SUB_PAGES, customerSlug, orderPath, type OrderSubPage } from '../../lib/orderPath';
import OrderDetail from './OrderDetail';
import OrderPresentation from './OrderPresentation';
import OrderLabels from './OrderLabels';
import ManufacturerCopy from './ManufacturerCopy';
import { OrderRouteIdContext } from './orderRouteId';

/** Not-found state shared by both resolvers. */
function OrderNotFound() {
  return <EmptyState title="Order not found" description="It may have been deleted, or the link is mistyped." />;
}

/** Resolves `/<customer-slug>/<order-number>[/<sub>]` and renders the page. */
export default function OrderByNumberRoute() {
  const { customerSlug: urlSlug = '', orderNumber = '', sub } = useParams();
  const location = useLocation();
  const { data: order, isLoading, error } = useOrderByNumber(orderNumber);

  if (sub !== undefined && !(ORDER_SUB_PAGES as readonly string[]).includes(sub)) return <OrderNotFound />;
  if (isLoading) return <ListSkeleton />;
  if (error || !order) return <OrderNotFound />;

  const page = sub as OrderSubPage | undefined;
  if (urlSlug !== customerSlug(order.customer)) {
    return <Navigate to={`${orderPath(order, page)}${location.search}`} replace />;
  }

  return (
    <OrderRouteIdContext.Provider value={order.id}>
      {page === 'present' ? (
        <OrderPresentation key={order.id} />
      ) : page === 'labels' ? (
        <OrderLabels key={order.id} />
      ) : page === 'manufacturer' ? (
        <ManufacturerCopy key={order.id} />
      ) : (
        <OrderDetail key={order.id} />
      )}
    </OrderRouteIdContext.Provider>
  );
}

/** `/orders/:id[/<sub>]` → canonical URL, keeping the query string. */
export function LegacyOrderRedirect({ sub }: { sub?: OrderSubPage }) {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const { data: order, error } = useOrder(id);
  if (error) return <OrderNotFound />;
  if (!order) return <ListSkeleton />;
  return <Navigate to={`${orderPath(order, sub)}${location.search}`} replace />;
}
```
(Check `EmptyState`'s and `ListSkeleton`'s real props/exports with `grep -n "export" apps/web/src/components/EmptyState.tsx apps/web/src/components/Skeleton.tsx` and adapt the two calls.)

- [ ] **Step 2: Switch the four pages to `useOrderRouteId`**

In each of `OrderDetail.tsx`, `OrderPresentation.tsx`, `OrderLabels.tsx`, `ManufacturerCopy.tsx`, replace
`const { id } = useParams<{ id: string }>();` with `const id = useOrderRouteId();`, add
`import { useOrderRouteId } from './orderRouteId';`, and remove `useParams` from the `react-router-dom` import if now unused.

- [ ] **Step 3: Routes** — `App.tsx`

Import `OrderByNumberRoute, { LegacyOrderRedirect } from './pages/orders/orderRoute'`. Replace the four `/orders/:id…` routes and `/estimates/:id` with:
```tsx
            {/* Ids (notifications, calendar, inbox, old links) redirect to the canonical URL */}
            <Route path="/orders/:id" element={guard(<Layout><LegacyOrderRedirect /></Layout>)} />
            <Route path="/orders/:id/manufacturer" element={guard(<Layout><LegacyOrderRedirect sub="manufacturer" /></Layout>)} />
            <Route path="/orders/:id/present" element={guard(<Layout><LegacyOrderRedirect sub="present" /></Layout>)} />
            <Route path="/orders/:id/labels" element={guard(<Layout><LegacyOrderRedirect sub="labels" /></Layout>)} />
            <Route path="/estimates/:id" element={guard(<Layout><LegacyOrderRedirect /></Layout>)} />
```
Keep `/orders/new`, `/estimates/new`. As the LAST routes inside `<Routes>` (React Router ranks static segments first, so placement is for readability):
```tsx
            {/* Staff order URL: /<customer-slug>/<order-number>[/<sub>] — lowest-ranked */}
            <Route path="/:customerSlug/:orderNumber" element={guard(<Layout><OrderByNumberRoute /></Layout>)} />
            <Route path="/:customerSlug/:orderNumber/:sub" element={guard(<Layout><OrderByNumberRoute /></Layout>)} />
```
Remove the now-unused direct imports of `OrderPresentation`, `OrderLabels`, `ManufacturerCopy` from `App.tsx` if nothing else uses them.

- [ ] **Step 4: Verify** — in `apps/web`: `pnpm check && pnpm test && pnpm lint` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/orders/orderRouteId.ts apps/web/src/pages/orders/orderRoute.tsx apps/web/src/App.tsx apps/web/src/pages/orders/OrderDetail.tsx apps/web/src/pages/orders/OrderPresentation.tsx apps/web/src/pages/orders/OrderLabels.tsx apps/web/src/pages/orders/ManufacturerCopy.tsx
git commit -m "feat(web): staff order URLs by customer slug and order number; id links redirect"
```

---

### Task 9: Web — Orders page (confirmed only), sidebar, editor title and links

**Files:**
- Create: `apps/web/src/pages/orders/OrderRowActions.tsx`
- Create: `apps/web/src/pages/orders/OrderTitleCard.tsx`
- Modify: `apps/web/src/pages/orders/OrderList.tsx` (becomes the Orders page)
- Modify: `apps/web/src/components/Sidebar.tsx` (`ITEMS` ~line 49)
- Modify: `apps/web/src/pages/orders/OrderDetail.tsx` (state ~line 525, hydrate ~line 693, `buildPayload` ~line 1205, `save` ~line 1227, present ~1314, duplicate ~1386, window.open ~2467/2475, render ~2400)

**Interfaces:**
- Consumes: `orderPath` (Task 7), `Order.title`.
- Produces: `OrderTab = 'confirmed' | 'awaiting_payment' | 'in_progress' | 'ready' | 'installed'` (replaces the old union in `hooks/useOrders.ts`); `OrderRowActions({ order, wrapperClass, buttonClass })` (Duplicate + Delete strip, reused by the Estimates page in Task 10); `OrderTitleCard({ value, onChange })`.

- [ ] **Step 1: Extract the row actions** — create `OrderRowActions.tsx`

Move `ROW_ACTION_CLASS`, `DuplicateButton`, `DeleteButton` and `RowActions` out of `OrderList.tsx` VERBATIM into the new file (with their JSDoc), then:
- rename `RowActions` → default export `OrderRowActions`;
- in `DuplicateButton`, change `navigate(\`/orders/${copy.id}\`)` to `navigate(orderPath(copy))`;
- bring the imports they use (`useNavigate`, `toast`, `useDuplicateOrder`, `useDeleteOrder`, `Order`, `orderPath`).
File header (SPDX + JSDoc): "Duplicate + Delete for one order row, shared by the Orders list and the Estimates page's customer groups. Moved out of `OrderList` (2026-10-22) so the two lists cannot drift; behaviour unchanged except Duplicate now opens the copy at its canonical URL." In `OrderList.tsx`, delete the moved code and `import OrderRowActions from './OrderRowActions';`, replacing each `<RowActions` with `<OrderRowActions`. This move is required by the task (the Estimates page needs the same actions), not a drive-by refactor.

- [ ] **Step 2: Turn `OrderList` into the Orders page**

In `hooks/useOrders.ts`, replace the `OrderTab` union (~line 35) with:
```ts
/** Status tabs on the Orders page — confirmed stages only; `confirmed` is its "All". */
export type OrderTab = 'confirmed' | 'awaiting_payment' | 'in_progress' | 'ready' | 'installed';
```
In `OrderList.tsx`:
1. `TABS` becomes:
```ts
/** Tab definitions in display order — confirmed stages only (Orders page). */
const TABS: { key: OrderTab; label: string }[] = [
  { key: 'confirmed', label: 'All' },
  { key: 'awaiting_payment', label: 'Awaiting Payment' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'ready', label: 'Ready' },
  { key: 'installed', label: 'Installed' },
];
```
2. In `SUMMARY`, replace the `draft` / "Drafts" tile with an `installed` / "Installed" tile (`accent: 'neutral'`, `d: 'M3 21h18 M5 21V7l7-4 7 4v14 M9 21v-6h6v6'`) — drafts no longer appear on this page.
3. `useState<OrderTab>('all')` → `useState<OrderTab>('confirmed')`; the tiles condition `tab === 'all'` → `tab === 'confirmed'`; in the empty state, `tab === 'all'` → `tab === 'confirmed'`, `'No orders yet'` stays, hint `'Create one below.'` → `'Orders appear here once a customer confirms an estimate.'`.
4. Header `<h1>`: keep "Orders". Delete the header "New Order" `<Link>` and the whole phones-only sticky "+ New Order" bar at the bottom (an order is born by confirming an estimate; new estimates start on the Estimates page). Change the root `pb-24 sm:pb-8` to `pb-8`.
5. Row navigation: both `navigate(\`/orders/${order.id}\`)` → `navigate(orderPath(order))` (import `orderPath`).
6. Rewrite the file header: "Orders page (`/orders`) — confirmed orders only (awaiting payment → installed), spec 2026-10-20 rev. 2026-10-22. Tabs: All (every confirmed stage, `status=confirmed`) / Awaiting Payment / In Progress / Ready / Installed; debounced search; 15 per page client-side; summary tiles on the unfiltered All view only (reasoning kept from the previous header). No create action — orders come from confirmed estimates." Keep the paging/tiles rationale paragraphs that still apply.

- [ ] **Step 3: Sidebar**

In `Sidebar.tsx` `ITEMS`: the first item becomes
```ts
  {
    to: '/',
    label: 'Estimates',
    end: true,
    d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M9 13h6 M9 17h6',
  },
  {
    // Confirmed work only — awaiting payment through installed.
    to: '/orders',
    label: 'Orders',
    d: 'M21 8l-9-5-9 5v8l9 5 9-5z M3 8l9 5 9-5 M12 13v8',
  },
```
Update the comment above `ITEMS` ("The six sections … Orders is the app's home screen") to name Estimates as home at `/` and Orders at `/orders`, and fix the section count.

- [ ] **Step 4: `OrderTitleCard.tsx`**

```tsx
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Optional estimate title in the order editor's Order Details section
 * (migration 47). Tells two estimates for one customer apart
 * ("Option A – Roller blinds") on the Estimates page, the customer's
 * link, the email subject and the PDF. Left blank it is sent as null and
 * shown nowhere — there is deliberately no auto-generated fallback.
 *
 * Controlled and presentational; `OrderDetail` owns the value and puts
 * it in the save payload. Capped at 120 characters to match the DB.
 */

import { Field, inputClass } from '../../components/ui';

export default function OrderTitleCard({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <section className="flex flex-col gap-3.5 rounded-xl border border-border-light bg-surface p-4 shadow-md">
      <Field label="Title (optional)" htmlFor="order-title" hint="Shown to the customer only when filled in.">
        <input
          id="order-title"
          type="text"
          maxLength={120}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. Option A – Roller blinds"
          className={`${inputClass} h-11`}
        />
      </Field>
    </section>
  );
}
```

- [ ] **Step 5: Wire title and links into `OrderDetail.tsx`**

1. Import `OrderTitleCard` and `orderPath`.
2. Beside `const [expiryDate, setExpiryDate] = …` add `const [title, setTitle] = useState('');`.
3. In the hydrate effect, after `setExpiryDate(savedExpiry);` add `setTitle(existing.title ?? '');`.
4. In `buildPayload`'s returned object add `title: title.trim() === '' ? null : title.trim(),`.
5. Inside the `<fieldset …>` immediately BEFORE `<OrderDatesCard`, add `<OrderTitleCard value={title} onChange={setTitle} />`.
6. Navigations:
   - `if (!id) navigate(\`/orders/${saved.id}?${ORDER_SECTION_PARAM}=${section}\`, { replace: true });` → `if (!id) navigate(\`${orderPath(saved)}?${ORDER_SECTION_PARAM}=${section}\`, { replace: true });`
   - `navigate(\`/orders/${savedId}/present\`);` → `navigate(existing ? orderPath(existing, 'present') : \`/orders/${savedId}/present\`);`
   - duplicate: `navigate(\`/orders/${copy.id}\`);` → `navigate(orderPath(copy));`
   - `window.open(\`/orders/${id}/manufacturer\`, …)` → `window.open(existing ? orderPath(existing, 'manufacturer') : \`/orders/${id}/manufacturer\`, …)`; same for `labels`.
   - The post-delete `navigate('/')` stays (Estimates home).
   (A stale slug after a customer change is fixed by the route's canonical redirect.)

- [ ] **Step 6: Verify** — in `apps/web`: `pnpm check && pnpm test && pnpm lint` → clean. Update any test that asserted the old tab set or the "New Order" button.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/hooks/useOrders.ts apps/web/src/pages/orders/OrderRowActions.tsx apps/web/src/pages/orders/OrderTitleCard.tsx apps/web/src/pages/orders/OrderList.tsx apps/web/src/pages/orders/OrderDetail.tsx apps/web/src/components/Sidebar.tsx
git add -u apps/web/src
git commit -m "feat(web): Orders page lists confirmed orders; estimate title field; order-path links"
```

---

### Task 10: Web — Estimates page grouped by customer

**Files:**
- Create: `apps/web/src/lib/estimateGroups.ts`, `apps/web/src/lib/estimateGroups.test.ts`
- Create: `apps/web/src/pages/estimates/EstimatesPage.tsx`, `apps/web/src/pages/estimates/EstimateGroup.tsx`
- Modify: `apps/web/src/App.tsx` (`/` and `/orders` routes ~lines 89–97)

**Interfaces:**
- Consumes: `useOrderGroups`, `EstimateTab`, `OrderGroup` (Task 7); `useCustomerPublicLink` (Task 7); `orderPath`, `customerLinkPath` (Task 7); `OrderRowActions` (Task 9); `StatusBadge`, `EmptyState`, `ListSkeleton`, `SidebarToggle`, `PAGE_CONTAINER`.
- Produces: `groupSummary(orders): string`; `EstimatesPage` (default, mounted at `/`); `EstimateGroup({ group, open, onToggle })`.

- [ ] **Step 1: Failing tests** — `apps/web/src/lib/estimateGroups.test.ts`

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins the one-line status summary on a collapsed customer group, e.g.
 * "2 active · 1 order". Counts only; no money.
 */

import { describe, it, expect } from 'vitest';
import { groupSummary } from './estimateGroups';

const o = (status: string) => ({ status }) as never;

describe('groupSummary', () => {
  it('counts active (draft + sent), confirmed and expired', () => {
    expect(groupSummary([o('draft'), o('sent'), o('awaiting_payment'), o('expired')])).toBe('2 active · 1 order · 1 expired');
  });
  it('pluralises orders and omits zero parts', () => {
    expect(groupSummary([o('ready'), o('installed')])).toBe('2 orders');
    expect(groupSummary([o('sent')])).toBe('1 active');
  });
  it('is empty for no estimates', () => {
    expect(groupSummary([])).toBe('');
  });
});
```

- [ ] **Step 2: Run** — in `apps/web`: `pnpm vitest run src/lib/estimateGroups.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `apps/web/src/lib/estimateGroups.ts`

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Text helpers for the Estimates page's customer groups.
 *
 * `groupSummary` is the status line a COLLAPSED group shows, so a
 * consultant can see "2 active · 1 order" without opening it. "Active"
 * matches the page's Active tab (draft + sent); "order" is any confirmed
 * stage; zero counts are omitted. Counts only — no money is derived here.
 */

import type { Order } from '../types';
import { isConfirmedStatus } from './orderStatus';

/** "2 active · 1 order · 1 expired" for a group's estimates. */
export function groupSummary(orders: Array<Pick<Order, 'status'>>): string {
  let active = 0;
  let confirmed = 0;
  let expired = 0;
  for (const o of orders) {
    if (o.status === 'draft' || o.status === 'sent') active += 1;
    else if (o.status === 'expired') expired += 1;
    else if (isConfirmedStatus(o.status)) confirmed += 1;
  }
  const parts: string[] = [];
  if (active) parts.push(`${active} active`);
  if (confirmed) parts.push(`${confirmed} ${confirmed === 1 ? 'order' : 'orders'}`);
  if (expired) parts.push(`${expired} expired`);
  return parts.join(' · ');
}
```
And create `apps/web/src/lib/orderStatus.ts` (tiny shared helper, used here and nowhere that duplicates it):
```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Which order statuses count as CONFIRMED — the point at which an
 * estimate has become an order (awaiting payment → installed). Mirrors
 * `CONFIRMED` in `apps/api/src/routes/orders.ts`; the Orders page and the
 * Estimates page's group summary both rely on it.
 */

import type { OrderStatus } from '../types';

/** Statuses at which an estimate has become an order. */
export const CONFIRMED_STATUSES: readonly OrderStatus[] = ['awaiting_payment', 'in_progress', 'ready', 'installed'];

/** True for a confirmed stage. */
export function isConfirmedStatus(s: OrderStatus): boolean {
  return CONFIRMED_STATUSES.includes(s);
}
```

- [ ] **Step 4: Run** — PASS (3 tests).

- [ ] **Step 5: `EstimateGroup.tsx`**

```tsx
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * One customer on the Estimates page: a collapsible row.
 *
 * Collapsed: name, estimate count, "Newest <date>" (the creation date
 * that orders the page) and the status summary. Open: the customer's
 * estimates newest-created first — every status, confirmed ones keep
 * their order badge — each opening `/<customer-slug>/<order-number>`,
 * with the shared Duplicate/Delete strip; then three group actions:
 * + New Estimate for this customer, Copy customer link (mints `/c/:token`
 * on first use), and Customer details (`/customers/:id`, unchanged page).
 *
 * Open/closed state is owned by `EstimatesPage` so a search can force
 * every matching group open.
 */

import { Link, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import StatusBadge from '../../components/StatusBadge';
import OrderRowActions from '../orders/OrderRowActions';
import { useCustomerPublicLink } from '../../hooks/useCustomers';
import type { OrderGroup } from '../../hooks/useOrders';
import { displayName } from '../../lib/customerName';
import { groupSummary } from '../../lib/estimateGroups';
import { customerLinkPath, orderPath } from '../../lib/orderPath';

const money = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });

/** "Oct 20" from an ISO date or timestamp. */
function shortDay(iso: string): string {
  return format(new Date(iso.length === 10 ? `${iso}T00:00:00` : iso), 'MMM d');
}

export default function EstimateGroup({
  group,
  open,
  onToggle,
}: {
  group: OrderGroup;
  open: boolean;
  onToggle: () => void;
}) {
  const navigate = useNavigate();
  const link = useCustomerPublicLink();
  const { customer, orders } = group;
  const panelId = `estimate-group-${customer.id}`;

  async function copyLink() {
    try {
      const token = await link.mutateAsync(customer.id);
      await navigator.clipboard.writeText(`${window.location.origin}${customerLinkPath(token)}`);
      toast.success('Customer link copied.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not copy the link.');
    }
  }

  return (
    <li className="rounded-xl border border-border-light bg-surface shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex min-h-11 w-full items-center gap-3 p-3.5 text-left"
      >
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"
          className={`shrink-0 text-text-muted transition-transform ${open ? 'rotate-90' : ''}`}
        >
          <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-bold text-text-primary">{displayName(customer)}</span>
          <span className="block text-xs text-text-muted">
            {orders.length} {orders.length === 1 ? 'estimate' : 'estimates'} · Newest {shortDay(group.newest_created_at)}
            {groupSummary(orders) && ` · ${groupSummary(orders)}`}
          </span>
        </span>
      </button>

      {open && (
        <div id={panelId} className="border-t border-border-light p-2.5">
          <ul className="flex flex-col gap-1.5">
            {orders.map((o) => (
              <li key={o.id} className="relative">
                <button
                  type="button"
                  onClick={() => navigate(orderPath(o))}
                  className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 pr-24 text-left hover:bg-surface-sunken"
                >
                  <span className="min-w-0">
                    {o.title && <span className="block truncate text-[14px] font-semibold text-text-primary">{o.title}</span>}
                    <span className="block text-[13px] text-text-secondary">
                      <span className="font-mono">{o.order_number}</span> · {shortDay(o.order_date)}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <StatusBadge status={o.status} />
                    <span className="font-mono text-[13px] font-semibold text-text-primary">{money.format(Number(o.total))}</span>
                  </span>
                </button>
                <OrderRowActions order={o} wrapperClass="right-1.5 top-1/2 -translate-y-1/2" buttonClass="h-11 w-11" />
              </li>
            ))}
          </ul>
          <div className="mt-2.5 flex flex-wrap gap-2 px-1">
            <Link
              to={`/orders/new?customer=${customer.id}`}
              className="flex h-11 items-center rounded-md bg-brand-600 px-3.5 text-[13px] font-semibold text-white hover:bg-brand-700"
            >
              + New Estimate
            </Link>
            <button
              type="button"
              onClick={copyLink}
              disabled={link.isPending}
              className="h-11 rounded-md border border-border-input bg-surface px-3.5 text-[13px] font-semibold text-text-primary hover:bg-surface-sunken disabled:opacity-40"
            >
              Copy customer link
            </button>
            <Link
              to={`/customers/${customer.id}`}
              className="flex h-11 items-center rounded-md border border-border-input bg-surface px-3.5 text-[13px] font-semibold text-text-primary hover:bg-surface-sunken"
            >
              Customer details
            </Link>
          </div>
        </div>
      )}
    </li>
  );
}
```
(`displayName` accepts the group's customer shape — `NameParts` in `lib/customerName.ts`. If `tsc` complains, pass `{ ...customer }`.)

- [ ] **Step 6: `EstimatesPage.tsx`**

```tsx
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Estimates page — the app's home screen at `/` (spec 2026-10-20 rev.
 * 2026-10-22). Every estimate grouped under its customer
 * (`GET /api/orders/grouped`), customers ordered by the creation date of
 * their newest estimate so a new estimate always puts its customer on
 * top. Each customer is a collapsible `EstimateGroup`, collapsed by
 * default; while a search term is present every returned group is shown
 * open, because the search is what the consultant is looking for.
 *
 * Tabs: All · Active (draft + sent) · Confirmed · Expired — a tab filters
 * the estimates inside groups, and customers with nothing in the tab
 * drop out. 15 groups per page, client-side over the fetched result,
 * pager bottom-right (the Orders page's pattern). Changing tab or search
 * returns to page 1; the page index is clamped so a shrinking result can
 * never strand the view on an empty page.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import SidebarToggle from '../../components/SidebarToggle';
import { PAGE_CONTAINER } from '../../components/PageHeader';
import { ListSkeleton } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import EstimateGroup from './EstimateGroup';
import { useOrderGroups, type EstimateTab } from '../../hooks/useOrders';

const TABS: { key: EstimateTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'expired', label: 'Expired' },
];

/** Customer groups per page. */
const PAGE_SIZE = 15;

export default function EstimatesPage() {
  const [tab, setTab] = useState<EstimateTab>('all');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const { data: groups, isLoading, error } = useOrderGroups(tab, term);
  const searching = term.trim() !== '';

  const totalPages = Math.max(1, Math.ceil((groups?.length ?? 0) / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageGroups = groups ? groups.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE) : [];

  function toggle(id: string) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="min-h-screen bg-surface-muted pb-8">
      <div className={`${PAGE_CONTAINER} py-4 md:py-6 lg:py-8`}>
        <div className="mb-5 flex items-center gap-2">
          <SidebarToggle />
          <h1 className="min-w-0 flex-1 truncate text-[22px] font-bold text-text-primary">Estimates</h1>
          <Link
            to="/orders/new"
            className="flex h-11 shrink-0 items-center gap-2 rounded-md bg-brand-600 px-4 text-[13px] font-semibold text-white shadow-sm hover:bg-brand-700"
          >
            + New Estimate
          </Link>
        </div>

        <div className="mb-3.5 flex max-w-xl overflow-x-auto rounded-md bg-surface-sunken p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setTab(t.key);
                setPage(1);
              }}
              className={`min-h-10 flex-1 whitespace-nowrap rounded-md px-3 py-2 text-[13px] transition-colors ${
                tab === t.key ? 'bg-surface font-bold text-text-primary shadow-sm' : 'font-medium text-text-muted hover:text-text-secondary'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <input
          type="search"
          placeholder="Search order # or customer…"
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setPage(1);
          }}
          className="mb-3.5 h-11 w-full max-w-md rounded-md border border-border-input bg-surface px-3 text-[15px] text-text-primary placeholder:text-text-muted"
        />

        {isLoading && <ListSkeleton />}
        {error && <p className="text-danger">{error.message}</p>}
        {groups && groups.length === 0 && (
          <EmptyState
            title={searching ? 'No estimates match your search' : 'No estimates here yet'}
            hint={searching ? 'Try an order number or customer name.' : 'Create one with + New Estimate.'}
          />
        )}

        {pageGroups.length > 0 && (
          <ul className="flex flex-col gap-2.5">
            {pageGroups.map((g) => (
              <EstimateGroup
                key={g.customer.id}
                group={g}
                open={searching || openIds.has(g.customer.id)}
                onToggle={() => toggle(g.customer.id)}
              />
            ))}
          </ul>
        )}

        {groups && totalPages > 1 && (
          <nav aria-label="Estimates pagination" className="mt-4 flex items-center justify-end gap-2">
            <span className="mr-1 text-[13px] text-text-secondary">
              {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, groups.length)} of {groups.length} customers
            </span>
            <button
              type="button"
              onClick={() => setPage(Math.max(1, currentPage - 1))}
              disabled={currentPage <= 1}
              aria-label="Previous page"
              className="h-11 rounded-md border border-border-input bg-surface px-3 text-[13px] font-medium text-text-secondary hover:bg-surface-muted disabled:opacity-40"
            >
              ‹ Previous
            </button>
            <span className="text-[13px] text-text-secondary" aria-current="page">
              Page {currentPage} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage >= totalPages}
              aria-label="Next page"
              className="h-11 rounded-md border border-border-input bg-surface px-3 text-[13px] font-medium text-text-secondary hover:bg-surface-muted disabled:opacity-40"
            >
              Next ›
            </button>
          </nav>
        )}
      </div>
    </div>
  );
}
```
(Check `EmptyState`'s prop names — `OrderList` passes `title` and `hint` — and `PAGE_CONTAINER`'s export from `components/PageHeader`.)

- [ ] **Step 7: Routes** — in `App.tsx`:
```tsx
            <Route path="/" element={guard(<Layout><EstimatesPage /></Layout>)} />
```
replaces `<Route path="/" … <OrderList /> …>`, and
```tsx
            <Route path="/orders" element={guard(<Layout><OrderList /></Layout>)} />
```
replaces `<Route path="/orders" element={<Navigate to="/" replace />} />`. Import `EstimatesPage`. `/estimates` keeps redirecting to `/`.

- [ ] **Step 8: Verify** — `pnpm check && pnpm test && pnpm lint` → clean.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/estimateGroups.ts apps/web/src/lib/estimateGroups.test.ts apps/web/src/lib/orderStatus.ts apps/web/src/pages/estimates/EstimatesPage.tsx apps/web/src/pages/estimates/EstimateGroup.tsx apps/web/src/App.tsx
git commit -m "feat(web): Estimates home page grouped by customer, newest estimate first"
```

---

### Task 11: Web — customer portal `/c/:token`

**Files:**
- Create: `apps/web/src/lib/portal.ts`, `apps/web/src/lib/portal.test.ts`
- Create: `apps/web/src/pages/customer-view/CustomerPortal.tsx`, `apps/web/src/pages/customer-view/PortalList.tsx`
- Modify: `apps/web/src/pages/customer-view/CustomerView.tsx` (signature line 482–483; `PublicEstimate` ~line 166; header ~line 805; order meta ~line 845)
- Modify: `apps/web/src/App.tsx` (public routes ~line 132)

**Interfaces:**
- Consumes: `GET /public/customer/:token` (Task 5), `statusLabel` (`lib/statusStyles`), `maintenanceMessage` (`lib/maintenance`).
- Produces: `PortalItem`, `PortalPayload`, `portalLanding(items)`, `splitPortalItems(items)`; `CustomerView({ token?, backTo? })`.

- [ ] **Step 1: Failing tests** — `apps/web/src/lib/portal.test.ts`

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins the customer link's landing rule — exactly one visible item opens
 * straight into it, otherwise the list — and the Estimates / Your orders split.
 */

import { describe, it, expect } from 'vitest';
import { portalLanding, splitPortalItems, type PortalItem } from './portal';

const item = (order_number: string, status: PortalItem['status']): PortalItem => ({
  order_number, status, title: null, order_date: '2026-10-20', expiry_date: '2026-11-03',
  total: 100, balance: 100, public_token: `tok-${order_number}`,
});

describe('portalLanding', () => {
  it('is empty with no items', () => {
    expect(portalLanding([])).toEqual({ kind: 'empty' });
  });
  it('opens the only item directly', () => {
    const a = item('A', 'sent');
    expect(portalLanding([a])).toEqual({ kind: 'single', item: a });
  });
  it('lists two or more, even one estimate plus one order', () => {
    expect(portalLanding([item('A', 'sent'), item('B', 'installed')])).toEqual({ kind: 'list' });
  });
});

describe('splitPortalItems', () => {
  it('separates live estimates from confirmed orders, keeping order', () => {
    const s = splitPortalItems([item('A', 'sent'), item('B', 'ready'), item('C', 'sent')]);
    expect(s.estimates.map((i) => i.order_number)).toEqual(['A', 'C']);
    expect(s.orders.map((i) => i.order_number)).toEqual(['B']);
  });
});
```

- [ ] **Step 2: Run** — FAIL (module missing).

- [ ] **Step 3: Implement** — `apps/web/src/lib/portal.ts`

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Types and pure rules for the customer link (`/c/:token`).
 *
 * The payload mirrors `GET /public/customer/:token` exactly; every figure
 * in it is server-computed and is displayed as-is. The Worker has already
 * hidden drafts and lapsed estimates, so these rules only decide layout:
 * one visible item opens straight into it (today's single-estimate
 * experience), otherwise a list with Estimates above Your orders.
 */

/** One card on the customer link (server shape). */
export interface PortalItem {
  order_number: string;
  title: string | null;
  status: 'sent' | 'awaiting_payment' | 'in_progress' | 'ready' | 'installed';
  order_date: string;
  expiry_date: string;
  total: number;
  balance: number;
  /** The order's own token, passed to `CustomerView`. */
  public_token: string;
}

/** `GET /public/customer/:token` → `data`. */
export interface PortalPayload {
  company: { company_name: string; logo_url: string | null; email: string; phone: string };
  customer: { first_name: string };
  items: PortalItem[];
}

/** What the link should render first. */
export type PortalLanding = { kind: 'empty' } | { kind: 'single'; item: PortalItem } | { kind: 'list' };

/** Exactly one item opens directly; none is empty; otherwise the list. */
export function portalLanding(items: PortalItem[]): PortalLanding {
  if (items.length === 0) return { kind: 'empty' };
  if (items.length === 1) return { kind: 'single', item: items[0] };
  return { kind: 'list' };
}

/** Splits into live estimates and confirmed orders, preserving server order. */
export function splitPortalItems(items: PortalItem[]): { estimates: PortalItem[]; orders: PortalItem[] } {
  return {
    estimates: items.filter((i) => i.status === 'sent'),
    orders: items.filter((i) => i.status !== 'sent'),
  };
}
```

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: `CustomerView` props and title**

Change the signature and token source:
```tsx
/**
 * … (keep the existing header doc) …
 *
 * Also rendered by `CustomerPortal` for one item of the customer link:
 * `token` then comes from the portal payload instead of the URL, and
 * `backTo` adds a "← All your estimates" link back to the list.
 */
export default function CustomerView({ token: tokenProp, backTo }: { token?: string; backTo?: string } = {}) {
  const params = useParams<{ token: string }>();
  const token = tokenProp ?? params.token;
```
Add `title: string | null;` to `PublicEstimate` (after `order_number`).
Immediately inside `<div className="mx-auto max-w-lg p-4">`, before the company header:
```tsx
        {backTo && (
          <Link to={backTo} className="mb-3 inline-flex min-h-11 items-center text-sm font-semibold text-brand-600">
            ← All your estimates
          </Link>
        )}
```
(add `Link` to the `react-router-dom` import). In the "Order meta" section, directly above the `<div className="flex justify-between gap-2">` row:
```tsx
          {estimate.title && <p className="mb-1 text-[15px] font-semibold text-text-primary">{estimate.title}</p>}
```

- [ ] **Step 6: `PortalList.tsx`**

```tsx
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * The customer link's list view: company header, a greeting, then
 * "Estimates" (live estimates) above "Your orders" (confirmed). Each card
 * shows the title only when one was entered, the number, dates and the
 * server total or balance, and a single "View" button — confirming
 * happens inside the estimate, after the customer has read it.
 *
 * Presentational: `CustomerPortal` owns loading and routing.
 */

import { Link } from 'react-router-dom';
import { statusLabel } from '../../lib/statusStyles';
import { splitPortalItems, type PortalItem, type PortalPayload } from '../../lib/portal';

const money = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });

/** One card; `kind` picks the estimate or order wording. */
function PortalCard({ item, token, kind }: { item: PortalItem; token: string; kind: 'estimate' | 'order' }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-2xl bg-surface-elevated p-4">
      <div className="min-w-0 text-sm">
        {item.title && <p className="truncate text-[15px] font-semibold text-text-primary">{item.title}</p>}
        <p className="text-text-primary">
          {kind === 'estimate' ? 'Estimate' : 'Order'} <span className="font-mono">{item.order_number}</span>
        </p>
        <p className="text-text-muted">
          {kind === 'estimate'
            ? `${item.order_date} · Valid until ${item.expiry_date}`
            : statusLabel(item.status)}
        </p>
        <p className="mt-1 font-mono text-text-primary">
          {kind === 'estimate' ? money.format(item.total) : `Balance ${money.format(item.balance)}`}
        </p>
      </div>
      <Link
        to={`/c/${token}/${encodeURIComponent(item.order_number)}`}
        className="flex h-11 shrink-0 items-center rounded-md bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700"
      >
        View
      </Link>
    </li>
  );
}

export default function PortalList({
  payload,
  token,
  notice,
}: {
  payload: PortalPayload;
  token: string;
  /** Shown above the list, e.g. when a deep link pointed at a lapsed estimate. */
  notice?: string;
}) {
  const { estimates, orders } = splitPortalItems(payload.items);
  const c = payload.company;
  return (
    <div className="min-h-screen bg-surface-muted pb-8">
      <div className="mx-auto max-w-lg p-4">
        <header className="mb-4 flex items-center gap-3 rounded-2xl bg-surface-elevated p-4">
          {c.logo_url && <img src={c.logo_url} alt="" className="h-12 w-12 rounded-lg object-contain" />}
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-text-primary">{c.company_name || 'Your estimates'}</h1>
            <p className="truncate text-xs text-text-muted">{[c.phone, c.email].filter(Boolean).join(' · ')}</p>
          </div>
        </header>
        {notice && <p className="mb-4 rounded-xl bg-warning-tint p-3 text-sm text-text-primary">{notice}</p>}
        {payload.customer.first_name && (
          <p className="mb-4 text-[15px] text-text-secondary">Hi {payload.customer.first_name}, here is everything we have prepared for you.</p>
        )}
        {estimates.length > 0 && (
          <section className="mb-6">
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-text-secondary">Estimates</h2>
            <ul className="flex flex-col gap-2">
              {estimates.map((i) => <PortalCard key={i.order_number} item={i} token={token} kind="estimate" />)}
            </ul>
          </section>
        )}
        {orders.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-text-secondary">Your orders</h2>
            <ul className="flex flex-col gap-2">
              {orders.map((i) => <PortalCard key={i.order_number} item={i} token={token} kind="order" />)}
            </ul>
          </section>
        )}
        {payload.items.length === 0 && (
          <p className="rounded-2xl bg-surface-elevated p-4 text-sm text-text-secondary">
            Nothing to review right now — contact us{c.phone ? ` at ${c.phone}` : ''}{c.email ? ` or ${c.email}` : ''}.
          </p>
        )}
      </div>
    </div>
  );
}
```
(If `bg-warning-tint` is not a theme token, use the token the app uses for amber notices — `grep -rn "warning" apps/web/src/index.css`.)

- [ ] **Step 7: `CustomerPortal.tsx`**

```tsx
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Customer link page — `/c/:token/*`, token-gated, NO authentication.
 *
 * Loads `GET /public/customer/:token` with a plain fetch (like
 * `CustomerView`) and decides what to show:
 *  - `/c/:token`: one visible item → that estimate directly; none → the
 *    "nothing to review" state; otherwise `PortalList`.
 *  - `/c/:token/<order-number>`: that item in `CustomerView` (its own
 *    order token) with "← All your estimates" when there is a list to
 *    return to. A number not in the payload (lapsed, drafted, foreign)
 *    shows the list with "That estimate is no longer available."
 *
 * One route element serves both paths so moving between them does not
 * remount; the list is re-fetched each time the customer returns to it,
 * so an estimate confirmed a moment ago shows under "Your orders".
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import CustomerView from './CustomerView';
import PortalList from './PortalList';
import { maintenanceMessage } from '../../lib/maintenance';
import { portalLanding, type PortalPayload } from '../../lib/portal';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787';

export default function CustomerPortal() {
  const { token = '', '*': rest = '' } = useParams();
  const orderNumber = rest ? decodeURIComponent(rest.split('/')[0]) : '';
  const [payload, setPayload] = useState<PortalPayload | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/public/customer/${token}`);
      const body = await res.json().catch(() => null);
      const closed = maintenanceMessage(res, body);
      if (closed) setFailure(closed);
      else if (!res.ok) setFailure((body as { error?: string } | null)?.error ?? 'We could not find your estimates.');
      else setPayload((body as { data: PortalPayload }).data);
    } catch {
      setFailure('Could not load your estimates. Please try again.');
    }
  }, [token]);

  // On the list (and on first load) fetch; on a detail page reuse what we have.
  useEffect(() => {
    if (!orderNumber || !payload) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- payload is read, not tracked
  }, [orderNumber, load]);

  if (failure) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-muted p-6">
        <p className="max-w-sm text-center text-[15px] text-text-secondary">{failure}</p>
      </div>
    );
  }
  if (!payload) {
    return <div className="flex min-h-screen items-center justify-center bg-surface-muted p-6 text-text-muted">Loading…</div>;
  }

  const landing = portalLanding(payload.items);

  if (orderNumber) {
    const item = payload.items.find((i) => i.order_number === orderNumber);
    if (!item) return <PortalList payload={payload} token={token} notice="That estimate is no longer available." />;
    return (
      <CustomerView
        key={item.public_token}
        token={item.public_token}
        backTo={landing.kind === 'list' ? `/c/${token}` : undefined}
      />
    );
  }
  if (landing.kind === 'single') return <CustomerView key={landing.item.public_token} token={landing.item.public_token} />;
  return <PortalList payload={payload} token={token} />;
}
```
(Drop the eslint comment if oxlint does not run that rule; the lint step will say.)

- [ ] **Step 8: Route** — in `App.tsx` beside `/customer/:token`:
```tsx
            <Route path="/c/:token/*" element={<CustomerPortal />} />
```
and import `CustomerPortal`.

- [ ] **Step 9: Verify** — `pnpm check && pnpm test && pnpm lint` in `apps/web` → clean.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/lib/portal.ts apps/web/src/lib/portal.test.ts apps/web/src/pages/customer-view/CustomerPortal.tsx apps/web/src/pages/customer-view/PortalList.tsx apps/web/src/pages/customer-view/CustomerView.tsx apps/web/src/App.tsx
git commit -m "feat(web): customer link lists live estimates and orders; one item opens directly"
```

---

### Task 12: Docs, full verification, migration

**Files:**
- Modify: `knowledge/history/engine_features.md`, `memory-bank/activeContext.md`, `memory-bank/progress.md`, `memory-bank/systemPatterns.md`, `memory-bank/productContext.md` (only if UX goals changed)

- [ ] **Step 1: History entry** — append a dated `2026-10-22` section to `knowledge/history/engine_features.md` covering: estimate titles; the Estimates home page grouped by customer (newest estimate's `created_at` first, collapsible groups, tabs, group actions); the confirmed-only Orders page at `/orders`; `/<slug>/<number>` URLs (number authoritative, slug cosmetic, `/orders/:id` redirects); the customer link `/c/:token` and its visibility rules; the estimate email now linking the customer's list; `PUBLIC_RATE_LIMIT` 5 → 20 and why; migration 47 must be applied before deploy. Link the spec and this plan.

- [ ] **Step 2: Memory bank** — overwrite (do not append) the "Where things stand" section of `activeContext.md` with the current state of this branch, and update `progress.md`'s current status/known issues. Add to `systemPatterns.md`: "Order URLs resolve by order number; slugs are cosmetic", "Customer link hands out per-order tokens; the estimate routes stay the only place that acts on an order", and "Estimates page groups by customer server-side (`lib/orderGroups`), ordered by newest estimate `created_at`".

- [ ] **Step 3: Full verification**

```bash
cd apps/api && pnpm check && pnpm test
```
```bash
cd apps/web && pnpm check && pnpm test && pnpm lint
```
Expected: 0 errors, 0 warnings, all tests passing. Record the counts for the PR. Confirm the out-of-scope files are untouched: `git diff --stat main -- apps/web/src/pages/customers apps/api/src/routes/customers.ts` shows only `customers.ts` (the public-link route).

- [ ] **Step 4: Commit docs**

```bash
git add knowledge/history/engine_features.md memory-bank/
git commit -m "docs: multiple estimates per customer — history and memory bank"
```

- [ ] **Step 5: Apply migration 47 — ASK THE USER FIRST**

This writes to the live Supabase project `lgbxxlwsdeuhdgzrjjen`. Do not run it without an explicit "yes" in chat. When approved, apply `supabase/migrations/20261022000047_customer_hub.sql` (Supabase MCP `apply_migration`, name `customer_hub`), then check:

```sql
select column_name from information_schema.columns
 where table_schema = 'public'
   and ((table_name = 'orders' and column_name = 'title')
     or (table_name = 'customers' and column_name = 'public_token'));
-- expect 2 rows

select indexname from pg_indexes where indexname = 'orders_customer_created_idx';
-- expect 1 row
```

- [ ] **Step 6: Browser check** (needs `apps/web/.env` with Supabase vars — see memory "Browser preview needs Supabase env"): start the dev server via the preview tools and confirm: `/` shows customers as collapsible groups with the newest-estimate customer first, and creating an estimate moves its customer to the top; `/orders` lists confirmed orders only; `/customers` is unchanged; opening an estimate lands on `/<slug>/<number>`; `/orders/<id>` redirects; with two sent estimates, `/c/<token>` lists both with "View" and confirming one moves it to "Your orders" while the other stays. If the env is missing, say so in the PR instead of claiming it was checked.
