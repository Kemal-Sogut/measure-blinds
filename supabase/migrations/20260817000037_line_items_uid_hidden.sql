-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.

-- Line-item identity and visibility.
--
-- `uid` is a STABLE per-item identity. Saving an order replaces its line
-- items wholesale (delete-all + bulk insert), so `id` is reborn on every
-- save and `position` moves whenever an item is inserted or reordered.
-- `uid` is minted once by the Worker, travels through the client, and
-- comes back on save — which is what lets the Worker tell whether a
-- particular item's visibility changed across an edit.
--
-- `hidden` excludes an item from the order total and from every
-- customer- and production-facing document while keeping it in the
-- editor. Default false, so every existing item stays visible and no
-- already-issued document changes.
alter table public.line_items
  add column uid uuid not null default gen_random_uuid(),
  add column hidden boolean not null default false;

-- The visibility diff on save looks items up by uid within one order.
create index line_items_uid_idx on public.line_items (uid);
