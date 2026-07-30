-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 28: bottom_rail_options + the line_items bottom-rail snapshot.
--
-- The bottom rail is the weighted bar at the foot of a blind. It is a
-- PRICED catalog, charged per linear metre of width exactly like the
-- cassette, so this table mirrors cassette_options column for column.
-- The chosen option's NAME and PRICE are snapshotted onto line_items, so
-- renaming or repricing an option never rewrites a historical order.
--
-- Both seeded options are priced at 0. That is deliberate: pricing is
-- recomputed server-side whenever an order is saved, so a non-zero seed
-- would silently raise the total of every existing order the moment
-- someone re-saved it. The shop sets real prices in Settings when ready,
-- and only orders saved after that pick them up.
--
-- Existing blind rows are backfilled to Regular. Without that, the
-- REQUIRED bottom_rail_id would make every historical order unsavable
-- until an operator picked a rail for each of its blinds. Preset and
-- custom rows keep NULL, exactly as they already do for cassette and
-- control.
--
-- update_order_with_items() is rebuilt because the atomic edit path
-- inserts an explicit column list: BOTH the insert list AND the
-- jsonb_to_recordset signature must name the new columns or the field is
-- silently dropped on every edit. Body copied from migration 23 with the
-- three bottom-rail columns added after cassette.

create table public.bottom_rail_options (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price_per_m numeric(10,2) not null default 0,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger bottom_rail_options_set_updated_at
  before update on public.bottom_rail_options
  for each row execute function public.set_updated_at();

alter table public.bottom_rail_options enable row level security;

create policy authenticated_full_access on public.bottom_rail_options
  for all to authenticated
  using (true) with check (true);

insert into public.bottom_rail_options (name, price_per_m, sort_order) values
  ('Regular', 0, 0),
  ('Pear', 0, 1);

alter table public.line_items
  add column bottom_rail_id uuid references public.bottom_rail_options (id) on delete set null,
  add column bottom_rail_name text,
  add column bottom_rail_price_per_m numeric(10,2);

update public.line_items
set bottom_rail_id = (select id from public.bottom_rail_options where name = 'Regular'),
    bottom_rail_name = 'Regular',
    bottom_rail_price_per_m = 0
where item_type = 'blind';

create or replace function public.update_order_with_items(
  p_order_id uuid,
  p_fields jsonb,
  p_items jsonb
) returns void
language plpgsql
set search_path = ''  -- pinned per Supabase advisor lint 0011 (mutable search_path)
as $$
begin
  update public.orders set
    customer_id     = (p_fields->>'customer_id')::uuid,
    order_date      = (p_fields->>'order_date')::date,
    expiry_date     = (p_fields->>'expiry_date')::date,
    discount_type   = p_fields->>'discount_type',
    discount_value  = (p_fields->>'discount_value')::numeric,
    subtotal        = (p_fields->>'subtotal')::numeric,
    discount_amount = (p_fields->>'discount_amount')::numeric,
    taxable_amount  = (p_fields->>'taxable_amount')::numeric,
    tax_rate        = (p_fields->>'tax_rate')::numeric,
    tax_amount      = (p_fields->>'tax_amount')::numeric,
    total           = (p_fields->>'total')::numeric
  where id = p_order_id;

  if not found then
    raise exception 'Order % not found', p_order_id;
  end if;

  delete from public.line_items where order_id = p_order_id;

  insert into public.line_items (
    order_id, item_type, position, room_name, blinds_type, panels, height_cm,
    material_id, material_name, material_price_per_sqm,
    cassette_id, cassette_name, cassette_price_per_m,
    bottom_rail_id, bottom_rail_name, bottom_rail_price_per_m,
    control_id, control_name, control_price_per_item,
    description, note, color, quantity, unit_price, line_total
  )
  select
    p_order_id, i.item_type, i.position,
    coalesce(i.room_name, ''), coalesce(i.blinds_type, ''),
    coalesce(i.panels, '[]'::jsonb), i.height_cm,
    i.material_id, i.material_name, i.material_price_per_sqm,
    i.cassette_id, i.cassette_name, i.cassette_price_per_m,
    i.bottom_rail_id, i.bottom_rail_name, i.bottom_rail_price_per_m,
    i.control_id, i.control_name, i.control_price_per_item,
    coalesce(i.description, ''), coalesce(i.note, ''), coalesce(i.color, ''),
    i.quantity, i.unit_price, i.line_total
  from jsonb_to_recordset(p_items) as i(
    item_type text, position int, room_name text, blinds_type text,
    panels jsonb, height_cm numeric,
    material_id uuid, material_name text, material_price_per_sqm numeric,
    cassette_id uuid, cassette_name text, cassette_price_per_m numeric,
    bottom_rail_id uuid, bottom_rail_name text, bottom_rail_price_per_m numeric,
    control_id uuid, control_name text, control_price_per_item numeric,
    description text, note text, color text, quantity int, unit_price numeric, line_total numeric
  );
end;
$$;
