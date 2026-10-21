// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Route-level tests for `/api/inbox` against a scripted fake Supabase
 * client that records every builder call per table and answers from a
 * per-table queue.
 *
 * What these pin: literal routes are not swallowed by `/:threadId`;
 * strict schemas reject unknown keys and empty updates; list paging and
 * defaults; rule position on create and reorder; re-apply only touches
 * changed, unlocked threads and skips message bodies when no rule needs
 * them; thread PUT semantics (category lock, handled_at, order → customer,
 * customer change clears order); non-UUID ids are 404.
 *
 * Auth is not exercised: `requireAuth` is applied in `index.ts`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Call {
  table: string;
  ops: Array<[string, unknown[]]>;
}
type Answer = { data?: unknown; error?: unknown; count?: number };

const calls: Call[] = [];
let answers: Record<string, Answer[]> = {};

function makeBuilder(table: string) {
  const call: Call = { table, ops: [] };
  calls.push(call);
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'insert', 'update', 'delete', 'upsert', 'eq', 'in', 'is', 'order', 'range', 'limit', 'maybeSingle', 'single', 'gte', 'contains', 'ilike']) {
    builder[m] = (...args: unknown[]) => {
      call.ops.push([m, args]);
      return builder;
    };
  }
  builder.then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => {
    const next = answers[table]?.shift() ?? {};
    return Promise.resolve({ data: next.data ?? null, error: next.error ?? null, count: next.count ?? null }).then(onF, onR);
  };
  return builder;
}

vi.mock('../lib/supabase', () => ({
  createSupabaseAdmin: () => ({ from: (table: string) => makeBuilder(table) }),
}));

import inboxApp from './inbox';

const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
  RESEND_API_KEY: 'x',
  APP_URL: 'http://localhost:5173',
  ENVIRONMENT: 'test',
};
const T1 = '11111111-1111-4111-8111-111111111111';
const R1 = '22222222-2222-4222-8222-222222222222';
const R2 = '33333333-3333-4333-8333-333333333333';
const C1 = '44444444-4444-4444-8444-444444444444';
const C2 = '55555555-5555-4555-8555-555555555555';
const O1 = '66666666-6666-4666-8666-666666666666';

function json(method: string, body: unknown): RequestInit {
  return { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } };
}
function callsFor(table: string): Call[] {
  return calls.filter((c) => c.table === table);
}
function op(call: Call, name: string): unknown[] | undefined {
  return call.ops.find(([m]) => m === name)?.[1];
}

beforeEach(() => {
  calls.length = 0;
  answers = {};
});

describe('GET /', () => {
  it('defaults to Inquiry / New / page 1 and returns the pager envelope', async () => {
    answers.email_threads = [{ data: [{ id: T1 }], count: 16 }];
    const res = await inboxApp.request('/', {}, ENV);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: [{ id: T1 }], page: 1, page_size: 15, total: 16, total_pages: 2 });
    const [call] = callsFor('email_threads');
    expect(call.ops).toContainEqual(['eq', ['category', 'inquiry']]);
    expect(call.ops).toContainEqual(['eq', ['status', 'new']]);
    expect(op(call, 'range')).toEqual([0, 14]);
  });

  it.each(['/?category=spam', '/?status=open', '/?page=0', '/?foo=1'])('400 for %s', async (path) => {
    expect((await inboxApp.request(path, {}, ENV)).status).toBe(400);
  });
});

describe('literal routes', () => {
  it('GET /rules reads rules, not a thread', async () => {
    answers.email_rules = [{ data: [{ id: R1 }] }];
    const res = await inboxApp.request('/rules', {}, ENV);
    expect(await res.json()).toEqual({ data: [{ id: R1 }] });
    expect(callsFor('email_threads')).toHaveLength(0);
  });

  it('GET /status reads the sync state', async () => {
    answers.email_sync_state = [{ data: [{ folder: 'inbox' }] }];
    const res = await inboxApp.request('/status', {}, ENV);
    expect(await res.json()).toEqual({ data: [{ folder: 'inbox' }] });
  });
});

describe('rules', () => {
  it('appends a new rule after the last position', async () => {
    answers.email_rules = [{ data: { position: 4 } }, { data: { id: R1, position: 5 } }];
    const res = await inboxApp.request('/rules', json('POST', { field: 'domain', match_type: 'equals', value: ' acme.com ', action: 'supplier' }), ENV);
    expect(res.status).toBe(201);
    const insert = op(callsFor('email_rules')[1], 'insert')![0];
    expect(insert).toEqual({ field: 'domain', match_type: 'equals', value: 'acme.com', action: 'supplier', enabled: true, position: 5 });
  });

  it('rejects unknown keys and blank values', async () => {
    expect((await inboxApp.request('/rules', json('POST', { field: 'domain', match_type: 'equals', value: 'a', action: 'supplier', position: 1 }), ENV)).status).toBe(400);
    expect((await inboxApp.request('/rules', json('POST', { field: 'domain', match_type: 'equals', value: '  ', action: 'supplier' }), ENV)).status).toBe(400);
  });

  it('reorders by index', async () => {
    const res = await inboxApp.request('/rules/reorder', json('POST', { ids: [R2, R1] }), ENV);
    expect(res.status).toBe(200);
    const updates = callsFor('email_rules').map((c) => [op(c, 'update')![0], op(c, 'eq')]);
    expect(updates).toEqual([
      [{ position: 0 }, ['id', R2]],
      [{ position: 1 }, ['id', R1]],
    ]);
  });

  it('updates and deletes by uuid, 404 otherwise', async () => {
    answers.email_rules = [{ data: { id: R1, enabled: false } }, { data: { id: R1 } }];
    expect((await inboxApp.request(`/rules/${R1}`, json('PUT', { enabled: false }), ENV)).status).toBe(200);
    expect((await inboxApp.request(`/rules/${R1}`, { method: 'DELETE' }, ENV)).status).toBe(200);
    expect((await inboxApp.request('/rules/nope', json('PUT', { enabled: false }), ENV)).status).toBe(404);
    expect((await inboxApp.request(`/rules/${R1}`, json('PUT', {}), ENV)).status).toBe(400);
  });

  it('re-applies rules to unlocked threads whose category changes', async () => {
    answers.email_rules = [{ data: [{ id: R1, position: 0, field: 'domain', match_type: 'equals', value: 'acme.com', action: 'supplier', enabled: true }] }];
    answers.email_threads = [
      {
        data: [
          { id: 'ta', subject: 'Hi', counterpart_address: 'x@acme.com', category: 'other' },
          { id: 'tb', subject: 'Hi', counterpart_address: 'y@else.com', category: 'other' },
          { id: 'tc', subject: 'Hi', counterpart_address: 'z@acme.com', category: 'supplier' },
        ],
      },
    ];
    const res = await inboxApp.request('/rules/reapply', { method: 'POST' }, ENV);
    expect(await res.json()).toEqual({ data: { changed: 1 } });
    const threadCalls = callsFor('email_threads');
    expect(threadCalls[0].ops).toContainEqual(['eq', ['category_locked', false]]);
    expect(op(threadCalls[1], 'update')).toEqual([{ category: 'supplier' }]);
    expect(op(threadCalls[1], 'in')).toEqual(['id', ['ta']]);
    expect(callsFor('email_messages')).toHaveLength(0);
  });
});

describe('unread', () => {
  it('GET /unread counts unread conversations per category, zero-filled', async () => {
    answers.email_threads = [{ data: [{ category: 'inquiry' }, { category: 'inquiry' }, { category: 'other' }] }];
    const res = await inboxApp.request('/unread', {}, ENV);
    expect(await res.json()).toEqual({ data: { inquiry: 2, supplier: 0, payment: 0, other: 1, total: 3 } });
    const [call] = callsFor('email_threads');
    expect(call.ops).toContainEqual(['eq', ['unread', true]]);
  });

  it('the list and the thread include the unread flag', async () => {
    answers.email_threads = [{ data: [], count: 0 }, { data: { id: T1, customer_id: null } }];
    answers.email_messages = [{ data: [] }];
    await inboxApp.request('/', {}, ENV);
    await inboxApp.request(`/${T1}`, {}, ENV);
    const [list, detail] = callsFor('email_threads');
    expect(String(op(list, 'select')![0])).toMatch(/\bunread\b/);
    expect(String(op(detail, 'select')![0])).toMatch(/\bunread\b/);
  });

  it('POST /:threadId/read clears the flag', async () => {
    answers.email_threads = [{ data: { id: T1 } }];
    const res = await inboxApp.request(`/${T1}/read`, { method: 'POST' }, ENV);
    expect(res.status).toBe(200);
    const [call] = callsFor('email_threads');
    expect(op(call, 'update')).toEqual([{ unread: false }]);
    expect(call.ops).toContainEqual(['eq', ['id', T1]]);
  });

  it('POST /:threadId/read 404s a bad or missing id', async () => {
    expect((await inboxApp.request('/nope/read', { method: 'POST' }, ENV)).status).toBe(404);
    answers.email_threads = [{ data: null }];
    expect((await inboxApp.request(`/${T1}/read`, { method: 'POST' }, ENV)).status).toBe(404);
  });
});

describe('GET /:threadId', () => {
  it('404s a non-uuid', async () => {
    expect((await inboxApp.request('/abc', {}, ENV)).status).toBe(404);
  });

  it('returns messages oldest first and the customer’s orders', async () => {
    answers.email_threads = [{ data: { id: T1, customer_id: C1 } }];
    answers.email_messages = [{ data: [{ id: 'm1' }, { id: 'm2' }] }];
    answers.orders = [{ data: [{ id: O1, order_number: 'F1021-001', status: 'sent' }] }];
    const res = await inboxApp.request(`/${T1}`, {}, ENV);
    expect(await res.json()).toEqual({
      data: { id: T1, customer_id: C1, messages: [{ id: 'm1' }, { id: 'm2' }], customer_orders: [{ id: O1, order_number: 'F1021-001', status: 'sent' }] },
    });
    expect(callsFor('email_messages')[0].ops).toContainEqual(['order', ['sent_at', { ascending: true }]]);
  });
});

describe('PUT /:threadId', () => {
  it('locks a hand-picked category and stamps handled_at', async () => {
    answers.email_threads = [{ data: { id: T1 } }];
    const res = await inboxApp.request(`/${T1}`, json('PUT', { category: 'supplier', status: 'handled' }), ENV);
    expect(res.status).toBe(200);
    const update = op(callsFor('email_threads')[0], 'update')![0] as Record<string, unknown>;
    expect(update).toMatchObject({ category: 'supplier', category_locked: true, status: 'handled' });
    expect(typeof update.handled_at).toBe('string');
  });

  it('linking an order also links its customer', async () => {
    answers.orders = [{ data: { id: O1, customer_id: C1 } }];
    answers.email_threads = [{ data: { id: T1 } }];
    await inboxApp.request(`/${T1}`, json('PUT', { order_id: O1 }), ENV);
    expect(op(callsFor('email_threads')[0], 'update')![0]).toEqual({ order_id: O1, customer_id: C1 });
  });

  it('rejects an order belonging to a different customer', async () => {
    answers.orders = [{ data: { id: O1, customer_id: C1 } }];
    const res = await inboxApp.request(`/${T1}`, json('PUT', { order_id: O1, customer_id: C2 }), ENV);
    expect(res.status).toBe(400);
  });

  it('changing the customer clears the order', async () => {
    answers.customers = [{ data: { id: C2 } }];
    answers.email_threads = [{ data: { id: T1 } }];
    await inboxApp.request(`/${T1}`, json('PUT', { customer_id: C2 }), ENV);
    expect(op(callsFor('email_threads')[0], 'update')![0]).toEqual({ customer_id: C2, order_id: null });
  });

  it('400s unknown keys and empty bodies; 404s a missing thread', async () => {
    expect((await inboxApp.request(`/${T1}`, json('PUT', { subject: 'x' }), ENV)).status).toBe(400);
    expect((await inboxApp.request(`/${T1}`, json('PUT', {}), ENV)).status).toBe(400);
    answers.email_threads = [{ data: null }];
    expect((await inboxApp.request(`/${T1}`, json('PUT', { status: 'new' }), ENV)).status).toBe(404);
  });
});
