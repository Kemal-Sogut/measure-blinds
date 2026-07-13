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

/** Which kind of home visit an appointment is. */
export type AppointmentKind = 'estimate' | 'installation';

/**
 * Appointment response sub-state. Installations are emailed as a
 * proposal (`proposed`), then the customer either `confirmed` the time
 * or `change_requested` a different one. Estimate visits skip the
 * approval step — they are created as `confirmed` and only ever move
 * to `change_requested`.
 */
export type AppointmentStatus = 'proposed' | 'confirmed' | 'change_requested';

/**
 * A scheduled home visit from the standalone `appointments` table.
 * kind='estimate' visits attach to a CUSTOMER only (order_id is always
 * null); kind='installation' visits attach to the order being
 * installed.
 */
export interface Appointment {
  id: string;
  kind: AppointmentKind;
  customer_id: string;
  order_id: string | null;
  appointment_date: string;
  appointment_time: string;
  status: AppointmentStatus;
  confirmed_at: string | null;
  response_note: string;
  created_at: string;
  updated_at: string;
  /** Joined data — populated by the appointments API reads. */
  customer?: Customer;
  order?: Pick<Order, 'id' | 'order_number' | 'status'> | null;
}

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

/** One row of an order's activity trail (`GET /api/orders/:id/logs`). */
export interface OrderLog {
  id: string;
  order_id: string;
  message: string;
  created_at: string;
}

/**
 * Lightweight event returned by `GET /api/appointments/calendar` for
 * the Calendar tab — one row per appointment, covering BOTH estimate
 * visits (`kind: 'estimate'`, no order) and installations
 * (`kind: 'installation'`, with the order id/number).
 */
export interface CalendarEvent {
  /** The APPOINTMENT id (not an order id). */
  id: string;
  kind: AppointmentKind;
  /** Visit date, YYYY-MM-DD. */
  date: string;
  /** Visit window start, HH:MM[:SS]. */
  time: string;
  schedule_status: AppointmentStatus;
  /** Installation visits only — null / '' for estimate visits. */
  order_id: string | null;
  order_number: string;
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
  material_id: string | null;
  material_name: string | null;
  material_price_per_sqm: number | null;
  cassette_id: string | null;
  cassette_name: string | null;
  cassette_price_per_m: number | null;
  control_id: string | null;
  control_name: string | null;
  control_price_per_item: number | null;
  description: string;
  note: string;
  /** Free-text colour label (display-only; no pricing effect). */
  color: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  created_at: string;
  updated_at: string;
}

/**
 * Material option from settings — price per square meter, plus the set
 * of blind types it appears under (`blind_type_ids`, from the
 * `material_blind_types` join). An EMPTY list means "available for all
 * blind types"; the line-item editor filters the Material dropdown by
 * the selected blind type using this list.
 */
export interface Material {
  id: string;
  name: string;
  price_per_sqm: number;
  active: boolean;
  sort_order: number;
  /** Blind-type ids this Material is scoped to; empty = all types. */
  blind_type_ids: string[];
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
  /** Google review link for the post-installation review request email. */
  google_review_url: string | null;
}
