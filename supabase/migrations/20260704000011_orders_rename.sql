-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 11: rename `estimates` → `orders` (Order-centric model).
--
-- The product model changed: an "Estimate" is no longer a first-class
-- entity, it is merely the PDF/email artifact we send about an Order.
-- The record that carries the customer, line items, totals, discount,
-- and lifecycle is now an ORDER.
--
-- New lifecycle (replaces draft/sent/confirmed/expired):
--   draft → sent → awaiting_payment → in_progress → completed
--                                                  ( + expired )
-- Transitions:
--   * send the estimate email:        draft/sent → sent
--   * customer (or user) confirms:    sent       → awaiting_payment
--   * user reverses a confirmation:   awaiting_payment → sent
--   * first payment recorded:         awaiting_payment → in_progress
--   * user marks order finished:      in_progress → completed
--   * sent estimate lapses (cron):    sent       → expired
--
-- Existing rows whose status was 'confirmed' are migrated to
-- 'awaiting_payment' (they were confirmed but not yet paid).
--
-- This is a non-destructive rename: ALTER TABLE ... RENAME preserves
-- all data, primary keys, and foreign keys. Only names and the status
-- CHECK constraint change.

-- 1. Rename the table and its "estimate_date" column.
alter table public.estimates rename to orders;
alter table public.orders rename column estimate_date to order_date;

-- 2. Swap the status CHECK constraint for the new lifecycle set.
--    (The inline constraint from migration 08 was auto-named
--    `estimates_status_check`; it travels with the table on rename.)
alter table public.orders drop constraint estimates_status_check;

--    Migrate legacy statuses before re-adding the guard.
update public.orders set status = 'awaiting_payment' where status = 'confirmed';

alter table public.orders
  add constraint orders_status_check
  check (status in ('draft', 'sent', 'awaiting_payment', 'in_progress', 'completed', 'expired'));

-- 3. Rename indexes, unique key, and trigger for clarity (optional but
--    keeps object names aligned with the new table name).
alter index public.estimates_order_number_key rename to orders_order_number_key;
alter index public.estimates_status_idx rename to orders_status_idx;
alter index public.estimates_customer_idx rename to orders_customer_idx;
alter trigger estimates_set_updated_at on public.orders rename to orders_set_updated_at;

-- 4. RLS is unchanged: the `authenticated_full_access` policy travels
--    with the table on rename, and the anon role still has NO policy —
--    public reads go only through the Worker's service-role token.
--
-- 5. Point line_items at the renamed parent.
alter table public.line_items rename column estimate_id to order_id;
alter index public.line_items_estimate_idx rename to line_items_order_idx;
