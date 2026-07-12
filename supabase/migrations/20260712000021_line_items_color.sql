-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 21: line_items.color.
-- Optional free-text color code captured per blind line item and shown to
-- the customer under the item on the estimate/invoice (PDF + online view).
-- No pricing effect. Non-null with a '' default so bulk inserts keep a
-- uniform column set.

alter table public.line_items
  add column color text not null default '';
