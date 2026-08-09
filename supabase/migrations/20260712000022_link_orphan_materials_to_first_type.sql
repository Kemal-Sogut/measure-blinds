-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 22: attach orphaned Materials to a default blind type.
-- The Materials UI now manages Materials per blind type (only materials
-- LINKED to a type appear under it), so any Material with no links would
-- be invisible everywhere. Link every currently-unlinked Material to the
-- first canonical type (Roller) so nothing is orphaned; users can
-- reassign in the UI. Idempotent: skips Materials that already have a
-- link, and no-ops if there is no 'Roller' type.

insert into public.material_blind_types (material_id, blind_type_id)
select m.id, bt.id
from public.materials m
cross join (select id from public.blind_types where name = 'Roller' limit 1) bt
where not exists (
  select 1 from public.material_blind_types l where l.material_id = m.id
)
on conflict do nothing;
