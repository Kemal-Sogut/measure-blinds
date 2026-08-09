-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 17: order_logs.
--
-- An append-only activity trail for an order (created, edited, sent,
-- confirmed, payments, lifecycle transitions, installation scheduling).
-- Rows are inserted by the Worker only — there is no update/delete path,
-- so the log is a faithful history of what happened and when.

create table public.order_logs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,

  -- Human-readable description of what happened, e.g. "Payment of
  -- $150.00 recorded." Kept as plain text (no structured event type)
  -- since the log is read-only display, never machine-parsed.
  message text not null,

  created_at timestamptz not null default now()
);

-- Detail reads fetch one order's logs newest-first.
create index order_logs_order_idx on public.order_logs (order_id, created_at desc);

alter table public.order_logs enable row level security;

-- Same single-org model as every other table: the authenticated role
-- has full access; the Worker's service role bypasses RLS; anon gets
-- nothing (no public log access exists).
create policy authenticated_full_access on public.order_logs
  for all to authenticated
  using (true) with check (true);
