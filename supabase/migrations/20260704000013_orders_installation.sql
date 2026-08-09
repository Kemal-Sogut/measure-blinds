-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 13: installation scheduling + status rename.
--
-- Status change: `completed` → `ready` (goods ready to install), and a
-- new terminal `installed` (set by the user after the physical job).
-- New lifecycle:
--   draft → sent → awaiting_payment → in_progress → ready → installed
--                                                          ( + expired )
--
-- Installation scheduling (available once an order is `ready`): the user
-- proposes a start time; the customer confirms it or requests another
-- via the existing token'd public page. The proposed window shown to the
-- customer is [install_time, install_time + 1 hour] on install_date.
-- `install_status` tracks that side-conversation independently of the
-- order status; reaching `installed` stays a deliberate user action.

-- 1. Swap `completed` for `ready` and add `installed` in the status CHECK.
alter table public.orders drop constraint orders_status_check;
update public.orders set status = 'ready' where status = 'completed';
alter table public.orders
  add constraint orders_status_check
  check (status in (
    'draft', 'sent', 'awaiting_payment', 'in_progress', 'ready', 'installed', 'expired'
  ));

-- 2. Installation scheduling columns.
alter table public.orders
  add column install_date date,
  add column install_time time,
  add column install_status text not null default 'unscheduled'
    check (install_status in ('unscheduled', 'proposed', 'confirmed', 'change_requested')),
  add column install_confirmed_at timestamptz,
  -- Free-text the customer leaves when requesting a different time.
  add column install_response_note text not null default '';
