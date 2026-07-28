// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Production-label field extraction — the shared source of truth for
 * WHAT goes on a label, independent of how it is drawn.
 *
 * This is the single implementation used by the labels page
 * (`pages/orders/OrderLabels.tsx`), which renders these fields to the
 * browser DOM and prints them via `window.print()` to a
 * Windows-installed Bluetooth printer on the shop PC. There is no
 * server-side counterpart — printing is browser-only.
 *
 * A label is fixed behind a blind's cassette before it ships, so the
 * unit is one physical installed blind: one label per line item per
 * unit of quantity. A multi-panel row is ONE unit and lists all its
 * panel widths. Preset and custom rows carry no dimensions and produce
 * no labels.
 */

/** The subset of a line-item row this module reads. */
export interface LabelLineItem {
  item_type: string;
  position: number;
  room_name: string;
  panels: number[];
  height_cm: number | null;
  material_name: string | null;
  color: string;
  cassette_name: string | null;
  control_name: string | null;
  quantity: number;
}

/** The subset of an order this module reads. */
export interface LabelOrder {
  order_number: string;
  customer?: { first_name: string; last_name: string } | null;
  line_items?: LabelLineItem[] | null;
}

/**
 * One label's worth of already-formatted text. Every field is a plain
 * string — a renderer decides only placement and size, never wording.
 * Fields that do not apply are `''` rather than absent, so a renderer
 * can test one way and never print a dangling label.
 */
export interface LabelFields {
  /** Order number, e.g. "T0408-126". */
  orderNumber: string;
  /** 1-based position across the whole order (the `n` in `n of m`). */
  index: number;
  /** Total labels the order produces (the `m` in `n of m`). */
  total: number;
  /** Customer full name; `''` when the order has no joined customer. */
  customer: string;
  room: string;
  /** Pre-joined, e.g. "120 + 90 x 210 cm"; `''` when nothing is known. */
  dimensions: string;
  /** Material and colour joined with " · "; either side may be absent. */
  material: string;
  cassette: string;
  control: string;
}

/** Trims a possibly-null value to a plain string. */
function text(value: string | null | undefined): string {
  return (value ?? '').trim();
}

/**
 * Builds the printable dimension line. Panels are joined with " + "
 * because that is how the shop reads a multi-panel unit, and the drop
 * follows after "x". Either half degrades independently so a
 * half-measured blind still prints what IS known instead of nothing.
 */
function dimensionsOf(item: LabelLineItem): string {
  const widths = item.panels.length ? item.panels.join(' + ') : '';
  const drop = item.height_cm === null ? '' : String(item.height_cm);
  if (widths && drop) return `${widths} x ${drop} cm`;
  if (widths) return `${widths} cm`;
  if (drop) return `H ${drop} cm`;
  return '';
}

/**
 * Expands an order into its labels, ordered by line-item `position` and
 * then by copy index. Numbering runs across the WHOLE order — label 3
 * of 7 is unambiguous on a bench holding several units — which is why
 * the total is computed before any filtering by the caller.
 *
 * @param order Order with its joined customer and line items.
 * @returns One entry per physical blind; empty when the order has none.
 */
export function buildLabels(order: LabelOrder): LabelFields[] {
  const blinds = (order.line_items ?? [])
    .filter((li) => li.item_type === 'blind')
    .slice()
    .sort((a, b) => a.position - b.position);

  const total = blinds.reduce((sum, li) => sum + Math.max(1, li.quantity), 0);
  const customer = order.customer
    ? `${text(order.customer.first_name)} ${text(order.customer.last_name)}`.trim()
    : '';

  const labels: LabelFields[] = [];
  for (const item of blinds) {
    const material = [text(item.material_name), text(item.color)].filter(Boolean).join(' · ');
    for (let copy = 0; copy < Math.max(1, item.quantity); copy++) {
      labels.push({
        orderNumber: text(order.order_number),
        index: labels.length + 1,
        total,
        customer,
        room: text(item.room_name),
        dimensions: dimensionsOf(item),
        material,
        cassette: text(item.cassette_name),
        control: text(item.control_name),
      });
    }
  }
  return labels;
}
