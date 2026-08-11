-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 36: every hardware option carries its own PRICE BASIS.
--
-- Until now the basis was hardcoded per catalog: a cassette and a bottom
-- rail were always per linear metre of width, a control always per panel,
-- an installation option always a flat charge per blind. The shop buys
-- some of these by the square metre and some by the unit, so the basis
-- moves onto the ROW: per_m, per_sqm, per_unit or per_panel, chosen next
-- to the price in Settings.
--
-- The price columns are RENAMED (price_per_m / price_per_item -> price)
-- rather than kept. A column called price_per_m holding a per-m2 rate is
-- the kind of lie that eventually becomes a wrong quote, and all four
-- catalogs now share one shape, which is what lets the Worker resolve
-- them through a single lookup instead of four.
--
-- EVERY DEFAULT REPRODUCES TODAY'S HARDCODED BASIS, so applying this
-- migration cannot move any price. Pricing is recomputed server-side on
-- every save, and a default that did not match the old constant would
-- silently reprice every order the moment someone re-saved it.
--
-- line_items keeps its *_price_per_m / *_price_per_item snapshot column
-- NAMES (nothing reads them; they are an audit trail, and renaming them
-- would rewrite history for no reader). Each gains a *_price_basis
-- sibling, because a rate with no basis is unreadable: "$12" says nothing
-- about what was charged.
--
-- RE-RUNNABLE, like migration 35: the renames are guarded on the old
-- column still existing, and every add-column is `if not exists`.

/* ------------------------------------------------------------------ */
/* 1. Catalogs: price_per_m / price_per_item -> price                  */
/* ------------------------------------------------------------------ */

do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('cassette_options',     'price_per_m'),
      ('bottom_rail_options',  'price_per_m'),
      ('control_options',      'price_per_item'),
      ('installation_options', 'price_per_item')
    ) as v(table_name, old_column)
  loop
    if exists (
      select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = t.table_name
         and column_name = t.old_column
    ) then
      execute format('alter table public.%I rename column %I to price', t.table_name, t.old_column);
    end if;
  end loop;
end $$;

/* ------------------------------------------------------------------ */
/* 2. Catalogs: the basis, defaulted to today's hardcoded constant     */
/* ------------------------------------------------------------------ */

alter table public.cassette_options
  add column if not exists price_basis text not null default 'per_m';
alter table public.bottom_rail_options
  add column if not exists price_basis text not null default 'per_m';
alter table public.control_options
  add column if not exists price_basis text not null default 'per_panel';
alter table public.installation_options
  add column if not exists price_basis text not null default 'per_unit';

-- Text + check rather than a Postgres enum: adding a fifth basis later is
-- one `alter ... check`, not a type migration with a rewrite behind it.
do $$
declare
  t text;
begin
  foreach t in array array[
    'cassette_options', 'bottom_rail_options', 'control_options', 'installation_options'
  ]
  loop
    if not exists (
      select 1 from pg_constraint
       where conname = t || '_price_basis_check'
         and conrelid = ('public.' || t)::regclass
    ) then
      execute format(
        'alter table public.%I add constraint %I check (price_basis in (%L, %L, %L, %L))',
        t, t || '_price_basis_check', 'per_m', 'per_sqm', 'per_unit', 'per_panel'
      );
    end if;
  end loop;
end $$;

/* ------------------------------------------------------------------ */
/* 3. line_items: snapshot the basis beside the rate                   */
/* ------------------------------------------------------------------ */

alter table public.line_items
  add column if not exists cassette_price_basis text,
  add column if not exists bottom_rail_price_basis text,
  add column if not exists control_price_basis text,
  add column if not exists installation_price_basis text;

-- Backfill the basis every historical row was actually charged on, which
-- is the old per-catalog constant. Only where the slot was filled: a null
-- id means no charge, and a basis there would imply one.
update public.line_items
   set cassette_price_basis = 'per_m'
 where cassette_id is not null and cassette_price_basis is null;

update public.line_items
   set bottom_rail_price_basis = 'per_m'
 where bottom_rail_id is not null and bottom_rail_price_basis is null;

update public.line_items
   set control_price_basis = 'per_panel'
 where control_id is not null and control_price_basis is null;

update public.line_items
   set installation_price_basis = 'per_unit'
 where installation_id is not null and installation_price_basis is null;

/* ------------------------------------------------------------------ */
/* 4. update_order_with_items() rebuilt for the four basis columns      */
/* ------------------------------------------------------------------ */

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
    cassette_id, cassette_name, cassette_price_per_m, cassette_price_basis,
    bottom_rail_id, bottom_rail_name, bottom_rail_price_per_m, bottom_rail_price_basis,
    control_id, control_name, control_price_per_item, control_price_basis,
    installation_id, installation_name, installation_price_per_item, installation_price_basis,
    description, note, color, attributes, quantity, unit_price, line_total,
    title, preset_id, base_unit_price, show_original_price, addons
  )
  select
    p_order_id, i.item_type, i.position,
    coalesce(i.room_name, ''), coalesce(i.blinds_type, ''),
    coalesce(i.panels, '[]'::jsonb), i.height_cm,
    i.material_id, i.material_name, i.material_price_per_sqm,
    i.cassette_id, i.cassette_name, i.cassette_price_per_m, i.cassette_price_basis,
    i.bottom_rail_id, i.bottom_rail_name, i.bottom_rail_price_per_m, i.bottom_rail_price_basis,
    i.control_id, i.control_name, i.control_price_per_item, i.control_price_basis,
    i.installation_id, i.installation_name, i.installation_price_per_item,
    i.installation_price_basis,
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
    cassette_price_basis text,
    bottom_rail_id uuid, bottom_rail_name text, bottom_rail_price_per_m numeric,
    bottom_rail_price_basis text,
    control_id uuid, control_name text, control_price_per_item numeric,
    control_price_basis text,
    installation_id uuid, installation_name text, installation_price_per_item numeric,
    installation_price_basis text,
    description text, note text, color text, attributes jsonb,
    quantity int, unit_price numeric, line_total numeric,
    title text, preset_id uuid, base_unit_price numeric,
    show_original_price boolean, addons jsonb
  );
end;
$$;
