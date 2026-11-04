-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 52: website leads (knowledge/specs/2026-11-04-website-lead-form-design.md).
--
-- The "Free Estimate" form on blindsnisa.com (apps/web/public/embed/lead-form.js)
-- posts to the Worker's public `POST /intake/lead`. Each accepted submission
-- becomes ONE row here and, in the same request, is attached to a customer:
-- the existing customer whose email matches (customer_match = 'matched'), or
-- a customer created from the submission (customer_match = 'created').
--
-- The lead row keeps exactly what the visitor typed, even when it differs
-- from the matched customer's saved details (the Worker only fills BLANK
-- customer fields, never overwrites), so staff can see what was submitted.
--
-- Staff work leads on the Leads page: new → contacted, or archived (spam,
-- duplicate, not a fit). There is no "converted" state: every lead is a
-- customer from the moment it arrives.
--
-- customer_id is SET NULL on delete so removing a customer never deletes
-- the record that someone asked for an estimate. (Customers are normally
-- soft-deleted, which leaves the link intact.)
--
-- email_sent_at records whether the best-effort shop email actually went
-- out, so a silent Resend failure is visible on the row rather than only
-- in the Worker logs.
--
-- 2. notifications gains kind 'lead_received' and a lead_id link
--    (cascades: an alert for a deleted lead has nowhere to go).

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'new'
    check (status in ('new', 'contacted', 'archived')),

  first_name text not null,
  last_name text not null,
  email text not null,
  phone text not null default '',
  street text not null default '',
  unit text not null default '',
  city text not null default '',
  province text not null default '',
  postal_code text not null default '',

  -- Covering ids from the form ('zebra', 'roller', … 'unsure').
  coverings text[] not null default '{}',
  -- Window-count bucket from the form ('1-5', '5-15', '15+').
  window_count text not null default '',
  message text not null default '',
  consent boolean not null default false,

  -- Page the form was embedded on.
  source_url text not null default '',

  customer_id uuid references public.customers (id) on delete set null,
  customer_match text not null
    check (customer_match in ('created', 'matched')),

  email_sent_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Leads page: newest first, optionally filtered by status; the sidebar
-- count reads only status = 'new'.
create index leads_status_created_idx on public.leads (status, created_at desc);
create index leads_created_idx on public.leads (created_at desc);

-- Supports the ON DELETE SET NULL from customers without a sequential scan.
create index leads_customer_idx on public.leads (customer_id)
  where customer_id is not null;

create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

alter table public.leads enable row level security;

-- Single-org model: authenticated staff full access, the Worker's service
-- role bypasses RLS, anon gets nothing (the public form writes through the
-- Worker only).
create policy authenticated_full_access on public.leads
  for all to authenticated
  using (true) with check (true);

-- 2. Alerts feed entry per lead.
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check
  check (kind in ('edit_request', 'order_confirmed', 'etransfer_received', 'email_received', 'lead_received'));

alter table public.notifications
  add column lead_id uuid references public.leads (id) on delete cascade;

create index notifications_lead_idx
  on public.notifications (lead_id)
  where lead_id is not null;
