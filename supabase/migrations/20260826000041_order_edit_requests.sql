-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 41: customer edit requests.
--
-- Before confirming an estimate a customer may want something changed
-- ("make the kitchen blind cordless", "drop the bay window"). Until now
-- the public page offered only Confirm, so that conversation happened
-- off-system and never reached the order record. This table is where it
-- lands, and the staff order page renders it beside the order being
-- edited.
--
-- A TABLE, not columns on `orders`. The cancellation request (migration
-- 27) is deliberately modelled as `orders.cancel_requested_at` because
-- it is a single optional side-conversation per order, never a
-- collection. An edit request is the opposite: a customer may send
-- several, and each is resolved on its own as staff work through them.
--
--   resolved_at IS NULL  → still needs an answer (shown on the order page)
--   resolved_at IS SET   → staff amended the order and closed it out
--
-- Rows are never deleted and never edited apart from that one stamp, so
-- the table doubles as the history of what the customer asked for.
--
-- No `resolved_by`: the app has a single-org permission model with no
-- per-user attribution anywhere else on the order, and `order_logs`
-- already records that the resolution happened.
--
-- The rule that requests are only accepted while the order is `sent`
-- (the pre-confirmation window in which the customer's action bar
-- exists at all) is enforced in the Worker, not here — it sits beside
-- the other public-surface guards in `apps/api/src/routes/public.ts`.

create table public.order_edit_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,

  -- The customer's free text, verbatim. Length is capped by the Worker
  -- (1000 chars) rather than by a column constraint, so tightening the
  -- limit later cannot orphan rows that are already stored.
  message text not null,

  created_at timestamptz not null default now(),

  -- Stamped when staff mark the request handled. Never cleared.
  resolved_at timestamptz
);

-- Both the staff card and the customer's own list read one order's
-- requests ordered by age.
create index order_edit_requests_order_idx
  on public.order_edit_requests (order_id, created_at desc);

-- Backs the per-order cap on OPEN requests (the Worker refuses a sixth),
-- which is a count of exactly this subset on every submit.
create index order_edit_requests_open_idx
  on public.order_edit_requests (order_id)
  where resolved_at is null;

alter table public.order_edit_requests enable row level security;

-- Same single-org model as every other table: the authenticated role has
-- full access; the Worker's service role bypasses RLS; anon gets nothing
-- (the customer reaches their own requests only through the token'd
-- /public/estimate/:token payload, which the Worker assembles).
create policy authenticated_full_access on public.order_edit_requests
  for all to authenticated
  using (true) with check (true);
