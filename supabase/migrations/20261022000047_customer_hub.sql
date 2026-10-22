-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Multiple estimates per customer
-- (knowledge/specs/2026-10-20-customer-hub-multi-estimate-design.md).
--
-- 1. orders.title — optional consultant label ("Option A – Roller blinds")
--    that tells two estimates for the same customer apart. NULL means
--    "not shown anywhere"; the Worker normalises '' to NULL.
-- 2. customers.public_token — capability token behind the one customer
--    link (/c/:token). Minted lazily by the Worker, never regenerated.
--    No anon policy: the Worker reads it with the service role.
-- 3. orders_customer_created_idx — serves the Estimates page, which
--    groups estimates by customer and orders customers by the creation
--    date of their newest estimate (read newest-created first).

alter table public.orders
  add column title text
  constraint orders_title_length check (title is null or char_length(title) <= 120);

alter table public.customers
  add column public_token uuid unique;

create index orders_customer_created_idx
  on public.orders (customer_id, created_at desc);
