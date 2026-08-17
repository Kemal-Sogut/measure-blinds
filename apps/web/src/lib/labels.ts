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

import { displayName } from './customerName';

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
  bottom_rail_name: string | null;
  control_name: string | null;
  installation_name: string | null;
  quantity: number;
  /** Hidden items are not manufactured, so they produce no label. */
  hidden: boolean;
}

/** The subset of an order this module reads. */
export interface LabelOrder {
  order_number: string;
  /** `YYYY-MM-DD` — the `orders.order_date` column, not a timestamp. */
  order_date: string;
  /**
   * Email and phone are optional here but read by `displayName` when the
   * customer has no name — a label with a blank addressee is useless on
   * a workshop bench.
   */
  customer?: {
    first_name: string;
    last_name: string;
    email?: string | null;
    phone?: string | null;
  } | null;
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
  /**
   * Month and day of the order date, e.g. "Jul 21"; `''` when the date
   * is missing or malformed. The year is deliberately dropped — the
   * stock is 3in wide and the shop only ever needs the day to tell two
   * in-flight orders apart.
   */
  orderDate: string;
  /** 1-based position across the whole order (the `n` in `n of m`). */
  index: number;
  /** Total labels the order produces (the `m` in `n of m`). */
  total: number;
  /** Customer full name; `''` when the order has no joined customer. */
  customer: string;
  room: string;
  /** Pre-joined, e.g. "120 + 90 x 210 cm"; `''` when nothing is known. */
  dimensions: string;
  /**
   * Material and colour joined with " — "; either side may be absent.
   * The wide dash is deliberate here and NOT shared with `hardware`
   * below, which joins with " · ": the material line is two prose names
   * that need the extra breathing room to read as separate values,
   * while the hardware line is three short captioned codes that a wide
   * dash would push past the 3in stock's usable width.
   */
  material: string;
  /**
   * The hardware spec as shop shorthand, e.g.
   * `"Cassette: R · Bottom Rail: P · Control: MB"`.
   *
   * Catalog names are printed as one- or two-letter CODES because three
   * full names ("Fabric Wrapped", "Regular", "Motorized (Bluetooth)")
   * overflow a 3in label and clip the control. A part whose name is
   * missing drops its whole `Label: code` segment, so a half-specced row
   * still reads clean with no dangling separator; `''` when no part is
   * known at all.
   */
  hardware: string;
}

/** Trims a possibly-null value to a plain string. */
function text(value: string | null | undefined): string {
  return (value ?? '').trim();
}

/**
 * "Jul 21" from a `YYYY-MM-DD` order date. The parts are split and fed
 * to the Date constructor rather than parsed from the string, which
 * would be read as UTC and print the previous day west of Greenwich —
 * the same guard `CustomerView`'s receipt date uses. Anything that is
 * not three numeric parts yields `''` so a bad row still prints a label.
 */
function shortDate(iso: string): string {
  const [y, m, d] = text(iso).split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(y, m - 1, d).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
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
 * A name-pattern table: the FIRST matching pattern wins, so entries are
 * ordered most-specific first. Patterns match the snapshotted catalog
 * name on the line item — never the option id — because a label must
 * keep printing what the order was sold as after the catalog is renamed.
 */
type CodeTable = readonly (readonly [RegExp, string])[];

/**
 * Cassette codes. "No Cassette" prints "-" rather than a letter or a
 * dropped segment: the shop needs to see the question was ANSWERED, not
 * left blank, before the unit is assembled.
 */
const CASSETTE_CODES: CodeTable = [
  [/\bno\b/i, '-'],
  [/wrap/i, 'W'],
  [/square/i, 'S'],
  [/regular/i, 'R'],
];

/** Bottom-rail codes — the catalog ships exactly Regular and Pear. */
const BOTTOM_RAIL_CODES: CodeTable = [
  [/pear/i, 'P'],
  [/regular/i, 'R'],
];

/**
 * Installation codes — the catalog ships exactly Rod and Track. Printed
 * only when the blind type has an installation option scoped to it, so
 * this segment is simply absent on everything but curtains today.
 */
const INSTALLATION_CODES: CodeTable = [
  [/rod/i, 'R'],
  [/track/i, 'T'],
];

/**
 * Control codes. Chain is "R" (the shop's word for it is the regular
 * control), and the two motor variants are told apart because they are
 * different parts to pick: "MB" is Bluetooth, plain "M" is not. The
 * non-Bluetooth pattern MUST stay above the Bluetooth one — its name
 * contains the word.
 */
const CONTROL_CODES: CodeTable = [
  [/chain/i, 'R'],
  [/cordless/i, 'C'],
  [/wand/i, 'SW'],
  [/non[\s-]?bluetooth/i, 'M'],
  [/bluetooth/i, 'MB'],
  [/motor/i, 'M'],
];

/**
 * Reduces a catalog name to its label code. An unmapped name — an option
 * the shop adds in Settings after this table was written — degrades to
 * its first character uppercased rather than printing nothing, so a new
 * option is still distinguishable on the bench instead of vanishing.
 *
 * @param name Snapshotted catalog name, possibly null or padded.
 * @param table Ordered patterns for that part.
 * @returns The code, or `''` when the row carries no name.
 */
function codeOf(name: string | null | undefined, table: CodeTable): string {
  const value = text(name);
  if (!value) return '';
  for (const [pattern, code] of table) {
    if (pattern.test(value)) return code;
  }
  return value[0].toUpperCase();
}

/**
 * Builds the hardware line, dropping any part the row does not carry.
 * The captions are spelled out ("Cassette: R") because the codes alone
 * are ambiguous across parts — "R" is Regular on a cassette and Chain on
 * a control — and the shop reads the label by caption, not by position.
 */
function hardwareOf(item: LabelLineItem): string {
  return [
    ['Cassette', codeOf(item.cassette_name, CASSETTE_CODES)],
    ['Bottom Rail', codeOf(item.bottom_rail_name, BOTTOM_RAIL_CODES)],
    ['Control', codeOf(item.control_name, CONTROL_CODES)],
    ['Installation', codeOf(item.installation_name, INSTALLATION_CODES)],
  ]
    .filter(([, code]) => code)
    .map(([caption, code]) => `${caption}: ${code}`)
    .join(' · ');
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
  // Hidden items drop out HERE, before the total below counts anything:
  // the "n of m" on a printed label has to match the number of labels
  // actually in the bundle, which it could not if the caller filtered
  // afterwards.
  const blinds = (order.line_items ?? [])
    .filter((li) => li.item_type === 'blind' && !li.hidden)
    .slice()
    .sort((a, b) => a.position - b.position);

  const total = blinds.reduce((sum, li) => sum + Math.max(1, li.quantity), 0);
  const customer = order.customer ? text(displayName(order.customer)) : '';

  const labels: LabelFields[] = [];
  for (const item of blinds) {
    const material = [text(item.material_name), text(item.color)].filter(Boolean).join(' — ');
    for (let copy = 0; copy < Math.max(1, item.quantity); copy++) {
      labels.push({
        orderNumber: text(order.order_number),
        orderDate: shortDate(order.order_date),
        index: labels.length + 1,
        total,
        customer,
        room: text(item.room_name),
        dimensions: dimensionsOf(item),
        material,
        hardware: hardwareOf(item),
      });
    }
  }
  return labels;
}
