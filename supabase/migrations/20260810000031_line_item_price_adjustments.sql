-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.

-- Migration 31: per-line-item price adjustments.
--
-- Three consultant-facing capabilities share these columns:
--   * price override  — `unit_price` keeps meaning "the unit price
--     CHARGED", so every existing reader (PDF, manufacturer copy,
--     customer page, totals) stays correct untouched. `base_unit_price`
--     holds the server-calculated figure and is written ONLY while an
--     override is in effect, so `base_unit_price is not null` is the
--     single source of truth for "this item was overridden" — there is
--     no second boolean that could disagree with it.
--   * titled flat items — `title` is the headline; `description` is now
--     multi-line free text below it. Blind rows keep '' for both, since
--     their title is derived from room_name + blinds_type.
--   * add-ons — `[{"label": text, "price": number}]`, each price added
--     ONCE to the line total (never multiplied by quantity).
--
-- `preset_id` moves preset items onto server-side pricing: the Worker
-- reads the price from preset_line_items instead of trusting the client,
-- which is also what gives an overridden preset a default to reset TO.
-- Rows written before this migration have preset_id null; those keep
-- their historical client-sent unit_price and cannot be overridden.
--
-- Add-on prices and the override are the ONLY money a client may send
-- (alongside a custom item's own unit_price). They are clamped by the
-- Zod schemas in apps/api/src/routes/orders.ts and written to the order
-- activity log on every save.
--
-- update_order_with_items() is rebuilt so the five new columns survive
-- the delete-and-reinsert. Its body is otherwise identical to migration
-- 29 (20260809000029_line_item_attributes.sql).

alter table public.line_items
  add column title text not null default '',
  add column preset_id uuid references public.preset_line_items (id) on delete set null,
  add column base_unit_price numeric(10,2),
  add column show_original_price boolean not null default true,
  add column addons jsonb not null default '[]'::jsonb;

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
    description, note, color, attributes, quantity, unit_price, line_total,
    title, preset_id, base_unit_price, show_original_price, addons
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
    coalesce(i.attributes, '{}'::jsonb),
    i.quantity, i.unit_price, i.line_total,
    coalesce(i.title, ''), i.preset_id, i.base_unit_price,
    coalesce(i.show_original_price, true), coalesce(i.addons, '[]'::jsonb)
  from jsonb_to_recordset(p_items) as i(
    item_type text, position int, room_name text, blinds_type text,
    panels jsonb, height_cm numeric,
    material_id uuid, material_name text, material_price_per_sqm numeric,
    cassette_id uuid, cassette_name text, cassette_price_per_m numeric,
    bottom_rail_id uuid, bottom_rail_name text, bottom_rail_price_per_m numeric,
    control_id uuid, control_name text, control_price_per_item numeric,
    description text, note text, color text, attributes jsonb,
    quantity int, unit_price numeric, line_total numeric,
    title text, preset_id uuid, base_unit_price numeric,
    show_original_price boolean, addons jsonb
  );
end;
$$;
