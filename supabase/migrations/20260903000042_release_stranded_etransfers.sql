-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 42: return e-Transfers stranded by a deleted order to the
-- pending inbox.
--
-- DATA ONLY — no schema change. `etransfers.order_id` is ON DELETE SET
-- NULL and `etransfers.payment_id` follows the payment that cascaded
-- away with the order, so deleting an order used to leave its applied
-- transfers as `status = 'applied'` pointing at NOTHING. Such a row is
-- invisible to `GET /payments/pending` (which lists `pending` only) and
-- reachable from no order page: money received, recorded nowhere staff
-- can see it.
--
-- The Worker no longer creates them — `lib/orderDelete.ts` releases an
-- order's transfers before deleting it — but rows stranded by earlier
-- deletions are still sitting in the table. This puts them back in the
-- unmatched inbox so a consultant can apply them to the right order.
--
-- The BOTH-null filter is what makes this precise. Deleting a single
-- payment (`DELETE /orders/:id/payments/:paymentId`) nulls `payment_id`
-- but leaves `order_id` set, so those rows are untouched here; only a
-- vanished ORDER can null both. `pending` and `dismissed` rows never
-- carried an order in the first place and are likewise out of scope.

update public.etransfers
   set status = 'pending'
 where status = 'applied'
   and order_id is null
   and payment_id is null;
