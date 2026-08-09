-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 21: align blind_types to the canonical product list.
-- Ten supported blind types, each with its own dedicated calculation
-- logic module (see apps/*/src/lib/calculators): Roller, Zebra, Roman,
-- Sunscreen/Solar, Honeycomb, Shutter, Vertical Sheer, Vertical Panel,
-- Vertical Roller, Curtains.
--
-- Non-destructive: pre-existing rows are renamed to the canonical label
-- where they map; any not in the list are kept but pushed to the end.
-- Line-item snapshots (blinds_type text) are unaffected — the pricing
-- registry normalises the snapshotted name to pick a calculator, so old
-- values like "Roller Blind" still resolve to the Roller calculator.

update public.blind_types set name = 'Roller',    sort_order = 1 where name = 'Roller Blind';
update public.blind_types set name = 'Zebra',     sort_order = 2 where name = 'Zebra Blind';
update public.blind_types set name = 'Roman',     sort_order = 3 where name = 'Roman Blind';
update public.blind_types set name = 'Honeycomb', sort_order = 5 where name = 'Honeycomb Blind';
-- Not part of the canonical ten — keep the row (data preservation) but
-- move it after the supported types.
update public.blind_types set sort_order = 99 where name = 'Venetian Blind';

insert into public.blind_types (name, sort_order)
select v.name, v.sort_order
from (values
  ('Roller',          1),
  ('Zebra',           2),
  ('Roman',           3),
  ('Sunscreen/Solar', 4),
  ('Honeycomb',       5),
  ('Shutter',         6),
  ('Vertical Sheer',  7),
  ('Vertical Panel',  8),
  ('Vertical Roller', 9),
  ('Curtains',        10)
) as v(name, sort_order)
where not exists (
  select 1 from public.blind_types b where b.name = v.name
);
