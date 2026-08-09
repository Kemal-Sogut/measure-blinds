-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 19: rename fabrics -> materials.
-- "Fabric" is renamed to "Material" across the whole product; this is
-- the database half of that rename. Renames the fabrics table, the
-- three snapshot columns on line_items (fabric_* -> material_*), the
-- FK, the primary-key index, and the updated_at trigger, then rebuilds
-- update_order_with_items() against the new column names. Non-
-- destructive: only identifiers change, so existing orders keep their
-- snapshotted names/prices intact.

alter table public.fabrics rename to materials;
alter index if exists fabrics_pkey rename to materials_pkey;

do $$
begin
  if exists (
    select 1 from pg_trigger
    where tgname = 'fabrics_set_updated_at'
      and tgrelid = 'public.materials'::regclass
  ) then
    execute 'alter trigger fabrics_set_updated_at on public.materials rename to materials_set_updated_at';
  end if;
end $$;

alter table public.line_items rename column fabric_id to material_id;
alter table public.line_items rename column fabric_name to material_name;
alter table public.line_items rename column fabric_price_per_sqm to material_price_per_sqm;
alter table public.line_items rename constraint line_items_fabric_id_fkey to line_items_material_id_fkey;

-- Rebuild the atomic order-update RPC against the renamed columns. The
-- previous body referenced fabric_* columns which no longer exist; a
-- void return means CREATE OR REPLACE keeps the same signature/grants.
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

  -- Every row carries the SAME column set (resolveLineItems guarantees
  -- this), so jsonb_to_recordset maps 1:1 onto the insert column list.
  insert into public.line_items (
    order_id, item_type, position, room_name, blinds_type, panels, height_cm,
    material_id, material_name, material_price_per_sqm,
    cassette_id, cassette_name, cassette_price_per_m,
    control_id, control_name, control_price_per_item,
    description, note, quantity, unit_price, line_total
  )
  select
    p_order_id, i.item_type, i.position,
    coalesce(i.room_name, ''), coalesce(i.blinds_type, ''),
    coalesce(i.panels, '[]'::jsonb), i.height_cm,
    i.material_id, i.material_name, i.material_price_per_sqm,
    i.cassette_id, i.cassette_name, i.cassette_price_per_m,
    i.control_id, i.control_name, i.control_price_per_item,
    coalesce(i.description, ''), coalesce(i.note, ''),
    i.quantity, i.unit_price, i.line_total
  from jsonb_to_recordset(p_items) as i(
    item_type text, position int, room_name text, blinds_type text,
    panels jsonb, height_cm numeric,
    material_id uuid, material_name text, material_price_per_sqm numeric,
    cassette_id uuid, cassette_name text, cassette_price_per_m numeric,
    control_id uuid, control_name text, control_price_per_item numeric,
    description text, note text, quantity int, unit_price numeric, line_total numeric
  );
end;
$$;

-- Worker-only entry point: nothing but the service role may call it.
revoke execute on function public.update_order_with_items(uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.update_order_with_items(uuid, jsonb, jsonb)
  to service_role;
