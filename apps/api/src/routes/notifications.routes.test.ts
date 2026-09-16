// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Route-level tests for the staff Alerts feed (`GET /api/notifications`)
 * and its best-effort writer (`lib/notifications.ts`), against a
 * scripted fake Supabase client.
 *
 * What these pin:
 *   - pages are 15 rows, newest first, requested via `.range()` offsets
 *     derived from `?page=`
 *   - the pager envelope (`page`, `page_size`, `total`, `total_pages`)
 *     matches the appointments list, with `total_pages` never below 1
 *   - PostgREST's string `numeric` amounts become numbers (null stays null)
 *   - a bad or unexpected query parameter is a 400, not a silent page 1
 *   - `recordNotification` never throws, whether PostgREST returns an
 *     error or the client itself throws
 *
 * Auth is not exercised: `requireAuth` is applied in `index.ts`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

/** What the fake records and returns for the single `notifications` read. */
interface FakeDb {
  rows: Array<Record<string, unknown>>;
  count: number;
  range: [number, number] | null;
  orders: Array<[string, { ascending: boolean }]>;
}
const db: FakeDb = { rows: [], count: 0, range: null, orders: [] };

/** Thenable builder mimicking the supabase-js chain used by the route. */
function makeBuilder() {
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.order = (col: string, opts: { ascending: boolean }) => {
    db.orders.push([col, opts]);
    return builder;
  };
  builder.range = (from: number, to: number) => {
    db.range = [from, to];
    return builder;
  };
  (builder as { then: unknown }).then = (onF: (v: unknown) => unknown) =>
    Promise.resolve(onF({ data: db.rows, count: db.count, error: null }));
  return builder;
}

vi.mock('../lib/supabase', () => ({
  createSupabaseAdmin: () => ({ from: () => makeBuilder() }),
}));

import notificationsApp from './notifications';
import { recordNotification } from '../lib/notifications';

const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
  RESEND_API_KEY: 'not-a-real-key',
  APP_URL: 'http://localhost:5173',
  ENVIRONMENT: 'test',
};

/** Response shape of the feed. */
interface FeedBody {
  data: Array<Record<string, unknown>>;
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

beforeEach(() => {
  db.rows = [];
  db.count = 0;
  db.range = null;
  db.orders = [];
});

describe('GET /api/notifications', () => {
  it('serves page 1 as rows 0-14, newest first', async () => {
    db.rows = [
      {
        id: 'n1',
        kind: 'etransfer_received',
        order_id: null,
        order_number: '',
        customer_name: 'JANE DOE',
        amount: '250.50',
        created_at: '2026-09-16T12:00:00.000Z',
      },
      {
        id: 'n2',
        kind: 'order_confirmed',
        order_id: 'o1',
        order_number: 'F0916-126',
        customer_name: 'Jane Doe',
        amount: null,
        created_at: '2026-09-16T11:00:00.000Z',
      },
    ];
    db.count = 2;

    const res = await notificationsApp.request('/', {}, ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as FeedBody;

    expect(db.range).toEqual([0, 14]);
    expect(db.orders[0]).toEqual(['created_at', { ascending: false }]);
    expect(body).toMatchObject({ page: 1, page_size: 15, total: 2, total_pages: 1 });
    expect(body.data[0].amount).toBe(250.5);
    expect(body.data[1].amount).toBeNull();
  });

  it('offsets later pages and rounds total_pages up', async () => {
    db.count = 31;
    const res = await notificationsApp.request('/?page=3', {}, ENV);
    const body = (await res.json()) as FeedBody;
    expect(db.range).toEqual([30, 44]);
    expect(body).toMatchObject({ page: 3, total: 31, total_pages: 3 });
  });

  it('reports one page when there are no alerts at all', async () => {
    const body = (await (await notificationsApp.request('/', {}, ENV)).json()) as FeedBody;
    expect(body).toMatchObject({ data: [], total: 0, total_pages: 1 });
  });

  it.each(['/?page=0', '/?page=abc', '/?page=1.5', '/?page_size=100'])(
    '400 for %s',
    async (path) => {
      const res = await notificationsApp.request(path, {}, ENV);
      expect(res.status).toBe(400);
    }
  );
});

describe('recordNotification', () => {
  it('swallows a PostgREST error', async () => {
    const sb = {
      from: () => ({ insert: async () => ({ error: { message: 'relation does not exist' } }) }),
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      recordNotification(sb as never, { kind: 'order_confirmed', orderId: 'o1' })
    ).resolves.toBeUndefined();
    spy.mockRestore();
  });

  it('swallows a thrown client error', async () => {
    const sb = {
      from: () => ({
        insert: () => {
          throw new Error('network down');
        },
      }),
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      recordNotification(sb as never, { kind: 'etransfer_received', amount: 10 })
    ).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
