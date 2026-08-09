-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 26: payment receipt "sent" stamp.
-- Records WHEN a receipt email was last sent to the customer for a
-- specific payment row (manual, per-payment action from the Payments
-- panel). The Worker stamps it only AFTER the email provider accepts
-- the send, so a non-null value means a receipt really went out.
--
-- Nullable = never sent. No default and no backfill BY DESIGN:
-- payments recorded before this feature show as "not sent". Resending
-- is allowed and simply overwrites the stamp with the latest send time.
-- No money column is touched.

alter table public.payments
  add column receipt_sent_at timestamptz;

comment on column public.payments.receipt_sent_at is
  'When a receipt email was last sent for this payment; NULL = never sent (no backfill). Re-stamped on resend.';
