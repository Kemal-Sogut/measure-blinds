# Blinds Nisa Field Estimator

A field-facing web app for custom blinds consultants: create estimates with live
pricing at the customer's home, email branded PDFs, and let customers confirm
online. React + Vite frontend, Hono Cloudflare Worker API, Supabase (Postgres +
Auth + Storage), Resend for email.

## Prerequisites

Node.js ≥ 22 and pnpm 9 (pinned via `packageManager`; `npm i -g pnpm@9.15.9`).

## Development

```bash
pnpm install
pnpm dev          # web on :5173 + API on :8787
pnpm dev:web      # frontend only
pnpm dev:api      # Worker only
```

## Tests & checks

```bash
pnpm test                  # web unit tests (pricing, totals, order numbers)
pnpm --filter api test     # API tests (pricing/totals/orderNumber, PDF render,
                           # email escaping, route-level integration suites)
pnpm check                 # TypeScript across both workspaces
pnpm build                 # production frontend build
node scripts/e2e.mjs       # LIVE end-to-end test against your dev servers +
                           # real Supabase (creates and fully cleans up a
                           # throwaway user/customer/estimates). Run with
                           # `pnpm dev:api` up.
```

## Environment variables

### Worker — `apps/api/.dev.vars` locally, `wrangler secret put <NAME>` in production

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server-side only — never ships to the frontend) |
| `RESEND_API_KEY` | Resend API key for estimate + notification emails |
| `RESEND_FROM` | Optional verified sender, e.g. `Blinds Nisa <estimates@yourdomain.com>` |
| `APP_URL` | Frontend origin used in customer links, e.g. `https://app.pages.dev` |

### Frontend — `apps/web/.env` (all `VITE_*` values are public by design)

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Public anon key (auth only; RLS grants it no data) |
| `VITE_API_URL` | Worker URL, `http://localhost:8787` in dev |

## Database

Migrations live in `supabase/migrations/` (already applied to the live
project); `supabase/seed.sql` holds idempotent dev seed data. All money columns
are `NUMERIC(10,2)`; every table has RLS enabled with access granted only to
the `authenticated` role — the Worker (service role) is the sole data path,
and the public estimate view is served exclusively through
`/public/estimate/:token`.

## Backups (do this — free tier has no point-in-time recovery)

Once a week, export the database (any of):

- Supabase Dashboard → Database → Backups → download, or
- `supabase db dump --db-url "$DATABASE_URL" -f backup-$(date +%F).sql`

Keep the last 4–8 dumps somewhere off the laptop (cloud drive is fine). At
this data volume a dump takes seconds.

## Deployment (when ready)

1. `pnpm --filter api exec wrangler deploy` — set the four secrets first,
   confirm the cron trigger (`0 6 * * *`, daily auto-expiry) is active.
2. Deploy `apps/web/dist` to Cloudflare Pages; set the three `VITE_*` env vars
   in the Pages build settings.
3. Lock CORS: the Worker already restricts origins to localhost + `*.pages.dev`;
   tighten to your exact Pages domain in `apps/api/src/index.ts` when you have it.
4. In Supabase: keep public sign-ups disabled (Authentication → Sign In / Up).

## Project conventions

See `AI_GUIDELINES.md` (SRP per file, doc comments, SPDX headers) and the
`memory-bank/` + `knowledge/history/` folders for architecture decisions and
change history. The phase plan is `implementation_plan.md`.
