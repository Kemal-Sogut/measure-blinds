// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Types and pure rules for the customer link (`/c/:token`).
 *
 * The payload mirrors `GET /public/customer/:token` exactly; every figure
 * in it is server-computed and is displayed as-is. The Worker has already
 * hidden drafts and lapsed estimates, so these rules only decide layout:
 * one visible item opens straight into it (today's single-estimate
 * experience), otherwise a list with Estimates above Your orders.
 */

/** One card on the customer link (server shape). */
export interface PortalItem {
  order_number: string;
  title: string | null;
  status: 'sent' | 'awaiting_payment' | 'in_progress' | 'ready' | 'installed';
  order_date: string;
  expiry_date: string;
  total: number;
  balance: number;
  /** The order's own token, passed to `CustomerView`. */
  public_token: string;
}

/** `GET /public/customer/:token` → `data`. */
export interface PortalPayload {
  company: { company_name: string; logo_url: string | null; email: string; phone: string };
  customer: { first_name: string };
  items: PortalItem[];
}

/** What the link should render first. */
export type PortalLanding =
  | { kind: 'empty' }
  | { kind: 'single'; item: PortalItem }
  | { kind: 'list' };

/** Exactly one item opens directly; none is empty; otherwise the list. */
export function portalLanding(items: PortalItem[]): PortalLanding {
  if (items.length === 0) return { kind: 'empty' };
  if (items.length === 1) return { kind: 'single', item: items[0] };
  return { kind: 'list' };
}

/** Splits into live estimates and confirmed orders, preserving server order. */
export function splitPortalItems(items: PortalItem[]): {
  estimates: PortalItem[];
  orders: PortalItem[];
} {
  return {
    estimates: items.filter((i) => i.status === 'sent'),
    orders: items.filter((i) => i.status !== 'sent'),
  };
}
