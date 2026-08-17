-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 38: per-blind-type default options.
--
-- One row per blind type holding the shop's preferred Material and one
-- default per hardware slot. NULL means "no default" — the form field
-- starts empty exactly as before this migration. Deleting an option
-- degrades the default to NULL (ON DELETE SET NULL) rather than blocking
-- the delete or leaving a dangling id; deleting the blind type removes
-- the row. The Worker validates on write that every id is an ACTIVE
-- option scoped to the type, so a stored default can always be applied
-- by the form without re-validation.
--
-- RE-RUNNABLE: every statement is guarded.

create table if not exists public.blind_type_defaults (
  blind_type_id   uuid primary key references public.blind_types (id)          on delete cascade,
  material_id     uuid          references public.materials (id)               on delete set null,
  cassette_id     uuid          references public.cassette_options (id)        on delete set null,
  bottom_rail_id  uuid          references public.bottom_rail_options (id)     on delete set null,
  control_id      uuid          references public.control_options (id)         on delete set null,
  installation_id uuid          references public.installation_options (id)    on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- public.set_updated_at() is defined in migration 00 (init_helpers) and
-- reused by every table in this schema; guarded via pg_trigger the same
-- way migration 19 (rename_fabrics_to_materials) checks for it.
do $$ begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'blind_type_defaults_set_updated_at'
      and tgrelid = 'public.blind_type_defaults'::regclass
  ) then
    create trigger blind_type_defaults_set_updated_at
      before update on public.blind_type_defaults
      for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.blind_type_defaults enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'blind_type_defaults' and policyname = 'authenticated_full_access') then
    create policy authenticated_full_access on public.blind_type_defaults
      for all to authenticated using (true) with check (true);
  end if;
end $$;
