// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Route-level integration tests for the appointments module, exercising
 * the real Hono app with a scripted fake Supabase client. Pins:
 *   - /calendar maps appointment rows into the unified event shape and
 *     validates its date-range params
 *   - creating an estimate visit requires a customer, REJECTS any
 *     attached order (estimate visits are customer-only by design),
 *     and inserts the row already CONFIRMED — no customer approval step
 *   - creating an installation requires a READY order (409 otherwise)
 *   - a failed proposal email leaves the schedule untouched (502, no
 *     insert/update after)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Rows returned per table.op, keyed for the fake client. */
interface FakeDb {
  responses: Record<string, unknown[]>;
  calls: string[];
  /** Captured insert payloads keyed by table name */
  insertPayloads: Record<string, unknown[]>;
}

const db: FakeDb = { responses: {}, calls: [], insertPayloads: {} };

/**
 * Minimal thenable query builder that mimics the supabase-js chain.
 * Every chained method returns `this`; awaiting resolves a scripted
 * response for the table/op pair.
 */
function makeBuilder(table: string) {
  const state = { table, op: 'select' };
  const builder: Record<string, unknown> = {};
  const chain = (name: string) =>
    ((...args: unknown[]) => {
      if (['insert', 'update', 'delete'].includes(name)) state.op = name;
      if (name === 'insert') {
        (db.insertPayloads[state.table] ??= []).push(args[0]);
      }
      return builder;
    }) as unknown;
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'is', 'gte', 'lte', 'order', 'limit']) {
    builder[m] = chain(m);
  }
  const resolve = () => {
    db.calls.push(`${state.table}.${state.op}`);
    const rows = db.responses[`${state.table}.${state.op}`] ?? [];
    return { data: rows, error: null };
  };
  builder.single = async () => {
    const r = resolve();
    return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error };
  };
  builder.maybeSingle = builder.single;
  (builder as { then: unknown }).then = (onFulfilled: (v: unknown) => unknown) => {
    const r = resolve();
    return Promise.resolve(onFulfilled(r));
  };
  return builder;
}

vi.mock('../lib/supabase', () => ({
  createSupabaseAdmin: () => ({ from: (table: string) => makeBuilder(table) }),
}));

import appointmentsApp from './appointments';

/** Standard env bindings for app.request. */
const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
  RESEND_API_KEY: 'not-a-real-key',
  APP_URL: 'http://localhost:5173',
  ENVIRONMENT: 'test',
};

const COMPANY = [
  { company_name: 'Blinds Nisa', logo_url: null, email: 'x@y.z', phone: '', address: '', google_review_url: '' },
];
const CUSTOMER_ID = '44444444-4444-4444-8444-444444444444';
const ORDER_ID = '55555555-5555-4555-8555-555555555555';

/** Stubs the Resend API to succeed (or fail) for one request. */
async function withResend(ok: boolean, run: () => Promise<void>) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).includes('api.resend.com')) {
      return ok
        ? new Response('{}', { status: 200 })
        : new Response(JSON.stringify({ message: 'API key is invalid' }), { status: 401 });
    }
    return realFetch(url as never, init as never);
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = realFetch;
  }
}

function post(path: string, body: unknown) {
  return appointmentsApp.request(
    path,
    { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } },
    ENV
  );
}

beforeEach(() => {
  db.responses = {};
  db.calls = [];
  db.insertPayloads = {};
});

describe('GET /api/appointments/calendar', () => {
  const ROWS = [
    {
      id: 'a1',
      kind: 'estimate',
      order_id: null,
      appointment_date: '2026-08-10',
      appointment_time: '09:00:00',
      status: 'proposed',
      order: null,
      customer: { first_name: 'Ann', last_name: 'Lee' },
    },
    {
      id: 'a2',
      kind: 'installation',
      order_id: ORDER_ID,
      appointment_date: '2026-08-15',
      appointment_time: '13:30:00',
      status: 'confirmed',
      order: { order_number: 'F0307-201' },
      customer: { first_name: 'Bo', last_name: 'Kim' },
    },
  ];

  it('maps rows into the unified event shape', async () => {
    db.responses['appointments.select'] = ROWS;
    const res = await appointmentsApp.request('/calendar?from=2026-08-01&to=2026-08-31', { method: 'GET' }, ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ id: string; kind: string; date: string; order_number: string }>;
    };
    expect(body.data).toHaveLength(2);
    expect(body.data[0]).toMatchObject({ id: 'a1', kind: 'estimate', date: '2026-08-10', order_number: '' });
    expect(body.data[1]).toMatchObject({ id: 'a2', kind: 'installation', order_number: 'F0307-201' });
  });

  it('400s on a malformed date param', async () => {
    const res = await appointmentsApp.request('/calendar?from=not-a-date&to=2026-08-31', { method: 'GET' }, ENV);
    expect(res.status).toBe(400);
  });

  it('400s when a required param is missing', async () => {
    const res = await appointmentsApp.request('/calendar?from=2026-08-01', { method: 'GET' }, ENV);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/appointments (estimate)', () => {
  it('rejects a malformed time (400) before touching the DB', async () => {
    const res = await post('/', {
      kind: 'estimate',
      customer_id: CUSTOMER_ID,
      appointment_date: '2026-08-07',
      appointment_time: '9am',
    });
    expect(res.status).toBe(400);
  });

  it('requires a customer_id', async () => {
    db.responses['company_settings.select'] = COMPANY;
    const res = await post('/', {
      kind: 'estimate',
      appointment_date: '2026-08-07',
      appointment_time: '09:00',
    });
    expect(res.status).toBe(400);
  });

  it('REJECTS an attached order — estimate visits are customer-only', async () => {
    db.responses['company_settings.select'] = COMPANY;
    const res = await post('/', {
      kind: 'estimate',
      customer_id: CUSTOMER_ID,
      order_id: ORDER_ID,
      appointment_date: '2026-08-07',
      appointment_time: '09:00',
    });
    expect(res.status).toBe(400);
  });

  it('emails the customer then inserts the visit CONFIRMED with NO order_id', async () => {
    db.responses['company_settings.select'] = COMPANY;
    db.responses['customers.select'] = [
      { id: CUSTOMER_ID, first_name: 'Ann', last_name: 'Lee', email: 'ann@example.com' },
    ];
    await withResend(true, async () => {
      const res = await post('/', {
        kind: 'estimate',
        customer_id: CUSTOMER_ID,
        appointment_date: '2026-08-07',
        appointment_time: '09:00',
      });
      expect(res.status).toBe(200);
      expect(db.calls).toContain('appointments.insert');
      const inserted = db.insertPayloads['appointments']?.[0] as Record<string, unknown>;
      expect(inserted.kind).toBe('estimate');
      expect(inserted.status).toBe('confirmed');
      expect(inserted.confirmed_at).toBeTruthy();
      expect(inserted).not.toHaveProperty('order_id');
    });
  });

  it('502 on email failure and never writes to the DB after', async () => {
    db.responses['company_settings.select'] = COMPANY;
    db.responses['customers.select'] = [
      { id: CUSTOMER_ID, first_name: 'Ann', last_name: 'Lee', email: 'ann@example.com' },
    ];
    await withResend(false, async () => {
      const res = await post('/', {
        kind: 'estimate',
        customer_id: CUSTOMER_ID,
        appointment_date: '2026-08-07',
        appointment_time: '09:00',
      });
      expect(res.status).toBe(502);
      expect(db.calls.filter((c) => c === 'appointments.insert')).toHaveLength(0);
    });
  });
});

describe('POST /api/appointments (installation)', () => {
  const readyOrder = {
    id: ORDER_ID,
    order_number: 'F0307-127',
    status: 'ready',
    customer: { id: CUSTOMER_ID, first_name: 'A', last_name: 'B', email: 'a@example.com' },
  };

  it('409 when the order is not ready', async () => {
    db.responses['company_settings.select'] = COMPANY;
    db.responses['orders.select'] = [{ ...readyOrder, status: 'in_progress' }];
    const res = await post('/', {
      kind: 'installation',
      order_id: ORDER_ID,
      appointment_date: '2026-08-07',
      appointment_time: '09:00',
    });
    expect(res.status).toBe(409);
  });

  it('emails the customer then inserts the visit with the order attached', async () => {
    db.responses['company_settings.select'] = COMPANY;
    db.responses['orders.select'] = [readyOrder];
    await withResend(true, async () => {
      const res = await post('/', {
        kind: 'installation',
        order_id: ORDER_ID,
        appointment_date: '2026-08-07',
        appointment_time: '09:00',
      });
      expect(res.status).toBe(200);
      expect(db.calls).toContain('appointments.insert');
      const inserted = db.insertPayloads['appointments']?.[0] as Record<string, unknown>;
      expect(inserted.kind).toBe('installation');
      expect(inserted.order_id).toBe(ORDER_ID);
    });
  });
});

describe('DELETE /api/appointments/:id', () => {
  it('deletes an existing appointment', async () => {
    db.responses['appointments.select'] = [{ id: 'a1', kind: 'estimate', order_id: null }];
    const res = await appointmentsApp.request('/a1', { method: 'DELETE' }, ENV);
    expect(res.status).toBe(200);
    expect(db.calls).toContain('appointments.delete');
  });

  it('404 for a missing appointment', async () => {
    const res = await appointmentsApp.request('/missing', { method: 'DELETE' }, ENV);
    expect(res.status).toBe(404);
  });
});
