-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 14: blind_types.
-- Catalog of blind types (Roller, Zebra, Roman, …) selectable from a
-- dropdown in the blind line-item editor. Unlike fabrics/cassettes/
-- controls this catalog has NO price — it only labels the blind. The
-- chosen type's NAME is snapshotted onto line_items.blinds_type, so
-- renaming or deleting a type never rewrites existing estimates.

create table public.blind_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger blind_types_set_updated_at
  before update on public.blind_types
  for each row execute function public.set_updated_at();

alter table public.blind_types enable row level security;

create policy authenticated_full_access on public.blind_types
  for all to authenticated
  using (true) with check (true);
