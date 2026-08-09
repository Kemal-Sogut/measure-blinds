-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 30: customer-sourced activity logs.
--
-- Two additions that together let the order's activity trail show what
-- the CUSTOMER did (open their page, confirm, ask to cancel) as visually
-- distinct rows, without disturbing any existing staff log.
--
-- 1. order_logs.source — who caused the entry. Defaults to 'staff', so
--    every historical row and every existing insert path in the Worker
--    stays correct with no backfill and no code change.
--
-- 2. orders.customer_viewed_at — the moment the customer first opened
--    their token'd page. This column, not a search of past log text, is
--    what makes "log the first open only" reliable: matching on the log
--    message would silently break the day the wording changes.

alter table public.order_logs
  add column source text not null default 'staff'
    check (source in ('staff', 'customer'));

alter table public.orders
  add column customer_viewed_at timestamptz;
