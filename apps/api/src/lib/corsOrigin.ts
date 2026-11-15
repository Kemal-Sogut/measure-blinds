// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Which browser origins may call the staff API and the customer pages'
 * API (`index.ts` applies this to every path except `/intake/*`).
 *
 * Origins are compared EXACTLY after parsing. The previous rule,
 * `origin.includes('localhost')`, also matched `localhost.evil.example`.
 * CORS is not what protects the data (a Bearer token is), but an
 * allow-list that can be satisfied by registering a domain is not an
 * allow-list.
 */

/** Origins of the deployed web Worker. Add a custom domain via `ALLOWED_ORIGINS`. */
const DEPLOYED_ORIGINS: readonly string[] = ['https://measure-blinds.blindsnisa.workers.dev'];

/** Hostnames accepted on any port for local development. */
const LOCAL_HOSTNAMES: readonly string[] = ['localhost', '127.0.0.1'];

/**
 * Parses the optional `ALLOWED_ORIGINS` Worker variable.
 *
 * @param raw Comma-separated origins, e.g. `"https://app.blindsnisa.com"`.
 * @returns Trimmed, non-empty entries; `[]` when unset.
 */
export function parseOriginList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Decides whether a request's `Origin` header may be echoed back.
 *
 * @param origin The `Origin` header, if any.
 * @param extra  Additional exact origins from configuration.
 * @returns The origin itself when allowed, or `''` (Hono then sends no
 *          `Access-Control-Allow-Origin`, so the browser blocks the read).
 */
export function allowedStaffOrigin(origin: string | undefined, extra: readonly string[] = []): string {
  if (!origin) return '';
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return '';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
  if (LOCAL_HOSTNAMES.includes(url.hostname)) return origin;
  return [...DEPLOYED_ORIGINS, ...extra].includes(url.origin) ? origin : '';
}
