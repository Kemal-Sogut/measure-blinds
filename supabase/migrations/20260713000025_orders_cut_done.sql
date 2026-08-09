-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 25: manufacturing "cut done" milestone.
-- Records WHEN an order's fabric/aluminium was cut in the workshop, set
-- once from the Manufacturer Copy page. It is a manufacturing milestone
-- INDEPENDENT of the order status lifecycle (an order stays in_progress /
-- ready / installed as usual); it only lets the cut sheet show that the
-- cutting is already finished when re-opened.
--
-- Nullable = not yet cut. Once stamped it is intended to be one-way (the
-- API refuses to re-stamp it), so a non-null value is a permanent record
-- of the cut date/time. No money or status column is touched.

alter table public.orders
  add column cut_done_at timestamptz;

comment on column public.orders.cut_done_at is
  'When the workshop marked the order''s cuts complete (Manufacturer Copy); NULL = not cut yet. One-way.';
