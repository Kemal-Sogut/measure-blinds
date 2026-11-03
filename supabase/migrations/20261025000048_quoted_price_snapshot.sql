-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 48: what the customer was LAST SENT.
--
-- Migration 39's price lock answers "what price is in force"; it cannot
-- answer "what price did the customer last see", because a save re-locks
-- an edited item at its NEW figure (`resolveLineItems`' lockColumns). A
-- notice driven by the lock would therefore disappear the moment the
-- consultant pressed Save — exactly when staff need to be told that a
-- quoted figure has moved.
--
-- These two columns are written ONLY by a send, never by a save:
--
--   line_items.quoted_base_price  numeric — the calculated base unit
--                                 price (pre-override, pre-add-on) this
--                                 item carried when the estimate last
--                                 went out.
--   orders.quoted_total           numeric — the grand total the order
--                                 carried at that same send.
--
-- The editor compares today's figures against these and shows a price-
-- update notice per line item and one below the order total. Sending the
-- estimate again overwrites both, which is what clears the notices.
--
-- NULL means "never sent", which is every draft order — and an order put
-- back to draft, since `clearOrderPriceLocks` clears these alongside the
-- lock columns. `PUT /orders/:id` carries `quoted_base_price` across the
-- wholesale line-item replacement by `uid` and never recomputes it.

-- Each notice can also be DISMISSED, which records the figure that was
-- acknowledged rather than a plain flag:
--
--   line_items.quoted_notice_ack_base   numeric — the item's own figure,
--                                       as acknowledged by staff.
--   orders.quoted_notice_ack_total      numeric — the order total, ditto.
--
-- A notice is shown while today's figure differs from the quoted stamp
-- AND from the acknowledged figure. Storing the figure rather than a
-- boolean is what makes a SECOND price move speak up again: dismissing
-- accepts one figure, not every figure that might follow it. A send
-- clears both columns as it re-stamps, so the acknowledgement never
-- outlives the quote it was about.

alter table public.line_items
  add column quoted_base_price numeric(10,2),
  add column quoted_notice_ack_base numeric(10,2);

alter table public.orders
  add column quoted_total numeric(10,2),
  add column quoted_notice_ack_total numeric(10,2);

comment on column public.line_items.quoted_base_price is
  'Calculated base unit price at the last send. Written by a send only; NULL = never sent.';
comment on column public.line_items.quoted_notice_ack_base is
  'Item figure staff dismissed the price-update notice at. NULL = not dismissed; cleared by a send.';
comment on column public.orders.quoted_total is
  'Grand total at the last send. Written by a send only; NULL = never sent.';
comment on column public.orders.quoted_notice_ack_total is
  'Order total staff dismissed the price-update notice at. NULL = not dismissed; cleared by a send.';
