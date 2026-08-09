-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 20: material_blind_types join table.
-- Many-to-many link deciding which Materials appear for which blind
-- type in the line-item editor's Material dropdown. A single Material
-- can belong to several blind types with no duplication.
--
-- CONVENTION: a Material with NO links is treated as available for ALL
-- blind types (enforced in the settings/orders API and the editor), so
-- pre-existing Materials keep working until they are explicitly scoped.
-- Both sides cascade-delete: removing a Material or a blind type clears
-- its links (never the counterpart catalog row).

create table public.material_blind_types (
  material_id   uuid not null references public.materials (id)   on delete cascade,
  blind_type_id uuid not null references public.blind_types (id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (material_id, blind_type_id)
);

create index material_blind_types_blind_type_idx
  on public.material_blind_types (blind_type_id);

alter table public.material_blind_types enable row level security;

create policy authenticated_full_access on public.material_blind_types
  for all to authenticated
  using (true) with check (true);
