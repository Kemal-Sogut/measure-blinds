-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 49: catalog rows are ARCHIVED, never deleted.
--
-- Until now Settings hard-deleted a material, hardware option, pleat type,
-- preset or blind type, and every `line_items` foreign key into those
-- catalogs was ON DELETE SET NULL. Deleting a row therefore REWROTE the
-- history of every order that used it: the id vanished from the line item
-- while its name/price snapshot stayed behind. That id is an input to the
-- price-lock fingerprint (migration 39), so the next save of a sent or
-- confirmed order no longer matched its lock and re-priced the item --
-- dropping the option's charge from an invoice, or refusing the save
-- outright ("a cassette option is required" / material_id not a uuid). A
-- deleted preset additionally became a "legacy" preset, which may not be
-- overridden, so a discounted line went back to full price.
--
-- From here on:
--
--   <catalog>.archived_at  timestamptz -- NULL = live. Set by the Settings
--                          DELETE route, which also sets active = false so
--                          every existing "active" filter (dropdowns, slot
--                          scoping, blind-type defaults) drops the row
--                          without a code change. The row itself stays, so
--                          ids on historical line items keep resolving and
--                          the Worker keeps pricing them exactly as quoted.
--
--   line_items FKs         ON DELETE RESTRICT. A hard delete of a catalog
--                          row that any line item still names now FAILS,
--                          so not even a manual SQL delete can repeat the
--                          damage. Rows nothing references can still be
--                          removed by hand.
--
-- The join tables (`<catalog>_blind_types`, `material_blind_types`) and
-- `blind_type_defaults` keep their CASCADE / SET NULL rules: they are
-- configuration, not history, and an archive never triggers them.
--
-- Nothing is backfilled: no row is archived by this migration, and the
-- live data held no casualties of the old SET NULL rule when it was
-- written (2026-10-25 audit). RE-RUNNABLE: every column is
-- `if not exists` and every constraint is dropped `if exists` first.

/* ------------------------------------------------------------------ */
/* 1. archived_at on every Settings catalog                            */
/* ------------------------------------------------------------------ */

alter table public.materials            add column if not exists archived_at timestamptz;
alter table public.cassette_options     add column if not exists archived_at timestamptz;
alter table public.bottom_rail_options  add column if not exists archived_at timestamptz;
alter table public.control_options      add column if not exists archived_at timestamptz;
alter table public.installation_options add column if not exists archived_at timestamptz;
alter table public.pleat_types          add column if not exists archived_at timestamptz;
alter table public.preset_line_items    add column if not exists archived_at timestamptz;
alter table public.blind_types          add column if not exists archived_at timestamptz;

comment on column public.materials.archived_at is
  'Set when deleted in Settings; the row stays so historical line items keep resolving. NULL = live.';
comment on column public.cassette_options.archived_at is
  'Set when deleted in Settings; the row stays so historical line items keep resolving. NULL = live.';
comment on column public.bottom_rail_options.archived_at is
  'Set when deleted in Settings; the row stays so historical line items keep resolving. NULL = live.';
comment on column public.control_options.archived_at is
  'Set when deleted in Settings; the row stays so historical line items keep resolving. NULL = live.';
comment on column public.installation_options.archived_at is
  'Set when deleted in Settings; the row stays so historical line items keep resolving. NULL = live.';
comment on column public.pleat_types.archived_at is
  'Set when deleted in Settings; the row stays so historical line items keep resolving. NULL = live.';
comment on column public.preset_line_items.archived_at is
  'Set when deleted in Settings; the row stays so historical line items keep resolving. NULL = live.';
comment on column public.blind_types.archived_at is
  'Set when deleted in Settings; the row stays so historical line items keep resolving. NULL = live.';

/* ------------------------------------------------------------------ */
/* 2. line_items foreign keys: SET NULL -> RESTRICT                    */
/* ------------------------------------------------------------------ */

alter table public.line_items drop constraint if exists line_items_material_id_fkey;
alter table public.line_items
  add constraint line_items_material_id_fkey
  foreign key (material_id) references public.materials (id) on delete restrict;

alter table public.line_items drop constraint if exists line_items_cassette_id_fkey;
alter table public.line_items
  add constraint line_items_cassette_id_fkey
  foreign key (cassette_id) references public.cassette_options (id) on delete restrict;

alter table public.line_items drop constraint if exists line_items_bottom_rail_id_fkey;
alter table public.line_items
  add constraint line_items_bottom_rail_id_fkey
  foreign key (bottom_rail_id) references public.bottom_rail_options (id) on delete restrict;

alter table public.line_items drop constraint if exists line_items_control_id_fkey;
alter table public.line_items
  add constraint line_items_control_id_fkey
  foreign key (control_id) references public.control_options (id) on delete restrict;

alter table public.line_items drop constraint if exists line_items_installation_id_fkey;
alter table public.line_items
  add constraint line_items_installation_id_fkey
  foreign key (installation_id) references public.installation_options (id) on delete restrict;

alter table public.line_items drop constraint if exists line_items_preset_id_fkey;
alter table public.line_items
  add constraint line_items_preset_id_fkey
  foreign key (preset_id) references public.preset_line_items (id) on delete restrict;
