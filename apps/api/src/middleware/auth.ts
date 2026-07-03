// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * JWT authentication middleware for protected API routes.
 *
 * Extracts the Bearer token from the Authorization header and verifies
 * it against the Supabase project's JWKS endpoint using `jose`. On
 * success the decoded payload (user id, email, role) is attached to the
 * Hono context as `user`; on any failure the request is rejected with
 * 401 before reaching a route handler.
 *
 * The remote JWKS set is created once per Worker isolate and cached by
 * `jose` internally (including key rotation refetches), so verification
 * adds no network round-trip on warm requests.
 */

import type { Context, MiddlewareHandler } from 'hono';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

/** Authenticated user identity extracted from a verified Supabase JWT. */
export interface AuthUser {
  /** Supabase auth user id (UUID) — matches profiles.id */
  id: string;
  /** Email address the user logged in with */
  email: string;
}

/** Hono context variables added by this middleware. */
export type AuthVariables = { user: AuthUser };

/**
 * Per-isolate cache of the remote JWKS keyed by Supabase URL, so all
 * requests in a warm Worker share one key set instead of re-creating it.
 */
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/**
 * Returns the (cached) remote JWKS for the given Supabase project URL.
 *
 * @param supabaseUrl - Base project URL, e.g. https://xyz.supabase.co
 */
function getJwks(supabaseUrl: string): ReturnType<typeof createRemoteJWKSet> {
  let jwks = jwksCache.get(supabaseUrl);
  if (!jwks) {
    jwks = createRemoteJWKSet(
      new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`)
    );
    jwksCache.set(supabaseUrl, jwks);
  }
  return jwks;
}

/**
 * Verifies the Bearer token on the request and attaches the user to
 * the context. Responds 401 for missing, malformed, expired, or
 * wrongly-signed tokens.
 *
 * Usage: `app.use('/api/*', requireAuth)` — apply to every route group
 * except `/public/*` and `/api/health`.
 */
export const requireAuth: MiddlewareHandler<{
  Bindings: { SUPABASE_URL: string };
  Variables: AuthVariables;
}> = async (c, next) => {
  const header = c.req.header('Authorization') ?? '';
  if (!header.startsWith('Bearer ')) {
    return unauthorized(c, 'Missing bearer token');
  }
  const token = header.slice('Bearer '.length).trim();

  let payload: JWTPayload;
  try {
    const result = await jwtVerify(token, getJwks(c.env.SUPABASE_URL), {
      issuer: `${c.env.SUPABASE_URL}/auth/v1`,
    });
    payload = result.payload;
  } catch {
    return unauthorized(c, 'Invalid or expired token');
  }

  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    return unauthorized(c, 'Token has no subject');
  }

  c.set('user', {
    id: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : '',
  });
  return next();
};

/**
 * Builds the uniform 401 response used for every authentication
 * failure, keeping error shapes consistent for the frontend client.
 */
function unauthorized(c: Context, message: string): Response {
  return c.json({ error: message }, 401);
}
