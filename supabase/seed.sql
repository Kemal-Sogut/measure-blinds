-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Development seed data. Idempotent: safe to run repeatedly.
-- Gives the settings pages and estimate editor realistic catalog
-- entries to work with before the real price list is entered.

insert into public.company_settings (id, company_name, email, phone, default_expiry_days)
values (1, 'Blinds Nisa', 'blindsnisa@gmail.com', '', 14)
on conflict (id) do update set company_name = excluded.company_name;

insert into public.fabrics (name, price_per_sqm, sort_order)
select * from (values
  ('Light Filtering White', 45.00::numeric, 1),
  ('Light Filtering Grey',  45.00::numeric, 2),
  ('Blackout White',        55.00::numeric, 3),
  ('Blackout Grey',         55.00::numeric, 4),
  ('Sunscreen 5%',          65.00::numeric, 5)
) as v(name, price_per_sqm, sort_order)
where not exists (select 1 from public.fabrics);

insert into public.cassette_options (name, price_per_m, sort_order)
select * from (values
  ('No Cassette',      0.00::numeric, 1),
  ('Standard Cassette', 20.00::numeric, 2),
  ('Deluxe Cassette',   35.00::numeric, 3)
) as v(name, price_per_m, sort_order)
where not exists (select 1 from public.cassette_options);

insert into public.control_options (name, price_per_item, sort_order)
select * from (values
  ('Chain Control',  0.00::numeric, 1),
  ('Wand Control',  10.00::numeric, 2),
  ('Motorized',    150.00::numeric, 3)
) as v(name, price_per_item, sort_order)
where not exists (select 1 from public.control_options);

insert into public.preset_line_items (name, description, unit_price)
select * from (values
  ('Installation', 'Professional installation per blind', 25.00::numeric),
  ('Removal & Disposal', 'Remove and dispose of old blinds', 10.00::numeric),
  ('Service Call', 'On-site measurement and consultation', 50.00::numeric)
) as v(name, description, unit_price)
where not exists (select 1 from public.preset_line_items);
