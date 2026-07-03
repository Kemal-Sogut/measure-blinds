# System Patterns

## Architecture
- **Monorepo** — pnpm workspaces with `apps/web` (frontend) and `apps/api` (backend)
- **Frontend** — React SPA with client-side routing (React Router v6)
- **Backend** — Cloudflare Workers edge functions (Hono.js framework)
- **Database** — Supabase PostgreSQL with Row Level Security on all tables
- **Auth flow** — Supabase Auth (frontend) → JWT → Worker verifies via JWKS

## Key Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Worker as API gateway | Frontend never calls Supabase directly for data; all goes through Worker with service role key |
| RLS on every table | Defense-in-depth; even if Worker is bypassed somehow, RLS blocks unauthorized access |
| Client-side live pricing | Immediate feedback on keystroke; Worker recalculates authoritatively on save |
| Snapshot pricing on line items | Fabric/cassette/control prices stored on line item at creation time to prevent retroactive price changes |
| UUID public tokens | Unguessable tokens for customer view URLs — no auth required, token acts as capability |
| No anon RLS on estimates | Public estimate view served only by the Worker (service role, single-row lookup by token); anon key grants zero data access, preventing enumeration |
| DB-enforced order_number uniqueness | Count-based generation can race under concurrent saves; UNIQUE index + Worker retry makes duplicates impossible |
| Session-sourced API tokens | `apiFetch` asks supabase-js for the current token per request (auto-refresh); tokens are never manually persisted |
| Vitest on money math | `pricing.ts`/`orderNumber.ts` (and later `totals.ts`) are pure functions; tests lock the formulas against silent drift |

## Design Patterns
- **Single Responsibility per File** — Each `.ts`/`.tsx` file has one clearly defined purpose
- **Barrel exports** — Types and hooks use index.ts barrel files
- **Thin entry points** — `main.tsx` and `index.ts` delegate all logic to modules
- **Zod validation** — All Worker inputs validated with Zod schemas before any DB operation
- **Optimistic UI** — TanStack Query with optimistic updates for settings CRUD

## Component Relationships
```
App.tsx → Router → Pages → Components
                 → Hooks (useAuth, useQuery...)
                 → Lib (api.ts, pricing.ts, orderNumber.ts)
                 → Types (index.ts)
```

## Critical Implementation Paths
1. **Estimate creation:** Customer select → Add line items → Live pricing → Save → Server recalculates
2. **Send flow:** Save draft → Generate PDF → Send via Resend → Set status=sent
3. **Customer confirm:** Email link → Public view → Confirm button → Status=confirmed → Notification email
