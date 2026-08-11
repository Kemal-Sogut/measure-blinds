-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 35: blind-type scoping for the four option catalogs, and the
-- promotion of Installation from a Curtains-only attribute to a real
-- line-item slot.
--
-- WHICH hardware slots a blind type uses stops being a code constant
-- (BaseBlindType.requiredCatalogs) and becomes data: an option is linked
-- to a blind type in a join table here, and a type uses a slot exactly
-- when at least one ACTIVE option is linked to it. The line-item form
-- renders the dropdown on the same rule and the Worker enforces the save
-- on it, so the form and the price can never disagree about a slot.
--
-- CONVENTION -- and it is the OPPOSITE of material_blind_types: an option
-- with NO links is shown for NO blind type. Empty-means-all would make it
-- impossible to switch a slot off for a type, which is the whole point.
-- That is why the backfill below is mandatory rather than cosmetic: it
-- reproduces today's hardcoded behaviour exactly, so applying this
-- migration changes nothing a user can see.
--
-- Installation moves out of line_items.attributes and into three columns.
-- The three jsonb keys are STRIPPED in the same migration: afterwards
-- curtains.ts no longer declares installation_id, its attributeSchema is
-- strict, and the editor re-parses a re-opened order's blob -- a key left
-- behind would be a 400 on the second save.
--
-- RE-RUNNABLE. Every statement is guarded, because this file was applied
-- once through the Supabase MCP before being run again from the CLI. The
-- backfill's guard is stronger than the rest (see section 2): a second run
-- must not re-seed links the shop has since deleted in Settings.

/* ------------------------------------------------------------------ */
/* 1. Join tables                                                      */
/* ------------------------------------------------------------------ */

create table if not exists public.cassette_option_blind_types (
  cassette_option_id uuid not null references public.cassette_options (id) on delete cascade,
  blind_type_id      uuid not null references public.blind_types (id)     on delete cascade,
  created_at         timestamptz not null default now(),
  primary key (cassette_option_id, blind_type_id)
);

create index if not exists cassette_option_blind_types_blind_type_idx
  on public.cassette_option_blind_types (blind_type_id);

create table if not exists public.bottom_rail_option_blind_types (
  bottom_rail_option_id uuid not null references public.bottom_rail_options (id) on delete cascade,
  blind_type_id         uuid not null references public.blind_types (id)         on delete cascade,
  created_at            timestamptz not null default now(),
  primary key (bottom_rail_option_id, blind_type_id)
);

create index if not exists bottom_rail_option_blind_types_blind_type_idx
  on public.bottom_rail_option_blind_types (blind_type_id);

create table if not exists public.control_option_blind_types (
  control_option_id uuid not null references public.control_options (id) on delete cascade,
  blind_type_id     uuid not null references public.blind_types (id)     on delete cascade,
  created_at        timestamptz not null default now(),
  primary key (control_option_id, blind_type_id)
);

create index if not exists control_option_blind_types_blind_type_idx
  on public.control_option_blind_types (blind_type_id);

create table if not exists public.installation_option_blind_types (
  installation_option_id uuid not null references public.installation_options (id) on delete cascade,
  blind_type_id          uuid not null references public.blind_types (id)          on delete cascade,
  created_at             timestamptz not null default now(),
  primary key (installation_option_id, blind_type_id)
);

create index if not exists installation_option_blind_types_blind_type_idx
  on public.installation_option_blind_types (blind_type_id);

alter table public.cassette_option_blind_types      enable row level security;
alter table public.bottom_rail_option_blind_types   enable row level security;
alter table public.control_option_blind_types       enable row level security;
alter table public.installation_option_blind_types  enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cassette_option_blind_types' and policyname = 'authenticated_full_access') then
    create policy authenticated_full_access on public.cassette_option_blind_types
      for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'bottom_rail_option_blind_types' and policyname = 'authenticated_full_access') then
    create policy authenticated_full_access on public.bottom_rail_option_blind_types
      for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'control_option_blind_types' and policyname = 'authenticated_full_access') then
    create policy authenticated_full_access on public.control_option_blind_types
      for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'installation_option_blind_types' and policyname = 'authenticated_full_access') then
    create policy authenticated_full_access on public.installation_option_blind_types
      for all to authenticated using (true) with check (true);
  end if;
end $$;

/* ------------------------------------------------------------------ */
/* 2. Backfill -- reproduces the hardcoded requiredCatalogs exactly     */
/* ------------------------------------------------------------------ */

-- ONE-SHOT, and the `not exists` guards are what make it so. This file is
-- re-runnable, and `on conflict do nothing` alone would not be enough: once
-- the shop has unscoped an option in Settings, re-running would silently
-- RESURRECT the link it deleted, switching a hardware slot back on behind
-- their back. Seeding only into an empty table means a re-run is a true
-- no-op, and the first run is the only one that decides anything.

-- Cassette and bottom rail: every type EXCEPT Curtains (whose module
-- declared requiredCatalogs = ['control']).
insert into public.cassette_option_blind_types (cassette_option_id, blind_type_id)
select o.id, t.id
  from public.cassette_options o
 cross join public.blind_types t
 where t.name <> 'Curtains'
   and not exists (select 1 from public.cassette_option_blind_types)
 on conflict do nothing;

insert into public.bottom_rail_option_blind_types (bottom_rail_option_id, blind_type_id)
select o.id, t.id
  from public.bottom_rail_options o
 cross join public.blind_types t
 where t.name <> 'Curtains'
   and not exists (select 1 from public.bottom_rail_option_blind_types)
 on conflict do nothing;

-- Control: every blind type, without exception.
insert into public.control_option_blind_types (control_option_id, blind_type_id)
select o.id, t.id
  from public.control_options o
 cross join public.blind_types t
 where not exists (select 1 from public.control_option_blind_types)
 on conflict do nothing;

-- Installation: Curtains only, matching the attribute it replaces.
insert into public.installation_option_blind_types (installation_option_id, blind_type_id)
select o.id, t.id
  from public.installation_options o
 cross join public.blind_types t
 where t.name = 'Curtains'
   and not exists (select 1 from public.installation_option_blind_types)
 on conflict do nothing;

/* ------------------------------------------------------------------ */
/* 3. Installation becomes a real slot                                 */
/* ------------------------------------------------------------------ */

alter table public.line_items
  add column if not exists installation_id uuid references public.installation_options (id) on delete set null,
  add column if not exists installation_name text,
  add column if not exists installation_price_per_item numeric(10,2);

-- Historical Curtains rows: move the snapshot out of the jsonb, then
-- remove the three keys so the strict attributeSchema still accepts the
-- blob on the next save.
update public.line_items
   set installation_id = nullif(attributes->>'installation_id', '')::uuid,
       installation_name = attributes->>'installation_name',
       installation_price_per_item = nullif(attributes->>'installation_price', '')::numeric
 where attributes ? 'installation_id';

update public.line_items
   set attributes = attributes - 'installation_id' - 'installation_name' - 'installation_price'
 where attributes ?| array['installation_id', 'installation_name', 'installation_price'];

/* ------------------------------------------------------------------ */
/* 4. update_order_with_items() rebuilt for the three new columns       */
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
    cassette_id, cassette_name, cassette_price_per_m,
    bottom_rail_id, bottom_rail_name, bottom_rail_price_per_m,
    control_id, control_name, control_price_per_item,
    installation_id, installation_name, installation_price_per_item,
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
    i.installation_id, i.installation_name, i.installation_price_per_item,
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
    installation_id uuid, installation_name text, installation_price_per_item numeric,
    description text, note text, color text, attributes jsonb,
    quantity int, unit_price numeric, line_total numeric,
    title text, preset_id uuid, base_unit_price numeric,
    show_original_price boolean, addons jsonb
  );
end;
$$;
