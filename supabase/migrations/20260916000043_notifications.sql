-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 43: staff alerts (the Alerts page in the sidebar).
--
-- Three things happen without a staff member in the room, and until now
-- each was only discoverable by opening the right order (or, for a
-- confirmation, by reading the shop inbox):
--
--   edit_request       — a customer filed a Request Edit on their estimate
--   order_confirmed    — a customer pressed Confirm Estimate
--   etransfer_received — the Gmail Apps Script reported an Interac
--                        e-Transfer (auto-applied to an order OR parked
--                        as pending for manual assignment)
--
-- One row per event, written best-effort by the Worker right after the
-- event itself persists (`apps/api/src/lib/notifications.ts`). Rows are
-- never edited and never deleted by the app; the page simply lists them
-- newest first.
--
-- Display fields are SNAPSHOTS taken at the moment of the event
-- (order number, customer or sender name, amount), so an alert keeps
-- reading the way it did even if the customer is renamed later, and the
-- list query needs no joins.
--
-- `order_id` is set only for the two order events, which link to the
-- order page. It cascades: an alert pointing at a deleted order has
-- nowhere to go, and `lib/orderDelete.ts` relies on FK cascades to take
-- an order's dependents with it. e-Transfer alerts deliberately leave it
-- NULL (they do not link anywhere) and keep the matched order number
-- only as text, so deleting an order never erases the record that money
-- arrived.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),

  kind text not null
    check (kind in ('edit_request', 'order_confirmed', 'etransfer_received')),

  order_id uuid references public.orders (id) on delete cascade,

  -- Snapshots; '' when unknown (an unmatched e-Transfer has no order).
  order_number text not null default '',
  -- Customer display name for order events; the e-Transfer sender for
  -- payment events.
  customer_name text not null default '',

  -- e-Transfer amount; NULL for order events.
  amount numeric(12, 2),

  created_at timestamptz not null default now()
);

-- The only read: newest first, paged 15 at a time.
create index notifications_created_idx
  on public.notifications (created_at desc);

-- Supports the ON DELETE CASCADE from orders without a sequential scan.
create index notifications_order_idx
  on public.notifications (order_id)
  where order_id is not null;

alter table public.notifications enable row level security;

-- Same single-org model as every other business table: authenticated has
-- full access, the Worker's service role bypasses RLS, anon gets nothing.
create policy authenticated_full_access on public.notifications
  for all to authenticated
  using (true) with check (true);
