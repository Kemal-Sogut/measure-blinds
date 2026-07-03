-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 09: line_items.
-- Line items belong to an estimate and cascade-delete with it.
-- item_type drives which columns are meaningful:
--   'blind'  → room/panels/height + fabric/cassette/control snapshots
--   'preset' → description + unit_price copied from preset_line_items
--   'custom' → free-form description + unit_price
-- Option prices and names are SNAPSHOTTED onto the row at save time so
-- later catalog edits never rewrite history. Option FKs are kept only
-- as provenance and null out if the catalog entry is deleted.

create table public.line_items (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates (id) on delete cascade,
  item_type text not null check (item_type in ('blind', 'preset', 'custom')),
  position int not null default 0,

  -- Blind-specific fields
  room_name text not null default '',
  blinds_type text not null default '',
  panels jsonb not null default '[]'::jsonb,
  height_cm numeric(10,2),

  fabric_id uuid references public.fabrics (id) on delete set null,
  fabric_name text,
  fabric_price_per_sqm numeric(10,2),

  cassette_id uuid references public.cassette_options (id) on delete set null,
  cassette_name text,
  cassette_price_per_m numeric(10,2),

  control_id uuid references public.control_options (id) on delete set null,
  control_name text,
  control_price_per_item numeric(10,2),

  -- Preset/custom fields
  description text not null default '',

  quantity int not null default 1 check (quantity >= 1),
  unit_price numeric(10,2) not null default 0,
  line_total numeric(10,2) not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index line_items_estimate_idx
  on public.line_items (estimate_id, position);

create trigger line_items_set_updated_at
  before update on public.line_items
  for each row execute function public.set_updated_at();

alter table public.line_items enable row level security;

create policy authenticated_full_access on public.line_items
  for all to authenticated
  using (true) with check (true);
