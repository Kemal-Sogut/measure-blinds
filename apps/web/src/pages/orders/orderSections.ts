// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * The order page's section model — which views exist, what they are
 * called, which of them an UNSAVED order may open, and how the selected
 * one round-trips through the URL.
 *
 * The order page is laid out as a left section menu, a middle column
 * showing ONE section at a time, and the right pricing panel. Keeping the
 * menu's vocabulary here, as plain data and pure functions, lets the menu
 * (`OrderSectionNav`), the page (`OrderDetail`) and the tests agree on one
 * list without the tests needing a DOM (this workspace runs vitest in
 * node, with no jsdom).
 *
 * The selected section lives in the `?view=` search param rather than in
 * component state so a reload, a shared link, or Back after opening the
 * cut sheet lands on the same section. Anything unrecognised — a typo, a
 * section removed in a later release, or a saved-only section on an
 * unsaved order — falls back to `details` instead of rendering an empty
 * middle column.
 */

/** Identifier of one order-page section, as it appears in `?view=`. */
export type OrderSectionId =
  | 'details'
  | 'items'
  | 'payments'
  | 'appointments'
  | 'manufacturer'
  | 'logs';

/** Menu metadata for one section. */
export interface OrderSectionMeta {
  id: OrderSectionId;
  /** Menu label; also the middle column's heading. */
  label: string;
  /**
   * True when the section only makes sense for an order that already has
   * a database row: payments, visits, the cut sheet and the activity trail
   * all hang off the order id, which an unsaved order does not have yet.
   */
  requiresSaved: boolean;
}

/** The sections in menu order. The first entry is the default. */
export const ORDER_SECTIONS: readonly OrderSectionMeta[] = [
  { id: 'details', label: 'Order Details', requiresSaved: false },
  { id: 'items', label: 'Items', requiresSaved: false },
  { id: 'payments', label: 'Payments', requiresSaved: true },
  { id: 'appointments', label: 'Appointments', requiresSaved: true },
  { id: 'manufacturer', label: 'Manufacturer', requiresSaved: true },
  { id: 'logs', label: 'Logs', requiresSaved: true },
];

/** Section shown when `?view=` is absent or unusable. */
export const DEFAULT_ORDER_SECTION: OrderSectionId = 'details';

/** Search-param name carrying the selected section. */
export const ORDER_SECTION_PARAM = 'view';

/**
 * Whether a section may be opened for this order.
 *
 * @param id Section to check.
 * @param isSaved Whether the order has been saved (has an id).
 */
export function isSectionAvailable(id: OrderSectionId, isSaved: boolean): boolean {
  const meta = ORDER_SECTIONS.find((s) => s.id === id);
  return Boolean(meta) && (isSaved || !meta!.requiresSaved);
}

/**
 * Resolves the raw `?view=` value to a section the page can render.
 *
 * @param raw The search param's value, or null when absent.
 * @param isSaved Whether the order has been saved; saved-only sections
 *   requested for an unsaved order resolve to the default.
 * @returns A known, available section id — never an empty view.
 */
export function resolveOrderSection(raw: string | null, isSaved: boolean): OrderSectionId {
  const match = ORDER_SECTIONS.find((s) => s.id === raw);
  return match && isSectionAvailable(match.id, isSaved) ? match.id : DEFAULT_ORDER_SECTION;
}

/**
 * localStorage keys for the two collapsible side panels. Persisted per
 * browser (not per order) because the choice is about screen room, and a
 * consultant who collapsed the menu on one order expects it collapsed on
 * the next.
 */
export const PANEL_STORAGE_KEYS = {
  nav: 'bn.order.navCollapsed',
  pricing: 'bn.order.pricingCollapsed',
} as const;

/**
 * Parses a stored collapse flag. Only the exact string `'true'` counts as
 * collapsed, so a missing, cleared or corrupted value opens the panel —
 * the recoverable direction, since a hidden panel can hide the Save button.
 */
export function parseCollapsedFlag(stored: string | null): boolean {
  return stored === 'true';
}
