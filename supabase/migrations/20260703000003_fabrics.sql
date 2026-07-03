-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 03: fabrics.
-- Fabric catalog priced per square meter. Line items snapshot the
-- price at creation time, so editing a fabric here never changes
-- existing estimates. Money columns are NUMERIC(10,2) — never float.

create table public.fabrics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price_per_sqm numeric(10,2) not null check (price_per_sqm >= 0),
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger fabrics_set_updated_at
  before update on public.fabrics
  for each row execute function public.set_updated_at();

alter table public.fabrics enable row level security;

create policy authenticated_full_access on public.fabrics
  for all to authenticated
  using (true) with check (true);
