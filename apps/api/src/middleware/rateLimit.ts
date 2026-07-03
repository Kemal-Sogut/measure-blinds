// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Rate limiting middleware for public (unauthenticated) API endpoints.
 *
 * Implements a fixed-window in-memory counter per client IP. Default:
 * 5 requests per 60-second window; excess requests get 429 with a
 * Retry-After header.
 *
 * KNOWN LIMITATION (accepted at this scale): the counter lives in
 * Worker isolate memory, so each isolate — and each Cloudflare edge
 * location — keeps its own window. A determined attacker spread across
 * regions sees a higher effective limit. At ≤50 customers/month this
 * is an acceptable trade-off versus adding KV/Durable Object state;
 * the public confirm route is additionally idempotent (409 on double
 * confirm), so the limiter only throttles noise, it is not the last
 * line of defense.
 */

import type { MiddlewareHandler } from 'hono';

/** A single IP's request count within the current fixed window. */
interface WindowEntry {
  /** Epoch ms when the current window ends */
  resetAt: number;
  /** Requests seen in the current window */
  count: number;
}

/** Per-isolate request counters keyed by client IP. */
const windows = new Map<string, WindowEntry>();

/** Prevents unbounded memory growth if many unique IPs hit the Worker. */
const MAX_TRACKED_IPS = 10_000;

/**
 * Creates a rate limiting middleware with the given budget.
 *
 * @param limit - Maximum requests allowed per window (default 5)
 * @param windowMs - Window length in milliseconds (default 60s)
 * @returns Hono middleware that responds 429 when the budget is spent
 */
export function rateLimit(limit = 5, windowMs = 60_000): MiddlewareHandler {
  return async (c, next) => {
    const ip =
      c.req.header('CF-Connecting-IP') ??
      c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ??
      'unknown';

    const now = Date.now();
    let entry = windows.get(ip);

    if (!entry || now >= entry.resetAt) {
      if (windows.size >= MAX_TRACKED_IPS) windows.clear();
      entry = { resetAt: now + windowMs, count: 0 };
      windows.set(ip, entry);
    }

    entry.count += 1;
    if (entry.count > limit) {
      const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      c.header('Retry-After', String(retryAfterSec));
      return c.json({ error: 'Too many requests. Please try again shortly.' }, 429);
    }

    return next();
  };
}
