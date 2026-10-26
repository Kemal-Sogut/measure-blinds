// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins the revision-cutting rules of `stampSent`: a revision is written
 * on the first send, and on a later overwrite only when something
 * customer-visible changed; a `fill` never adds to existing history; a
 * failed stamp writes nothing; and the staff-only `source` copy never
 * rides along on an ordinary revision read.
 *
 * Uses a small in-memory fake of the three tables involved
 * (`orders`, `line_items`, `order_revisions`) rather than scripted
 * results, so the real `stampQuotedFigures` runs against it and the
 * `quoted_total === latest revision total` invariant is observable.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stampSent,
  readLatestRevision,
  readRevisionSource,
  pendingChanges,
  listRevisions,
  revisionDetailFields,
  type RevisionSource,
} from './orderRevisions';

type Row = Record<string, unknown>;
interface Db {
  orders: Row[];
  line_items: Row[];
  order_revisions: Row[];
}

let db: Db;
/** Table.op combinations that fail with the given error. */
let failures: Record<string, { message: string; code?: string }>;
/** Every `select` column list used against order_revisions. */
let revisionSelects: string[];

/**
 * In-memory Supabase fake: supports select (with `line_items(*)` embed),
 * insert, update, `eq`, `order`, `limit`, `maybeSingle`, as awaited
 * directly or via `maybeSingle`.
 */
function fakeSb(): SupabaseClient {
  return {
    from(table: keyof Db) {
      let op: 'select' | 'insert' | 'update' = 'select';
      let columns = '*';
      let payload: Row = {};
      const filters: Array<[string, unknown]> = [];
      let orderBy: { col: string; ascending: boolean } | null = null;
      let max: number | null = null;

      const run = (): { data: unknown; error: { message: string; code?: string } | null } => {
        const failure = failures[`${table}.${op}`];
        if (failure) return { data: null, error: failure };
        const matches = db[table].filter((r) => filters.every(([k, v]) => r[k] === v));
        if (op === 'insert') {
          const dup = db[table].some(
            (r) => r.order_id === payload.order_id && r.rev_no === payload.rev_no
          );
          if (table === 'order_revisions' && dup) {
            return { data: null, error: { message: 'duplicate key', code: '23505' } };
          }
          db[table].push({ id: `rev-${db[table].length + 1}`, ...payload });
          return { data: null, error: null };
        }
        if (op === 'update') {
          matches.forEach((r) => Object.assign(r, payload));
          return { data: null, error: null };
        }
        if (table === 'order_revisions') revisionSelects.push(columns);
        let rows = matches.map((r) => ({ ...r }));
        if (orderBy) {
          const { col, ascending } = orderBy;
          rows.sort((a, b) => ((a[col] as number) - (b[col] as number)) * (ascending ? 1 : -1));
        }
        if (max !== null) rows = rows.slice(0, max);
        if (columns !== '*' && !columns.includes('(')) {
          const wanted = columns.split(',').map((c) => c.trim());
          rows = rows.map((r) => Object.fromEntries(wanted.map((c) => [c, r[c]])));
        }
        if (table === 'orders' && columns.includes('line_items(')) {
          rows = rows.map((o) => ({
            ...o,
            line_items: db.line_items
              .filter((li) => li.order_id === o.id)
              .sort((a, b) => (a.position as number) - (b.position as number))
              .map((li) => ({ ...li })),
          }));
        }
        return { data: rows, error: null };
      };

      const b: Record<string, unknown> = {};
      b.select = (cols = '*') => {
        columns = cols;
        return b;
      };
      b.insert = (row: Row) => {
        op = 'insert';
        payload = row;
        return b;
      };
      b.update = (row: Row) => {
        op = 'update';
        payload = row;
        return b;
      };
      b.eq = (k: string, v: unknown) => {
        filters.push([k, v]);
        return b;
      };
      b.order = (col: string, opts?: { ascending?: boolean; referencedTable?: string }) => {
        if (!opts?.referencedTable) orderBy = { col, ascending: opts?.ascending ?? true };
        return b;
      };
      b.limit = (n: number) => {
        max = n;
        return b;
      };
      b.maybeSingle = async () => {
        const res = run();
        return { ...res, data: Array.isArray(res.data) ? (res.data[0] ?? null) : res.data };
      };
      (b as { then: unknown }).then = (ok: (v: unknown) => unknown) => Promise.resolve(ok(run()));
      return b;
    },
  } as unknown as SupabaseClient;
}

/** A sent order with one visible and one hidden item, both price-locked. */
function seed(): void {
  db = {
    orders: [
      {
        id: 'o1',
        title: 'Option A',
        order_date: '2026-10-01',
        expiry_date: '2026-11-01',
        subtotal: 1000,
        discount_type: 'percent',
        discount_value: 5,
        discount_amount: 50,
        taxable_amount: 950,
        tax_rate: 13,
        tax_amount: 123.5,
        total: 1073.5,
        terms_snapshot: 'Net 30',
        quoted_total: null,
      },
      { id: 'o2', total: 1, quoted_total: null },
    ],
    line_items: [
      {
        id: 'l1',
        order_id: 'o1',
        position: 0,
        uid: 'u1',
        item_type: 'blind',
        room_name: 'Kitchen',
        blinds_type: 'roller',
        panels: 1,
        height_cm: 150,
        quantity: 1,
        unit_price: 1000,
        base_unit_price: 1000,
        line_total: 1000,
        hidden: false,
        locked_base_price: 1000,
        quoted_base_price: null,
        attributes: { secret: 'internal' },
      },
      {
        id: 'l2',
        order_id: 'o1',
        position: 1,
        uid: 'u2',
        item_type: 'blind',
        room_name: 'Hall',
        blinds_type: 'roller',
        quantity: 1,
        unit_price: 80,
        base_unit_price: 80,
        line_total: 80,
        hidden: true,
        locked_base_price: 80,
        quoted_base_price: null,
      },
    ],
    order_revisions: [],
  };
}

const revisionsOf = (orderId: string) =>
  db.order_revisions.filter((r) => r.order_id === orderId);

beforeEach(() => {
  seed();
  failures = {};
  revisionSelects = [];
});

describe('stampSent', () => {
  it('creates Rev 1 on the first overwrite', async () => {
    expect(await stampSent(fakeSb(), 'o1', 'overwrite', 'email')).toBeNull();
    const revs = revisionsOf('o1');
    expect(revs).toHaveLength(1);
    expect(revs[0]).toMatchObject({ rev_no: 1, source_kind: 'email', total: 1073.5 });
    expect((revs[0].snapshot as { line_items: unknown[] }).line_items).toHaveLength(1);
  });

  it('writes no revision when nothing customer-visible changed', async () => {
    await stampSent(fakeSb(), 'o1', 'overwrite', 'email');
    expect(await stampSent(fakeSb(), 'o1', 'overwrite', 'email')).toBeNull();
    expect(revisionsOf('o1')).toHaveLength(1);
  });

  it('creates Rev 2 when an item height changed', async () => {
    await stampSent(fakeSb(), 'o1', 'overwrite', 'email');
    db.line_items[0].height_cm = 180;
    expect(await stampSent(fakeSb(), 'o1', 'overwrite', 'manual')).toBeNull();
    const revs = revisionsOf('o1');
    expect(revs.map((r) => r.rev_no)).toEqual([1, 2]);
    expect(revs[1].source_kind).toBe('manual');
  });

  it('fill creates Rev 1 only when there is none', async () => {
    await stampSent(fakeSb(), 'o1', 'fill', 'stage');
    expect(revisionsOf('o1')).toHaveLength(1);
    db.line_items[0].height_cm = 180;
    expect(await stampSent(fakeSb(), 'o1', 'fill', 'stage')).toBeNull();
    expect(revisionsOf('o1')).toHaveLength(1);
  });

  it('keeps quoted_total equal to the new revision total', async () => {
    await stampSent(fakeSb(), 'o1', 'overwrite', 'email');
    db.orders[0].total = 1200;
    db.line_items[0].line_total = 1126.5;
    await stampSent(fakeSb(), 'o1', 'overwrite', 'email');
    const latest = await readLatestRevision(fakeSb(), 'o1');
    expect(latest?.rev_no).toBe(2);
    expect(latest?.total).toBe(1200);
    expect(db.orders[0].quoted_total).toBe(latest?.total);
  });

  it('writes no revision when the stamp fails', async () => {
    failures['orders.update'] = { message: 'stamp boom' };
    expect(await stampSent(fakeSb(), 'o1', 'overwrite', 'email')).toBe('stamp boom');
    expect(revisionsOf('o1')).toHaveLength(0);
  });

  it('stores source with hidden items, uids and lock columns', async () => {
    await stampSent(fakeSb(), 'o1', 'overwrite', 'email');
    const source = revisionsOf('o1')[0].source as RevisionSource;
    expect(source.order).toEqual({ title: 'Option A', discount_type: 'percent', discount_value: 5 });
    expect(source.line_items).toHaveLength(2);
    expect(source.line_items.map((li) => li.uid)).toEqual(['u1', 'u2']);
    expect(source.line_items.every((li) => li.locked_base_price !== undefined)).toBe(true);
    expect(source.line_items[0].locked_base_price).toBe(1000);
    expect(source.line_items[1].hidden).toBe(true);
  });

  it('treats a unique violation on insert as success', async () => {
    failures['order_revisions.insert'] = { message: 'duplicate key', code: '23505' };
    expect(await stampSent(fakeSb(), 'o1', 'overwrite', 'email')).toBeNull();
  });

  it('returns any other insert error', async () => {
    failures['order_revisions.insert'] = { message: 'disk full' };
    expect(await stampSent(fakeSb(), 'o1', 'overwrite', 'email')).toBe('disk full');
  });
});

describe('readRevisionSource', () => {
  it('returns null for a revision of another order', async () => {
    await stampSent(fakeSb(), 'o1', 'overwrite', 'email');
    const id = revisionsOf('o1')[0].id as string;
    expect(await readRevisionSource(fakeSb(), 'o2', id)).toBeNull();
    const own = await readRevisionSource(fakeSb(), 'o1', id);
    expect(own?.rev_no).toBe(1);
    expect(own?.source.line_items).toHaveLength(2);
  });
});

describe('readLatestRevision', () => {
  it('never selects the staff-only source column', async () => {
    await stampSent(fakeSb(), 'o1', 'overwrite', 'email');
    revisionSelects = [];
    const latest = await readLatestRevision(fakeSb(), 'o1');
    expect(latest).not.toHaveProperty('source');
    expect(revisionSelects.length).toBeGreaterThan(0);
    for (const cols of revisionSelects) {
      expect(cols).not.toBe('*');
      expect(cols.split(',').map((c) => c.trim())).not.toContain('source');
    }
  });
});

describe('pendingChanges', () => {
  it('reports no revision for a never-sent order', async () => {
    expect(await pendingChanges(fakeSb(), 'o1')).toEqual({ latest: null, changes: [] });
  });

  it('lists what changed since the latest revision', async () => {
    await stampSent(fakeSb(), 'o1', 'overwrite', 'email');
    db.line_items[0].height_cm = 180;
    const { latest, changes } = await pendingChanges(fakeSb(), 'o1');
    expect(latest?.rev_no).toBe(1);
    expect(changes.length).toBeGreaterThan(0);
  });
});

describe('listRevisions', () => {
  it('lists summaries newest first with neither snapshot nor source', async () => {
    await stampSent(fakeSb(), 'o1', 'overwrite', 'email');
    db.line_items[0].height_cm = 180;
    await stampSent(fakeSb(), 'o1', 'overwrite', 'manual');
    const res = await listRevisions(fakeSb(), 'o1');
    if (!('rows' in res)) throw new Error(res.error);
    expect(res.rows.map((r) => r.rev_no)).toEqual([2, 1]);
    expect(Object.keys(res.rows[0]).sort()).toEqual(
      ['id', 'rev_no', 'sent_at', 'source_kind', 'total'].sort()
    );
    expect(res.rows[0].source_kind).toBe('manual');
  });

  it('returns an empty list for an order never sent, not an error', async () => {
    expect(await listRevisions(fakeSb(), 'o1')).toEqual({ rows: [] });
  });

  it('returns the database error instead of an empty list', async () => {
    failures['order_revisions.select'] = { message: 'relation does not exist' };
    expect(await listRevisions(fakeSb(), 'o1')).toEqual({ error: 'relation does not exist' });
  });
});

describe('revisionDetailFields', () => {
  it('carries the history and the described unsent changes', async () => {
    await stampSent(fakeSb(), 'o1', 'overwrite', 'email');
    db.line_items[0].height_cm = 180;
    const out = await revisionDetailFields(fakeSb(), 'o1', true);
    expect(out.revisions).toHaveLength(1);
    expect(out.unsent_changes).toEqual(expect.arrayContaining([expect.stringContaining('180 cm')]));
  });

  it('reports no unsent changes as an empty list, not null', async () => {
    await stampSent(fakeSb(), 'o1', 'overwrite', 'email');
    expect((await revisionDetailFields(fakeSb(), 'o1', true)).unsent_changes).toEqual([]);
  });

  it('nulls unsent_changes without a price lock but keeps the history', async () => {
    await stampSent(fakeSb(), 'o1', 'overwrite', 'email');
    db.line_items[0].height_cm = 180;
    const out = await revisionDetailFields(fakeSb(), 'o1', false);
    expect(out.unsent_changes).toBeNull();
    expect(out.revisions).toHaveLength(1);
  });

  it('nulls unsent_changes for an order with no revision', async () => {
    const out = await revisionDetailFields(fakeSb(), 'o1', true);
    expect(out).toEqual({ revisions: [], unsent_changes: null });
  });

  it('nulls both fields when the revision read fails', async () => {
    failures['order_revisions.select'] = { message: 'boom' };
    expect(await revisionDetailFields(fakeSb(), 'o1', true)).toEqual({
      revisions: null,
      unsent_changes: null,
    });
  });

  it('nulls both fields when the live-order read fails after the history read', async () => {
    await stampSent(fakeSb(), 'o1', 'overwrite', 'email');
    failures['orders.select'] = { message: 'boom' };
    expect(await revisionDetailFields(fakeSb(), 'o1', true)).toEqual({
      revisions: null,
      unsent_changes: null,
    });
  });
});
