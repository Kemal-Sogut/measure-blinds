-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 48: the "Dual Shades" blind type.
--
-- A Dual Shade is one headrail carrying two independent rolls -- a FRONT
-- and a BACK fabric -- each with its own control and bottom rail. Pricing
-- lives in apps/*/src/lib/blindTypes/dualShades.ts: area x (front rate +
-- back rate), control and bottom rail charged twice. The front fabric is
-- the ordinary line_items.material_id; the back fabric is the
-- attributes.back_material_id catalog ref, resolved by the Worker.
--
-- Dual Shades has its OWN fabric list. It starts as a COPY of every
-- material linked to Roller: new materials rows (same name, price, width,
-- active flag, sort order) linked ONLY to Dual Shades. Nothing is shared,
-- so editing or deleting a Dual fabric in Settings never touches Roller.
--
-- Hardware: the new type inherits Roller's CURRENT scoping (cassette,
-- bottom rail, control, installation -- migration 35: an option with no
-- link is shown for NO type) and Roller's hardware defaults (migration
-- 38). The default MATERIAL is deliberately not copied: it would point at
-- a Roller row, which Dual no longer lists.
--
-- RE-RUNNABLE and ONE-SHOT, like migration 44: everything happens only on
-- the run that creates the row, so a re-run can never resurrect a fabric
-- or link the shop has since removed.

do $$
declare
  v_roller uuid;
  v_dual   uuid;
  r        record;
  v_new    uuid;
begin
  if exists (select 1 from public.blind_types where name = 'Dual Shades') then
    return;
  end if;

  insert into public.blind_types (name, sort_order)
  values ('Dual Shades', 12)
  returning id into v_dual;

  select id into v_roller
    from public.blind_types
   where name = 'Roller'
   order by created_at
   limit 1;

  -- No Roller row (a database seeded differently): Dual Shades is created
  -- unscoped and with no fabrics; the shop configures it in Settings.
  if v_roller is null then
    return;
  end if;

  insert into public.cassette_option_blind_types (cassette_option_id, blind_type_id)
  select cassette_option_id, v_dual
    from public.cassette_option_blind_types
   where blind_type_id = v_roller
  on conflict do nothing;

  insert into public.bottom_rail_option_blind_types (bottom_rail_option_id, blind_type_id)
  select bottom_rail_option_id, v_dual
    from public.bottom_rail_option_blind_types
   where blind_type_id = v_roller
  on conflict do nothing;

  insert into public.control_option_blind_types (control_option_id, blind_type_id)
  select control_option_id, v_dual
    from public.control_option_blind_types
   where blind_type_id = v_roller
  on conflict do nothing;

  insert into public.installation_option_blind_types (installation_option_id, blind_type_id)
  select installation_option_id, v_dual
    from public.installation_option_blind_types
   where blind_type_id = v_roller
  on conflict do nothing;

  insert into public.blind_type_defaults
    (blind_type_id, cassette_id, bottom_rail_id, control_id, installation_id)
  select v_dual, cassette_id, bottom_rail_id, control_id, installation_id
    from public.blind_type_defaults
   where blind_type_id = v_roller
  on conflict (blind_type_id) do nothing;

  -- Fabric copy: one NEW materials row per Roller material, each linked
  -- only to Dual Shades. Row by row so every copy gets exactly one link.
  for r in
    select m.name, m.price_per_sqm, m.width_cm, m.active, m.sort_order
      from public.materials m
      join public.material_blind_types mbt on mbt.material_id = m.id
     where mbt.blind_type_id = v_roller
     order by m.sort_order, m.name
  loop
    insert into public.materials (name, price_per_sqm, width_cm, active, sort_order)
    values (r.name, r.price_per_sqm, r.width_cm, r.active, r.sort_order)
    returning id into v_new;

    insert into public.material_blind_types (material_id, blind_type_id)
    values (v_new, v_dual);
  end loop;
end $$;
