-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 45: the Titan inbox (sidebar Inbox page + Settings → Email Rules).
--
-- A cron on the API Worker reads new mail from the shop's Titan mailbox
-- (INBOX and Sent, read-only IMAP) every 5 minutes and stores it here:
--
--   email_threads    — one row per conversation. Category, customer/order
--                      links and the New/Handled status live here. The
--                      last_* / message_count columns are a summary kept
--                      current by refresh_email_thread(), so the Inbox list
--                      needs no aggregate query.
--   email_messages   — one row per email. direction 'in' = from the other
--                      party (left bubble), 'out' = from the shop (right
--                      bubble). reply_text is the message with quoted
--                      history trimmed off; text_body keeps the full text
--                      for the "···" reveal. message_id is UNIQUE: it is
--                      the dedupe key across runs and across folders.
--   email_rules      — staff-edited filter rules, first match wins by
--                      position. 'ignore' means the conversation is never
--                      stored.
--   email_sync_state — one IMAP cursor per folder role (UIDVALIDITY + last
--                      UID seen) plus the last error for the Settings page.
--
-- Only the Worker writes these (service role). Same single-org RLS model as
-- every other business table: authenticated full access, nothing for anon.

create table public.email_threads (
  id uuid primary key default gen_random_uuid(),
  subject text not null default '',
  -- Lower-cased subject with Re:/Fwd:/[tag] prefixes removed; the
  -- subject-fallback threading key together with counterpart_address.
  normalized_subject text not null default '',
  -- The other party: the sender of an incoming message, the first
  -- non-shop recipient of an outgoing one. Lower-cased.
  counterpart_address text not null default '',
  counterpart_name text not null default '',
  category text not null
    check (category in ('inquiry', 'supplier', 'payment', 'other')),
  -- true once staff picked the category by hand; "Re-apply rules" then
  -- leaves the thread alone.
  category_locked boolean not null default false,
  customer_id uuid references public.customers (id) on delete set null,
  order_id uuid references public.orders (id) on delete set null,
  status text not null default 'new' check (status in ('new', 'handled')),
  handled_at timestamptz,
  last_message_at timestamptz not null,
  last_direction text not null default 'in' check (last_direction in ('in', 'out')),
  last_snippet text not null default '',
  message_count integer not null default 0,
  created_at timestamptz not null default now()
);

-- The Inbox list: one category tab + status, newest conversation first.
create index email_threads_list_idx
  on public.email_threads (category, status, last_message_at desc);
-- Subject-fallback threading lookup.
create index email_threads_subject_idx
  on public.email_threads (counterpart_address, normalized_subject, last_message_at desc);
-- Support ON DELETE SET NULL from customers/orders without a scan.
create index email_threads_customer_idx
  on public.email_threads (customer_id) where customer_id is not null;
create index email_threads_order_idx
  on public.email_threads (order_id) where order_id is not null;

create table public.email_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.email_threads (id) on delete cascade,
  -- Message-ID header without angle brackets, or 'uid:<folder>:<uidvalidity>:<uid>'
  -- when the header is missing.
  message_id text not null unique,
  in_reply_to text,
  -- The References header ids (named reference_ids: REFERENCES is reserved).
  reference_ids text[] not null default '{}',
  direction text not null check (direction in ('in', 'out')),
  folder text not null check (folder in ('inbox', 'sent')),
  imap_uid bigint,
  uid_validity bigint,
  sent_at timestamptz not null,
  from_address text not null default '',
  from_name text not null default '',
  to_addresses text[] not null default '{}',
  cc_addresses text[] not null default '{}',
  subject text not null default '',
  text_body text not null default '',
  reply_text text not null default '',
  -- [{ filename, mime_type, size }] — names and sizes only; files stay in Titan.
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index email_messages_thread_idx
  on public.email_messages (thread_id, sent_at);
create index email_messages_in_reply_to_idx
  on public.email_messages (in_reply_to) where in_reply_to is not null;
create index email_messages_reference_ids_idx
  on public.email_messages using gin (reference_ids);

create table public.email_rules (
  id uuid primary key default gen_random_uuid(),
  position integer not null default 0,
  field text not null check (field in ('address', 'domain', 'subject', 'body')),
  match_type text not null check (match_type in ('contains', 'equals', 'ends_with')),
  value text not null check (char_length(value) between 1 and 200),
  action text not null
    check (action in ('inquiry', 'supplier', 'payment', 'other', 'ignore')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index email_rules_position_idx on public.email_rules (position);

create trigger email_rules_set_updated_at
  before update on public.email_rules
  for each row execute function public.set_updated_at();

create table public.email_sync_state (
  folder text primary key check (folder in ('inbox', 'sent')),
  -- The IMAP folder name the cursor belongs to ('INBOX', 'Sent', …). A
  -- different name next run means the cursor is reset, not reused.
  folder_name text not null default '',
  uid_validity bigint,
  last_uid bigint,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_error text
);

alter table public.email_threads enable row level security;
alter table public.email_messages enable row level security;
alter table public.email_rules enable row level security;
alter table public.email_sync_state enable row level security;

create policy authenticated_full_access on public.email_threads
  for all to authenticated using (true) with check (true);
create policy authenticated_full_access on public.email_messages
  for all to authenticated using (true) with check (true);
create policy authenticated_full_access on public.email_rules
  for all to authenticated using (true) with check (true);
create policy authenticated_full_access on public.email_sync_state
  for all to authenticated using (true) with check (true);

-- Recomputes a thread's summary columns from its messages. p_reopen moves
-- a 'handled' thread back to 'new' (the Worker passes true only for an
-- incoming message). A thread left with no messages — possible only when
-- an insert lost a dedupe race right after the thread was created — is
-- deleted so the Inbox never lists an empty conversation.
create or replace function public.refresh_email_thread(p_thread_id uuid, p_reopen boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_last record;
begin
  select count(*) into v_count from email_messages where thread_id = p_thread_id;
  if v_count = 0 then
    delete from email_threads where id = p_thread_id;
    return;
  end if;

  select sent_at, direction, reply_text
    into v_last
    from email_messages
   where thread_id = p_thread_id
   order by sent_at desc, created_at desc
   limit 1;

  update email_threads
     set message_count   = v_count,
         last_message_at = v_last.sent_at,
         last_direction  = v_last.direction,
         last_snippet    = left(regexp_replace(v_last.reply_text, '\s+', ' ', 'g'), 140),
         status          = case when p_reopen then 'new' else status end,
         handled_at      = case when p_reopen then null else handled_at end
   where id = p_thread_id;
end;
$$;

-- Folds p_drop threads into p_keep (the oldest of the set): moves their
-- messages, inherits a customer/order link p_keep lacks, deletes the
-- emptied threads and refreshes p_keep's summary. Used when one message's
-- headers prove two existing conversations are the same one.
create or replace function public.merge_email_threads(p_keep uuid, p_drop uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update email_messages set thread_id = p_keep where thread_id = any(p_drop);

  update email_threads k
     set customer_id = coalesce(k.customer_id, (
           select d.customer_id from email_threads d
            where d.id = any(p_drop) and d.customer_id is not null limit 1)),
         order_id = coalesce(k.order_id, (
           select d.order_id from email_threads d
            where d.id = any(p_drop) and d.order_id is not null limit 1))
   where k.id = p_keep;

  delete from email_threads where id = any(p_drop);
  perform refresh_email_thread(p_keep, false);
end;
$$;

-- Only the Worker (service role) calls these.
revoke all on function public.refresh_email_thread(uuid, boolean) from public, anon, authenticated;
revoke all on function public.merge_email_threads(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.refresh_email_thread(uuid, boolean) to service_role;
grant execute on function public.merge_email_threads(uuid, uuid[]) to service_role;
