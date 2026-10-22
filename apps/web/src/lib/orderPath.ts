// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Staff order URLs: `/<customer-slug>/<order-number>[/<sub-page>]`
 * (spec 2026-10-20).
 *
 * The ORDER NUMBER is authoritative — it is DB-unique and the page loads
 * by it (`GET /api/orders/by-number/:n`). The slug is cosmetic: built from
 * first + last name only (never email or phone, which would end up in
 * browser history and logs), and `OrderByNumberRoute` redirects to the
 * canonical slug when the URL's differs (rename, typo). Slugs that equal
 * a first path segment the app owns are prefixed with `customer-`, so a
 * customer called "Settings" can never shadow `/settings/...`.
 *
 * Callers that hold only an order id link to `/orders/:id`, which
 * redirects here (`LegacyOrderRedirect`).
 */

/** Read-only pages that hang off an order. */
export type OrderSubPage = 'present' | 'labels' | 'manufacturer';

/** Every valid sub-page, for route validation. */
export const ORDER_SUB_PAGES: readonly OrderSubPage[] = ['present', 'labels', 'manufacturer'];

/** First path segments the app routes itself; a slug may never equal one. */
const RESERVED = new Set([
  'login',
  'customers',
  'orders',
  'estimates',
  'calendar',
  'appointments',
  'appointment',
  'notifications',
  'inbox',
  'settings',
  'customer',
  'c',
]);

/** Name fields the slug is built from. */
export interface SlugName {
  first_name?: string | null;
  last_name?: string | null;
}

/** Readable, URL-safe, collision-free slug for a customer. */
export function customerSlug(c: SlugName | null | undefined): string {
  const raw = [c?.first_name ?? '', c?.last_name ?? ''].join(' ');
  const slug = raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  if (!slug) return 'customer';
  return RESERVED.has(slug) ? `customer-${slug}`.slice(0, 60) : slug;
}

/** The canonical staff path for an order (and optional sub-page). */
export function orderPath(
  order: { order_number: string; customer?: SlugName | null },
  sub?: OrderSubPage
): string {
  const base = `/${customerSlug(order.customer)}/${encodeURIComponent(order.order_number)}`;
  return sub ? `${base}/${sub}` : base;
}

/** The customer-facing link path for a customer token. */
export function customerLinkPath(token: string): string {
  return `/c/${token}`;
}
