# Calendar Feature — Implementation Plan

> Status: **PROPOSED — awaiting user approval before implementation** (per AI_GUIDELINES §11 Multi-Module Coordination and §13 AI Behavior Lock).
> Author context: reviewed `AI_GUIDELINES.md`, `knowledge/history/*`, and the full `memory-bank/`.

## 1. Goal

Add a **Calendar** feature to the Blinds Nisa Field Estimator:

- A dedicated **Calendar tab** — new item in the desktop left `Sidebar` and the mobile `BottomNav` (bottom tab bar).
- A **monthly** calendar view as the default (and only, for v1) layout.
- The consultant can **create an Installation proposal directly from the calendar** through a strict 3-step, one-selection-per-step wizard:
  1. **Day** — pre-selected from the calendar cell tapped (or chosen in step 1).
  2. **Time** — a single arrival start time (the 1-hour window is derived, matching the existing model).
  3. **Ready order** — pick exactly one order that is in `ready` status.
- The calendar renders **proposed (pending)** and **confirmed** installations as day markers/events, visually distinguished.

## 2. Fit with the existing system (what already exists)

The installation-scheduling domain already exists and this feature is a **new surface over it**, not a new domain. From the memory bank + code review:

- `orders` carry installation fields (migration `20260704000013_orders_installation.sql`):
  `install_date` (date), `install_time` (time), `install_status`
  (`unscheduled | proposed | confirmed | change_requested`), `install_confirmed_at`, `install_response_note`.
- API endpoint **`POST /api/orders/:id/install/propose`** (`apps/api/src/routes/orders.ts`) already:
  validates `{ install_date, install_time, message? }`, requires the order to be **`ready`**,
  emails the customer a 1-hour window `[install_time, install_time+1h]` on `install_date` via Resend,
  reuses/mints the order `public_token`, and sets `install_status='proposed'`.
- Frontend already has `useProposeInstallation()` (`hooks/useOrders.ts`), `InstallProposeInput`, the
  `Order` type with all install fields, a shared `DatePicker`, and an install-proposal bottom sheet inside `OrderDetail.tsx`.
- Customer confirms/requests another time on the token'd public page → `install_status` becomes `confirmed` / `change_requested`.

**Consequence:** the calendar's "create proposal" wizard reuses the existing `useProposeInstallation` /
`/install/propose` path. Step 3 ("Ready order") lines up exactly with the endpoint's `ready`-only rule.
No new lifecycle, no schema change to the write path.

## 3. Key design decisions (please confirm at approval)

1. **Reuse the emailing propose endpoint.** Creating a proposal from the calendar will, like today, **email the
   customer** the arrival window. This keeps one source of truth for proposals. → *If you instead want a "quiet"
   calendar-only schedule with no email, that is a different endpoint and is called out as an open question in §9.*
2. **Data source for calendar events.** Add one **read-only** endpoint `GET /api/orders/calendar?from=&to=` returning
   the lightweight fields the calendar needs (id, order_number, customer name, install_date, install_time,
   install_status, status) for orders whose `install_date` falls in the visible month range and whose
   `install_status` is `proposed`, `confirmed`, or `change_requested`. This avoids over-fetching full order bundles.
   *(Alternative: reuse `GET /api/orders` and filter client-side — rejected: it caps at 100 rows and returns full payloads.)*
3. **Monthly view only for v1.** Week/day views are out of scope unless requested.
4. **Scope for "Ready order" step.** Step 3 lists orders in `ready` status that do **not already** have a
   `confirmed` install (re-proposing an already-`proposed`/`change_requested` order is allowed — it re-sends).
5. **Timezone.** All dates handled as date-only ISO strings (existing convention — see `parseDateOnly`); no UTC shifting.
6. **Guidelines compliance.** New files each carry the SPDX header (§17), `///`-style JSDoc on exported units (§2/§16),
   Single-Responsibility per file (§14), files < 800 lines / functions < 100 lines (§10), and no scope creep into
   unrelated modules (§7). Memory bank + `knowledge/history/engine_features.md` updated on completion (§3, §15).

## 4. Architecture / file plan

### 4.1 Backend (`apps/api`)
- **`apps/api/src/routes/orders.ts`** — add one route `GET /calendar` (read-only, auth-guarded like siblings).
  Returns `{ data: CalendarEvent[] }`. Query by `install_date` between `from`/`to`, `install_status` in the three
  active states. Small Zod schema for the query params. *(Stays within the orders module — no new god-file.)*
  - Add/extend Vitest coverage in `apps/api/src/routes/orders.routes.test.ts` for the new query (date-range filter,
    status filter, empty range).

### 4.2 Shared types (`apps/web/src/types/index.ts`)
- Add `CalendarEvent` interface (subset of `Order` for the calendar) and reuse existing `InstallStatus`.

### 4.3 Frontend data hook (`apps/web/src/hooks/useCalendar.ts`) — **new file**
- `useCalendarEvents(fromIso, toIso)` → TanStack Query wrapper over `GET /api/orders/calendar`.
- `useReadyOrders()` → thin query over `GET /api/orders?status=ready` for the wizard's step 3 (or reuse `useOrderList('ready','')`).
- Barrel-export from `hooks/index.ts`.

### 4.4 Frontend page (`apps/web/src/pages/calendar/`) — **new folder**
- **`CalendarPage.tsx`** — top-level page: month state, header (month label + prev/next/Today), renders the grid,
  owns the "New proposal" wizard sheet. Keep it thin; delegate rendering to child components.
- **`MonthGrid.tsx`** — pure presentational monthly grid (weekday header + 6×7 day cells) built with `date-fns`
  (`startOfMonth`, `endOfMonth`, `eachDayOfInterval`, etc. — already a dependency). Renders event dots per day;
  tapping a day opens the wizard pre-set to that day.
- **`InstallProposalWizard.tsx`** — the strict 3-step, one-selection-per-step flow (Day → Time → Ready order),
  reusing `DatePicker` for step 1 and a time list for step 2; step 3 lists ready orders. Submits via
  `useProposeInstallation`. Mobile: bottom sheet; desktop: centered dialog (mirror `DatePicker`'s overlay pattern).
- **`EventChip.tsx`** (optional small component) — colored chip: pending vs confirmed vs change-requested.

### 4.5 Navigation (2 small, isolated edits)
- **`apps/web/src/components/Sidebar.tsx`** — add a `Calendar` item to `ITEMS` (icon path + `/calendar`).
- **`apps/web/src/components/BottomNav.tsx`** — add a `Calendar` tab to `TABS`.
  *(Note: BottomNav currently has 4 tabs; adding a 5th needs a quick visual check of spacing on a 380px viewport.)*

### 4.6 Routing (`apps/web/src/App.tsx`)
- Lazy-import `CalendarPage`; add `<Route path="/calendar" element={guard(<Layout><CalendarPage/></Layout>)} />`.

### 4.7 Docs / memory (required by guidelines)
- `knowledge/history/engine_features.md` — append a dated "Calendar feature" entry.
- `memory-bank/activeContext.md`, `progress.md`, `systemPatterns.md` — reflect the new surface + endpoint.

## 5. UX detail — the 3-step wizard

- **Step 1 — Day:** if launched from a day cell, that date is preselected; user can still change it. One selection → Next.
- **Step 2 — Time:** single start time (e.g. 30-min increments 08:00–18:00, matching field hours; final list TBD).
  Helper text shows the derived window "between {t} and {t+1h}". One selection → Next.
- **Step 3 — Ready order:** list of `ready` orders (order number + customer + total). One selection → **Propose**.
- On submit: call `useProposeInstallation({ id, input:{ install_date, install_time } })`; success toast
  "Installation proposed — customer emailed."; invalidate calendar + order queries; close sheet.
- Back navigation allowed between steps; each step enforces exactly one active selection before advancing.

## 6. Visual language on the calendar

- **Proposed / change_requested → pending look** (e.g. amber outline dot, matching `warning` token used on the dashboard).
- **Confirmed → solid brand look** (`brand-600`).
- Day cell shows up to N chips then "+k more"; tapping a chip → navigates to `/orders/:id`.
- Uses existing Tailwind `@theme` tokens only (no new colors), consistent with the 2026 redesign.

## 7. Testing & verification (guidelines §5, plus repo's Vitest habit)

- API: extend `orders.routes.test.ts` for `/calendar` (range + status filtering, empty result).
- Web: `tsc --noEmit` clean on both `web` and `api`; `pnpm --filter web build`.
- Manual smoke: create a `ready` order → open Calendar → tap a day → Day/Time/Ready order → Propose →
  event shows as pending → (customer confirms on public page) → event flips to confirmed.
- Note from `activeContext.md`: the Cowork sandbox can't reliably run the Windows `node_modules`/Vitest; final
  `tsc`/`vitest`/build must be run on the dev machine. Plan includes that as an explicit hand-off step.

## 8. Step-by-step execution order (for the implementing agent)

1. Backend: `GET /api/orders/calendar` + Zod + tests.
2. Types: `CalendarEvent`.
3. Hooks: `useCalendar.ts` (+ barrel).
4. Components: `MonthGrid.tsx`, `EventChip.tsx`, `InstallProposalWizard.tsx`.
5. Page: `CalendarPage.tsx`.
6. Nav: `Sidebar.tsx` + `BottomNav.tsx` items.
7. Route: `App.tsx`.
8. Docs: memory-bank + `engine_features.md`.
9. Verify: `tsc --noEmit` (web+api), build, targeted tests; hand-off note for dev-machine test run.

## 9. Confirmed decisions (locked with user, 2026-07-06)

1. **Email on proposal:** ✅ Reuse the existing emailing `/install/propose` — the customer is emailed the arrival
   window. No separate "quiet schedule" endpoint.
2. **Time options (step 2):** ✅ 30-minute increments, 08:00–18:00.
3. **Mobile nav:** ✅ Add Calendar as a **5th** bottom-nav tab (Home, Customers, Orders, Calendar, Settings).
   Tabs stay `flex-1` (~20% width each) — verify icon+label stack stays ≥44px on a 380px viewport.
4. **View scope:** ✅ Monthly view only for v1.

## 10. Validation findings folded in (from Sonnet fork review)

- **Register `GET /calendar` BEFORE `GET /:id`** in `orders.ts` (~after the `GET /` list handler, before line 480),
  or Hono routes `/calendar` into `/:id` with `id="calendar"` and it 404s. Add a route-ordering regression test.
- **Extend the API test fake builder** (`orders.routes.test.ts` `makeBuilder().chain()`) with `gte`/`lte` before
  adding date-range coverage — those methods aren't stubbed anywhere yet.
- **Follow `useOrders.ts`'s existing import style** for `useCalendar.ts` (direct import, not the `hooks/index.ts`
  barrel) to avoid an unrequested refactor.
- Mirror the list route's lightweight `.select()` shape; `install_date` has no index but scale makes that a non-issue.
