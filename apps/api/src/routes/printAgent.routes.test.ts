// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Route-level tests for the print-agent endpoints. These are the only
 * routes outside /api/* other than the e-Transfer webhook, so the
 * shared-secret guard is the first thing pinned here: a Worker with no
 * PRINT_AGENT_SECRET configured must fail CLOSED, never open.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

/** Scripted state for the fake Supabase client. */
const db = {
  rpcResult: [] as unknown[],
  rpcError: null as { message: string } | null,
  updates: [] as Array<{ table: string; values: Record<string, unknown> }>,
};

vi.mock('../lib/supabase', () => ({
  createSupabaseAdmin: () => ({
    rpc: async () => ({ data: db.rpcResult, error: db.rpcError }),
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      for (const m of ['select', 'eq']) builder[m] = () => builder;
      builder.update = (values: Record<string, unknown>) => {
        db.updates.push({ table, values });
        return builder;
      };
      (builder as { then: unknown }).then = (onFulfilled: (v: unknown) => unknown) =>
        Promise.resolve(onFulfilled({ data: [], error: null }));
      return builder;
    },
  }),
}));

import agentApp from './printAgent';

const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
  RESEND_API_KEY: 'not-a-real-key',
  APP_URL: 'http://localhost:5173',
  ENVIRONMENT: 'test',
  PRINT_AGENT_SECRET: 'shop-floor-secret',
};

const AUTH = { Authorization: 'Bearer shop-floor-secret' };

beforeEach(() => {
  db.rpcResult = [];
  db.rpcError = null;
  db.updates = [];
});

describe('GET /print-jobs/next', () => {
  it('returns 204 when the queue is empty', async () => {
    const res = await agentApp.request('/print-jobs/next', { headers: AUTH }, ENV);
    expect(res.status).toBe(204);
  });

  it('returns the claimed job', async () => {
    db.rpcResult = [
      {
        id: '66666666-6666-4666-8666-666666666666',
        payload: 'SIZE 3,1.50\r\nPRINT 1,1\r\n',
        label_count: 2,
        order_number: 'T0408-126',
      },
    ];
    const res = await agentApp.request('/print-jobs/next', { headers: AUTH }, ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { label_count: number; payload: string } };
    expect(body.data.label_count).toBe(2);
    expect(body.data.payload).toContain('PRINT 1,1');
  });

  it('rejects a wrong secret', async () => {
    const res = await agentApp.request(
      '/print-jobs/next',
      { headers: { Authorization: 'Bearer wrong' } },
      ENV
    );
    expect(res.status).toBe(401);
  });

  it('fails closed when no secret is configured', async () => {
    const res = await agentApp.request('/print-jobs/next', { headers: AUTH }, {
      ...ENV,
      PRINT_AGENT_SECRET: undefined,
    });
    expect(res.status).toBe(401);
  });

  it('rejects "Bearer undefined" when the secret is unset', async () => {
    const res = await agentApp.request(
      '/print-jobs/next',
      { headers: { Authorization: 'Bearer undefined' } },
      { ...ENV, PRINT_AGENT_SECRET: undefined }
    );
    expect(res.status).toBe(401);
  });

  it('fails closed when the secret is an empty string', async () => {
    const res = await agentApp.request('/print-jobs/next', { headers: AUTH }, {
      ...ENV,
      PRINT_AGENT_SECRET: '',
    });
    expect(res.status).toBe(401);
  });
});

describe('POST /print-jobs/:id/result', () => {
  it('marks a job done', async () => {
    const res = await agentApp.request(
      '/print-jobs/66666666-6666-4666-8666-666666666666/result',
      {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true }),
      },
      ENV
    );
    expect(res.status).toBe(200);
    expect(db.updates[0].values).toEqual({ status: 'done', last_error: '' });
  });

  it('records a truncated failure reason', async () => {
    const res = await agentApp.request(
      '/print-jobs/66666666-6666-4666-8666-666666666666/result',
      {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'x'.repeat(900) }),
      },
      ENV
    );
    expect(res.status).toBe(200);
    const values = db.updates[0].values as { status: string; last_error: string };
    expect(values.status).toBe('failed');
    expect(values.last_error).toHaveLength(500);
  });

  it('rejects unknown body fields (strict schema)', async () => {
    const res = await agentApp.request(
      '/print-jobs/66666666-6666-4666-8666-666666666666/result',
      {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, retries: 2 }),
      },
      ENV
    );
    expect(res.status).toBe(400);
    expect(db.updates).toHaveLength(0);
  });

  it('rejects an unauthenticated caller before touching the database', async () => {
    const res = await agentApp.request(
      '/print-jobs/66666666-6666-4666-8666-666666666666/result',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"ok":true}' },
      ENV
    );
    expect(res.status).toBe(401);
    expect(db.updates).toHaveLength(0);
  });
});
