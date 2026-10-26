-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 50: numbered, frozen revisions of what the customer was SENT.
--
-- Migration 48 stamps the last-sent FIGURES (`quoted_base_price`,
-- `quoted_total`). That answers "has a price moved since the send?" but
-- not "what exactly did the customer receive?" -- a size, an option, a
-- note or an added item leaves no trace once the order is saved over. An
-- order_revisions row is the whole customer-visible quote, frozen at the
-- moment of a send.
--
-- A revision is cut ON A SEND, never on a save:
--
--   * Ten saves between two sends make ONE revision. Title, contact and
--     note edits never make a revision on their own.
--   * A send writes a new revision only if something customer-visible
--     changed since the latest one (or there is no revision yet).
--     Re-announcing an unchanged `sent` estimate is a reminder, not a
--     new revision.
--   * Every place that stamps the quoted figures (migration 48) now
--     records the revision in the same step, with the same 'overwrite' /
--     'fill' meaning. Right after any send:
--     orders.quoted_total = latest revision.total.
--   * Reverting an order to draft clears the migration-48 stamps but
--     KEEPS its revisions (history); the next send is Rev N+1.
--
-- Each revision stores two copies:
--
--   snapshot  jsonb  the customer view (PublicQuote): served on the
--                    customer page while the order is sent/expired, and
--                    used for diffs and the "updated" email.
--   source    jsonb  the staff copy used to restore a revision: the
--                    editable order fields plus the raw line_items rows
--                    (hidden items, uids and lock columns included).
--                    Staff-only; never served publicly.
--
-- orders.accepted_revision_id records which revision the customer
-- confirmed. ON DELETE SET NULL so the pointer can never block deleting
-- a revision row; deleting the ORDER cascades to its revisions.
--
-- RLS is enabled with NO policies: the table is reachable only through
-- the service-role key held by the Worker, never by an anon client.
-- RE-RUNNABLE: every object is created `if not exists`.

create table if not exists public.order_revisions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  rev_no int not null,
  sent_at timestamptz not null default now(),
  source_kind text not null check (source_kind in ('email', 'manual', 'stage')),
  total numeric(10,2) not null,
  snapshot jsonb not null,   -- customer view (PublicQuote)
  source jsonb not null,     -- staff copy for restore; never served publicly
  unique (order_id, rev_no)
);

create index if not exists order_revisions_order_idx
  on public.order_revisions (order_id, rev_no desc);

alter table public.order_revisions enable row level security;

alter table public.orders
  add column if not exists accepted_revision_id uuid
    references public.order_revisions(id) on delete set null;

comment on table public.order_revisions is
  'One row per send that changed the customer-visible quote. Written by a send only.';
comment on column public.order_revisions.snapshot is
  'Customer view of the quote (PublicQuote) as sent.';
comment on column public.order_revisions.source is
  'Staff copy (order fields + raw line_items rows) used to restore; never served publicly.';
comment on column public.orders.accepted_revision_id is
  'Revision the customer confirmed. NULL = none yet or confirmed before revisions.';
