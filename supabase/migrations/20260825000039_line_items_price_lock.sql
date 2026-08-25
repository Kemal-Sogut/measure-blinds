-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 39: per-line-item price lock.
--
-- Confirming an order turns it into an invoice, and an invoice's item
-- prices must stop being a computation. Until now every save re-ran the
-- pricing formula over TODAY's catalog, so editing a confirmed order
-- after a formula tweak or a catalog price change silently re-priced it.
--
-- The lock freezes the CALCULATED base price of each item at
-- confirmation time, next to a fingerprint of the inputs that produced
-- it (see `apps/api/src/lib/priceLock.ts`). A later save reuses the
-- frozen figure while the fingerprint still matches; an item whose
-- pricing inputs were actually edited is re-priced with today's logic
-- and re-locked at the new figure.
--
--   locked_base_price       numeric — the frozen pre-override, pre-add-on
--                           unit price. NULL means "live-priced", which is
--                           every item on a draft/sent estimate.
--   locked_inputs_fingerprint  canonical JSON of the pricing inputs the
--                           frozen figure was computed from.
--
-- Reversing a confirmation (`POST /:id/unconfirm`, a revert below
-- awaiting_payment, an accepted cancellation request) clears both
-- columns, so the order goes back to being a live-priced estimate.

alter table public.line_items
  add column locked_base_price numeric(10,2),
  add column locked_inputs_fingerprint text;

comment on column public.line_items.locked_base_price is
  'Frozen calculated unit price (pre-override, pre-add-on). NULL = live-priced.';
comment on column public.line_items.locked_inputs_fingerprint is
  'Canonical JSON of the pricing inputs behind locked_base_price; a mismatch re-prices the item.';
