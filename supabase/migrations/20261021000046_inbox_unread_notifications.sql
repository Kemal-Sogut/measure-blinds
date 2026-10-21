-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 46: Inbox unread marks + a Notifications entry per received email.
--
-- 1. email_threads.unread — true while a conversation has an incoming email
--    staff have not opened yet. Set by refresh_email_thread() whenever an
--    incoming ('in') message is stored (the same moment a Handled
--    conversation is moved back to New); cleared by
--    POST /api/inbox/:id/read when staff open the conversation. Outgoing
--    replies never set it. Separate from status: New/Handled is the triage
--    decision, unread is "there is something you haven't looked at".
--    Drives the dot on the conversation row, on the category tabs and on
--    the sidebar's Inbox item.
--
-- 2. notifications gains kind 'email_received' (one row per incoming email
--    the sync stores; ignored conversations write nothing), a link to the
--    conversation (email_thread_id, cascades: an alert for a deleted
--    conversation has nowhere to go) and a subject snapshot. customer_name
--    holds the sender's name or address, as for e-Transfers.

alter table public.email_threads
  add column unread boolean not null default false;

-- Conversations already waiting on staff (incoming last, still New) start unread.
update public.email_threads
   set unread = true
 where last_direction = 'in' and status = 'new';

-- Unread counts per category (tab dots, sidebar dot) read only unread rows.
create index email_threads_unread_idx
  on public.email_threads (category) where unread;

-- Same as migration 45, plus: an incoming message (p_reopen) also marks the
-- conversation unread.
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
         handled_at      = case when p_reopen then null else handled_at end,
         unread          = case when p_reopen then true else unread end
   where id = p_thread_id;
end;
$$;

revoke all on function public.refresh_email_thread(uuid, boolean) from public, anon, authenticated;
grant execute on function public.refresh_email_thread(uuid, boolean) to service_role;

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check
  check (kind in ('edit_request', 'order_confirmed', 'etransfer_received', 'email_received'));

alter table public.notifications
  add column email_thread_id uuid references public.email_threads (id) on delete cascade,
  add column subject text not null default '';

-- Supports the ON DELETE CASCADE from email_threads without a scan.
create index notifications_email_thread_idx
  on public.notifications (email_thread_id)
  where email_thread_id is not null;
