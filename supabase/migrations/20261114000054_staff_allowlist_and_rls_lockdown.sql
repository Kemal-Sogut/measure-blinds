-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 54: staff allow-list + removal of the authenticated-role data path.
--
-- 1. public.profiles becomes the staff allow-list. The Worker
--    (middleware/auth.ts, via lib/staffAccess.ts) accepts a verified
--    Supabase JWT only when its subject has a row here. Until now the
--    table was empty and unused, and ANY Supabase login was a staff login.
--    The seed takes the accounts that existed when the app launched,
--    selected by creation date so no email address is written to this
--    public file. Adding a staff member later = create the auth user in
--    the dashboard, then insert their id here.
--
-- 2. Every `authenticated_full_access` policy is dropped and table
--    privileges are revoked from `anon` and `authenticated`. The web app
--    uses Supabase for AUTH ONLY and the Worker uses the service role
--    (which bypasses RLS), so nothing legitimate used those policies; they
--    only meant that any logged-in account could read and write every
--    table straight through PostgREST. RLS stays ENABLED on every table:
--    with no policy, the two client roles see nothing.

insert into public.profiles (id, role)
select u.id, 'admin'
  from auth.users u
 where u.created_at < timestamptz '2026-07-05 00:00:00+00'
on conflict (id) do nothing;

do $$
declare
  r record;
begin
  for r in
    select schemaname, tablename, policyname
      from pg_policies
     where schemaname = 'public'
       and policyname = 'authenticated_full_access'
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end
$$;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
