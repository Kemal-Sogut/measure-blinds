// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Order view (`/orders/:id/present`) — the app's ONE read-only order
 * screen, reached from the "Present to Customer" action at every stage of
 * the order detail page.
 *
 * It serves two readings of the same page. Turned toward a customer it is
 * the presentation: every blind is one row, every option type is a column,
 * and the filter bar narrows the list live during the conversation — "just
 * the cordless ones", "the bedroom" — with every total following. Read by
 * a consultant alone it is the itemised listing the separate Order
 * Overview page used to be, carrying notes, unit prices, add-ons and the
 * outstanding balance.
 *
 * The `Price breakdown` switch beside the order number is what spans those
 * two readings. ON reveals what each individual CHOICE cost; OFF leaves
 * option and add-on names on screen without their money. It starts OFF on
 * every load and is not persisted — a consultant reveals the breakdown
 * deliberately rather than discovering the last session's state on a
 * screen already facing a customer. It never touches a line total or an
 * order total: those are on screen in both states, so the page cannot
 * disagree with the estimate the customer was sent.
 *
 * The action SAVES before navigating here: this page reads the server row,
 * so an unsaved draft would otherwise be presented stale.
 *
 * Money discipline (AI_GUIDELINES §1). Two different numbers are on screen
 * and they are labelled apart on purpose:
 *   - the table's overall total is the sum of the stored `line_total`s of
 *     whatever is currently visible, and moves with the filters;
 *   - the order strip (subtotal / discount / HST / total / paid / balance)
 *     is read VERBATIM from the server row and never recomputed. Applying
 *     13% to a filtered subset would put a fabricated number in front of a
 *     customer.
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
import BreakdownToggle from './BreakdownToggle';
import PresentationFilterBar from './PresentationFilterBar';
import PresentationOtherItems from './PresentationOtherItems';
import PresentationTable from './PresentationTable';
import { money } from './presentationMoney';
import {
  buildFacets,
  hasOptionFilter,
  matchesFilters,
  type PresentationFilter,
} from './presentationFilters';

/** One line of the order-total strip. */
function TotalRow({
  label,
  value,
  strong = false,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  /** Overrides the value's colour, e.g. a settled balance in green. */
  tone?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span
        className={strong ? 'text-sm font-semibold text-text-primary' : 'text-sm text-text-muted'}
      >
        {label}
      </span>
      <span
        className={`font-mono ${strong ? 'text-base font-semibold text-text-primary' : 'text-sm text-text-secondary'} ${tone ?? ''}`}
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
  const [showBreakdown, setShowBreakdown] = useState(false);

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

  const customerName = order?.customer ? displayName(order.customer) : '';
  const amountPaid = Number(order?.amount_paid ?? 0);
  const balance = order ? Math.round((Number(order.total) - amountPaid) * 100) / 100 : 0;

  return (
    <div className="min-h-screen bg-surface-muted print:bg-white">
      <PageHeader
        title="Order"
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
            {/* Order meta. The breakdown switch sits on the title row: it
                changes what the whole page shows, not one section of it. */}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-text-primary">{order.order_number}</h2>
                {(customerName || order.order_date) && (
                  <p className="text-sm text-text-muted">
                    {[customerName, order.order_date].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <BreakdownToggle value={showBreakdown} onChange={setShowBreakdown} />
                <StatusBadge status={order.status} />
              </div>
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
              <PresentationTable items={shown} showBreakdown={showBreakdown} />
            )}

            {showOtherItems && (
              <PresentationOtherItems items={otherItems} showBreakdown={showBreakdown} />
            )}

            {/* Server-authoritative order money. Never recomputed here, and
                never governed by the breakdown toggle. */}
            <section className="rounded-lg border border-border bg-surface p-4 print:break-inside-avoid">
              <TotalRow label="Subtotal" value={money(order.subtotal)} />
              {Number(order.discount_amount) > 0 && (
                <TotalRow label="Discount" value={`−${money(order.discount_amount)}`} />
              )}
              <TotalRow
                label={`HST (${Math.round(Number(order.tax_rate) * 100)}%)`}
                value={money(order.tax_amount)}
              />
              <TotalRow label="Order total" value={money(order.total)} strong />
              {amountPaid > 0 && (
                <>
                  <TotalRow label="Paid" value={`−${money(amountPaid)}`} />
                  <TotalRow
                    label="Balance due"
                    value={money(balance)}
                    strong
                    tone={balance <= 0 ? 'text-success' : undefined}
                  />
                </>
              )}
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
