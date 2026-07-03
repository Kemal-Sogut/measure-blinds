# Engine Features / Feature History

## 2026-06-27 — Phase 1: Project Scaffolding
- Initialized pnpm monorepo with `apps/web` (React frontend) and `apps/api` (CF Worker backend)
- Configured Tailwind CSS v4 with custom design tokens (brand colors, spacing, shadows)
- Implemented core pricing logic in `apps/web/src/lib/pricing.ts`:
  - `applyWidthMinimum()` — widths < 100cm charged as 100cm
  - `applyHeightMinimum()` — tiered minimums: <100→100, 100-199→200, ≥200→actual
  - `calculateBlindUnitPrice()` — fabric + cassette + control costs
  - `calculateBlindLineTotal()` — unit price × quantity
- Implemented order number generator in `apps/web/src/lib/orderNumber.ts`
- Created typed API fetch wrapper in `apps/web/src/lib/api.ts`
- Set up Supabase admin client factory in `apps/api/src/lib/supabase.ts`
- Defined complete TypeScript types for all database models in `apps/web/src/types/index.ts`
- Created Worker entry point with CORS, security headers, health check, and cron handler

## 2026-07-03 — Stability Improvements (plan review)
- Added Vitest + 18 unit tests for money math: `pricing.test.ts` (14), `orderNumber.test.ts` (4)
- Plan: UNIQUE index on `estimates.order_number` + Worker retry-on-conflict (implements in Phase 7)
- Plan: send flow sets `status='sent'` only after Resend succeeds; `public_token` reused on resend
- Plan: Phase 10 weekly `pg_dump` backup routine (free tier has no PITR)
- Upgraded wrangler ^3.114.0 → ^4.20.0 in `apps/api/package.json`

## 2026-07-03 — Phase 2: Database Schema
- 10 migrations in `supabase/migrations/` (00 helpers + one per table, per AI Guidelines §14):
  profiles, company_settings (singleton id=1), fabrics, cassette_options, control_options,
  preset_line_items, customers (soft delete), estimates, line_items (snapshot pricing columns)
- Every table: RLS enabled, `authenticated_full_access` policy, `updated_at` trigger
- `estimates`: status check constraint, `expiry_date >= estimate_date` check, UNIQUE order_number,
  status/customer indexes; deliberate deviation — NO anon RLS policy (public reads only via Worker)
- Idempotent `supabase/seed.sql` with dev fabrics/cassettes/controls/presets

## 2026-07-03 — Phase 3: Authentication
- `apps/api/src/middleware/auth.ts` — `requireAuth`: Bearer extraction, jose JWKS verify
  (per-isolate JWKS cache), issuer check, attaches `{id, email}` to context, uniform 401s
- `apps/api/src/middleware/rateLimit.ts` — fixed-window in-memory limiter (5/min/IP default),
  Retry-After header, 10k-IP memory cap; per-isolate limitation documented and accepted
- `apps/web/src/lib/supabaseClient.ts` — anon-key client for auth only; fails loudly on missing env
- `apps/web/src/hooks/useAuth.ts` — Zustand store: initialize/signIn/signOut, onAuthStateChange sub
- `apps/web/src/pages/Login.tsx` — mobile-first form, 48px targets, redirect-back-after-login
- `apps/web/src/components/ProtectedRoute.tsx` — loading splash / redirect guard
- `apps/web/src/lib/api.ts` — rewritten: token fetched from supabase session per request
  (no manual storage), typed `ApiError` with HTTP status
- `apps/api/src/index.ts` — `requireAuth` on `/api/*` (health stays public), temp `/api/me` echo

## 2026-07-03 — Database Live (Supabase project lgbxxlwsdeuhdgzrjjen)
- Applied all 10 migrations + seed data via Supabase MCP; 9 tables, RLS on all, 15 catalog rows
- Advisor-driven hardening: `set_updated_at()` now pins `search_path = ''` (lint 0011);
  mirrored into `supabase/migrations/20260703000000_init_helpers.sql`
- Advisor `rls_policy_always_true` warnings on all tables ACCEPTED — intentional single-org
  design; policies grant only the `authenticated` role, Worker uses service role, anon gets nothing
- Live middleware test via `wrangler dev`: `/api/health` 200 public; `/api/me` 401 for both
  missing and invalid Bearer tokens; project JWKS confirmed serving ES256 key
- Created `apps/web/.env` (project URL + anon key) and `apps/api/.dev.vars` (service_role placeholder)

## 2026-07-03 — Phase 4: Settings Module
- `apps/api/src/routes/settings.ts` — company GET/PUT (Zod partial schema), logo upload
  (multipart, image/* ≤2MB, timestamped name in `company-assets` bucket, public URL saved),
  and a catalog route factory registering GET/POST/PUT/DELETE for fabrics, cassette-options,
  control-options, presets; uniform `{data}`/`{error}` envelopes; mounted at `/api/settings`
- Migration 10: `company-assets` storage bucket (public read, service-role-only writes) —
  applied live + mirrored to `supabase/migrations/20260703000010_company_assets_bucket.sql`
- `apps/web/src/lib/api.ts` — FormData bodies skip the manual Content-Type header
- `apps/web/src/hooks/useSettings.ts` — company query/mutation/logo-upload hooks + generic
  catalog hooks; updates are optimistic with rollback, create/delete invalidate (tiny lists)
- `apps/web/src/components/PageHeader.tsx` — shared back-button header (≥44px targets)
- `apps/web/src/components/CatalogEditor.tsx` — generic add/edit/toggle/delete list editor;
  the four catalog pages are ~20-line configs of it
- Pages: SettingsIndex (nav hub), CompanyInfo (form + logo upload), Fabrics, CassetteOptions,
  ControlOptions, PresetLineItems, TermsAndConditions (1.5s debounced autosave + status text)
- App.tsx settings routes now render real pages; hooks barrel re-exports settings hooks
- Verified: api `tsc` clean, web build clean, 18 tests pass, live `wrangler dev` smoke test
  (`/api/settings/fabrics` → 401 unauthenticated, health → 200)

## 2026-07-03 — Phase 5: Customers Module
- `apps/api/src/routes/customers.ts` — list with `?q=` ILIKE search (sanitized term: commas/
  parens/wildcards stripped before embedding in PostgREST `or()`), POST create, GET/:id,
  PUT/:id partial update, DELETE/:id soft delete via `deleted_at`; all reads exclude deleted;
  mounted at `/api/customers`
- `apps/web/src/types/index.ts` — Customer aligned with live schema (non-null text fields,
  `deleted_at` added, phantom `created_by` removed)
- `apps/web/src/hooks/useDebouncedValue.ts` — reusable 300ms debounce hook
- `apps/web/src/hooks/useCustomers.ts` — `useCustomerSearch` (debounced, keepPreviousData;
  shared with Phase 7 estimate editor), detail/create/update/delete hooks
- `apps/web/src/pages/customers/CustomerList.tsx` — search-as-you-type list, sticky
  "+ New Customer" bar
- `apps/web/src/pages/customers/CustomerForm.tsx` — one component for new/edit routes;
  billing block hidden by "Billing same as shipping" checkbox (values preserved when hidden);
  soft-delete button in edit mode; sticky save bar
- Verified: api `tsc` clean, web build clean, 18 tests pass, `/api/customers` → 401 smoke test

## 2026-07-03 — Phase 6: Main Page & App Shell
- `apps/web/index.html` — Inter font (Google Fonts, preconnect), proper title, theme-color,
  viewport-fit=cover for iOS safe areas
- `apps/web/src/components/BottomNav.tsx` — fixed bottom nav (Home/Customers/Estimates/
  Settings), active-tab highlighting via NavLink, safe-area padding, ≥44px targets
- `apps/web/src/components/Layout.tsx` — wraps SECTION-level pages only (Main, lists,
  settings hub); form/detail pages keep their own sticky action bars instead — nesting both
  would stack two fixed bottom bars
- `apps/web/src/components/Skeleton.tsx` — Skeleton + ListSkeleton loading placeholders
- `apps/web/src/components/EmptyState.tsx` — icon/title/hint empty state
- `apps/web/src/pages/Main.tsx` — company logo+name header (live from settings), gear icon
  → /settings, three big buttons (Customers, Estimates, Tools-disabled), sign-out
- CustomerList adopted ListSkeleton/EmptyState; its sticky "+ New Customer" bar moved to
  `bottom-14` to clear the nav
- NOTE: web bundle now warns >500 kB minified — consider route-level code-splitting in Phase 10

## 2026-07-03 — Phase 7: Estimates Core
- Types aligned with DB (`position`, `cassette_id`, no 'rejected', no created_by/notes/width_cm)
- `apps/web/src/lib/totals.ts` + tests — §6 order: subtotal → discount (clamped 0..subtotal,
  before tax) → taxable → 13% HST → total; every stage rounded to 2dp
- `apps/api/src/lib/{pricing,totals,orderNumber}.ts` — AUTHORITATIVE server twins of the web
  libs, each with mirrored unit tests (drift in either side fails a suite)
- `apps/api/src/routes/estimates.ts` — list (status tabs + sanitized search), POST with
  server-generated order number (23505 retry ×5) and 100% server-side pricing (catalog prices
  fetched by id, names+prices snapshotted; line-item schemas are `.strict()` so client-sent
  money fields are REJECTED), GET/:id with defensive expiry, PUT full-recalc (draft/sent only)
- `components/DatePicker.tsx` — react-day-picker in bottom-sheet (mobile) / dialog (sm+)
- `hooks/useEstimates.ts`, `EstimateList.tsx` (Waiting/Confirmed/Expired tabs),
  `LineItemEditor.tsx` (draft models + blind/flat cards, live per-keystroke pricing),
  `EstimateDetail.tsx` (customer bottom-sheet selector, expiry auto-follow until manual
  override, preset picker, discount toggle, sticky Save/Send/Confirm/PDF bar)
- `lib/api.ts` gained `apiDownload` (authenticated blob fetch for PDFs)

## 2026-07-03 — Phase 8: PDF & Email
- `apps/api/src/lib/pdf.ts` — @react-pdf/renderer layout per §10 via React.createElement
  (keeps planned filename, no JSX config change); logo pre-fetched to bytes (png/jpg only,
  fails soft); unit tests render real PDFs and assert %PDF magic + %%EOF
- `apps/api/src/lib/email.ts` — escapeHtml + Resend via plain fetch + branded templates;
  injection attempts pinned by tests
- Routes: GET /:id/pdf (streams), POST /:id/send (email FIRST, DB write only after Resend
  success; public_token reused on resend; chunked base64 for attachments), POST /:id/confirm
- wrangler.toml gained `nodejs_compat`; api package gained react + @react-pdf/renderer + vitest

## 2026-07-03 — Phase 9: Public Flow & Expiry
- `apps/api/src/routes/public.ts` — /public/estimate/:token (sanitized payload — no ids, no
  token echo) + /confirm (DB-level status='sent' guard → exactly-once, 409/410/400 taxonomy),
  UUID shape pre-check, rate limited 5/min/IP, internal notification email best-effort
- Cron scheduled handler implemented: daily UPDATE of stale sent → expired via ctx.waitUntil
- `pages/customer-view/CustomerView.tsx` — expired/confirmed/active/post-confirm states,
  PDF-mirroring layout, big confirm button; `components/PaymentSection.tsx` deposit stub

## 2026-07-03 — Phase 10 & Verification
- Route-level code splitting (React.lazy + Suspense): public CustomerView chunk is ~8 kB;
  500 kB chunk warning resolved
- Security audit: no secrets in dist bundle, CORS origin-checked (never *), CSP/XFO/nosniff
  global, Zod safeParse on every body-carrying route, zero raw SQL, public payload sanitized
- Route-level integration tests with scripted fake Supabase (28 api tests total): order-number
  retry, tamper rejection, send-failure leaves DB untouched, confirm-once + 409, defensive
  expiry, 429 rate limit
- Live DB constraint tests via Supabase MCP (all pass): unique order_number, expiry check,
  status check, updated_at trigger, line_items cascade, singleton guard, FK delete restriction
- `scripts/e2e.mjs` — full live E2E for the dev machine (creates + cleans temp user/customer/
  estimates); sandbox egress cannot reach supabase.co, so live E2E runs user-side
- Root README.md: setup, tests, env vars, weekly backup routine, deployment steps
- Final: api tsc clean + 28 tests, web tsc/build clean + 25 tests, Worker dry-run bundles
  (825 KiB gzip, within limits)
