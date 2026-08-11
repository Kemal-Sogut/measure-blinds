// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Unit tests for `optionScoping.ts` — the module that decides which
 * hardware slots a blind type uses.
 *
 * The rule under test is "ACTIVE **and** linked": an option that is
 * linked to a type but deactivated must not keep that type's slot alive,
 * or the form would demand a choice with nothing to choose from. The
 * unknown-type case is equally load-bearing — every order saved before
 * the blind-type dropdown existed carries free text in `blinds_type`, and
 * treating those as constrained would make them unsavable forever.
 *
 * Backed by the same scripted fake Supabase client the route tests use
 * (network is unavailable in CI): every awaited query resolves the rows
 * registered under `<table>.<op>`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadSlotScoping } from './optionScoping';

/** Scripted rows keyed `<table>.<op>`, plus a log of resolved queries. */
const db: { responses: Record<string, unknown[]>; calls: string[] } = {
  responses: {},
  calls: [],
};

/**
 * Minimal thenable query builder mimicking the supabase-js chain: every
 * chained method returns `this`, and awaiting resolves the scripted rows
 * for the table/op pair. Filters (`eq`/`in`) are deliberately NOT applied
 * — the module must not depend on Postgres to enforce a rule the tests
 * are asserting.
 */
function makeBuilder(table: string) {
  const state = { table, op: 'select' };
  const builder: Record<string, unknown> = {};
  const chain = (name: string) =>
    ((..._args: unknown[]) => {
      if (['insert', 'update', 'delete'].includes(name)) state.op = name;
      return builder;
    }) as unknown;
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'order', 'limit']) {
    builder[m] = chain(m);
  }
  (builder as { then: unknown }).then = (onFulfilled: (v: unknown) => unknown) => {
    const key = `${state.table}.${state.op}`;
    db.calls.push(key);
    return Promise.resolve(onFulfilled({ data: db.responses[key] ?? [], error: null }));
  };
  return builder;
}

/** A stand-in for the service-role client the Worker hands the module. */
function sb(): SupabaseClient {
  return { from: (table: string) => makeBuilder(table) } as unknown as SupabaseClient;
}

const ROLLER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const CURTAINS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';

describe('loadSlotScoping', () => {
  beforeEach(() => {
    db.calls = [];
    db.responses = {
      'blind_types.select': [
        { id: ROLLER, name: 'Roller' },
        { id: CURTAINS, name: 'Curtains' },
      ],
      'cassette_options.select': [
        { id: 'cas-1', active: true },
        { id: 'cas-2', active: false },
      ],
      'bottom_rail_options.select': [{ id: 'rail-1', active: true }],
      'control_options.select': [{ id: 'ctl-1', active: true }],
      'installation_options.select': [{ id: 'ins-1', active: true }],
      'cassette_option_blind_types.select': [
        { cassette_option_id: 'cas-1', blind_type_id: ROLLER },
      ],
      'bottom_rail_option_blind_types.select': [
        { bottom_rail_option_id: 'rail-1', blind_type_id: ROLLER },
      ],
      'control_option_blind_types.select': [
        { control_option_id: 'ctl-1', blind_type_id: ROLLER },
        { control_option_id: 'ctl-1', blind_type_id: CURTAINS },
      ],
      'installation_option_blind_types.select': [
        { installation_option_id: 'ins-1', blind_type_id: CURTAINS },
      ],
    };
  });

  it('reports a slot in use when an active option is linked', async () => {
    const scoping = await loadSlotScoping(sb(), ['Roller']);
    expect(scoping.isKnownType('Roller')).toBe(true);
    expect(scoping.usesSlot('Roller', 'cassette')).toBe(true);
    expect(scoping.usesSlot('Roller', 'bottom_rail')).toBe(true);
    expect(scoping.usesSlot('Roller', 'control')).toBe(true);
    expect(scoping.usesSlot('Roller', 'installation')).toBe(false);
  });

  it('reports a slot unused when only INACTIVE options are linked', async () => {
    db.responses['cassette_option_blind_types.select'] = [
      { cassette_option_id: 'cas-2', blind_type_id: ROLLER },
    ];
    const scoping = await loadSlotScoping(sb(), ['Roller']);
    expect(scoping.usesSlot('Roller', 'cassette')).toBe(false);
  });

  it('scopes per blind type', async () => {
    const scoping = await loadSlotScoping(sb(), ['Roller', 'Curtains']);
    expect(scoping.usesSlot('Curtains', 'cassette')).toBe(false);
    expect(scoping.usesSlot('Curtains', 'bottom_rail')).toBe(false);
    expect(scoping.usesSlot('Curtains', 'control')).toBe(true);
    expect(scoping.usesSlot('Curtains', 'installation')).toBe(true);
  });

  it('treats an unknown legacy type name as unconstrained', async () => {
    const scoping = await loadSlotScoping(sb(), ['Venetian (legacy)']);
    expect(scoping.isKnownType('Venetian (legacy)')).toBe(false);
    expect(scoping.usesSlot('Venetian (legacy)', 'cassette')).toBe(false);
    expect(scoping.usesSlot('Venetian (legacy)', 'control')).toBe(false);
  });

  it('issues no queries at all when there are no blind items', async () => {
    const scoping = await loadSlotScoping(sb(), []);
    expect(db.calls).toEqual([]);
    expect(scoping.isKnownType('Roller')).toBe(false);
  });

  it('ignores blank type names — a blind saved before the dropdown', async () => {
    await loadSlotScoping(sb(), ['', '']);
    expect(db.calls).toEqual([]);
  });
});
