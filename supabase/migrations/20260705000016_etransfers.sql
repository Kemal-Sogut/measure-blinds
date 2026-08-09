-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 16: etransfers (e-Transfer reconciliation inbox).
--
-- Incoming Interac e-Transfer notifications are posted here by a Google
-- Apps Script webhook. When the order can be identified (order number in
-- the message, or a confident customer-name + amount match) the payment
-- is recorded automatically and the row is marked 'applied'. Otherwise
-- the row stays 'pending' and surfaces at the top of the Record Payment
-- popup so a consultant can assign it to the right order in one tap.
--
-- gmail_message_id is UNIQUE so the webhook is idempotent — a retried or
-- duplicated email never records the same payment twice.

create table public.etransfers (
  id uuid primary key default gen_random_uuid(),
  gmail_message_id text unique,
  amount numeric(10,2) not null check (amount > 0),
  sender text not null default '',
  reference_message text not null default '',
  received_at timestamptz not null default now(),
  raw_snippet text not null default '',
  status text not null default 'pending' check (status in ('pending', 'applied', 'dismissed')),
  order_id uuid references public.orders (id) on delete set null,
  payment_id uuid references public.payments (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index etransfers_status_idx on public.etransfers (status, received_at desc);

create trigger etransfers_set_updated_at
  before update on public.etransfers
  for each row execute function public.set_updated_at();

alter table public.etransfers enable row level security;

create policy authenticated_full_access on public.etransfers
  for all to authenticated
  using (true) with check (true);
