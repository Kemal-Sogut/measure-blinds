// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Route tests for the staff Leads API (`/api/leads`) against a scripted
 * fake Supabase client.
 *
 * What these pin:
 *   - the list pages 20 at a time, newest first, filters by `?status=`,
 *     and carries `new_count` plus the Notifications-style pager envelope
 *   - `/summary` answers the new count. It is a literal route, so it is
 *     never read as an id
 *   - `PUT /:id` changes only the status, 404s an unknown or malformed id,
 *     and 400s anything but a known status
 *
 * Auth is not exercised: `requireAuth` is applied in `index.ts`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Recorded chain calls per `from()` and the canned replies. */
const db = {
  ops: [] as Array<{ table: string; calls: Array<[string, unknown[]]> }>,
  rows: [] as Array<Record<string, unknown>>,
  total: 0,
  newCount: 0,
  updated: null as Record<string, unknown> | null,
};

/** Thenable builder mimicking the supabase-js chains the route uses. */
function builder(table: string) {
  const op = { table, calls: [] as Array<[string, unknown[]]> };
  db.ops.push(op);
  const b: Record<string, unknown> = {};
  for (const name of ['select', 'eq', 'order', 'range', 'update']) {
    b[name] = (...args: unknown[]) => {
      op.calls.push([name, args]);
      return b;
    };
  }
  const head = () => op.calls.some(([n, a]) => n === 'select' && (a[1] as { head?: boolean } | undefined)?.head);
  b.maybeSingle = () => Promise.resolve({ data: db.updated, error: null });
  (b as { then: unknown }).then = (onF: (v: unknown) => unknown) =>
    Promise.resolve(
      onF(head() ? { count: db.newCount, data: null, error: null } : { data: db.rows, count: db.total, error: null })
    );
  return b;
}

vi.mock('../lib/supabase', () => ({
  createSupabaseAdmin: () => ({ from: (t: string) => builder(t) }),
}));

import leadsApp from './leads';

const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
  RESEND_API_KEY: 'x',
  APP_URL: 'http://localhost:5173',
  ENVIRONMENT: 'test',
};
const ID = '11111111-2222-4333-8444-555555555555';

beforeEach(() => {
  db.ops = [];
  db.rows = [{ id: ID, status: 'new' }];
  db.total = 41;
  db.newCount = 3;
  db.updated = null;
});

/** The list chain (the one that is not the head-only count). */
const listOp = () =>
  db.ops.find((o) => o.calls.some(([n]) => n === 'range'))!;

describe('GET /api/leads', () => {
  it('returns page 1 of everything, newest first, with the pager and new count', async () => {
    const res = await leadsApp.request('/', {}, ENV);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ page: 1, page_size: 20, total: 41, total_pages: 3, new_count: 3 });
    expect(listOp().calls).toContainEqual(['range', [0, 19]]);
    expect(listOp().calls).toContainEqual(['order', ['created_at', { ascending: false }]]);
    expect(listOp().calls.some(([n]) => n === 'eq')).toBe(false);
  });

  it('filters by status and pages', async () => {
    await leadsApp.request('/?status=contacted&page=2', {}, ENV);
    expect(listOp().calls).toContainEqual(['eq', ['status', 'contacted']]);
    expect(listOp().calls).toContainEqual(['range', [20, 39]]);
  });

  it.each(['?status=converted', '?page=0', '?size=50'])('rejects %s', async (q) => {
    expect((await leadsApp.request(`/${q}`, {}, ENV)).status).toBe(400);
  });
});

describe('GET /api/leads/summary', () => {
  it('returns the new count', async () => {
    const res = await leadsApp.request('/summary', {}, ENV);
    expect(await res.json()).toEqual({ new_count: 3 });
  });
});

describe('PUT /api/leads/:id', () => {
  const put = (id: string, body: unknown) =>
    leadsApp.request(`/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, ENV);

  it('updates only the status', async () => {
    db.updated = { id: ID, status: 'contacted' };
    const res = await put(ID, { status: 'contacted' });
    expect(res.status).toBe(200);
    const op = db.ops[0];
    expect(op.calls).toContainEqual(['update', [{ status: 'contacted' }]]);
    expect(op.calls).toContainEqual(['eq', ['id', ID]]);
  });

  it('404s an unknown or malformed id', async () => {
    expect((await put(ID, { status: 'archived' })).status).toBe(404);
    expect((await put('not-a-uuid', { status: 'archived' })).status).toBe(404);
  });

  it('400s an unknown status or extra fields', async () => {
    expect((await put(ID, { status: 'converted' })).status).toBe(400);
    expect((await put(ID, { status: 'new', email: 'x@y.z' })).status).toBe(400);
  });
});
