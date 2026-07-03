// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Route-level integration tests for the public customer flow with a
 * scripted fake Supabase client. Pins:
 *   - unknown/malformed tokens → 404 before any DB access pattern leak
 *   - defensive expiry (sent + past expiry reads as expired, 410 on confirm)
 *   - confirm succeeds exactly once (second attempt → 409)
 *   - the in-memory rate limiter returns 429 after the budget is spent
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

interface FakeDb {
  estimate: Record<string, unknown> | null;
  updated: boolean;
  calls: string[];
}
const db: FakeDb = { estimate: null, updated: false, calls: [] };

/** Fake supabase: estimates reads return db.estimate; updates flip status. */
function makeBuilder(table: string) {
  const state = { table, op: 'select', filteredBySentStatus: false };
  const builder: Record<string, unknown> = {};
  const chain = (name: string) =>
    ((...args: unknown[]) => {
      if (['insert', 'update', 'delete'].includes(name)) state.op = name;
      if (name === 'eq' && args[0] === 'status' && args[1] === 'sent') state.filteredBySentStatus = true;
      return builder;
    }) as unknown;
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'is', 'lt', 'or', 'order', 'limit']) {
    builder[m] = chain(m);
  }
  const resolve = () => {
    db.calls.push(`${state.table}.${state.op}`);
    if (state.table === 'company_settings') {
      return { data: { company_name: 'Blinds Nisa', logo_url: null, email: 'biz@example.com', phone: '', address: '', hst_number: 'HST1' } };
    }
    if (state.table !== 'estimates') return { data: null };
    if (state.op === 'update') {
      // Mimic the status='sent' guard: only update when still sent.
      if (state.filteredBySentStatus && (db.estimate as { status?: string })?.status !== 'sent') {
        return { data: null };
      }
      if (db.estimate) {
        db.estimate = { ...db.estimate, status: 'confirmed' };
        db.updated = true;
      }
      return { data: db.estimate };
    }
    return { data: db.estimate };
  };
  builder.single = async () => ({ ...resolve(), error: null });
  builder.maybeSingle = builder.single;
  (builder as { then: unknown }).then = (onF: (v: unknown) => unknown) =>
    Promise.resolve(onF({ ...resolve(), error: null }));
  return builder;
}

vi.mock('../lib/supabase', () => ({
  createSupabaseAdmin: () => ({ from: (t: string) => makeBuilder(t) }),
}));

import publicApp from './public';

const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
  RESEND_API_KEY: 'placeholder',
  APP_URL: 'http://localhost:5173',
  ENVIRONMENT: 'test',
};

const TOKEN = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

/** Requests carry a unique IP by default so the limiter doesn't interfere. */
let ipSeq = 0;
function req(path: string, method = 'GET', ip?: string) {
  return publicApp.request(
    path,
    { method, headers: { 'CF-Connecting-IP': ip ?? `10.0.0.${++ipSeq}` } },
    ENV
  );
}

/** A future-dated sent estimate with customer + items. */
function sentEstimate(): Record<string, unknown> {
  return {
    id: 'e1',
    status: 'sent',
    order_number: 'F0307-126',
    estimate_date: '2026-07-03',
    expiry_date: '2099-01-01',
    subtotal: 100, discount_amount: 0, taxable_amount: 100,
    tax_rate: 0.13, tax_amount: 13, total: 113,
    terms_snapshot: 'Terms here',
    confirmed_at: null,
    public_token: TOKEN,
    line_items: [],
    customer: { first_name: 'A', last_name: 'B', shipping_address_line1: '', shipping_address_line2: '', shipping_city: '', shipping_province: '', shipping_postal_code: '' },
  };
}

beforeEach(() => {
  db.estimate = sentEstimate();
  db.updated = false;
  db.calls = [];
});

describe('GET /public/estimate/:token', () => {
  it('rejects malformed tokens with 404', async () => {
    const res = await req('/estimate/not-a-uuid');
    expect(res.status).toBe(404);
  });

  it('returns the sanitized estimate for a valid token', async () => {
    const res = await req(`/estimate/${TOKEN}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data.status).toBe('sent');
    expect(body.data.total).toBe(113);
    expect(body.data.terms).toBe('Terms here');
    expect(body.data).not.toHaveProperty('id');
    expect(body.data).not.toHaveProperty('public_token');
  });

  it('404 for unknown token', async () => {
    db.estimate = null;
    const res = await req(`/estimate/${TOKEN}`);
    expect(res.status).toBe(404);
  });

  it('defensively expires a stale sent estimate on read', async () => {
    db.estimate = { ...sentEstimate(), expiry_date: '2020-01-01' };
    const res = await req(`/estimate/${TOKEN}`);
    const body = (await res.json()) as { data: { status: string } };
    expect(body.data.status).toBe('expired');
    expect(db.calls).toContain('estimates.update');
  });
});

describe('POST /public/estimate/:token/confirm', () => {
  it('confirms a sent estimate exactly once, then 409', async () => {
    const first = await req(`/estimate/${TOKEN}/confirm`, 'POST');
    expect(first.status).toBe(200);
    expect((db.estimate as { status: string }).status).toBe('confirmed');

    const second = await req(`/estimate/${TOKEN}/confirm`, 'POST');
    expect(second.status).toBe(409);
  });

  it('410 for an expired estimate', async () => {
    db.estimate = { ...sentEstimate(), expiry_date: '2020-01-01' };
    const res = await req(`/estimate/${TOKEN}/confirm`, 'POST');
    expect(res.status).toBe(410);
  });

  it('400 for a draft estimate (no token should exist, but belt & braces)', async () => {
    db.estimate = { ...sentEstimate(), status: 'draft' };
    const res = await req(`/estimate/${TOKEN}/confirm`, 'POST');
    expect(res.status).toBe(400);
  });
});

describe('rate limiting', () => {
  it('returns 429 after 5 requests in a minute from one IP', async () => {
    const ip = '203.0.113.7';
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await req(`/estimate/${TOKEN}`, 'GET', ip);
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(statuses[5]).toBe(429);
  });
});
