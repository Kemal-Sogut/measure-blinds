-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 15: line_items.note.
-- Optional free-text note captured per blind line item and shown to the
-- customer under the item on the estimate/invoice (PDF + online view).
-- Non-null with a '' default so bulk inserts keep a uniform column set.

alter table public.line_items
  add column note text not null default '';
