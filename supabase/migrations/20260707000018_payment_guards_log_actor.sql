-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 18: payment idempotency + log actor + atomic order updates.
--
-- 1. payments.client_key — client-generated idempotency key. The UI
--    mints one UUID per Record Payment sheet; a double-click or network
--    retry re-sends the same key and the UNIQUE constraint turns the
--    replay into a no-op (Worker catches 23505 and returns the current
--    order). Nullable: webhook-recorded payments dedupe on
--    etransfers.gmail_message_id instead.
--
-- 2. order_logs.actor_email — who performed the logged action (the
--    authenticated consultant's email). Empty string for system events
--    (cron expiry) and rows created before this migration.
--
-- 3. update_order_with_items() — updates the order's fields and
--    replaces its line items in ONE transaction. The Worker previously
--    ran update → delete items → insert items as three separate
--    PostgREST calls; a failure after the delete stranded the order
--    with new totals and no items. Executable by service_role only.

alter table public.payments
  add column client_key uuid unique;

alter table public.order_logs
  add column actor_email text not null default '';

create or replace function public.update_order_with_items(
  p_order_id uuid,
  p_fields jsonb,
  p_items jsonb
) returns void
language plpgsql
set search_path = ''  -- pinned per Supabase advisor lint 0011 (mutable search_path)
as $$
begin
  update public.orders set
    customer_id     = (p_fields->>'customer_id')::uuid,
    order_date      = (p_fields->>'order_date')::date,
    expiry_date     = (p_fields->>'expiry_date')::date,
    discount_type   = p_fields->>'discount_type',
    discount_value  = (p_fields->>'discount_value')::numeric,
    subtotal        = (p_fields->>'subtotal')::numeric,
    discount_amount = (p_fields->>'discount_amount')::numeric,
    taxable_amount  = (p_fields->>'taxable_amount')::numeric,
    tax_rate        = (p_fields->>'tax_rate')::numeric,
    tax_amount      = (p_fields->>'tax_amount')::numeric,
    total           = (p_fields->>'total')::numeric
  where id = p_order_id;

  if not found then
    raise exception 'Order % not found', p_order_id;
  end if;

  delete from public.line_items where order_id = p_order_id;

  -- Every row carries the SAME column set (resolveLineItems guarantees
  -- this), so jsonb_to_recordset maps 1:1 onto the insert column list.
  insert into public.line_items (
    order_id, item_type, position, room_name, blinds_type, panels, height_cm,
    fabric_id, fabric_name, fabric_price_per_sqm,
    cassette_id, cassette_name, cassette_price_per_m,
    control_id, control_name, control_price_per_item,
    description, note, quantity, unit_price, line_total
  )
  select
    p_order_id, i.item_type, i.position,
    coalesce(i.room_name, ''), coalesce(i.blinds_type, ''),
    coalesce(i.panels, '[]'::jsonb), i.height_cm,
    i.fabric_id, i.fabric_name, i.fabric_price_per_sqm,
    i.cassette_id, i.cassette_name, i.cassette_price_per_m,
    i.control_id, i.control_name, i.control_price_per_item,
    coalesce(i.description, ''), coalesce(i.note, ''),
    i.quantity, i.unit_price, i.line_total
  from jsonb_to_recordset(p_items) as i(
    item_type text, position int, room_name text, blinds_type text,
    panels jsonb, height_cm numeric,
    fabric_id uuid, fabric_name text, fabric_price_per_sqm numeric,
    cassette_id uuid, cassette_name text, cassette_price_per_m numeric,
    control_id uuid, control_name text, control_price_per_item numeric,
    description text, note text, quantity int, unit_price numeric, line_total numeric
  );
end;
$$;

-- Worker-only entry point: nothing but the service role may call it.
revoke execute on function public.update_order_with_items(uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.update_order_with_items(uuid, jsonb, jsonb)
  to service_role;
