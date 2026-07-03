-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 08: estimates.
-- Estimate lifecycle: draft → sent → confirmed | expired.
-- Totals are stored as computed by the Worker (authoritative,
-- discount applied before 13% HST). public_token is the unguessable
-- capability for the customer-facing view; it is only ever read
-- through the Worker's /public routes, never via the anon key.
--
-- order_number carries a UNIQUE index (stability improvement):
-- generation counts estimates per day, which can race under
-- concurrent saves — the index makes duplicates impossible and the
-- Worker retries with an incremented count on conflict.

create table public.estimates (
  id uuid primary key default gen_random_uuid(),
  order_number text not null,
  customer_id uuid not null references public.customers (id) on delete restrict,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'confirmed', 'expired')),

  estimate_date date not null default current_date,
  expiry_date date not null,
  sent_at timestamptz,
  confirmed_at timestamptz,

  subtotal numeric(10,2) not null default 0,
  discount_type text not null default 'fixed'
    check (discount_type in ('fixed', 'percent')),
  discount_value numeric(10,2) not null default 0 check (discount_value >= 0),
  discount_amount numeric(10,2) not null default 0,
  taxable_amount numeric(10,2) not null default 0,
  tax_rate numeric(5,4) not null default 0.13,
  tax_amount numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,

  public_token uuid unique,
  terms_snapshot text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint expiry_not_before_estimate check (expiry_date >= estimate_date)
);

-- DB-level guard against duplicate order numbers (see header comment).
create unique index estimates_order_number_key
  on public.estimates (order_number);

-- List page filters by status; search joins on customer.
create index estimates_status_idx on public.estimates (status, estimate_date desc);
create index estimates_customer_idx on public.estimates (customer_id);

create trigger estimates_set_updated_at
  before update on public.estimates
  for each row execute function public.set_updated_at();

alter table public.estimates enable row level security;

create policy authenticated_full_access on public.estimates
  for all to authenticated
  using (true) with check (true);

-- NOTE (deliberate deviation from the original plan): no anon-role RLS
-- policy is created for public estimate reads. A blanket anon SELECT
-- would let anyone with the anon key enumerate estimates. The public
-- customer view is served exclusively by the Worker (service role),
-- which looks up exactly one row by public_token.
