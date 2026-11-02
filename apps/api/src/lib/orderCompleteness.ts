// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * The Worker's DB-facing side of the incomplete-item rule (spec
 * 2026-11-02). `lib/lineItemCompleteness.ts` decides; this module feeds
 * it stored rows and today's slot scoping, for three callers:
 *   - the gates on every route that takes an order OUT of draft (send,
 *     mark-sent, confirm, a status move to sent+, the PDF) — each runs
 *     ONLY while the order is currently a draft, so a sent or confirmed
 *     order is never re-judged against a later Settings change;
 *   - the detail reads, which annotate a draft's lines with
 *     `missing_fields` and the order with `incomplete_items` for the
 *     Present view;
 *   - the list reads, which attach `incomplete_items` to every draft so
 *     a list shows "Incomplete" instead of a partial total.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { loadSlotScoping } from './optionScoping';
import {
  countIncomplete,
  firstIncompleteMessage,
  missingFields,
  type CompletenessInput,
} from './lineItemCompleteness';

/**
 * The columns the rule reads. Literal strings (not built), because
 * supabase-js parses the select string at the type level.
 */
const COLUMNS =
  'item_type, position, room_name, blinds_type, panels, height_cm, material_id, cassette_id, bottom_rail_id, control_id, installation_id, attributes';
const LIST_COLUMNS =
  'order_id, item_type, position, room_name, blinds_type, panels, height_cm, material_id, cassette_id, bottom_rail_id, control_id, installation_id, attributes';

/** The blind-type names a scoping load needs; flat items contribute none. */
function blindTypesOf(items: readonly CompletenessInput[]): string[] {
  return items.flatMap((it) => (it.item_type === 'blind' ? [String(it.blinds_type ?? '')] : []));
}

/**
 * The first incomplete item's message for rows already in hand (the
 * order bundle the PDF and send routes load), or null. Costs no query
 * when no row is a blind.
 */
export async function incompleteMessageFor(
  sb: SupabaseClient,
  items: readonly CompletenessInput[]
): Promise<string | null> {
  if (!items.some((it) => it.item_type === 'blind')) return null;
  const scope = await loadSlotScoping(sb, blindTypesOf(items));
  return firstIncompleteMessage(items, scope);
}

/**
 * As {@link incompleteMessageFor}, reading the order's rows itself —
 * for routes that load only the order's status (mark-sent, confirm,
 * status). Rows come back in `position` order, matching "Item N".
 *
 * @throws Error when the read fails, so the caller fails the transition
 *         rather than letting an unchecked order through.
 */
export async function loadIncompleteMessage(
  sb: SupabaseClient,
  orderId: string
): Promise<string | null> {
  const { data, error } = await sb
    .from('line_items')
    .select(COLUMNS)
    .eq('order_id', orderId)
    .order('position');
  if (error) throw new Error(error.message);
  return incompleteMessageFor(sb, (data ?? []) as unknown as CompletenessInput[]);
}

/**
 * Mutates a detail-read order: every line gets `missing_fields` and the
 * order gets `incomplete_items`. Only a draft can hold an incomplete
 * item, so any other status gets `[]` / `0` with no query.
 */
export async function annotateOrderCompleteness(
  sb: SupabaseClient,
  order: Record<string, unknown>
): Promise<void> {
  const lines = (order.line_items ?? []) as Record<string, unknown>[];
  if (order.status !== 'draft' || !lines.some((l) => l.item_type === 'blind')) {
    for (const line of lines) line.missing_fields = [];
    order.incomplete_items = 0;
    return;
  }
  const items = lines as unknown as CompletenessInput[];
  const scope = await loadSlotScoping(sb, blindTypesOf(items));
  for (const line of lines) {
    line.missing_fields = missingFields(line as unknown as CompletenessInput, scope);
  }
  order.incomplete_items = countIncomplete(items, scope);
}

/** Order ids per `line_items` read, so the `in.(...)` list never overflows the URL. */
const ID_CHUNK = 100;

/** PostgREST's default response cap; a page of exactly this many rows may have a successor. */
const PAGE_SIZE = 1000;

/**
 * Mutates list rows: each gets `incomplete_items` — counted for drafts
 * from their `line_items` plus one scoping load, `0` for every other
 * status. Hidden items count (the badge means "cannot be sent yet").
 *
 * The item read is bounded on both axes. Draft ids go out in chunks of
 * {@link ID_CHUNK} (`/grouped` can list 500 orders, and a long `in.(...)`
 * overflows the URL), and each chunk is paged with `range` in
 * {@link PAGE_SIZE} rows (PostgREST silently truncates a response at
 * 1000 rows, which would UNDERCOUNT). Pages use a stable
 * `order_id, position` order so none repeats or skips a row.
 *
 * @throws Error when any read fails, so the list fails loudly rather
 *         than showing a total that omits an incomplete item.
 */
export async function attachIncompleteCounts(
  sb: SupabaseClient,
  orders: Record<string, unknown>[]
): Promise<void> {
  for (const o of orders) o.incomplete_items = 0;
  const draftIds = orders.filter((o) => o.status === 'draft').map((o) => String(o.id));
  if (draftIds.length === 0) return;
  const rows: (CompletenessInput & { order_id: string })[] = [];
  for (let i = 0; i < draftIds.length; i += ID_CHUNK) {
    const chunk = draftIds.slice(i, i + ID_CHUNK);
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await sb
        .from('line_items')
        .select(LIST_COLUMNS)
        .in('order_id', chunk)
        .order('order_id')
        .order('position')
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      const page = (data ?? []) as unknown as (CompletenessInput & { order_id: string })[];
      rows.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
  }
  if (!rows.some((r) => r.item_type === 'blind')) return;
  const scope = await loadSlotScoping(sb, blindTypesOf(rows));
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (missingFields(row, scope).length > 0) counts.set(row.order_id, (counts.get(row.order_id) ?? 0) + 1);
  }
  for (const o of orders) o.incomplete_items = counts.get(String(o.id)) ?? 0;
}
