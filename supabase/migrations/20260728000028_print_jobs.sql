-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 28: print_jobs.
-- Queue of rendered production-label jobs waiting for the shop-floor
-- print agent. The API is a Cloudflare Worker with no route into the
-- shop LAN, so the agent must initiate every connection: it polls
-- claim_print_job() every 30 seconds and reports the result back.
--
-- payload holds the FULL TSPL command stream for the whole request —
-- one job per print request, not one per label — so the agent writes it
-- to the printer in a single pass and never has to understand TSPL.

create table public.print_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'printing', 'done', 'failed')),
  payload text not null,
  label_count int not null default 1 check (label_count >= 1),
  attempts int not null default 0,
  last_error text not null default '',
  -- Email of the staff member who queued it (order_logs.actor_email convention).
  requested_by text not null default '',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The agent's only query: oldest pending first.
create index print_jobs_pending_idx on public.print_jobs (status, created_at);

create trigger print_jobs_set_updated_at
  before update on public.print_jobs
  for each row execute function public.set_updated_at();

alter table public.print_jobs enable row level security;

create policy authenticated_full_access on public.print_jobs
  for all to authenticated
  using (true) with check (true);

-- Atomic claim. PostgREST cannot express "update the oldest pending
-- row" without a race, and two agent instances racing would print the
-- same labels twice, so this is an RPC using FOR UPDATE SKIP LOCKED.
create or replace function public.claim_print_job()
returns table (id uuid, payload text, label_count int, order_number text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- Reap jobs whose agent died mid-print. Three failed claims is the
  -- point at which retrying is no longer worth blocking the queue.
  update public.print_jobs
     set status = case when attempts >= 3 then 'failed' else 'pending' end,
         last_error = case when attempts >= 3
                           then 'Abandoned after 3 attempts.'
                           else last_error end
   where status = 'printing'
     and updated_at < now() - interval '5 minutes';

  select j.id into v_id
    from public.print_jobs j
   where j.status = 'pending'
   order by j.created_at
   for update skip locked
   limit 1;

  if v_id is null then
    return;
  end if;

  update public.print_jobs j
     set status = 'printing',
         attempts = j.attempts + 1
   where j.id = v_id;

  return query
    select j.id, j.payload, j.label_count, o.order_number
      from public.print_jobs j
      join public.orders o on o.id = j.order_id
     where j.id = v_id;
end;
$$;

-- Worker-only entry point: nothing but the service role may call it.
revoke execute on function public.claim_print_job() from public, anon, authenticated;
grant execute on function public.claim_print_job() to service_role;
