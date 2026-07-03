-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 02: company_settings.
-- Singleton table (id constrained to 1) holding company identity used
-- on PDFs and emails: name, logo, contact details, HST number, default
-- estimate expiry window, and the current terms & conditions text.

create table public.company_settings (
  id int primary key default 1 check (id = 1),
  company_name text not null default '',
  logo_url text,
  email text not null default '',
  phone text not null default '',
  address text not null default '',
  hst_number text not null default '',
  default_expiry_days int not null default 14
    check (default_expiry_days between 1 and 365),
  terms_and_conditions text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger company_settings_set_updated_at
  before update on public.company_settings
  for each row execute function public.set_updated_at();

alter table public.company_settings enable row level security;

create policy authenticated_full_access on public.company_settings
  for all to authenticated
  using (true) with check (true);

-- Ensure the singleton row always exists so PUT /api/settings/company
-- can be a plain UPDATE.
insert into public.company_settings (id) values (1)
on conflict (id) do nothing;
