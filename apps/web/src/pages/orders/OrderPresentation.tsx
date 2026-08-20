// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Order Presentation page (`/orders/:id/present`).
 *
 * The screen a consultant turns toward the customer while an order is
 * still unconfirmed. Every blind is one row, every option type is a column
 * carrying what that choice cost, and the filter bar narrows the list live
 * during the conversation — "just the cordless ones", "the bedroom" — with
 * every total following.
 *
 * Reached from the "Present to Customer" action below Confirm on the order
 * detail page, which SAVES before navigating: this page reads the server
 * row, so an unsaved draft would otherwise be presented stale.
 *
 * Money discipline (AI_GUIDELINES §1). Two different numbers are on screen
 * and they are labelled apart on purpose:
 *   - the table's overall total is the sum of the stored `line_total`s of
 *     whatever is currently visible, and moves with the filters;
 *   - the order strip (subtotal / discount / HST / total) is read VERBATIM
 *     from the server row and never recomputed. Applying 13% to a filtered
 *     subset would put a fabricated number in front of a customer.
 *
 * Hidden line items are excluded throughout — they are already out of the
 * order total and off every other customer-facing surface.
 */

import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import StatusBadge from '../../components/StatusBadge';
import { useOrder } from '../../hooks/useOrders';
import { displayName } from '../../lib/customerName';
import PresentationFilterBar from './PresentationFilterBar';
import PresentationTable from './PresentationTable';
import {
  buildFacets,
  hasOptionFilter,
  matchesFilters,
  type PresentationFilter,
} from './presentationFilters';

/** Formats a number as dollars, e.g. `$1234.50`. */
function money(value: number | null | undefined): string {
  return `$${(Number(value) || 0).toFixed(2)}`;
}

/** One line of the order-total strip. */
function TotalRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span
        className={strong ? 'text-sm font-semibold text-text-primary' : 'text-sm text-text-muted'}
      >
        {label}
      </span>
      <span
        className={`font-mono ${strong ? 'text-base font-semibold text-text-primary' : 'text-sm text-text-secondary'}`}
      >
        {value}
      </span>
    </div>
  );
}

export default function OrderPresentation() {
  const { id } = useParams<{ id: string }>();
  const { data: order, isLoading, error } = useOrder(id);
  const [filters, setFilters] = useState<PresentationFilter[]>([]);

  // Stable reference so the memos below don't recompute every render.
  const lineItems = order?.line_items;
  // Hidden items are excluded once, here, so nothing downstream has to
  // remember to do it.
  const visible = useMemo(() => (lineItems ?? []).filter((item) => !item.hidden), [lineItems]);

  const blinds = useMemo(() => visible.filter((item) => item.item_type === 'blind'), [visible]);
  const otherItems = useMemo(() => visible.filter((item) => item.item_type !== 'blind'), [visible]);

  const facets = useMemo(() => buildFacets(blinds), [blinds]);
  const shown = useMemo(
    () => blinds.filter((item) => matchesFilters(item, filters)),
    [blinds, filters]
  );

  // "The cordless ones" cannot meaningfully include a call-out fee, so the
  // other-items section drops out once the view is narrowed to options.
  const showOtherItems = otherItems.length > 0 && !hasOptionFilter(filters);
  const filtered = shown.length !== blinds.length;

  const otherItemsTotal = useMemo(
    () =>
      Math.round(otherItems.reduce((sum, item) => sum + (Number(item.line_total) || 0), 0) * 100) /
      100,
    [otherItems]
  );

  const customerName = order?.customer ? displayName(order.customer) : '';

  return (
    <div className="min-h-screen bg-surface-muted print:bg-white">
      <PageHeader
        title="Order Presentation"
        backTo={id ? `/orders/${id}` : '/'}
        right={
          <button
            onClick={() => window.print()}
            className="flex h-9 items-center gap-1.5 rounded-md border border-border-input bg-surface px-3 text-sm font-medium text-text-secondary hover:bg-surface-sunken print:hidden"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <path d="M6 14h12v8H6z" />
            </svg>
            Print
          </button>
        }
      />

      <div className="page-container py-4 md:py-6 lg:py-8">
        {isLoading && <p className="p-4 text-text-muted">Loading…</p>}
        {error && <p className="p-4 text-danger">{error.message}</p>}

        {order && (
          <div className="flex flex-col gap-4">
            {/* Order meta */}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-text-primary">{order.order_number}</h2>
                {(customerName || order.order_date) && (
                  <p className="text-sm text-text-muted">
                    {[customerName, order.order_date].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
              <StatusBadge status={order.status} />
            </div>

            <PresentationFilterBar facets={facets} filters={filters} onChange={setFilters} />

            {shown.length === 0 ? (
              <div className="rounded-lg border border-border bg-surface p-8 text-center">
                <p className="text-sm text-text-muted">
                  {blinds.length === 0
                    ? 'This order has no blinds.'
                    : 'No blinds match these filters.'}
                </p>
                {blinds.length > 0 && (
                  <button
                    onClick={() => setFilters([])}
                    className="mt-3 text-sm font-medium text-brand-600 underline"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              <PresentationTable items={shown} />
            )}

            {showOtherItems && (
              <section className="rounded-lg border border-border bg-surface">
                <div className="flex items-baseline justify-between gap-2 border-b border-border px-4 py-3">
                  <h3 className="text-base font-semibold text-text-primary">Other items</h3>
                  <span className="font-mono text-sm font-semibold text-text-primary">
                    {money(otherItemsTotal)}
                  </span>
                </div>
                <ul className="divide-y divide-border-light">
                  {otherItems.map((item, i) => (
                    <li
                      key={item.id}
                      className="flex items-baseline justify-between gap-4 px-4 py-2"
                    >
                      <span className="text-[13px] text-text-secondary">
                        {item.title || item.description || `Item ${i + 1}`}
                        {item.quantity > 1 && (
                          <span className="ml-1 text-text-muted">× {item.quantity}</span>
                        )}
                      </span>
                      <span className="font-mono text-[13px] text-text-secondary">
                        {money(item.line_total)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Server-authoritative order money. Never recomputed here. */}
            <section className="rounded-lg border border-border bg-surface p-4">
              <TotalRow label="Subtotal" value={money(order.subtotal)} />
              {Number(order.discount_amount) > 0 && (
                <TotalRow label="Discount" value={`−${money(order.discount_amount)}`} />
              )}
              <TotalRow
                label={`HST (${Math.round(Number(order.tax_rate) * 100)}%)`}
                value={money(order.tax_amount)}
              />
              <TotalRow label="Order total" value={money(order.total)} strong />
              {filtered && (
                <p className="mt-2 border-t border-border-light pt-2 text-xs text-text-muted">
                  Showing {shown.length} of {blinds.length} blinds · order total unchanged
                </p>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
