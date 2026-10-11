-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 44: the "Sheer" blind type.
--
-- Sheer prices exactly like Curtains: its pricing module
-- (apps/*/src/lib/blindTypes/sheer.ts) subclasses CurtainsBlindType, so
-- fabric is charged per RUNNING METRE of width x pleat fullness plus the
-- per-panel hem allowance, and a Sheer material's price_per_sqm column
-- holds dollars per running metre. It is NOT "Vertical Sheer", which
-- keeps the shared area formula; the pricing registry normalises the two
-- names to different keys.
--
-- Which hardware slots a type uses is DATA (migration 35: an option with
-- no link is shown for NO type), so a bare blind_types row would give
-- Sheer no control and no installation dropdown at all. The new row
-- therefore inherits Curtains' CURRENT scoping -- whatever control,
-- installation (and, if the shop has added any, cassette / bottom rail)
-- options are linked to Curtains right now -- plus Curtains' hardware
-- defaults (migration 38). The default MATERIAL is deliberately not
-- copied: sheer fabric is a different product, added on the Sheer
-- Materials page.
--
-- RE-RUNNABLE and ONE-SHOT: everything happens only on the run that
-- creates the row. Once Sheer exists, a re-run is a true no-op, so it can
-- never resurrect a link the shop has since removed in Settings (the same
-- hazard migration 35's backfill guards against).

do $$
declare
  v_curtains uuid;
  v_sheer    uuid;
begin
  if exists (select 1 from public.blind_types where name = 'Sheer') then
    return;
  end if;

  insert into public.blind_types (name, sort_order)
  values ('Sheer', 11)
  returning id into v_sheer;

  select id into v_curtains
    from public.blind_types
   where name = 'Curtains'
   order by created_at
   limit 1;

  -- No Curtains row (a fresh database seeded differently): Sheer is
  -- created unscoped and the shop links its hardware in Settings.
  if v_curtains is null then
    return;
  end if;

  insert into public.cassette_option_blind_types (cassette_option_id, blind_type_id)
  select cassette_option_id, v_sheer
    from public.cassette_option_blind_types
   where blind_type_id = v_curtains
  on conflict do nothing;

  insert into public.bottom_rail_option_blind_types (bottom_rail_option_id, blind_type_id)
  select bottom_rail_option_id, v_sheer
    from public.bottom_rail_option_blind_types
   where blind_type_id = v_curtains
  on conflict do nothing;

  insert into public.control_option_blind_types (control_option_id, blind_type_id)
  select control_option_id, v_sheer
    from public.control_option_blind_types
   where blind_type_id = v_curtains
  on conflict do nothing;

  insert into public.installation_option_blind_types (installation_option_id, blind_type_id)
  select installation_option_id, v_sheer
    from public.installation_option_blind_types
   where blind_type_id = v_curtains
  on conflict do nothing;

  insert into public.blind_type_defaults
    (blind_type_id, cassette_id, bottom_rail_id, control_id, installation_id)
  select v_sheer, cassette_id, bottom_rail_id, control_id, installation_id
    from public.blind_type_defaults
   where blind_type_id = v_curtains
  on conflict (blind_type_id) do nothing;
end $$;
