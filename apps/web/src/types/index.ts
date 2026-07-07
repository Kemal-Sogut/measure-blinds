// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Shared TypeScript type definitions for the Blinds Nisa application.
 *
 * These types represent the database models and API request/response shapes
 * used across the frontend. They mirror the Supabase PostgreSQL schema
 * defined in IMPLEMENTATION.md §3.
 */

/** User profile extending Supabase auth.users. */
export interface Profile {
  id: string;
  full_name: string | null;
  role: 'admin' | 'consultant';
  created_at: string;
}

/**
 * Customer record with shipping and optional separate billing address.
 * Text fields are non-null in the DB (default '') so they are plain
 * strings here. `deleted_at` marks soft deletion — list/detail
 * endpoints never return soft-deleted rows.
 */
export interface Customer {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  shipping_address_line1: string;
  shipping_address_line2: string;
  shipping_city: string;
  shipping_province: string;
  shipping_postal_code: string;
  billing_same_as_shipping: boolean;
  billing_address_line1: string;
  billing_address_line2: string;
  billing_city: string;
  billing_province: string;
  billing_postal_code: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Order lifecycle:
 *   draft → sent → awaiting_payment → in_progress → ready → installed
 * plus `expired` for a sent estimate whose validity date lapsed.
 *
 * Transitions: send estimate (→sent), customer/user confirm
 * (→awaiting_payment), first payment (→in_progress), user marks the
 * goods ready (→ready), user marks the job done (→installed). A
 * confirmation is reversible by the user only (awaiting_payment → sent)
 * until a payment is recorded.
 */
export type OrderStatus =
  | 'draft'
  | 'sent'
  | 'awaiting_payment'
  | 'in_progress'
  | 'ready'
  | 'installed'
  | 'expired';

/**
 * Installation scheduling sub-state, independent of `OrderStatus`.
 * `unscheduled` → user proposes → `proposed` → customer either
 * `confirmed` the time or `change_requested` a different one.
 */
export type InstallStatus = 'unscheduled' | 'proposed' | 'confirmed' | 'change_requested';

/** Discount entry mode: fixed dollar amount or percentage of subtotal. */
export type DiscountType = 'fixed' | 'percent';

/**
 * A single payment recorded against an order (immutable ledger row).
 * The order's outstanding balance is derived as `total − Σ amount`,
 * never stored. Mirrors the `payments` table.
 */
export interface Payment {
  id: string;
  order_id: string;
  amount: number;
  paid_on: string;
  note: string;
  created_at: string;
}

/**
 * Order record with full pricing breakdown, lifecycle status, and
 * payment ledger. An "estimate"/"invoice" is just the PDF/email we
 * generate about this order. All money fields are authoritative
 * server-computed values (discount applied before 13% HST). Mirrors
 * the `orders` table.
 */
export interface Order {
  id: string;
  order_number: string;
  customer_id: string;
  status: OrderStatus;
  order_date: string;
  expiry_date: string;
  subtotal: number;
  discount_type: DiscountType;
  discount_value: number;
  discount_amount: number;
  taxable_amount: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  terms_snapshot: string | null;
  public_token: string | null;
  sent_at: string | null;
  confirmed_at: string | null;
  /** Installation scheduling (set once the order is `ready`). */
  install_status: InstallStatus;
  install_date: string | null;
  install_time: string | null;
  install_confirmed_at: string | null;
  install_response_note: string;
  created_at: string;
  updated_at: string;
  /** Server-derived sum of `payments` (present on detail/list reads). */
  amount_paid?: number;
  /** Joined data — populated when fetching a single order */
  line_items?: LineItem[];
  /** Joined data — the order's payment ledger, oldest-first */
  payments?: Payment[];
  /** Joined data — populated when fetching with customer info */
  customer?: Customer;
}

/**
 * Lightweight order projection returned by `GET /api/orders/calendar`
 * for the Calendar tab's monthly grid. A strict subset of `Order` —
 * only the fields the grid/chips need (no line items, no payments) so
 * a month's worth of installations stays a cheap fetch. Only orders
 * with an active `install_status` (`proposed` / `confirmed` /
 * `change_requested`) are ever returned; `unscheduled` orders have no
 * `install_date` to plot and are excluded server-side.
 */
export interface CalendarEvent {
  id: string;
  order_number: string;
  install_date: string;
  install_time: string;
  install_status: InstallStatus;
  status: OrderStatus;
  /** Joined customer name only — no address/contact fields needed here. */
  customer: Pick<Customer, 'first_name' | 'last_name'>;
}

/** Line item type discriminator for different pricing models. */
export type LineItemType = 'blind' | 'custom' | 'preset';

/**
 * Line item within an order. Mirrors the `line_items` table:
 * blind items use panels/height + snapshotted option names & prices
 * (frozen at save time so later catalog edits never change history);
 * preset/custom items use description + unit_price.
 */
export interface LineItem {
  id: string;
  order_id: string;
  item_type: LineItemType;
  position: number;
  room_name: string;
  blinds_type: string;
  panels: number[];
  height_cm: number | null;
  fabric_id: string | null;
  fabric_name: string | null;
  fabric_price_per_sqm: number | null;
  cassette_id: string | null;
  cassette_name: string | null;
  cassette_price_per_m: number | null;
  control_id: string | null;
  control_name: string | null;
  control_price_per_item: number | null;
  description: string;
  note: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  created_at: string;
  updated_at: string;
}

/** Fabric option from settings — price per square meter. */
export interface Fabric {
  id: string;
  name: string;
  price_per_sqm: number;
  active: boolean;
  sort_order: number;
}

/** Cassette option from settings — price per linear meter (width). */
export interface CassetteOption {
  id: string;
  name: string;
  price_per_m: number;
  active: boolean;
  sort_order: number;
}

/** Control mechanism option from settings — flat price per panel. */
export interface ControlOption {
  id: string;
  name: string;
  price_per_item: number;
  active: boolean;
  sort_order: number;
}

/** Blind type option from settings — a label only, no price. */
export interface BlindType {
  id: string;
  name: string;
  active: boolean;
  sort_order: number;
}

/** Preset line item template — for commonly used add-on services. */
export interface PresetLineItem {
  id: string;
  name: string;
  description: string | null;
  unit_price: number;
  active: boolean;
}

/** Company settings — singleton record with business branding and defaults. */
export interface CompanySettings {
  id: number;
  company_name: string | null;
  logo_url: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  hst_number: string | null;
  terms_and_conditions: string | null;
  default_expiry_days: number;
}
