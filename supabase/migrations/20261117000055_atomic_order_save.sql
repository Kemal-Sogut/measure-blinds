-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 55: atomic order save + optimistic concurrency.
--
-- 1. orders.content_version — bumped by one on every editor save, and by
--    NOTHING else. Deliberately not `updated_at`: that moves whenever a
--    customer opens their page (customer_viewed_at), a payment changes the
--    status, or a notice is dismissed, and none of those should make the
--    editor think someone else edited the order.
--
-- 2. save_order_with_items() — writes the order's fields and replaces its
--    line items in ONE transaction. The Worker ran update → delete → insert
--    as three PostgREST calls; a failure after the delete left an order with
--    new totals and no items. When `p_expected_version` is given and differs
--    from the stored version, nothing is written and `version_conflict` is
--    raised.
--
--    The column lists are read from pg_attribute at run time instead of
--    being spelled out. The previous function (migration 18, re-declared in
--    six later migrations) named every column, was missed when `uid`,
--    `hidden` and the price-lock columns arrived, and so could no longer be
--    used. This one needs no change when a column is added: a key in the
--    JSON that names a real column is written, anything else is ignored.
--    Identifiers come from the catalog and are quoted with %I, so no value
--    from the request is ever concatenated into SQL.
--
-- 3. The stale update_order_with_items() is dropped so nobody calls it.

alter table public.orders
  add column content_version integer not null default 0;

drop function if exists public.update_order_with_items(uuid, jsonb, jsonb);

create or replace function public.save_order_with_items(
  p_order_id uuid,
  p_fields jsonb,
  p_items jsonb,
  p_expected_version integer default null
) returns integer
language plpgsql
set search_path = ''  -- pinned per Supabase advisor lint 0011 (mutable search_path)
as $$
declare
  v_version integer;
  v_set     text;
  v_cols    text;
begin
  -- Lock the order row for the whole save: two saves of one order queue
  -- here, so the second sees the first one's version.
  select o.content_version
    into v_version
    from public.orders o
   where o.id = p_order_id
     for update;
  if not found then
    raise exception 'order_not_found';
  end if;
  if p_expected_version is not null and p_expected_version <> v_version then
    raise exception 'version_conflict';
  end if;

  -- Order fields: every key of p_fields that is a writable orders column.
  select string_agg(format('%1$I = r.%1$I', a.attname), ', ')
    into v_set
    from pg_catalog.pg_attribute a
   where a.attrelid = 'public.orders'::regclass
     and a.attnum > 0
     and not a.attisdropped
     and p_fields ? a.attname::text
     and a.attname not in ('id', 'order_number', 'created_at', 'updated_at', 'content_version');
  if v_set is null then
    raise exception 'no_order_fields';
  end if;

  execute format(
    'update public.orders o
        set %s, content_version = o.content_version + 1
       from jsonb_populate_record(null::public.orders, $1) r
      where o.id = $2',
    v_set
  ) using p_fields, p_order_id;

  delete from public.line_items li where li.order_id = p_order_id;

  if jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) > 0 then
    -- Union of the keys across ALL items, so a row that omits a key gets
    -- NULL for it exactly as a PostgREST bulk insert did.
    select string_agg(format('%I', a.attname), ', ' order by a.attnum)
      into v_cols
      from pg_catalog.pg_attribute a
     where a.attrelid = 'public.line_items'::regclass
       and a.attnum > 0
       and not a.attisdropped
       and a.attname not in ('id', 'order_id', 'created_at', 'updated_at')
       and exists (select 1 from jsonb_array_elements(p_items) e where e ? a.attname::text);

    execute format(
      'insert into public.line_items (order_id, %1$s)
       select $2, %1$s
         from jsonb_populate_recordset(null::public.line_items, $1)',
      v_cols
    ) using p_items, p_order_id;
  end if;

  return v_version + 1;
end;
$$;

revoke all on function public.save_order_with_items(uuid, jsonb, jsonb, integer) from public, anon, authenticated;
grant execute on function public.save_order_with_items(uuid, jsonb, jsonb, integer) to service_role;

-- Make PostgREST see the new function without waiting for its next reload.
notify pgrst, 'reload schema';
