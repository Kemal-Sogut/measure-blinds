-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 29: the Cordless control option.
--
-- The shop sells a cordless control but had no catalog row for it, so it
-- was being written into orders as a Safety-Wand. It is added here rather
-- than through the Settings UI so a rebuilt database has the same control
-- catalog the live project does, and so the production label's control
-- code "C" has a real option behind it (see apps/web/src/lib/labels.ts).
--
-- Priced at 0, for the same reason both bottom rails were (migration 28):
-- pricing is recomputed server-side on every save, so a non-zero seed
-- would silently raise the total of any existing order the moment someone
-- re-saved it. The shop sets the real price in Settings when ready.
--
-- Sorted last so the existing option order on the line-item editor does
-- not shift under anyone mid-quote. No line_items backfill: control is
-- chosen per blind and no historical row was sold as Cordless.
--
-- Idempotent by name — the insert is skipped if the maintainer already
-- added the option by hand in Settings, which would otherwise leave two
-- identically named controls in the dropdown.

insert into public.control_options (name, price_per_item, sort_order)
select 'Cordless', 0, 4
where not exists (
  select 1 from public.control_options where name = 'Cordless'
);
