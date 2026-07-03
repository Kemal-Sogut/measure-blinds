-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 00: shared helpers.
-- Defines the updated_at trigger function used by every table so that
-- row modification timestamps are maintained by the database itself,
-- not by application code that could forget to set them.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''  -- pinned per Supabase advisor lint 0011 (mutable search_path)
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
