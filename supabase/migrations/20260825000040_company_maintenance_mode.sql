-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 40: customer-facing maintenance mode.
-- Two fields on the company_settings singleton that let staff close the
-- CUSTOMER surfaces (`/public/*` — estimate and appointment token pages)
-- without touching the authenticated staff app, which keeps working so
-- the work that motivated the pause can actually be done.
--
-- `maintenance_mode` is not-null with a false default so the flag is
-- always a boolean the Worker can branch on — a NULL "maybe closed" has
-- no meaning here, and an existing install must stay OPEN across this
-- migration. `maintenance_message` is the wording customers read; empty
-- (the default) means the Worker serves its own neutral fallback line,
-- so turning the flag on alone is a complete, sane state.
--
-- No money column, no order column, and no status semantics are touched:
-- the flag gates request admission only and changes no stored record.

alter table public.company_settings
  add column maintenance_mode boolean not null default false,
  add column maintenance_message text not null default '';

comment on column public.company_settings.maintenance_mode is
  'When true the Worker refuses every /public/* request with 503; the authenticated staff app is unaffected.';

comment on column public.company_settings.maintenance_message is
  'Wording shown to customers while maintenance_mode is on; empty means the Worker''s default line.';
