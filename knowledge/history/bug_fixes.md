# Bug Fixes History

## 2026-07-03 — Blind line-item schema silently stripped client prices
- **Issue:** `blindItemSchema` was a plain `z.object`, so a tampered payload carrying
  `unit_price` was quietly stripped instead of rejected — caught by the route-level
  integration test expecting 400.
- **Fix:** both line-item schemas are now `.strict()`; any unknown field (esp. money) → 400.

## 2026-07-03 — PDF response body type + Hono
- **Issue:** `c.body(Uint8Array)` fails Hono's typing (`Uint8Array<ArrayBufferLike>`).
- **Fix:** re-slice into a plain `ArrayBuffer` before returning the PDF stream.

## 2026-07-03 — base64 attachment stack overflow risk
- **Issue:** `btoa(String.fromCharCode(...bytes))` overflows the call stack for PDFs
  larger than ~100 kB.
- **Fix:** chunked 8 kB conversion in `toBase64()` in the estimates routes.

## 2026-07-03 — Root scripts broken on Windows (single-quoted pnpm filters)
- **Issue:** `pnpm dev` failed with "No projects matched the filters" — cmd.exe does not
  treat single quotes as quoting, so `--filter './apps/*'` was passed literally.
- **Fix:** Root `package.json` scripts now use escaped double quotes (`\"./apps/*\"`),
  which work in both cmd.exe and bash. Also added root `test` script and pinned
  `"packageManager": "pnpm@9.15.9"` (pnpm 11 via Corepack crashes on Node 20).

## 2026-07-03 — api.ts token source (latent bug, fixed before release)
- **Issue:** `apiFetch` read the access token from `localStorage.getItem('sb-access-token')`,
  a key supabase-js does not use (it stores under `sb-<project-ref>-auth-token` as JSON).
  Every authenticated API call would have gone out without a Bearer token → permanent 401s.
- **Fix:** `apiFetch` now calls `supabase.auth.getSession()` per request, which also gets
  transparent token refresh. No token is manually persisted anywhere.

## 2026-07-03 — package.json truncation during tooling edits
- **Issue:** During plan-improvement edits, `apps/web/package.json` and `apps/api/package.json`
  were observed truncated mid-file in one environment view (stale filesystem cache between the
  editing tool and the sandbox mount).
- **Fix:** Both files rewritten in full and re-validated with `JSON.parse`. Lesson recorded:
  after editing JSON config files, validate them with a parser, not by eye.
