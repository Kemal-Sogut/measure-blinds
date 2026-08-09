-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 12: payments ledger.
--
-- An order is paid off over one or more payments (e.g. a deposit then a
-- balance). Each payment is an immutable ledger row; the outstanding
-- BALANCE is derived as `orders.total - sum(payments.amount)` and is
-- never stored, so it can never drift from the ledger.
--
-- Recording the FIRST payment moves the order awaiting_payment →
-- in_progress and flips its generated PDF from "Estimate" to "Invoice"
-- (both handled by the Worker, not the schema).

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,

  -- Positive dollar amount tendered in this payment.
  amount numeric(10,2) not null check (amount > 0),
  -- Calendar date the money was received (defaults to today).
  paid_on date not null default current_date,
  -- Optional free-text note (method, reference, etc.).
  note text not null default '',

  created_at timestamptz not null default now()
);

-- Detail reads fetch a single order's payments oldest-first.
create index payments_order_idx on public.payments (order_id, paid_on);

alter table public.payments enable row level security;

-- Same single-org model as every other table: the authenticated role
-- has full access; the Worker's service role bypasses RLS; anon gets
-- nothing (no public payment access exists).
create policy authenticated_full_access on public.payments
  for all to authenticated
  using (true) with check (true);
