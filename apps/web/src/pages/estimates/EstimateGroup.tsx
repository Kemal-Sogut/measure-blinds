// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * One customer on the Estimates page: a collapsible row.
 *
 * Collapsed: name, estimate count, "Newest <date>" (the creation date
 * that orders the page) and the status summary. Open: the customer's
 * estimates newest-created first — every status, confirmed ones keep
 * their order badge — each opening `/<customer-slug>/<order-number>`,
 * with the shared Duplicate/Delete strip; then four group actions:
 * + New Estimate for this customer, Send estimates (opens the picker dialog
 * that emails one link covering the ticked estimates; disabled when the
 * customer has no email address), Copy customer link (mints `/c/:token` on
 * first use), and Customer details (`/customers/:id`, unchanged page).
 *
 * Open/closed state is owned by `EstimatesPage` so a search can force
 * every matching group open.
 */

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import StatusBadge from '../../components/StatusBadge';
import OrderRowActions from '../orders/OrderRowActions';
import SendEstimatesDialog from './SendEstimatesDialog';
import { useCustomerPublicLink } from '../../hooks/useCustomers';
import type { OrderGroup } from '../../hooks/useOrders';
import { displayName } from '../../lib/customerName';
import { groupSummary } from '../../lib/estimateGroups';
import { customerLinkPath, orderPath } from '../../lib/orderPath';

const money = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });

/** "Oct 20" from an ISO date (`YYYY-MM-DD`, read as local) or a timestamp. */
function shortDay(iso: string): string {
  return format(new Date(iso.length === 10 ? `${iso}T00:00:00` : iso), 'MMM d');
}

export default function EstimateGroup({
  group,
  open,
  onToggle,
}: {
  group: OrderGroup;
  open: boolean;
  onToggle: () => void;
}) {
  const navigate = useNavigate();
  const link = useCustomerPublicLink();
  const [sendOpen, setSendOpen] = useState(false);
  const { customer, orders } = group;
  const panelId = `estimate-group-${customer.id}`;
  const summary = groupSummary(orders);

  /** Mints (if needed) and copies the customer's `/c/:token` link. */
  async function copyLink() {
    try {
      const token = await link.mutateAsync(customer.id);
      await navigator.clipboard.writeText(`${window.location.origin}${customerLinkPath(token)}`);
      toast.success('Customer link copied.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not copy the link.');
    }
  }

  return (
    <li className="rounded-xl border border-border-light bg-surface shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex min-h-11 w-full items-center gap-3 p-3.5 text-left"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          className={`shrink-0 text-text-muted transition-transform ${open ? 'rotate-90' : ''}`}
        >
          <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-bold text-text-primary">
            {displayName(customer)}
          </span>
          <span className="block text-xs text-text-muted">
            {orders.length} {orders.length === 1 ? 'estimate' : 'estimates'} · Newest{' '}
            {shortDay(group.newest_created_at)}
            {summary && ` · ${summary}`}
          </span>
        </span>
      </button>

      {open && (
        <div id={panelId} className="border-t border-border-light p-2.5">
          <ul className="flex flex-col gap-1.5">
            {orders.map((o) => (
              // `relative` so the row actions can overlay the row as a
              // SIBLING — the row is one button and cannot contain others.
              <li key={o.id} className="relative">
                <button
                  type="button"
                  onClick={() => navigate(orderPath(o))}
                  className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 pr-24 text-left hover:bg-surface-sunken"
                >
                  <span className="min-w-0">
                    {o.title && (
                      <span className="block truncate text-[14px] font-semibold text-text-primary">
                        {o.title}
                      </span>
                    )}
                    <span className="block text-[13px] text-text-secondary">
                      <span className="font-mono">{o.order_number}</span> · {shortDay(o.order_date)}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <StatusBadge status={o.status} />
                    <span className="font-mono text-[13px] font-semibold text-text-primary">
                      {money.format(Number(o.total))}
                    </span>
                  </span>
                </button>
                <OrderRowActions
                  order={o}
                  wrapperClass="right-1.5 top-1/2 -translate-y-1/2"
                  buttonClass="h-11 w-11"
                />
              </li>
            ))}
          </ul>
          <div className="mt-2.5 flex flex-wrap gap-2 px-1">
            <Link
              to={`/orders/new?customer=${customer.id}`}
              className="flex h-11 items-center rounded-md bg-brand-600 px-3.5 text-[13px] font-semibold text-white hover:bg-brand-700"
            >
              + New Estimate
            </Link>
            <button
              type="button"
              onClick={() => setSendOpen(true)}
              disabled={!customer.email}
              title={customer.email ? undefined : 'This customer has no email address'}
              className="h-11 rounded-md border border-border-input bg-surface px-3.5 text-[13px] font-semibold text-text-primary hover:bg-surface-sunken disabled:opacity-40"
            >
              Send estimates
            </button>
            <button
              type="button"
              onClick={copyLink}
              disabled={link.isPending}
              className="h-11 rounded-md border border-border-input bg-surface px-3.5 text-[13px] font-semibold text-text-primary hover:bg-surface-sunken disabled:opacity-40"
            >
              Copy customer link
            </button>
            <Link
              to={`/customers/${customer.id}`}
              className="flex h-11 items-center rounded-md border border-border-input bg-surface px-3.5 text-[13px] font-semibold text-text-primary hover:bg-surface-sunken"
            >
              Customer details
            </Link>
          </div>
        </div>
      )}
      {sendOpen && (
        <SendEstimatesDialog
          customerId={customer.id}
          customerEmail={customer.email}
          onClose={() => setSendOpen(false)}
        />
      )}
    </li>
  );
}
