-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 06: preset_line_items.
-- Reusable non-blind line items (installation fee, valance, etc.)
-- with a fixed unit price, selectable from the estimate editor.

create table public.preset_line_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  unit_price numeric(10,2) not null check (unit_price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger preset_line_items_set_updated_at
  before update on public.preset_line_items
  for each row execute function public.set_updated_at();

alter table public.preset_line_items enable row level security;

create policy authenticated_full_access on public.preset_line_items
  for all to authenticated
  using (true) with check (true);
