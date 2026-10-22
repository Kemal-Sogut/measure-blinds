// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Route tests for `GET /public/customer/:token` against a scripted fake
 * Supabase. Exercised on the sub-app directly, so the rate limiter and
 * maintenance gate in `public.ts` are out of scope here (they are
 * covered by public.routes.test.ts).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const TOKEN = '11111111-1111-4111-8111-111111111111';
const db = {
  customer: null as Record<string, unknown> | null,
  orders: [] as Array<Record<string, unknown>>,
  orderUpdates: [] as Array<Record<string, unknown>>,
};

function makeBuilder(table: string) {
  let op = 'select';
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'in', 'order', 'update']) {
    b[m] = (...args: unknown[]) => {
      if (m === 'update') {
        op = 'update';
        db.orderUpdates.push(args[0] as Record<string, unknown>);
      }
      return b;
    };
  }
  const result = () => {
    if (table === 'customers') return { data: db.customer, error: null };
    if (table === 'company_settings') {
      return {
        data: { company_name: 'Blinds Nisa', logo_url: null, email: 'biz@example.com', phone: '555' },
        error: null,
      };
    }
    if (table === 'orders' && op === 'update') return { data: db.orderUpdates.at(-1), error: null };
    return { data: db.orders, error: null };
  };
  b.maybeSingle = async () => result();
  b.single = async () => result();
  (b as { then: unknown }).then = (ok: (v: unknown) => unknown) => Promise.resolve(ok(result()));
  return b;
}

vi.mock('../lib/supabase', () => ({
  createSupabaseAdmin: () => ({ from: (t: string) => makeBuilder(t) }),
}));

import publicCustomerApp from './publicCustomer';

const ENV = {
  SUPABASE_URL: 'x',
  SUPABASE_SERVICE_ROLE_KEY: 'x',
  RESEND_API_KEY: 'x',
  APP_URL: 'http://localhost:5173',
  ENVIRONMENT: 'test',
};
const order = (over: Record<string, unknown>) => ({
  id: 'o', order_number: 'N', title: null, status: 'sent', order_date: '2026-10-20',
  expiry_date: '2099-01-01', total: 100, public_token: 'ot', payments: [], ...over,
});

beforeEach(() => {
  db.customer = { id: 'c1', first_name: 'Jane', email: 'secret@example.com' };
  db.orders = [];
  db.orderUpdates = [];
});

describe('GET /public/customer/:token', () => {
  it('404s a malformed token', async () => {
    expect((await publicCustomerApp.request('/not-a-uuid', {}, ENV)).status).toBe(404);
  });

  it('404s an unknown token', async () => {
    db.customer = null;
    expect((await publicCustomerApp.request(`/${TOKEN}`, {}, ENV)).status).toBe(404);
  });

  it('lists live estimates and confirmed orders, hiding lapsed ones', async () => {
    db.orders = [
      order({ order_number: 'A', title: 'Option A' }),
      order({ order_number: 'B', expiry_date: '2020-01-01' }),
      order({ order_number: 'C', status: 'awaiting_payment', payments: [{ amount: 40 }] }),
    ];
    const res = await publicCustomerApp.request(`/${TOKEN}`, {}, ENV);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: {
        items: Array<Record<string, unknown>>;
        customer: Record<string, unknown>;
        company: Record<string, unknown>;
      };
    };
    expect(data.items.map((i) => i.order_number)).toEqual(['A', 'C']);
    expect(data.items[0].title).toBe('Option A');
    expect(data.items[1].balance).toBe(60);
    expect(data.customer).toEqual({ first_name: 'Jane' });
    expect(Object.keys(data.company).sort()).toEqual(['company_name', 'email', 'logo_url', 'phone']);
  });

  it('mints a token for a sent order that has none', async () => {
    db.orders = [order({ order_number: 'A', public_token: null })];
    const res = await publicCustomerApp.request(`/${TOKEN}`, {}, ENV);
    const { data } = (await res.json()) as { data: { items: Array<{ public_token: string }> } };
    expect(db.orderUpdates).toHaveLength(1);
    expect(data.items[0].public_token).toBe(db.orderUpdates[0].public_token);
  });
});
