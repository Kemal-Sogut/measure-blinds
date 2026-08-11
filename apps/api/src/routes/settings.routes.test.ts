// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Route-level tests for the settings catalog factory, covering the two
 * Curtains catalogs added in migration 30.
 *
 * These pin the contract the Curtains pricing path depends on: the list
 * endpoints exist at the expected paths, and create validates the value
 * column. A pleat multiplier of 0 must be REJECTED — it would zero the
 * whole line — which the shared `price` fragment (min 0) would allow, so
 * pleat_types needs its own positive-only rule.
 *
 * Network is unavailable in CI, so `../lib/supabase` is mocked with a
 * scripted fake client keyed `<table>.<op>`, the same approach
 * `orders.routes.test.ts` uses.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Scripted rows keyed `<table>.<op>`, plus captured insert payloads. */
const db: { responses: Record<string, unknown[]>; inserts: Record<string, unknown[]> } = {
  responses: {},
  inserts: {},
};

/**
 * Minimal thenable supabase-js query-builder stand-in: every chained
 * method returns itself, and awaiting resolves the scripted response for
 * the table/op pair the chain ended up describing.
 */
function makeBuilder(table: string) {
  const state = { table, op: 'select' };
  const builder: Record<string, unknown> = {};
  const chain = (name: string) =>
    ((...args: unknown[]) => {
      if (['insert', 'update', 'delete'].includes(name)) state.op = name;
      if (name === 'insert') (db.inserts[table] ??= []).push(args[0]);
      return builder;
    }) as unknown;
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'order', 'limit']) {
    builder[m] = chain(m);
  }
  const resolve = () => ({ data: db.responses[`${state.table}.${state.op}`] ?? [], error: null });
  builder.single = async () => {
    const r = resolve();
    return { data: (r.data as unknown[])[0] ?? null, error: null };
  };
  builder.maybeSingle = builder.single;
  (builder as { then: unknown }).then = (onFulfilled: (v: unknown) => unknown) =>
    Promise.resolve(onFulfilled(resolve()));
  return builder;
}

vi.mock('../lib/supabase', () => ({
  createSupabaseAdmin: () => ({ from: (table: string) => makeBuilder(table) }),
}));

import settingsApp from './settings';

/** Standard env bindings for app.request. */
const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
  RESEND_API_KEY: 'not-a-real-key',
  APP_URL: 'http://localhost:5173',
  ENVIRONMENT: 'test',
};

/** POSTs a JSON body to one catalog path. */
function post(path: string, body: unknown) {
  return settingsApp.request(
    path,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    ENV
  );
}

beforeEach(() => {
  db.responses = {};
  db.inserts = {};
});

describe('blind-type scoped catalogs', () => {
  /** PUTs a JSON body to one catalog row. */
  function put(path: string, body: unknown) {
    return settingsApp.request(
      path,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      ENV
    );
  }

  const TYPE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

  it('flattens the join embed into blind_type_ids and hides the join table', async () => {
    db.responses['cassette_options.select'] = [
      {
        id: 'cas-1',
        name: 'Standard',
        price_per_m: 20,
        active: true,
        sort_order: 0,
        cassette_option_blind_types: [{ blind_type_id: TYPE }],
      },
    ];
    const res = await settingsApp.request('/cassette-options', {}, ENV);
    expect(res.status).toBe(200);
    const row = ((await res.json()) as { data: Record<string, unknown>[] }).data[0];
    expect(row.blind_type_ids).toEqual([TYPE]);
    expect(row.cassette_option_blind_types).toBeUndefined();
  });

  it('reports an unlinked option as scoped to nothing', async () => {
    db.responses['control_options.select'] = [
      { id: 'ctl-1', name: 'Chain', price_per_item: 0, active: true, sort_order: 0 },
    ];
    const res = await settingsApp.request('/control-options', {}, ENV);
    const row = ((await res.json()) as { data: Record<string, unknown>[] }).data[0];
    expect(row.blind_type_ids).toEqual([]);
  });

  it('writes the links on create', async () => {
    db.responses['cassette_options.insert'] = [{ id: 'cas-9', name: 'New', price_per_m: 5 }];
    const res = await post('/cassette-options', {
      name: 'New',
      price_per_m: 5,
      blind_type_ids: [TYPE],
    });
    expect(res.status).toBe(201);
    expect(db.inserts['cassette_option_blind_types']?.[0]).toEqual([
      { cassette_option_id: 'cas-9', blind_type_id: TYPE },
    ]);
  });

  it('creates without blind_type_ids — an option offered nowhere yet', async () => {
    db.responses['bottom_rail_options.insert'] = [{ id: 'rail-9', name: 'Pear', price_per_m: 0 }];
    const res = await post('/bottom-rail-options', { name: 'Pear', price_per_m: 0 });
    expect(res.status).toBe(201);
    // Nothing inserted into the join table: no links means no rows.
    expect(db.inserts['bottom_rail_option_blind_types']).toBeUndefined();
  });

  it('replaces the links on update', async () => {
    db.responses['installation_options.select'] = [
      { id: 'ins-1', name: 'Rod', price_per_item: 45, active: true, sort_order: 0 },
    ];
    const res = await put('/installation-options/ins-1', { blind_type_ids: [TYPE] });
    expect(res.status).toBe(200);
    expect(db.inserts['installation_option_blind_types']?.[0]).toEqual([
      { installation_option_id: 'ins-1', blind_type_id: TYPE },
    ]);
  });

  it('rejects blind_type_ids on an unscoped catalog', async () => {
    const res = await post('/pleat-types', {
      name: 'Pinch',
      multiplier: 2,
      blind_type_ids: [TYPE],
    });
    expect(res.status).toBe(400);
    expect(db.inserts['pleat_types']).toBeUndefined();
  });
});

describe('pleat types catalog', () => {
  it('lists rows at /pleat-types', async () => {
    db.responses['pleat_types.select'] = [
      { id: 'p1', name: 'Pinch', multiplier: 2.5, active: true, sort_order: 0 },
    ];
    const res = await settingsApp.request('/pleat-types', {}, ENV);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { name: string }[] }).data[0].name).toBe('Pinch');
  });

  it('rejects a zero multiplier', async () => {
    const res = await post('/pleat-types', { name: 'Broken', multiplier: 0 });
    expect(res.status).toBe(400);
    expect(db.inserts['pleat_types']).toBeUndefined();
  });

  it('rejects a negative multiplier', async () => {
    const res = await post('/pleat-types', { name: 'Broken', multiplier: -1 });
    expect(res.status).toBe(400);
    expect(db.inserts['pleat_types']).toBeUndefined();
  });

  it('accepts a positive multiplier', async () => {
    db.responses['pleat_types.insert'] = [
      { id: 'p2', name: 'Regular', multiplier: 2, active: true, sort_order: 0 },
    ];
    const res = await post('/pleat-types', { name: 'Regular', multiplier: 2 });
    expect(res.status).toBe(201);
    expect(db.inserts['pleat_types']?.[0]).toMatchObject({ name: 'Regular', multiplier: 2 });
  });
});

describe('installation options catalog', () => {
  it('lists rows at /installation-options', async () => {
    db.responses['installation_options.select'] = [
      { id: 'i1', name: 'Rod', price_per_item: 0, active: true, sort_order: 0 },
    ];
    const res = await settingsApp.request('/installation-options', {}, ENV);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { name: string }[] }).data[0].name).toBe('Rod');
  });

  it('accepts a zero price, the shipped seed value', async () => {
    db.responses['installation_options.insert'] = [
      { id: 'i2', name: 'Track', price_per_item: 0, active: true, sort_order: 0 },
    ];
    const res = await post('/installation-options', { name: 'Track', price_per_item: 0 });
    expect(res.status).toBe(201);
  });

  it('rejects a negative price', async () => {
    const res = await post('/installation-options', { name: 'Track', price_per_item: -5 });
    expect(res.status).toBe(400);
  });
});
