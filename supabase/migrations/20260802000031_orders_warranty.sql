-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 31: warranty certificate stamps on orders.
--
-- When a payment brings an order's outstanding balance to zero, the
-- Worker emails the customer a Warranty Certificate PDF. Two nullable
-- columns back that feature, and they are deliberately SEPARATE:
--
--   warranty_sent_at   — WHEN the certificate was last emailed. NULL =
--                        never sent. Stamped only AFTER the email
--                        provider accepts the send, so a non-null value
--                        means a certificate really went out. It is the
--                        idempotency guard: a second payment on an order
--                        that already has a stamp emails nothing.
--                        Resending is allowed and moves the stamp
--                        forward, exactly like payments.receipt_sent_at.
--
--   warranty_starts_on — the DATE coverage is measured from: the paid_on
--                        of the payment that cleared the balance. Written
--                        once and never recomputed.
--
-- Why the start date is stored rather than derived at send time: the
-- certificate prints expiry dates (start + 10 years for products, start
-- + 2 years for motorised parts). A resend months or years later — or a
-- staff download of the same document — must reproduce the SAME dates.
-- Deriving from "now" at render time would silently move a customer's
-- coverage window every time the document was regenerated.
--
-- It is also written INDEPENDENTLY of the send succeeding: the date the
-- order was paid in full is a fact about the order, not about the email,
-- so a failed send must not lose it.
--
-- Nullable, no default, no backfill BY DESIGN. Orders already paid in
-- full before this feature show as never-warrantied; issuing certificates
-- retroactively to past customers is a business decision, not a
-- migration, and staff can do it per order from the Payments panel.
--
-- Deleting a payment after a certificate was issued does NOT clear
-- either column: a warranty sitting in a customer's inbox cannot be
-- un-sent. No money column is touched by this migration.
--
-- RLS: orders already carries its authenticated_full_access policy;
-- adding columns needs no policy change, and all warranty reads/writes
-- go through the Worker's service-role client anyway.

alter table public.orders
  add column warranty_sent_at timestamptz,
  add column warranty_starts_on date;

comment on column public.orders.warranty_sent_at is
  'When the warranty certificate was last emailed; NULL = never sent (no backfill). Idempotency guard for the automatic paid-in-full trigger; re-stamped on resend.';

comment on column public.orders.warranty_starts_on is
  'Date warranty coverage starts — the paid_on of the payment that cleared the balance. Written once so every regeneration of the certificate reproduces identical expiry dates. NULL = not yet paid in full.';
