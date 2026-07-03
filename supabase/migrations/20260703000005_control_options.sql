-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 05: control_options.
-- Control mechanism catalog (chain, motor, etc.) priced per item;
-- the pricing engine charges one control per panel.

create table public.control_options (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price_per_item numeric(10,2) not null check (price_per_item >= 0),
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger control_options_set_updated_at
  before update on public.control_options
  for each row execute function public.set_updated_at();

alter table public.control_options enable row level security;

create policy authenticated_full_access on public.control_options
  for all to authenticated
  using (true) with check (true);
