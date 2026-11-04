# AI Guidelines for Blinds Nisa Field Estimator

> [!IMPORTANT]
> All AI assistants contributing to this repository MUST read and adhere to these guidelines before proposing or executing any code changes.

## 0. What This Project Is

A field-facing web app for a custom blinds business (pnpm monorepo, TypeScript everywhere):

- `apps/web` — React 19 + Vite + Tailwind v4 SPA (Zustand, TanStack Query, React Router). Deployed as Cloudflare Worker `measure-blinds` (static assets, SPA fallback).
- `apps/api` — Hono on Cloudflare Workers (`blinds-nisa-api`). Talks to Supabase (project `lgbxxlwsdeuhdgzrjjen`) with the service-role key; verifies Supabase JWTs via `jose` + JWKS.
- `supabase/migrations` — SQL schema, RLS, seed. Applied to the live project.
- Email via Resend; PDFs via `pdf-lib` (NOT @react-pdf — its WASM is forbidden in workerd); e-Transfer webhook fed by a Gmail Apps Script (`scripts/etransfer-gmail.gs`).

## 1. Server-Authoritative Money (highest priority)

- **Rule**: Clients send measurements and catalog option IDs only. The Worker fetches catalog prices itself, snapshots names + prices onto line items, and computes all unit prices, line totals, and order totals (`apps/api/src/lib/pricing.ts`, `totals.ts`).
- **Rule**: Zod schemas for order payloads are `.strict()` — client-supplied money fields must be REJECTED (400), never silently stripped.
- **Rule**: `apps/web/src/lib/pricing.ts`/`totals.ts` are live-preview TWINS of the api versions. If you touch one side, change BOTH and BOTH mirrored test suites.

## 2. Security Invariants

- The Supabase service-role key exists ONLY in the Worker (`.dev.vars` locally, `wrangler secret put` in prod). It must never appear in `apps/web` or any committed file.
- The frontend Supabase client is for AUTH ONLY; all data access goes through the Worker API.
- No anon-role RLS policy on business tables — public estimate reads happen only via `/public/estimate/:token` (unguessable UUID capability token, rate-limited, sanitized payload).
- Every user-supplied string interpolated into email HTML passes through `escapeHtml`. Every search term embedded in a PostgREST `or()` filter passes through the sanitizer that strips `,().%*\`.
- `/api/*` requires a verified JWT (`middleware/auth.ts`); `/webhooks/etransfer` requires the shared bearer secret; `/public/*` is rate-limited.
- Email-then-persist ordering: status changes that announce something by email (send estimate, propose installation) persist ONLY after the email succeeds.

## 3. Mandatory Documentation (JSDoc)

- **Rule**: Every exported module, component, hook, function, type, and route group MUST have a JSDoc (`/** ... */`) comment. File headers describe the module's responsibility.
- **Rule**: English only. Explain purpose, behavior, constraints, and integration context — never just restate the name.
- **Rule**: Internally score each doc-comment 0–10; anything below 8/10 must be improved before the task is complete (see scoring table at the end).

## 4. Persistent Knowledge Base (`knowledge/`)

- **Rule**: All newly added features and improvements MUST be added IMMEDIATELY to `knowledge/history/engine_features.md`.
- **Rule**: All bug fixes, crash solutions, and stability patches MUST be added IMMEDIATELY to `knowledge/history/bug_fixes.md`.
- **Rule**: This is NOT a recommendation — skipping the history update means the task is incomplete.
- **Rule**: Before starting work, search and read the relevant `knowledge/` files (especially `knowledge/history/`) to understand existing logic, patterns, and previously solved issues.

## 5. Memory Bank Rule (REQUIRED)

The `memory-bank/` folder is the long-term project memory for all AI assistants.

- **Rule**: Before starting any task, read all files in `memory-bank/`.
- `projectbrief.md` — source of truth for scope, goals, core requirements.
- `activeContext.md` — MUST reflect current focus, recent changes, next steps, active decisions, learnings.
- `progress.md` — MUST track what works, what's left, current status, known issues, decision evolution.
- `systemPatterns.md` — architecture, technical decisions, design patterns, component relationships.
- `techContext.md` — technologies, dependencies, dev setup, constraints.
- `productContext.md` — why the project exists, what it solves, UX goals.
- **Rule**: Update the relevant memory-bank files at the end of every task that changes project state.
- **Rule — summarize, don't append**: `activeContext.md` and `progress.md` are CURRENT-STATE
  snapshots, not changelogs. Overwrite the relevant section to describe what is true now;
  do not add a new dated "Current Focus" / entry on top of the old ones — that is how these
  two files previously grew past 1,000 lines each of one-time bug narration. The permanent,
  append-only history belongs in `knowledge/history/engine_features.md` and
  `knowledge/history/bug_fixes.md` (Rule 4) — link to a dated entry there instead of
  re-narrating it here. `systemPatterns.md`, `techContext.md`, `productContext.md` and
  `projectbrief.md` are also current-state documents, not logs.

## 6. Modular Responsibility & File Boundaries

- **Rule**: Keep entry points thin (`apps/api/src/index.ts`, `apps/web/src/main.tsx`/`App.tsx`) — business logic lives in `routes/`, `lib/`, `hooks/`, `pages/`, `components/`.
- **Rule**: Files should not exceed 800 lines. Functions should stay small and focused (ideally <100 lines).
  - Known standing violations to reduce opportunistically (only when already working in them, per Rule 8): `apps/api/src/routes/orders.ts` (~2,220 lines), `apps/web/src/pages/orders/OrderDetail.tsx` (~3,170 lines).
- **Rule**: One file, one responsibility. No God objects/components; no centralized "manager" that owns unrelated concerns.
- **Rule**: Do not merge files, collapse modules, or move logic between modules unless explicitly instructed.

## 7. Scope Isolation

- **Rule**: Modify ONLY the files/modules the task requires. No drive-by "improvements", refactors, or optimizations outside the requested scope.
- **Rule**: Refactoring happens only when explicitly requested.
- **Rule**: For multi-module changes: analyze all affected modules → propose a plan → wait for confirmation → implement.
- **Rule**: If uncertain, ASK instead of guessing.

## 8. Architecture Preservation

- The current architecture (SPA → Worker API → Supabase; server-authoritative pricing; capability-token public flow) is STABLE. Treat the codebase as production, not a prototype.
- Priority order: 1. Stability, 2. Modularity, 3. Readability, 4. Performance.
- **Locked patterns** (documented in `knowledge/history/`):
  - Hono literal routes (e.g. `/calendar`) MUST be registered before param routes (`/:id`) in the same group.
  - Bulk `line_items` inserts: every row must carry the SAME column set (PostgREST NULL-fills gaps and violates not-null defaults).
  - `pdf-lib` only — @react-pdf/renderer cannot run on Workers (runtime WASM forbidden).
  - Order-number uniqueness is guaranteed by the DB UNIQUE index + retry-on-23505, not by the counter.

## 9. Verification Standards

- **Rule**: After any structural change run, in the affected workspace(s): `pnpm check` (tsc --noEmit), `pnpm test` (vitest), and `pnpm lint` (web: oxlint). Target: 0 errors / 0 warnings.
- **Rule**: These prove nothing about layout. Any change that adds, moves or restyles something visible is ALSO bound by §11 — it is not done until it has been seen rendered as §11 describes.
- **Rule**: If you touched pricing/totals, run BOTH web and api test suites.
- **Rule**: Cowork-sandbox caveat: the mounted repo view has been observed stale/truncated; treat Read/Edit/Write tool results as ground truth and hand real compile/test verification to the dev machine when the sandbox misbehaves.
- **Rule**: No placeholders — if an asset or value is needed, use a real representative one.
- API accuracy: do not rely on stale training data for library APIs. Current majors: React 19, Vite 8, Tailwind 4 (`@tailwindcss/vite`, `@theme` tokens — no PostCSS config), Hono 4, Zod 3, Wrangler 4 (Node 22+), TanStack Query 5, supabase-js 2.

## 10. Copyright and SPDX Header Rule (REQUIRED)

- **Rule**: Every source file (`.ts`, `.tsx`, `.sql`, `.mjs`, `.gs`) MUST begin with:
  ```ts
  // SPDX-License-Identifier: GPL-3.0-only
  // Copyright (c) 2026 Blinds Nisa. All rights reserved.
  ```
  (SQL files use `--` comments.)
- **Rule**: Preserve this header during any modification. If a file is updated in a later year, extend the year (e.g. `2026-2027`).

## 11. UI Layout & Visual Verification

> Why this exists: on 2026-11-03 an "Incomplete" chip added beside a line item's name passed
> tsc, 620 tests, lint, four code reviews and a harness check — then collapsed the name to one
> letter per line in the real, narrower order card. The harness had used a wide box and a short
> name. See `knowledge/history/bug_fixes.md` 2026-11-03.

### Verifying a visible change

- **Rule — render it in its real container.** Mount the component inside the same parent it lives in (same card / grid / column classes and padding), never in a free-standing wide box. If it sits in a side panel or grid column, measure that column's width at the viewports below and use it.
- **Rule — at the real widths.** At minimum: desktop (≥1280px viewport, the component at its actual column width) and the narrowest supported phone (375px viewport, i.e. ~343px for a full-width card). Also check one width in between (~768px) when the layout has a breakpoint.
- **Rule — with worst-case content.** Short fixture text hides overflow. Always include: a long name with spaces, a 60+ character unbroken string, the longest label that can appear (e.g. every missing field listed), empty values, and every optional badge/chip/icon the row can show at once (e.g. Hidden + Incomplete + lock).
- **Rule — measure, don't just look.** At each width confirm programmatically: no row/card wider than its container (`scrollWidth <= clientWidth`), no text column squeezed below ~10 characters, no sibling overlap (compare `getBoundingClientRect`). Keep a screenshot as proof.
- **Rule — never verify by saving through the real app.** `apps/web/.env` points at the LIVE Supabase project: saving, sending or deleting in a locally run app writes production data. Use a throwaway harness — `apps/web/harness.html` + `apps/web/src/harness.tsx` importing `./index.css` and mounting the component (or a page under `MemoryRouter` + `QueryClientProvider` with a pre-seeded query cache and `staleTime: Infinity`), served by the `web` launch config at `/harness.html`. Confirm zero `/api` requests in the network log. Delete both files before committing.
- **Rule — report exactly what was seen.** Name the widths, the container and the content you rendered. A skipped or partial visual check is reported as "NOT visually verified at <widths/content>" — never as verified — and stays an open item in the task list, the handoff and the PR description until someone does it. A reviewer who sees "visual check skipped" treats it as an open finding, not a pass.
- **Rule — plans and briefs for UI work** name the component's real container, the narrowest width it must hold, and the worst-case content to test it with. Reviewers of a UI diff check the layout classes (flex/grid shrink and wrap behaviour) against that width, not only the logic.

### Layout patterns (locked)

- **Never add a non-shrinking element beside a text column in a flex row.** A `shrink-0` badge/chip/label next to a `min-w-0 flex-1` name takes the row's width first and the name collapses. Put the new element INSIDE the text column as its own line (as `LineItemRow`'s attribute line and Incomplete line do), or make it able to shrink (`min-w-0` + `truncate`).
- **Variable-length text never goes inside a non-shrinking element.** Field lists, user input and translated labels must be able to wrap or truncate; a pill or badge holds one short, fixed word.
- **Read a component's layout comments before changing its rows.** They record measured failures (e.g. `LineItemRow`'s notes on `wrap-anywhere`, and why its extra lines are nested blocks rather than flex columns). A change that contradicts one needs a re-measurement at the widths above.

## Documentation Score Meaning

```txt
0/10 = Missing documentation.
1/10 = Useless placeholder comment.
2/10 = Extremely vague and not technically helpful.
3/10 = Mostly repeats the item name.
4/10 = Mentions purpose but lacks useful context.
5/10 = Basic explanation, but incomplete.
6/10 = Understandable but missing constraints, behavior, or usage notes.
7/10 = Good enough for humans, but not strong enough for long-term AI context.
8/10 = Acceptable: clear purpose, behavior, and relevant context.
9/10 = Strong: explains purpose, behavior, constraints, and integration context.
10/10 = Excellent: future-proof, precise, technically rich, and useful for AI/human maintenance.
```
