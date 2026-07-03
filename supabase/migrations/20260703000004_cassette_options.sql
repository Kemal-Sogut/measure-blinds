-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 04: cassette_options.
-- Cassette (headrail) catalog priced per linear meter of blind width.
-- Same snapshot-on-use pattern as fabrics.

create table public.cassette_options (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price_per_m numeric(10,2) not null check (price_per_m >= 0),
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger cassette_options_set_updated_at
  before update on public.cassette_options
  for each row execute function public.set_updated_at();

alter table public.cassette_options enable row level security;

create policy authenticated_full_access on public.cassette_options
  for all to authenticated
  using (true) with check (true);
