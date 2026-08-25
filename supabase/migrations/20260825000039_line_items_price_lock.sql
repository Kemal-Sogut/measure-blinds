-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 39: per-line-item price lock.
--
-- Sending an estimate quotes the customer a price, and a quoted price
-- must stop being a computation. Until now every save re-ran the pricing
-- formula over TODAY's catalog, so editing a sent estimate (or a
-- confirmed invoice) after a formula tweak or a catalog price change
-- silently re-priced it.
--
-- The lock freezes the CALCULATED base price of each item when the
-- estimate goes out (`POST /:id/send` or `/mark-sent`), next to a
-- fingerprint of the inputs that produced it (see
-- `apps/api/src/lib/priceLock.ts`). Every later save reuses the frozen
-- figure while the fingerprint still matches; an item whose pricing
-- inputs were actually edited is re-priced with today's logic and
-- re-locked at the new figure.
--
--   locked_base_price       numeric — the frozen pre-override, pre-add-on
--                           unit price. NULL means "live-priced", which is
--                           every item of a DRAFT order.
--   locked_inputs_fingerprint  canonical JSON of the pricing inputs the
--                           frozen figure was computed from.
--
-- Only returning an order to `draft` clears both columns — a manual
-- status change to draft, or reviving a lapsed estimate by extending its
-- expiry date. Reversing a confirmation does NOT: it lands the order on
-- `sent`, where the customer still holds the estimate that quoted these
-- prices.

alter table public.line_items
  add column locked_base_price numeric(10,2),
  add column locked_inputs_fingerprint text;

comment on column public.line_items.locked_base_price is
  'Frozen calculated unit price (pre-override, pre-add-on). NULL = live-priced.';
comment on column public.line_items.locked_inputs_fingerprint is
  'Canonical JSON of the pricing inputs behind locked_base_price; a mismatch re-prices the item.';
