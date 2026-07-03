-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 10: company-assets storage bucket.
-- Public READ (the logo appears in customer emails and PDFs); writes
-- happen only through the Worker's service role client, so no
-- storage.objects RLS policies are granted to other roles.

insert into storage.buckets (id, name, public)
values ('company-assets', 'company-assets', true)
on conflict (id) do nothing;
