// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Route-level tests for the customers module against a scripted fake
 * Supabase client. The subject here is the CREATE contract, which
 * changed on 2026-08-01: first and last name became optional so a
 * customer can be entered from a phone number alone.
 *
 * What these pin:
 *   - a customer with only an email, only a phone, or only one name is
 *     accepted (the previous schema 400'd all three)
 *   - a create with no identifying field at all is still refused, and
 *     with a sentence the form can show verbatim — the refinement has an
 *     empty issue path, so this also covers `firstZodIssue`'s carve-out
 *   - `.strict()` still rejects unknown fields (client-supplied columns
 *     must never be silently accepted)
 *   - the UPDATE schema stays unrefined, so an address-only PATCH is not
 *     forced to restate an identifier it is not touching
 *
 * Auth is not exercised: `requireAuth` is applied in `index.ts`, so
 * requests made directly against this sub-app are already past it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Rows returned per `<table>.<op>` key, plus a record of insert payloads. */
interface FakeDb {
  responses: Record<string, unknown[]>;
  insertPayloads: Record<string, unknown[]>;
}
const db: FakeDb = { responses: {}, insertPayloads: {} };

/**
 * Minimal thenable builder mimicking the supabase-js chain: every
 * chained method returns `this`, and awaiting resolves the scripted rows
 * for the table/op pair. Filters are ignored — these tests are about
 * schema validation, which runs before any query is built.
 */
function makeBuilder(table: string) {
  const state = { table, op: 'select' };
  const builder: Record<string, unknown> = {};
  const chain = (name: string) =>
    ((...args: unknown[]) => {
      if (['insert', 'update', 'delete'].includes(name)) state.op = name;
      if (name === 'insert') (db.insertPayloads[state.table] ??= []).push(args[0]);
      return builder;
    }) as unknown;
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'is', 'or', 'order', 'limit']) {
    builder[m] = chain(m);
  }
  const resolve = () => ({ data: db.responses[`${state.table}.${state.op}`] ?? [], error: null });
  builder.single = async () => {
    const r = resolve();
    return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: null };
  };
  builder.maybeSingle = builder.single;
  (builder as { then: unknown }).then = (onFulfilled: (v: unknown) => unknown) =>
    Promise.resolve(onFulfilled(resolve()));
  return builder;
}

vi.mock('../lib/supabase', () => ({
  createSupabaseAdmin: () => ({ from: (table: string) => makeBuilder(table) }),
}));

import customersApp from './customers';

const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
  RESEND_API_KEY: 'not-a-real-key',
  APP_URL: 'http://localhost:5173',
  ENVIRONMENT: 'test',
};

const CUSTOMER = { id: 'c1', first_name: '', last_name: '', email: '', phone: '' };

beforeEach(() => {
  db.insertPayloads = {};
  db.responses = {
    'customers.insert': [CUSTOMER],
    'customers.update': [CUSTOMER],
    'customers.select': [CUSTOMER],
  };
});

/** Sends a JSON body to the customers sub-app. */
const send = (path: string, method: string, body: unknown) =>
  customersApp.request(
    path,
    { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } },
    ENV
  );

describe('POST /api/customers validation', () => {
  it('accepts a customer with an email and no names', async () => {
    const res = await send('/', 'POST', { first_name: '', last_name: '', email: 'a@b.com' });
    expect(res.status).toBe(201);
  });

  it('accepts a customer with a phone and no names', async () => {
    const res = await send('/', 'POST', { first_name: '', last_name: '', phone: '4165550100' });
    expect(res.status).toBe(201);
  });

  it('accepts a first name alone', async () => {
    const res = await send('/', 'POST', { first_name: 'Ada' });
    expect(res.status).toBe(201);
  });

  it('accepts a last name alone', async () => {
    const res = await send('/', 'POST', { last_name: 'Lovelace' });
    expect(res.status).toBe(201);
  });

  it('rejects a create with no identifying field at all', async () => {
    const res = await send('/', 'POST', { first_name: '', last_name: '', email: '', phone: '' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Enter a name, email or phone number.');
  });

  it('rejects a create whose only fields are whitespace', async () => {
    const res = await send('/', 'POST', { first_name: '  ', last_name: ' ' });
    expect(res.status).toBe(400);
  });

  it('still rejects client-supplied unknown fields', async () => {
    const res = await send('/', 'POST', { first_name: 'Ada', nickname: 'A' });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/customers/:id validation', () => {
  it('accepts an address-only update with no identifying field', async () => {
    const res = await send('/c1', 'PUT', { shipping_city: 'Toronto' });
    expect(res.status).toBe(200);
  });

  it('accepts blanking both names on an existing customer', async () => {
    const res = await send('/c1', 'PUT', { first_name: '', last_name: '' });
    expect(res.status).toBe(200);
  });
});
