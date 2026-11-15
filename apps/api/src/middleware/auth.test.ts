// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Tests for the `requireAuth` middleware: the allow/refuse decision made
 * after a Supabase JWT is verified.
 *
 * `jose` is mocked so each case chooses the verified payload (or a
 * verification failure), and the Supabase admin client is stubbed down to
 * the `profiles` lookup chain. The middleware keeps its staff gate in
 * module-level state, so every case resets the module registry and
 * re-imports `./auth` to start with a cold gate. Audience and issuer are
 * enforced by `jwtVerify` options, so they are asserted as call arguments
 * rather than simulated.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const SUPABASE_URL = 'https://proj.supabase.co';
const ENV = { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-key' };
const USER_ID = '11111111-1111-1111-1111-111111111111';

const jwtVerify = vi.fn();
const maybeSingle = vi.fn();

vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => ({})),
  jwtVerify: (...args: unknown[]) => jwtVerify(...args),
}));

vi.mock('../lib/supabase', () => ({
  createSupabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => maybeSingle() }) }) }),
  }),
}));

/** Loads a fresh `requireAuth` (cold staff gate) mounted on a tiny app. */
async function buildApp() {
  vi.resetModules();
  const { requireAuth } = await import('./auth');
  const app = new Hono<{ Bindings: typeof ENV; Variables: { user: { id: string; email: string } } }>();
  app.use('/secure', requireAuth);
  app.get('/secure', (c) => c.json(c.get('user')));
  return app;
}

/** Requests `/secure` with a bearer token (or none). */
function call(app: Awaited<ReturnType<typeof buildApp>>, token: string | null = 'tok') {
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  return app.request('/secure', { headers }, ENV);
}

describe('requireAuth', () => {
  beforeEach(() => {
    jwtVerify.mockReset();
    maybeSingle.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('401 without a bearer token', async () => {
    const res = await call(await buildApp(), null);
    expect(res.status).toBe(401);
    expect(jwtVerify).not.toHaveBeenCalled();
  });

  it('401 when jwtVerify throws', async () => {
    jwtVerify.mockRejectedValue(new Error('bad signature'));
    const res = await call(await buildApp());
    expect(res.status).toBe(401);
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it('401 when the role is not authenticated', async () => {
    jwtVerify.mockResolvedValue({ payload: { sub: USER_ID, role: 'anon' } });
    const res = await call(await buildApp());
    expect(res.status).toBe(401);
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it('401 for an anonymous sign-in, without querying profiles', async () => {
    jwtVerify.mockResolvedValue({ payload: { sub: USER_ID, role: 'authenticated', is_anonymous: true } });
    const res = await call(await buildApp());
    expect(res.status).toBe(401);
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it('403 with the exact message for a non-staff login', async () => {
    jwtVerify.mockResolvedValue({ payload: { sub: USER_ID, role: 'authenticated' } });
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const res = await call(await buildApp());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'This account is not authorised for staff access.' });
  });

  it('503 with the exact message when the lookup fails', async () => {
    jwtVerify.mockResolvedValue({ payload: { sub: USER_ID, role: 'authenticated' } });
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'db down' } });
    const res = await call(await buildApp());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Could not verify staff access. Please try again.' });
  });

  it('200 for staff, with the user set on the context', async () => {
    jwtVerify.mockResolvedValue({
      payload: { sub: USER_ID, role: 'authenticated', email: 'staff@example.test' },
    });
    maybeSingle.mockResolvedValue({ data: { id: USER_ID }, error: null });
    const res = await call(await buildApp());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: USER_ID, email: 'staff@example.test' });
  });

  it('verifies audience and issuer through jwtVerify options', async () => {
    jwtVerify.mockResolvedValue({ payload: { sub: USER_ID, role: 'authenticated' } });
    maybeSingle.mockResolvedValue({ data: { id: USER_ID }, error: null });
    await call(await buildApp(), 'the-token');
    expect(jwtVerify).toHaveBeenCalledWith('the-token', expect.anything(), {
      issuer: `${SUPABASE_URL}/auth/v1`,
      audience: 'authenticated',
    });
  });
});
