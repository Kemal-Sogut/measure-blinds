-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 30: pleat_types + installation_options — the two catalogs the
-- Curtains blind type prices from.
--
-- Curtains is the first blind type to leave the shared base formula. It is
-- priced by the running metre of fabric, and the quantity of fabric depends
-- on the pleat style's fullness:
--
--   fabric  = width_m x pleat multiplier x material price per metre
--   install = a fixed charge for the rod or track
--
-- Both values are PRICE INPUTS, so neither may arrive from the client. The
-- client sends only the row id, inside line_items.attributes; the Worker
-- looks the row up and snapshots its name and value into that same jsonb
-- (see apps/api/src/routes/orders.ts). Snapshotting is what stops a rename
-- or a reprice here from rewriting a historical order.
--
-- No line_items columns are added: migration 29's attributes jsonb holds
-- the snapshot, so update_order_with_items() stays correct as-is.
--
-- EVERY SEEDED VALUE IS THE IDENTITY FOR ITS OPERATION -- x1 for the
-- multiplier, +0 for the price. Pricing is recomputed server-side whenever
-- an order is saved, so a non-identity seed would silently move the total of
-- every existing Curtains order the moment someone re-saved it. Running this
-- migration therefore cannot change any price. The shop sets the real
-- multipliers and prices in Settings, and only orders saved after that pick
-- them up.
--
-- The consequence is deliberate and is surfaced in the UI: until the
-- multipliers are set, a curtain prices as flat fabric (x1). The pleat types
-- settings page carries a standing note saying exactly that.

create table public.pleat_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Fullness ratio: metres of fabric per metre of finished curtain width.
  -- Strictly positive -- a 0 multiplier would zero the whole line.
  multiplier numeric(10,2) not null check (multiplier > 0),
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger pleat_types_set_updated_at
  before update on public.pleat_types
  for each row execute function public.set_updated_at();

alter table public.pleat_types enable row level security;

create policy authenticated_full_access on public.pleat_types
  for all to authenticated
  using (true) with check (true);

insert into public.pleat_types (name, multiplier, sort_order) values
  ('No-pleat', 1, 0),
  ('Regular', 1, 1),
  ('Pinch', 1, 2);

create table public.installation_options (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Fixed charge per curtain, NOT per metre and NOT per panel.
  price_per_item numeric(10,2) not null check (price_per_item >= 0),
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger installation_options_set_updated_at
  before update on public.installation_options
  for each row execute function public.set_updated_at();

alter table public.installation_options enable row level security;

create policy authenticated_full_access on public.installation_options
  for all to authenticated
  using (true) with check (true);

insert into public.installation_options (name, price_per_item, sort_order) values
  ('Rod', 0, 0),
  ('Track', 0, 1);
