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
 *   - `PUT /:id` changes only the status (stamping or clearing
 *     `handled_at`), 404s an unknown or malformed id, and 400s anything but
 *     `new` / `handled` (the old `contacted` / `archived` are gone)
 *   - `DELETE /:id` deletes by id and 404s an unknown one
 *   - `POST /:id/propose` validates the time, passes the lib's error status
 *     through untouched, and only on success marks the lead handled and links
 *     the visit (the email/visit logic itself is pinned in `leadProposal.test.ts`)
 *
 * Auth is not exercised: `requireAuth` is applied in `index.ts`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LeadProposalResult } from '../lib/leadProposal';

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
  for (const name of ['select', 'eq', 'order', 'range', 'update', 'delete']) {
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

/** The proposal lib's scripted answer, and the inputs it was called with. */
const proposal = {
  result: { ok: true, appointmentId: 'appt-1', email: 'jane@example.com' } as LeadProposalResult,
  calls: [] as unknown[][],
};
vi.mock('../lib/leadProposal', () => ({
  sendLeadProposal: (...args: unknown[]) => {
    proposal.calls.push(args);
    return Promise.resolve(proposal.result);
  },
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
  proposal.result = { ok: true, appointmentId: 'appt-1', email: 'jane@example.com' };
  proposal.calls = [];
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
    await leadsApp.request('/?status=handled&page=2', {}, ENV);
    expect(listOp().calls).toContainEqual(['eq', ['status', 'handled']]);
    expect(listOp().calls).toContainEqual(['range', [20, 39]]);
  });

  it.each(['?status=converted', '?status=archived', '?page=0', '?size=50'])('rejects %s', async (q) => {
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

  it('marks handled with a timestamp, and back to new clears it', async () => {
    db.updated = { id: ID, status: 'handled' };
    const res = await put(ID, { status: 'handled' });
    expect(res.status).toBe(200);
    const update = db.ops[0].calls.find(([n]) => n === 'update')![1][0] as Record<string, unknown>;
    expect(Object.keys(update).sort()).toEqual(['handled_at', 'status']);
    expect(update.status).toBe('handled');
    expect(typeof update.handled_at).toBe('string');
    expect(db.ops[0].calls).toContainEqual(['eq', ['id', ID]]);

    db.ops = [];
    await put(ID, { status: 'new' });
    expect(db.ops[0].calls).toContainEqual(['update', [{ status: 'new', handled_at: null }]]);
  });

  it('404s an unknown or malformed id', async () => {
    expect((await put(ID, { status: 'handled' })).status).toBe(404);
    expect((await put('not-a-uuid', { status: 'handled' })).status).toBe(404);
  });

  it('400s an unknown or retired status, or extra fields', async () => {
    expect((await put(ID, { status: 'converted' })).status).toBe(400);
    expect((await put(ID, { status: 'contacted' })).status).toBe(400);
    expect((await put(ID, { status: 'archived' })).status).toBe(400);
    expect((await put(ID, { status: 'new', email: 'x@y.z' })).status).toBe(400);
  });
});

describe('DELETE /api/leads/:id', () => {
  it('deletes by id', async () => {
    db.updated = { id: ID };
    const res = await leadsApp.request(`/${ID}`, { method: 'DELETE' }, ENV);
    expect(res.status).toBe(200);
    expect(db.ops[0].table).toBe('leads');
    expect(db.ops[0].calls.map(([n]) => n)).toEqual(['delete', 'eq', 'select']);
    expect(db.ops[0].calls).toContainEqual(['eq', ['id', ID]]);
  });

  it('404s an unknown or malformed id', async () => {
    expect((await leadsApp.request(`/${ID}`, { method: 'DELETE' }, ENV)).status).toBe(404);
    expect((await leadsApp.request('/nope', { method: 'DELETE' }, ENV)).status).toBe(404);
    expect(db.ops).toHaveLength(1);
  });
});

describe('POST /api/leads/:id/propose', () => {
  const propose = (id: string, body: unknown) =>
    leadsApp.request(
      `/${id}/propose`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      ENV
    );
  const VALID = { appointment_date: '2026-11-06', appointment_time: '10:00', message: 'See you soon' };

  it('sends, then marks the lead handled and links the visit', async () => {
    db.updated = { id: ID, status: 'handled', appointment_id: 'appt-1' };
    const res = await propose(ID, VALID);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { status: 'handled' }, emailed_to: 'jane@example.com' });
    expect(proposal.calls[0].slice(2)).toEqual([ID, VALID]);
    const update = db.ops[0].calls.find(([n]) => n === 'update')![1][0] as Record<string, unknown>;
    expect(update).toMatchObject({ status: 'handled', appointment_id: 'appt-1' });
    expect(typeof update.handled_at).toBe('string');
  });

  it.each([404, 409, 502] as const)('passes a %i from the proposal through and leaves the lead alone', async (status) => {
    proposal.result = { ok: false, status, error: 'nope' };
    const res = await propose(ID, VALID);
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: 'nope' });
    expect(db.ops).toHaveLength(0);
  });

  it('says the proposal went out when only the lead update fails', async () => {
    db.updated = null;
    const res = await propose(ID, VALID);
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toMatch(/proposal was sent/);
  });

  it.each([
    { appointment_date: '6 Nov', appointment_time: '10:00' },
    { appointment_date: '2026-11-06', appointment_time: '25:00' },
    { appointment_date: '2026-11-06', appointment_time: '10:00', status: 'handled' },
    { appointment_date: '2026-11-06', appointment_time: '10:00', message: 'x'.repeat(1001) },
  ])('400s a bad payload %#', async (body) => {
    expect((await propose(ID, body)).status).toBe(400);
    expect(proposal.calls).toHaveLength(0);
  });

  it('404s a malformed id without calling the lib', async () => {
    expect((await propose('nope', VALID)).status).toBe(404);
    expect(proposal.calls).toHaveLength(0);
  });
});
