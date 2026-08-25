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
  /**
   * When a receipt email was last sent for this payment (ISO timestamp),
   * or null if none has ever been sent. Stamped server-side only after a
   * successful send; drives the "Receipt sent" indicator and the
   * Send/Resend receipt labeling on the order detail Payments panel.
   */
  receipt_sent_at: string | null;
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
  /**
   * When the workshop marked the order's cuts complete on the Manufacturer
   * Copy page; `null` = not cut yet. One-way (set once, never reset).
   */
  cut_done_at: string | null;
  /**
   * When the warranty certificate was last emailed to the customer;
   * `null` = never sent. Stamped server-side only after the email
   * provider accepts the send. The certificate goes out automatically as
   * soon as a payment clears the balance, so a paid order with `null`
   * here means the send was skipped or failed — that is what the
   * Send/Resend warranty action on the Payments panel is for.
   */
  warranty_sent_at: string | null;
  /**
   * The date warranty coverage runs from — the day the order was paid in
   * full; `null` until then. Snapshotted server-side so every
   * regeneration of the certificate prints identical expiry dates
   * (coverage + 10 years on products, + 2 years on motorised parts).
   */
  warranty_starts_on: string | null;
  /**
   * When the customer asked, from the public page, for their confirmation
   * to be cancelled; `null` = no open request. The request changes no
   * status by itself — staff answer it on
   * `POST /orders/:id/cancel-request/resolve`, and either answer clears
   * this back to `null` (the activity log keeps the history).
   */
  cancel_requested_at: string | null;
  /** The customer's stated reason, shown in the staff warning banner. */
  cancel_request_note: string;
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
  /**
   * Who caused this entry. Optional on the wire on purpose: if the web
   * app deploys ahead of the Worker, older rows arrive without it and
   * must render as staff rather than crash or mis-colour.
   */
  source?: 'staff' | 'customer';
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
  /**
   * Joined identifying fields only — no address needed here. Email and
   * phone are carried solely so `displayName` can label a customer who
   * has no name; neither is rendered on a chip as such.
   */
  customer: Pick<Customer, 'first_name' | 'last_name' | 'email' | 'phone'>;
}

/** Line item type discriminator for different pricing models. */
export type LineItemType = 'blind' | 'custom' | 'preset';

/**
 * One consultant-added extra on a line item — a label and a flat price.
 *
 * The price is added ONCE to the item's line total, never multiplied by
 * the item's quantity: an add-on describes something bought for the line
 * as a whole ("rush fee", "site measure"), not a per-unit upgrade. Both
 * fields are snapshotted onto the row at save time, so editing nothing
 * but a catalog price later cannot rewrite a quoted extra.
 */
export interface LineItemAddon {
  label: string;
  price: number;
}

/**
 * Line item within an order. Mirrors the `line_items` table:
 * blind items use panels/height + snapshotted option names & prices
 * (frozen at save time so later catalog edits never change history);
 * preset/custom items use title + description + unit_price.
 */
export interface LineItem {
  id: string;
  order_id: string;
  item_type: LineItemType;
  position: number;
  /**
   * Stable identity minted by the Worker. Saving an order replaces its
   * line items wholesale, so `id` is reborn on every save and `position`
   * moves on any reorder — `uid` is what survives, and therefore what
   * lets the Worker tell whether THIS item's visibility changed.
   */
  uid: string;
  /**
   * Excluded from the order total and from every customer- and
   * production-facing surface (documents, the customer page, the
   * warranty, labels, the cut sheet) while staying in the editor.
   * Changeable only before the order is confirmed — the Worker answers a
   * flip on a confirmed order with a 400.
   */
  hidden: boolean;
  room_name: string;
  blinds_type: string;
  panels: number[];
  height_cm: number | null;
  material_id: string | null;
  material_name: string | null;
  material_price_per_sqm: number | null;
  cassette_id: string | null;
  cassette_name: string | null;
  /**
   * The rate charged, and the basis it was charged on. The column names
   * predate migration 36 and are deliberately unchanged — nothing reads
   * them, they are an audit trail, and renaming would rewrite history.
   * The basis is what makes the rate readable: "$12" alone says nothing.
   */
  cassette_price_per_m: number | null;
  cassette_price_basis: PriceBasis | null;
  bottom_rail_id: string | null;
  bottom_rail_name: string | null;
  bottom_rail_price_per_m: number | null;
  bottom_rail_price_basis: PriceBasis | null;
  control_id: string | null;
  control_name: string | null;
  control_price_per_item: number | null;
  control_price_basis: PriceBasis | null;
  /**
   * Rod/track slot, promoted out of `attributes` by migration 35. Null on
   * flat items and on any blind whose type has no installation option
   * scoped to it. The charge is FIXED per blind, unlike the cassette and
   * the rail, which are per linear metre of width.
   */
  installation_id: string | null;
  installation_name: string | null;
  installation_price_per_item: number | null;
  installation_price_basis: PriceBasis | null;
  description: string;
  note: string;
  /** Free-text colour label (display-only; no pricing effect). */
  color: string;
  /**
   * The blind type's own extra inputs, as validated and stored by the
   * Worker. `{}` for flat items and for every blind of a type that has
   * not declared any. Render it through
   * `getBlindType(blinds_type).describeAttributes()` — never by iterating
   * the object directly, or the labels drift between surfaces.
   */
  attributes: Record<string, string | number | boolean>;
  quantity: number;
  unit_price: number;
  line_total: number;
  /**
   * Headline for preset/custom items; `''` on blind rows, whose title is
   * derived from `room_name` + `blinds_type`. Rows written before the
   * title existed also carry `''` — every surface falls back to
   * `description` so historical orders still print a name.
   */
  title: string;
  /**
   * Catalog provenance for preset items, `null` for blind, custom, and
   * pre-migration-31 preset rows. Its presence is what lets the Worker
   * re-price the item — and therefore what makes "reset to calculated"
   * possible on a preset.
   */
  preset_id: string | null;
  /**
   * The server-CALCULATED unit price, populated only while the item's
   * price is overridden; `null` means no override. `unit_price` always
   * holds the price actually charged, so this is purely the "was" figure
   * behind a strikethrough, never a number any total is derived from.
   */
  base_unit_price: number | null;
  /**
   * Whether customer-facing surfaces print the struck-through original.
   * Meaningless while `base_unit_price` is `null`. The public endpoint
   * omits the figure entirely when this is false, so the toggle is a real
   * privacy control rather than a CSS-level one.
   */
  show_original_price: boolean;
  /** Consultant-added extras; each price lands once in `line_total`. */
  addons: LineItemAddon[];
  /**
   * The CALCULATED unit price frozen when the order was confirmed
   * (migration 39), or `null` while the item is live-priced — which is
   * every item of a draft/sent estimate.
   *
   * While it is set, saving the order re-uses this figure instead of
   * re-running the pricing formula, so neither a later formula change
   * nor a catalog price change can move a confirmed invoice. Editing the
   * item's own pricing inputs releases the lock for that one item; see
   * `lib/priceLock.ts`.
   */
  locked_base_price: number | null;
  /**
   * Canonical JSON of the pricing inputs behind `locked_base_price`. The
   * editor recomputes it as the consultant types and compares: while it
   * matches, the frozen price is what the preview shows.
   */
  locked_inputs_fingerprint: string | null;
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
  /**
   * Fabric roll width in cm — a MANUFACTURING input (not pricing) used by
   * the cut planner on the Manufacturer Copy page. `null` when unset; the
   * planner then assumes a default 3 m (300 cm) roll.
   */
  width_cm: number | null;
  /** Blind-type ids this Material is scoped to; empty = all types. */
  blind_type_ids: string[];
}

/**
 * Blind-type scoping carried by the four hardware option catalogs.
 *
 * EMPTY MEANS NONE — the opposite of `Material.blind_type_ids`, and
 * deliberately so: it is what lets Settings switch a hardware slot off
 * for a blind type entirely. The line-item form renders a slot's dropdown
 * only while at least one ACTIVE option is scoped to the selected type
 * (`slotsForType`), and the Worker enforces the save on the same rule.
 */
interface BlindTypeScoped {
  /** Blind-type ids this option is offered for; empty = offered nowhere. */
  blind_type_ids: string[];
}

/**
 * How a hardware option's price is charged. Mirrors the `PriceBasis`
 * union the pricing modules switch on and the `price_basis` check
 * constraint on all four catalogs — the three must list the same members
 * or a row could be saved that the formula cannot price.
 */
export type PriceBasis = 'per_m' | 'per_sqm' | 'per_unit' | 'per_panel';

/**
 * The shape shared by all four hardware catalogs since migration 36: one
 * rate plus the basis it is charged on, and the blind types it is offered
 * for.
 *
 * Before that the basis was implied by the column name — `price_per_m` on
 * a cassette, `price_per_item` on a control — and could not vary per row.
 * The shop buys some parts by the metre, some by the square metre, some
 * outright, so it is chosen next to the price in Settings now.
 */
interface HardwarePriced extends BlindTypeScoped {
  /** The rate. What it BUYS is decided by `price_basis`, never by a name. */
  price: number;
  price_basis: PriceBasis;
}

/** Cassette option from settings — charged on its own . */
export interface CassetteOption extends HardwarePriced {
  id: string;
  name: string;
  active: boolean;
  sort_order: number;
}

/**
 * Bottom-rail option from settings — the weighted bar at the foot of a
 * blind, priced per linear meter of width on the same basis as the
 * cassette. Shipped options are Regular and Pear.
 */
export interface BottomRailOption extends HardwarePriced {
  id: string;
  name: string;
  active: boolean;
  sort_order: number;
}

/** Control mechanism option from settings — flat price per panel. */
export interface ControlOption extends HardwarePriced {
  id: string;
  name: string;
  active: boolean;
  sort_order: number;
}

/**
 * Pleat style from settings — a Curtains-only catalog. `multiplier` is a
 * fullness RATIO, not money: metres of fabric consumed per metre of
 * finished curtain width, so 2.5 means a 3 m curtain uses 7.5 m of
 * fabric. It multiplies the fabric cost, which makes it a price input —
 * the client only ever sends the row id and the Worker resolves the
 * ratio itself.
 */
export interface PleatType {
  id: string;
  name: string;
  multiplier: number;
  active: boolean;
  sort_order: number;
}

/**
 * Installation method from settings — rod or track. Charged as a FIXED
 * amount per blind, unlike the cassette and bottom rail, which are
 * charged per linear metre of width. The price is resolved server-side
 * from the id.
 *
 * Curtains-only by DATA, not by rule: migration 35 promoted this to a
 * shared hardware slot and seeded links to Curtains alone, so scoping it
 * to another blind type in Settings is all it takes to offer it there.
 */
export interface InstallationOption extends HardwarePriced {
  id: string;
  name: string;
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

/**
 * One blind type's saved default catalog picks — at most one row per
 * `blind_type_id` in the `blind_type_defaults` table. Each of the five
 * option slots is `uuid | null`: `null` means "no default for this
 * slot", not "unset vs. explicitly cleared" — the settings page and the
 * order form treat a missing row (a blind type that has never had
 * defaults saved) identically to one whose fields are all null, so no
 * placeholder row needs to exist up front.
 *
 * The Worker (`PUT /api/settings/blind-type-defaults/:blindTypeId`)
 * validates every non-null id on write: it must be an ACTIVE option
 * LINKED to that blind type in the matching join table, the same
 * "active AND linked" rule enforced for hardware at order-save time.
 * That guarantee is what lets a later `applyTypeDefaults` helper seed a
 * line-item draft straight from these ids without re-checking scoping
 * itself — a stored default can never name an option the order form
 * would refuse to save.
 */
export interface BlindTypeDefaults {
  blind_type_id: string;
  material_id: string | null;
  cassette_id: string | null;
  bottom_rail_id: string | null;
  control_id: string | null;
  installation_id: string | null;
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
  /**
   * Interac e-Transfer recipient shown to customers on the public order
   * summary once they have confirmed and still owe a balance. Empty
   * hides the payment block entirely.
   */
  etransfer_email: string | null;
  /** Optional extra instructions rendered under the e-Transfer address. */
  etransfer_instructions: string | null;
}
