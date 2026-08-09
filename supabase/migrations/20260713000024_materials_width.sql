-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 24: material fabric width.
-- Adds an optional roll WIDTH (in centimetres) to each Material. This is
-- a manufacturing input, not a pricing input: it drives the fabric
-- cutting algorithm on the Manufacturer Copy page (how many full-width
-- courses a roll yields). It deliberately does NOT affect any money
-- column, so existing orders and their snapshotted prices are untouched.
--
-- Nullable on purpose: a Material with no width entered is treated as a
-- default 3 m (300 cm) roll by the cutting algorithm, so leaving it blank
-- keeps the existing catalog valid. When present it must be positive.

alter table public.materials
  add column width_cm numeric(10,2)
  check (width_cm is null or width_cm > 0);

comment on column public.materials.width_cm is
  'Fabric roll width in cm used by the manufacturing cut planner; NULL = assume 300 cm (3 m).';
