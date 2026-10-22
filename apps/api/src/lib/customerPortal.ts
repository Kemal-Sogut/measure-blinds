// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * What the customer link (`/c/:token`) is allowed to show, and the
 * sanitized shape it shows it in.
 *
 * Visible: `sent` estimates on or before their expiry date (checked here,
 * so a lapsed estimate disappears even before the nightly cron flips it),
 * and every confirmed stage. Never visible: drafts (nothing was sent) and
 * expired estimates. The item is built field by field — never a spread of
 * the row — because the route is unauthenticated; a new column must not
 * become public by accident. Money is server-computed (AI_GUIDELINES §1).
 */

/** Statuses the portal query asks for; expiry is filtered in code. */
export const PORTAL_STATUSES = ['sent', 'awaiting_payment', 'in_progress', 'ready', 'installed'] as const;

/** A status a portal item can carry. */
export type PortalStatus = (typeof PORTAL_STATUSES)[number];

/** The order columns the portal query selects. */
export interface PortalOrderRow {
  id: string;
  order_number: string;
  title: string | null;
  status: string;
  order_date: string;
  expiry_date: string;
  total: number | string;
  public_token: string | null;
  payments?: Array<{ amount: number | string }> | null;
}

/** One card on the customer link. */
export interface PortalItem {
  order_number: string;
  title: string | null;
  status: PortalStatus;
  order_date: string;
  expiry_date: string;
  total: number;
  /** total − Σ payments, to the cent. */
  balance: number;
  /** The order's own token — the detail view calls `/public/estimate/:token` with it. */
  public_token: string;
}

const CONFIRMED: readonly string[] = ['awaiting_payment', 'in_progress', 'ready', 'installed'];

/** True when the customer link may show this row today (`YYYY-MM-DD`). */
export function isPortalVisible(
  row: Pick<PortalOrderRow, 'status' | 'expiry_date'>,
  today: string
): boolean {
  if (row.status === 'sent') return row.expiry_date >= today;
  return CONFIRMED.includes(row.status);
}

/** Builds the sanitized item; `token` is the (possibly just minted) order token. */
export function toPortalItem(row: PortalOrderRow, token: string): PortalItem {
  const total = Number(row.total);
  const paid = (row.payments ?? []).reduce((acc, p) => acc + Number(p.amount), 0);
  return {
    order_number: row.order_number,
    title: row.title ?? null,
    status: row.status as PortalStatus,
    order_date: row.order_date,
    expiry_date: row.expiry_date,
    total,
    balance: Math.round((total - paid) * 100) / 100,
    public_token: token,
  };
}
