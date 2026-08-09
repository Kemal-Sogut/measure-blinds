-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 20: standalone appointments table.
--
-- Scheduling moves OFF the orders table into one first-class
-- `appointments` table covering both kinds of visit:
--   kind = 'estimate'      — a free in-home estimate visit, attached to
--                            a CUSTOMER only. No order is ever attached
--                            to an estimate appointment.
--   kind = 'installation'  — attached to the order being installed (the
--                            customer email references its number).
--
-- Each appointment carries its own unguessable public_token: the
-- customer confirms / requests-another-time on a dedicated public
-- appointment page, independent of the order estimate page. Active
-- schedules that lived on orders columns are carried over, then the old
-- columns are dropped (orders keep installed_at / review_request_sent_at
-- — those belong to the order lifecycle, not scheduling).

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('estimate', 'installation')),
  customer_id uuid not null references public.customers (id) on delete cascade,
  -- Installations belong to an order; estimate visits NEVER do.
  order_id uuid references public.orders (id) on delete cascade,
  appointment_date date not null,
  appointment_time time not null,
  -- Proposals are always emailed at creation, so 'proposed' is the floor.
  status text not null default 'proposed'
    check (status in ('proposed', 'confirmed', 'change_requested')),
  confirmed_at timestamptz,
  -- Free-text the customer leaves when requesting a different time.
  response_note text not null default '',
  -- Day-before reminder dedup stamp (cleared on re-propose).
  reminder_sent_at timestamptz,
  public_token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint installation_requires_order check (kind = 'estimate' or order_id is not null),
  constraint estimate_never_has_order check (kind = 'installation' or order_id is null)
);

-- Calendar range scans + joins.
create index appointments_date_idx on public.appointments (appointment_date);
create index appointments_customer_idx on public.appointments (customer_id);
-- One installation schedule per order — re-proposing updates the row.
create unique index appointments_order_unique
  on public.appointments (order_id) where order_id is not null;

create trigger appointments_set_updated_at
  before update on public.appointments
  for each row execute function public.set_updated_at();

alter table public.appointments enable row level security;

create policy authenticated_full_access on public.appointments
  for all to authenticated
  using (true) with check (true);

-- NOTE: no anon-role RLS policy on purpose — the public confirm/request
-- page is served exclusively by the Worker (service role), which looks
-- up exactly one row by public_token.

-- Carry over schedules that currently live on orders columns.
insert into public.appointments
  (kind, customer_id, order_id, appointment_date, appointment_time,
   status, confirmed_at, response_note, reminder_sent_at)
select 'installation', o.customer_id, o.id, o.install_date, o.install_time,
       o.install_status, o.install_confirmed_at, o.install_response_note,
       o.install_reminder_sent_at
from public.orders o
where o.install_status in ('proposed', 'confirmed', 'change_requested')
  and o.install_date is not null and o.install_time is not null;

insert into public.appointments
  (kind, customer_id, order_id, appointment_date, appointment_time,
   status, confirmed_at, response_note, reminder_sent_at)
select 'estimate', o.customer_id, null, o.appointment_date, o.appointment_time,
       o.appointment_status, o.appointment_confirmed_at, o.appointment_response_note,
       o.appointment_reminder_sent_at
from public.orders o
where o.appointment_status in ('proposed', 'confirmed', 'change_requested')
  and o.appointment_date is not null and o.appointment_time is not null;

-- Retire the per-order scheduling columns.
alter table public.orders
  drop column install_date,
  drop column install_time,
  drop column install_status,
  drop column install_confirmed_at,
  drop column install_response_note,
  drop column install_reminder_sent_at,
  drop column appointment_date,
  drop column appointment_time,
  drop column appointment_status,
  drop column appointment_confirmed_at,
  drop column appointment_response_note,
  drop column appointment_reminder_sent_at;
