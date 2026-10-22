// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Duplicate + Delete for one order row, shared by the Orders list
 * (`OrderList`) and the Estimates page's customer groups
 * (`EstimateGroup`). Moved out of `OrderList` on 2026-10-22 so the two
 * lists cannot drift apart; behaviour is unchanged except that Duplicate
 * now opens the copy at its canonical `/<customer-slug>/<order-number>`
 * URL. Each button owns its own mutation, so one row's pending state
 * never disables another row's icons.
 */

import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useDuplicateOrder, useDeleteOrder } from '../../hooks/useOrders';
import { orderPath } from '../../lib/orderPath';
import type { Order } from '../../types';

/** Geometry-free shape shared by the two per-row icon actions. */
const ROW_ACTION_CLASS =
  'flex items-center justify-center rounded-sm transition-colors disabled:opacity-40';

/**
 * The per-row "duplicate this order" action.
 *
 * Its own component because each row needs its OWN pending state — one
 * mutation lifted to the list would spin every row's icon at once — and
 * because rows are whole-row `<button>`s, so this has to be rendered as
 * an absolutely-positioned SIBLING rather than a child.
 *
 * The copy opens immediately: duplicating is nearly always the first
 * step of editing the copy.
 */
function DuplicateButton({ order, className }: { order: Order; className: string }) {
  const navigate = useNavigate();
  const duplicateMut = useDuplicateOrder();
  return (
    <button
      type="button"
      disabled={duplicateMut.isPending}
      onClick={async () => {
        try {
          const copy = await duplicateMut.mutateAsync(order.id);
          toast.success(`Duplicated to ${copy.order_number}.`);
          navigate(orderPath(copy));
        } catch (e) {
          toast.error(e instanceof Error ? e.message : 'Duplicate failed.');
        }
      }}
      title={`Duplicate ${order.order_number} into a new draft`}
      aria-label={`Duplicate ${order.order_number}`}
      className={`${ROW_ACTION_CLASS} text-text-muted hover:bg-surface-sunken hover:text-brand-600 ${className}`}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

/**
 * The per-row "delete this order" action.
 *
 * Deletion cascades to everything the order owns — line items, activity
 * log, payments, change requests, the installation visit — and cannot
 * be undone, so it is confirmed BY ORDER NUMBER — this icon sits right
 * beside Duplicate, whose worst case is a stray draft, and the row it
 * overlays is one click from opening the order. The wording matches the
 * Delete action on the order page, and both go through the same
 * `DELETE /api/orders/:id`: this is not a looser list-only path.
 *
 * Own mutation and own pending state, for the same reason Duplicate has
 * them — one mutation lifted to the list would disable every row's icon
 * while a single order is deleted. Nothing navigates on success: the
 * hook invalidates the list and the row simply leaves it.
 */
function DeleteButton({ order, className }: { order: Order; className: string }) {
  const deleteMut = useDeleteOrder();
  return (
    <button
      type="button"
      disabled={deleteMut.isPending}
      onClick={async () => {
        const ok = window.confirm(
          `Delete ${order.order_number} permanently? Its line items, activity log, payments, ` +
            'change requests and installation visit are removed. The customer is kept.',
        );
        if (!ok) return;
        try {
          await deleteMut.mutateAsync(order.id);
          toast.success(`${order.order_number} deleted.`);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : 'Delete failed.');
        }
      }}
      title={`Delete ${order.order_number} permanently`}
      aria-label={`Delete ${order.order_number}`}
      className={`${ROW_ACTION_CLASS} text-text-muted hover:bg-surface-sunken hover:text-danger ${className}`}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M3 6h18" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        <path d="M10 11v6M14 11v6" />
      </svg>
    </button>
  );
}

/**
 * Duplicate + Delete as ONE absolutely-positioned sibling overlaying
 * the row. Both breakpoints render this same strip and differ only in
 * geometry, so the two actions cannot drift apart on one layout while
 * staying aligned on the other. Whatever renders it must reserve room
 * for it in its own right padding (`pr-24` on both the card and the
 * table row) — the strip overlays content, it does not push it.
 */
export default function OrderRowActions({
  order,
  wrapperClass,
  buttonClass,
}: {
  order: Order;
  wrapperClass: string;
  buttonClass: string;
}) {
  return (
    <div className={`absolute flex items-center gap-0.5 ${wrapperClass}`}>
      <DuplicateButton order={order} className={buttonClass} />
      <DeleteButton order={order} className={buttonClass} />
    </div>
  );
}
