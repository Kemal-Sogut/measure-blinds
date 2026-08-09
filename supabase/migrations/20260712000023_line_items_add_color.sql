-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 23: line_items.color.
-- Free-text colour label for a blind line item (e.g. "White", "Oak").
-- Display-only: it has NO effect on pricing, but it is snapshotted onto
-- the line item and shown on the item detail, the PDF, and the public
-- customer estimate view. Rebuild update_order_with_items() so the
-- atomic edit path carries the new column too (its jsonb_to_recordset
-- column list and INSERT must include `color`).

alter table public.line_items
  add column color text not null default '';

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
    control_id, control_name, control_price_per_item,
    description, note, color, quantity, unit_price, line_total
  )
  select
    p_order_id, i.item_type, i.position,
    coalesce(i.room_name, ''), coalesce(i.blinds_type, ''),
    coalesce(i.panels, '[]'::jsonb), i.height_cm,
    i.material_id, i.material_name, i.material_price_per_sqm,
    i.cassette_id, i.cassette_name, i.cassette_price_per_m,
    i.control_id, i.control_name, i.control_price_per_item,
    coalesce(i.description, ''), coalesce(i.note, ''), coalesce(i.color, ''),
    i.quantity, i.unit_price, i.line_total
  from jsonb_to_recordset(p_items) as i(
    item_type text, position int, room_name text, blinds_type text,
    panels jsonb, height_cm numeric,
    material_id uuid, material_name text, material_price_per_sqm numeric,
    cassette_id uuid, cassette_name text, cassette_price_per_m numeric,
    control_id uuid, control_name text, control_price_per_item numeric,
    description text, note text, color text, quantity int, unit_price numeric, line_total numeric
  );
end;
$$;