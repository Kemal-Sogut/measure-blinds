# Active Context

## Current Focus
ALL 10 PHASES CODE-COMPLETE (2026-07-03). The app is feature-complete per
implementation_plan.md with 53 automated tests + live DB constraint verification.

Remaining items are user/account-dependent (see progress.md): real Resend key + live
email test, `node scripts/e2e.mjs` on the dev machine, physical device pass, deployment
to Cloudflare (then lock CORS to the final Pages domain), weekly backup routine.

Next session: start from README.md + progress.md. If touching pricing/totals, remember
the web and api implementations are twins — change BOTH and their mirrored tests.

## Recent Changes (2026-07-03)
- Phase 1 verified: fresh install, `tsc --noEmit` clean on api, web builds, Worker bundles via `wrangler deploy --dry-run`
- Applied 5 approved stability improvements to `implementation_plan.md`:
  1. Vitest unit tests for money math (18 tests passing: `pricing.test.ts`, `orderNumber.test.ts`)
  2. UNIQUE index on `estimates.order_number` + Worker retry-on-conflict (planned for Phase 7)
  3. Send flow: `status='sent'` only after Resend succeeds; `public_token` reused on resend
  4. Phase 10 backup routine step (weekly pg_dump — free tier has no PITR)
  5. Wrangler aligned to ^4.20.0 (was ^3.114.0)
- Phase 2: wrote 10 migration files in `supabase/migrations/` + idempotent `supabase/seed.sql`
- Phase 3: implemented `middleware/auth.ts` (jose JWKS verify), `middleware/rateLimit.ts`,
  `lib/supabaseClient.ts`, `hooks/useAuth.ts` (Zustand), `pages/Login.tsx`,
  `components/ProtectedRoute.tsx`, rewrote `lib/api.ts` (token from supabase session, ApiError class),
  wired guards + Login into `App.tsx`, added `requireAuth` on `/api/*` + temp `/api/me` echo route

## Next Steps
- Run `pnpm install` on the dev machine (wrangler 4 + vitest were added to package.json)
- Apply migrations + seed to Supabase project via MCP connector
- Create the consultant auth user; disable public signups in Supabase Auth settings
- Set Worker secrets and `apps/web/.env`; verify login → `/api/me` flow end-to-end
- Proceed to Phase 4: Settings module

## Active Decisions
- No anon-role RLS policy for public estimate reads — the Worker (service role) is the only
  path to `/public/estimate/:token`, preventing estimate enumeration with the anon key
- Auth tokens are never manually persisted; `apiFetch` asks supabase-js for the current
  access token per request (auto-refresh included)
- In-memory rate limiter accepted with documented per-isolate limitation (fine at this scale)
- Tailwind CSS v4 with `@theme` tokens; SPDX headers say "Blinds Nisa"

## Important Learnings
- The plan references `IMPLEMENTATION.md` (§ sections) but that file is missing from the repo —
  `implementation_plan.md` is currently the source of truth for phase details
- Money columns are NUMERIC(10,2) everywhere; snapshot option prices onto line_items at save
- Supabase JWKS endpoint: `<url>/auth/v1/.well-known/jwks.json`; issuer `<url>/auth/v1`
