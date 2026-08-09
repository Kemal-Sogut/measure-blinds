-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 27: customer cancellation requests + e-Transfer details.
--
-- 1. Cancellation requests. A customer can never undo their own
--    confirmation (that stays a user-only action on
--    /api/orders/:id/unconfirm). What they CAN do, from the public
--    token'd page, is ASK for the confirmation to be cancelled. The
--    request is a flag on the order, not a status change:
--
--      cancel_requested_at IS NULL  → no open request
--      cancel_requested_at IS SET   → the customer is waiting on an answer
--
--    Staff answer it from the order page: accepting clears the flag AND
--    applies the existing unconfirm transition (awaiting_payment → sent);
--    denying clears the flag alone and emails the customer. Either way
--    the flag returns to NULL — `order_logs` is the audit trail, exactly
--    as it is for every other lifecycle event, so no history is kept
--    here. The customer may also withdraw their own request.
--
--    Modelled as columns on `orders` (not a side table) to match the
--    existing install_status / install_response_note precedent: it is a
--    single optional side-conversation per order, never a collection.
--
--    Requests are only accepted while the order is `awaiting_payment`
--    with zero payments — the same window in which a confirmation can be
--    reversed at all. That rule is enforced in the Worker, not here,
--    because it depends on the payments ledger.
--
-- 2. e-Transfer details. The public order summary tells the customer
--    where to send an Interac e-Transfer. The address previously lived
--    as a literal in apps/web/src/components/PaymentSection.tsx, which
--    meant changing it required a redeploy. It now comes from the
--    company_settings singleton and is editable in Settings → Company
--    Info.
--
-- Both company_settings columns are NOT NULL DEFAULT '' so the existing
-- singleton row (id = 1) needs no backfill.

alter table public.orders
  add column cancel_requested_at timestamptz,
  -- Free-text reason the customer leaves when asking to cancel.
  add column cancel_request_note text not null default '';

alter table public.company_settings
  -- Interac e-Transfer recipient shown on the public order summary.
  add column etransfer_email text not null default '',
  -- Optional extra instructions rendered under the address.
  add column etransfer_instructions text not null default '';
