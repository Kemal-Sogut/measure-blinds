// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * JWT authentication middleware for protected API routes.
 *
 * Extracts the Bearer token from the Authorization header and verifies
 * it against the Supabase project's JWKS endpoint using `jose`. On
 * success the decoded payload (user id, email, role) is attached to the
 * Hono context as `user`; on any failure the request is rejected with
 * 401 before reaching a route handler. A verified token is then checked
 * against the staff allow-list (`lib/staffAccess.ts`): a login that is
 * not staff gets 403.
 *
 * The remote JWKS set is created once per Worker isolate and cached by
 * `jose` internally (including key rotation refetches), so verification
 * adds no network round-trip on warm requests.
 */

import type { Context, MiddlewareHandler } from 'hono';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { createSupabaseAdmin } from '../lib/supabase';
import { createStaffGate, profilesLookup, type StaffLookup } from '../lib/staffAccess';

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
 * Per-isolate staff gate. Created on first use because it needs the
 * request's `env`; the bindings are identical for every request an
 * isolate serves, so the first one is safe to keep.
 */
let staffGate: StaffLookup | null = null;

/** Returns the isolate's staff gate, creating it on first use. */
function getStaffGate(env: { SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY: string }): StaffLookup {
  staffGate ??= createStaffGate((userId) => profilesLookup(createSupabaseAdmin(env))(userId));
  return staffGate;
}

/**
 * Verifies the Bearer token on the request, checks that its subject is
 * on the staff allow-list, and attaches the user to the context.
 *
 * 401 for a missing, malformed, expired or wrongly-signed token, and for
 * any token that is not an ordinary signed-in session (wrong audience or
 * role, or an anonymous sign-in). 403 for a real session whose user is
 * not staff. 503 when the allow-list could not be read — never 200.
 *
 * Usage: `app.use('/api/*', requireAuth)` — apply to every route group
 * except `/public/*`, `/intake/*`, `/webhooks/*` and `/api/health`.
 */
export const requireAuth: MiddlewareHandler<{
  Bindings: { SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY: string };
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
      audience: 'authenticated',
    });
    payload = result.payload;
  } catch {
    return unauthorized(c, 'Invalid or expired token');
  }

  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    return unauthorized(c, 'Token has no subject');
  }
  if (payload.role !== 'authenticated' || payload.is_anonymous === true) {
    return unauthorized(c, 'Invalid or expired token');
  }

  let isStaff: boolean;
  try {
    isStaff = await getStaffGate(c.env)(payload.sub);
  } catch (e) {
    console.error('Staff gate:', e);
    return c.json({ error: 'Could not verify staff access. Please try again.' }, 503);
  }
  if (!isStaff) {
    return c.json({ error: 'This account is not authorised for staff access.' }, 403);
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
