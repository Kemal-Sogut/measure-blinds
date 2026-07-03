-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 07: customers.
-- Customer records with separate shipping and billing address blocks.
-- billing_same_as_shipping = true means the billing_* columns are
-- ignored and shipping values are used everywhere (PDF bill-to, etc.).
-- Rows are soft-deleted via deleted_at so historical estimates keep
-- their customer reference.

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  email text not null default '',
  phone text not null default '',

  shipping_address_line1 text not null default '',
  shipping_address_line2 text not null default '',
  shipping_city text not null default '',
  shipping_province text not null default 'ON',
  shipping_postal_code text not null default '',

  billing_same_as_shipping boolean not null default true,
  billing_address_line1 text not null default '',
  billing_address_line2 text not null default '',
  billing_city text not null default '',
  billing_province text not null default '',
  billing_postal_code text not null default '',

  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Supports the customer search (?q= ILIKE across name/email/phone).
create index customers_search_idx
  on public.customers (last_name, first_name)
  where deleted_at is null;

create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

alter table public.customers enable row level security;

create policy authenticated_full_access on public.customers
  for all to authenticated
  using (true) with check (true);
