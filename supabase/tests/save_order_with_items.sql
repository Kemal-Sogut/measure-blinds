-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Smoke test for public.save_order_with_items (migration 55).
--
-- Runs entirely inside ONE transaction that is rolled back, so it is safe
-- to run against the live project: it re-saves an existing order with its
-- own items, checks the result, and leaves no trace. It proves the three
-- things the function exists for:
--   1. a save round-trips every line item (no column is lost);
--   2. a stale expected version is refused with `version_conflict`;
--   3. a save that fails part-way keeps the items it started with.
-- Any failed check raises, which aborts the script with the message.

begin;

do $$
declare
  v_order   uuid;
  v_before  integer;
  v_after   integer;
  v_items   jsonb;
  v_snap    jsonb;
  v_new     integer;
begin
  select o.id into v_order
    from public.orders o
   where exists (select 1 from public.line_items li where li.order_id = o.id)
   limit 1;
  if v_order is null then
    raise notice 'No order with line items found — nothing to test.';
    return;
  end if;

  select count(*) into v_before from public.line_items where order_id = v_order;
  select jsonb_agg(to_jsonb(li) - 'id' - 'order_id' - 'created_at' - 'updated_at' order by li.position)
    into v_items
    from public.line_items li
   where li.order_id = v_order;
  v_snap := v_items;

  -- 1. Round trip.
  v_new := public.save_order_with_items(v_order, jsonb_build_object('discount_value', 0), v_items, null);
  select count(*) into v_after from public.line_items where order_id = v_order;
  assert v_after = v_before, format('item count changed: %s -> %s', v_before, v_after);
  assert v_new = (select content_version from public.orders where id = v_order), 'returned version is not the stored one';
  select jsonb_agg(to_jsonb(li) - 'id' - 'order_id' - 'created_at' - 'updated_at' order by li.position)
    into v_items
    from public.line_items li
   where li.order_id = v_order;
  assert v_items = v_snap, 'line items differ after a round-trip save';

  -- 2. Stale version is refused.
  begin
    perform public.save_order_with_items(v_order, jsonb_build_object('discount_value', 0), v_items, v_new - 1);
    raise exception 'expected version_conflict, but the save went through';
  exception when others then
    if sqlerrm <> 'version_conflict' then raise; end if;
  end;

  -- 3. A failing insert must not lose the existing items.
  begin
    perform public.save_order_with_items(
      v_order,
      jsonb_build_object('discount_value', 0),
      '[{"item_type":"not-a-type","position":0,"quantity":1,"unit_price":0,"line_total":0}]'::jsonb,
      null
    );
    raise exception 'expected the item_type check to fail, but the save went through';
  exception when check_violation then
    null; -- expected
  end;
  select count(*) into v_after from public.line_items where order_id = v_order;
  assert v_after = v_before, 'items were lost when a save failed part-way';

  -- 4. An unknown order is reported, not ignored.
  begin
    perform public.save_order_with_items(gen_random_uuid(), jsonb_build_object('discount_value', 0), '[]'::jsonb, null);
    raise exception 'expected order_not_found';
  exception when others then
    if sqlerrm <> 'order_not_found' then raise; end if;
  end;

  raise notice 'save_order_with_items: all checks passed';
end
$$;

rollback;
