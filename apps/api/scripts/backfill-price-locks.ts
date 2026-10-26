// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * One-off backfill: freezes every line item that sits on a price-locked
 * order but carries no lock — rows saved before migration 39 added
 * `locked_base_price` / `locked_inputs_fingerprint` without backfilling
 * them.
 *
 * Why it matters: `PUT /api/orders/:id` treats an unlocked item on a
 * locked order as NEW and prices it from today's catalog, so opening an
 * installed order to fix a room name silently re-prices every such item.
 * Freezing them at the price they already carry closes that door, and
 * from then on only a genuine edit to an item's pricing inputs re-prices
 * it — the same rule every post-migration-39 item already follows.
 *
 * It reuses the Worker's own `freezeOrderPrices`, so the frozen figure
 * (the CALCULATED price, `base_unit_price ?? unit_price`) and the
 * fingerprint text are produced by exactly the code that later compares
 * them. Rewriting the fingerprint in SQL would be a second, drift-prone
 * copy of `pricingFingerprint`. No price, total or snapshot column is
 * touched — only the two lock columns of rows where both are null.
 *
 * Usage (from the repo root; reads apps/api/.dev.vars, which points at the
 * live project). The TypeScript is bundled first because the Worker's
 * sources use extensionless imports Node cannot resolve on its own:
 *
 *   apps/api/node_modules/.bin/esbuild apps/api/scripts/backfill-price-locks.ts \
 *     --bundle --platform=node --format=esm --outfile=<tmp>/backfill.mjs
 *   node <tmp>/backfill.mjs            # dry run: lists what would freeze
 *   node <tmp>/backfill.mjs --apply    # writes the locks, then re-checks
 *
 * Idempotent: `freezeOrderPrices` only touches rows whose lock is null, so
 * a second run finds nothing to do.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { freezeOrderPrices } from '../src/lib/priceLockStore';

/**
 * The statuses whose prices are frozen — a copy of `PRICE_LOCKED` in
 * `src/routes/orders.ts`, which is not importable here (it lives inside
 * the route module). `expired` is included: a lapsed estimate was sent,
 * and only reviving it to `draft` releases its locks.
 */
const PRICE_LOCKED = ['sent', 'expired', 'awaiting_payment', 'in_progress', 'ready', 'installed'];

/** Parses simple KEY=VALUE env files (comments and blank lines ignored). */
function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

/** One line item as this script needs to see it. */
interface ItemRow {
  id: string;
  item_type: string;
  unit_price: number | string | null;
  base_unit_price: number | string | null;
  locked_base_price: number | string | null;
}

/** One affected order and the items that would be frozen on it. */
interface Affected {
  id: string;
  order_number: string | null;
  status: string;
  unlocked: ItemRow[];
}

/** Finds every locked-status order that still has an unlocked item. */
async function findAffected(sb: ReturnType<typeof createClient>): Promise<Affected[]> {
  const { data, error } = await sb
    .from('orders')
    .select('id, order_number, status, line_items(id, item_type, unit_price, base_unit_price, locked_base_price)')
    .in('status', PRICE_LOCKED);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[])
    .map((o) => ({
      id: String(o.id),
      order_number: (o.order_number as string | null) ?? null,
      status: String(o.status),
      unlocked: ((o.line_items ?? []) as ItemRow[]).filter((li) => li.locked_base_price === null),
    }))
    .filter((o) => o.unlocked.length > 0);
}

/** Prints what would be (or was) frozen, one order per block. */
function report(affected: Affected[]): void {
  const items = affected.reduce((n, o) => n + o.unlocked.length, 0);
  console.log(`${affected.length} order(s), ${items} unlocked item(s):`);
  for (const o of affected) {
    console.log(`  ${o.order_number ?? o.id}  [${o.status}]`);
    for (const li of o.unlocked) {
      const base = Number(li.base_unit_price ?? li.unit_price ?? 0).toFixed(2);
      console.log(`    ${li.id}  ${li.item_type.padEnd(6)}  freeze at $${base}`);
    }
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const vars = parseEnvFile(resolve(process.cwd(), 'apps/api/.dev.vars'));
  if (!vars.SUPABASE_URL || !vars.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('apps/api/.dev.vars needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }
  const sb = createClient(vars.SUPABASE_URL, vars.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const affected = await findAffected(sb);
  report(affected);
  if (affected.length === 0 || !apply) {
    if (!apply && affected.length > 0) console.log('\nDry run — re-run with --apply to write the locks.');
    return;
  }

  let failures = 0;
  for (const o of affected) {
    const err = await freezeOrderPrices(sb as never, o.id);
    if (err) {
      failures++;
      console.error(`  FAILED ${o.order_number ?? o.id}: ${err}`);
    }
  }
  const left = await findAffected(sb);
  console.log(`\nApplied. ${failures} order(s) failed; ${left.length} order(s) still unlocked.`);
  if (failures > 0 || left.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
