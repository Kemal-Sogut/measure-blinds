-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 01: profiles.
-- One row per authenticated user, keyed to auth.users. Holds display
-- name and role. Single-org model: every authenticated user sees all
-- data; the role field exists for future permission tightening.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  role text not null default 'consultant'
    check (role in ('admin', 'consultant')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

create policy authenticated_full_access on public.profiles
  for all to authenticated
  using (true) with check (true);
