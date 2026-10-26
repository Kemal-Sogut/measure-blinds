// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Diff of two customer-visible quotes ({@link PublicQuote}) into a short
 * list of human-readable changes — the "what changed since the last sent
 * version" shown to staff (revision banner) and to the customer (updated
 * estimate email).
 *
 * Pure and read-only: it compares the formatted, customer-visible values
 * of two already-sanitized quotes, so a change it reports is always one
 * the customer could actually see. Fields the customer never sees (cost
 * columns, raw attributes, hidden items) are absent from {@link PublicQuote}
 * and therefore can never appear here. Money is never computed — only
 * formatted from the stored, server-computed figures (AI_GUIDELINES rule 1).
 */

import type { PublicQuote, PublicQuoteLine } from './publicQuote';

/**
 * One difference between a sent quote and a live quote.
 *
 * - `item_added` / `item_removed`: a line exists on only one side
 *   (hiding an item after send counts as removed, un-hiding as added,
 *   because hidden items are not part of a {@link PublicQuote}).
 * - `item_changed`: a line on both sides differs in one field; `from` and
 *   `to` are already formatted for display (e.g. `150 cm`, `$312.00`).
 * - `order_changed`: an order-level field differs. For `Terms` the values
 *   are the literal `"updated"` so the long text is never quoted.
 */
export type QuoteChange =
  | { kind: 'item_added' | 'item_removed'; item: string }
  | { kind: 'item_changed'; item: string; field: string; from: string; to: string }
  | { kind: 'order_changed'; field: string; from: string; to: string };

/** Shown for a null, empty or missing value so a change never reads blank. */
const EMPTY = '—';

/**
 * Formats a dollar amount as `$1,234.00` (comma thousands, two decimals),
 * matching the money format of the customer emails.
 */
function money(value: number): string {
  return `$${value.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Formats a free-text/pass-through value, mapping null/empty to {@link EMPTY}. */
function text(value: unknown): string {
  if (value === null || value === undefined) return EMPTY;
  const s = String(value).trim();
  return s === '' ? EMPTY : s;
}

/** Formats a length in centimetres, e.g. `150 cm`; empty values become {@link EMPTY}. */
function cm(value: unknown): string {
  const t = text(value);
  return t === EMPTY ? EMPTY : `${t} cm`;
}

/**
 * Formats the per-panel widths (cm) as `120 + 80 cm`; a single panel is
 * `120 cm`. A bare number (older rows) is treated as one panel.
 */
function widths(value: unknown): string {
  const list = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
  const parts = list.map((w) => text(w)).filter((w) => w !== EMPTY);
  return parts.length === 0 ? EMPTY : `${parts.join(' + ')} cm`;
}

/** Joins a list with `, `, or {@link EMPTY} when it has no entries. */
function list(values: string[]): string {
  return values.length === 0 ? EMPTY : values.join(', ');
}

/**
 * Builds the human label that identifies a line in a change message.
 *
 * @param line The quote line to name.
 * @param index The line's zero-based position in the quote it comes from
 *   (live quote for added/changed, sent quote for removed); only used for
 *   the `Item N` fallback.
 * @returns `room_name`, else `title`, else `description`, else
 *   `Item ${index + 1}`, followed by ` — ${blinds_type}` when the type is set.
 */
export function itemLabel(line: PublicQuoteLine, index: number): string {
  const name = [line.room_name, line.title, line.description]
    .map((v) => text(v))
    .find((v) => v !== EMPTY) ?? `Item ${index + 1}`;
  const type = text(line.blinds_type);
  return type === EMPTY ? name : `${name} — ${type}`;
}

/** The compared line fields: display label plus a formatter of the stored value. */
const LINE_FIELDS: { label: string; format: (l: PublicQuoteLine) => string }[] = [
  { label: 'Type', format: (l) => text(l.blinds_type) },
  { label: 'Width', format: (l) => widths(l.panels) },
  { label: 'Height', format: (l) => cm(l.height_cm) },
  { label: 'Fabric', format: (l) => text(l.material_name) },
  { label: 'Cassette', format: (l) => text(l.cassette_name) },
  { label: 'Bottom rail', format: (l) => text(l.bottom_rail_name) },
  { label: 'Control', format: (l) => text(l.control_name) },
  { label: 'Installation', format: (l) => text(l.installation_name) },
  { label: 'Colour', format: (l) => text(l.color) },
  { label: 'Title', format: (l) => text(l.title) },
  { label: 'Description', format: (l) => text(l.description) },
  { label: 'Note', format: (l) => text(l.note) },
  { label: 'Qty', format: (l) => String(l.quantity) },
  { label: 'Options', format: (l) => list(l.attribute_lines) },
  { label: 'Add-ons', format: (l) => list(l.addons.map((a) => `${a.label} ${money(a.price)}`)) },
  { label: 'Line total', format: (l) => money(l.line_total) },
];

/** The compared order-level fields, in the order their changes are reported. */
const ORDER_FIELDS: { label: string; format: (q: PublicQuote) => string }[] = [
  { label: 'Title', format: (q) => text(q.title) },
  { label: 'Valid until', format: (q) => text(q.expiry_date) },
  { label: 'Discount', format: (q) => money(q.discount_amount) },
  { label: 'Tax rate', format: (q) => `${q.tax_rate}%` },
  { label: 'Total', format: (q) => money(q.total) },
  { label: 'Terms', format: (q) => text(q.terms) },
];

/**
 * Pairs each live line with the sent line it replaces.
 *
 * Lines are matched by `uid`; a line with `uid === null` is matched by its
 * position among the null-uid lines on each side.
 *
 * @returns For each live line its sent counterpart (or `undefined` when
 *   new), plus the sent lines that no live line claimed (removed).
 */
function pairLines(
  sent: PublicQuoteLine[],
  live: PublicQuoteLine[]
): { pairs: { live: PublicQuoteLine; liveIndex: number; sent?: PublicQuoteLine }[]; removed: { line: PublicQuoteLine; index: number }[] } {
  const sentByUid = new Map<string, PublicQuoteLine>();
  const sentNull: PublicQuoteLine[] = [];
  for (const line of sent) {
    if (line.uid === null) sentNull.push(line);
    else sentByUid.set(line.uid, line);
  }

  const claimed = new Set<PublicQuoteLine>();
  let nullSeen = 0;
  const pairs = live.map((line, liveIndex) => {
    const match = line.uid === null ? sentNull[nullSeen++] : sentByUid.get(line.uid);
    if (match) claimed.add(match);
    return { live: line, liveIndex, sent: match };
  });

  const removed = sent
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => !claimed.has(line));
  return { pairs, removed };
}

/**
 * Compares the quote the customer was last sent with the current one.
 *
 * @param sent The quote as of the latest sent revision.
 * @param live The current quote (from `buildPublicQuote` on the saved
 *   order). Hidden items are already absent from it, so hiding an item
 *   after send reports as removed.
 * @returns The changes in display order: order-level changes, then items
 *   in live order (added, or changed field by field), then removed items.
 *   An empty array means the customer-visible quote is identical. A pure
 *   reordering of the same items is not a change.
 */
export function diffQuotes(sent: PublicQuote, live: PublicQuote): QuoteChange[] {
  const changes: QuoteChange[] = [];

  for (const field of ORDER_FIELDS) {
    const from = field.format(sent);
    const to = field.format(live);
    if (from === to) continue;
    // Terms can be pages long, so they are reported as updated, not quoted.
    changes.push(
      field.label === 'Terms'
        ? { kind: 'order_changed', field: field.label, from: 'updated', to: 'updated' }
        : { kind: 'order_changed', field: field.label, from, to }
    );
  }

  const { pairs, removed } = pairLines(sent.line_items, live.line_items);
  for (const { live: line, liveIndex, sent: before } of pairs) {
    const item = itemLabel(line, liveIndex);
    if (!before) {
      changes.push({ kind: 'item_added', item });
      continue;
    }
    for (const field of LINE_FIELDS) {
      const from = field.format(before);
      const to = field.format(line);
      if (from !== to) changes.push({ kind: 'item_changed', item, field: field.label, from, to });
    }
  }
  for (const { line, index } of removed) {
    changes.push({ kind: 'item_removed', item: itemLabel(line, index) });
  }

  return changes;
}

/**
 * Renders one {@link QuoteChange} as a single display line.
 *
 * @param c A change from {@link diffQuotes}.
 * @returns `"<Item>: <Field> <from> → <to>"` for item changes,
 *   `"<Field> <from> → <to>"` for order changes, `"Terms updated"` for
 *   terms, and `"Added: <Item>"` / `"Removed: <Item>"` for added or
 *   removed items. Values are already formatted (`$1,234.00`, `150 cm`).
 */
export function describeChange(c: QuoteChange): string {
  switch (c.kind) {
    case 'item_added':
      return `Added: ${c.item}`;
    case 'item_removed':
      return `Removed: ${c.item}`;
    case 'item_changed':
      return `${c.item}: ${c.field} ${c.from} → ${c.to}`;
    case 'order_changed':
      return c.field === 'Terms' ? 'Terms updated' : `${c.field} ${c.from} → ${c.to}`;
  }
}
