# Progress

## What Works
- ✅ Full auth flow: login → JWT → JWKS-verified Worker calls; protected routes
- ✅ Settings module: company info + logo upload (Storage), all four catalogs, T&C autosave
- ✅ Customers: debounced search, create/edit, billing/shipping toggle, soft delete
- ✅ App shell: dashboard, bottom nav, layout, skeletons, empty states, Inter font
- ✅ Estimates: editor with live per-keystroke pricing, panel splitting, date pickers with
  expiry auto-follow, preset/custom items, discount before 13% HST, sticky action bar;
  list with Waiting/Confirmed/Expired tabs + search
- ✅ Server-authoritative pricing: Worker fetches catalog prices itself, snapshots them,
  recomputes all money; client prices rejected (strict schemas); order numbers unique with
  retry-on-conflict
- ✅ PDF generation (@react-pdf, §10 layout) + download endpoint
- ✅ Email flow code: branded templates, HTML-escaped, send-only-then-persist ordering,
  token reuse on resend (LIVE sending pending a real Resend API key)
- ✅ Public customer flow: token view, confirm-exactly-once, deposit screen, rate limiting
- ✅ Expiry automation: daily cron + defensive per-read checks
- ✅ Code-split bundle (public page ~8 kB chunk), security audit clean
- ✅ Tests: 25 web + 28 api unit/integration tests, 7 live DB constraint tests,
  `scripts/e2e.mjs` live E2E runner

## What's Left (needs the user / real accounts)
- [ ] Resend: create account, verify domain, put real `RESEND_API_KEY` (+ optional
  `RESEND_FROM`) in `.dev.vars` / wrangler secrets — then live-test the send flow
- [ ] Run `node scripts/e2e.mjs` locally (sandbox egress can't reach supabase.co)
- [ ] Physical device pass: iOS Safari + Android Chrome (date pickers, keyboards) —
  automated checks can't replace hands-on-device verification
- [ ] Deployment: wrangler deploy + Cloudflare Pages + lock CORS to the final domain
- [ ] Weekly backup routine (documented in README)

## Current Status
ALL 10 PHASES CODE-COMPLETE as of 2026-07-03. Verified: api tsc clean + 28 tests pass,
web tsc/build clean + 25 tests pass, Worker dry-run bundles (825 KiB gzip), live DB
constraints verified via Supabase MCP, security checklist pass.

## Known Issues
- Live email sending untested (placeholder Resend key) — code paths unit/integration tested
- Supabase advisor `rls_policy_always_true` warnings — ACCEPTED single-org design
- `IMPLEMENTATION.md` referenced by the plan is missing from the repo

## Project Decision Evolution
| Date | Decision | Context |
|------|----------|---------|
| 2026-06-27 | Tailwind CSS v4 | New `@tailwindcss/vite` plugin, no PostCSS config |
| 2026-06-27 | SPDX adapted | Headers say "Blinds Nisa" not "Aeon Engine" |
| 2026-06-27 | `jose` for JWT | Edge-compatible JWKS verification |
| 2026-07-03 | Wrangler 4 + Node 22 | Wrangler 4 requires Node 22; Node 20 EOL Apr 2026 |
| 2026-07-03 | Vitest on money math | Both web and api sides pinned by mirrored suites |
| 2026-07-03 | UNIQUE order_number + retry | Count-based generation can race |
| 2026-07-03 | No anon RLS on estimates | Public reads only via Worker; no enumeration |
| 2026-07-03 | Send-then-persist email flow | Failed send leaves the estimate untouched |
| 2026-07-03 | Server-only pricing | Client sends measurements + option ids; `.strict()` schemas |
| 2026-07-03 | createElement PDF (no JSX) | Keeps plan's `pdf.ts` filename, no build change |
| 2026-07-03 | React.lazy route splitting | Public page loads ~8 kB instead of the whole app |
