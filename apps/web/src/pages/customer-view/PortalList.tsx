// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * The customer link's list view: company header, a greeting, then
 * "Estimates" (live estimates) above "Your orders" (confirmed). Each card
 * shows the title only when one was entered, the number, dates and the
 * server total or balance, and a single "View" button — confirming
 * happens inside the estimate, after the customer has read it.
 *
 * Presentational: `CustomerPortal` owns loading and routing. Every
 * figure is the server's (`GET /public/customer/:token`); nothing here
 * computes money.
 */

import { Link } from 'react-router-dom';
import { statusLabel } from '../../lib/statusStyles';
import { splitPortalItems, type PortalItem, type PortalPayload } from '../../lib/portal';

const money = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });

/** One card; `kind` picks the estimate or order wording. */
function PortalCard({
  item,
  token,
  kind,
}: {
  item: PortalItem;
  token: string;
  kind: 'estimate' | 'order';
}) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-2xl bg-surface-elevated p-4">
      <div className="min-w-0 text-sm">
        {item.title && (
          <p className="truncate text-[15px] font-semibold text-text-primary">{item.title}</p>
        )}
        <p className="text-text-primary">
          {kind === 'estimate' ? 'Estimate' : 'Order'}{' '}
          <span className="font-mono">{item.order_number}</span>
        </p>
        <p className="text-text-muted">
          {kind === 'estimate'
            ? `${item.order_date} · Valid until ${item.expiry_date}`
            : statusLabel(item.status)}
        </p>
        <p className="mt-1 font-mono text-text-primary">
          {kind === 'estimate' ? money.format(item.total) : `Balance ${money.format(item.balance)}`}
        </p>
      </div>
      <Link
        to={`/c/${token}/${encodeURIComponent(item.order_number)}`}
        className="flex h-11 shrink-0 items-center rounded-md bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700"
      >
        View
      </Link>
    </li>
  );
}

export default function PortalList({
  payload,
  token,
  notice,
}: {
  payload: PortalPayload;
  token: string;
  /** Shown above the list, e.g. when a deep link pointed at a lapsed estimate. */
  notice?: string;
}) {
  const { estimates, orders } = splitPortalItems(payload.items);
  const c = payload.company;
  return (
    <div className="min-h-screen bg-surface-muted pb-8">
      <div className="mx-auto max-w-lg p-4">
        <header className="mb-4 flex items-center gap-3 rounded-2xl bg-surface-elevated p-4">
          {c.logo_url && (
            <img src={c.logo_url} alt="" className="h-12 w-12 rounded-lg object-contain" />
          )}
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-text-primary">
              {c.company_name || 'Your estimates'}
            </h1>
            <p className="truncate text-xs text-text-muted">
              {[c.phone, c.email].filter(Boolean).join(' · ')}
            </p>
          </div>
        </header>

        {notice && (
          <p className="mb-4 rounded-xl bg-warning-tint p-3 text-sm text-text-primary">{notice}</p>
        )}

        {payload.customer.first_name && payload.items.length > 0 && (
          <p className="mb-4 text-[15px] text-text-secondary">
            Hi {payload.customer.first_name}, here is everything we have prepared for you.
          </p>
        )}

        {estimates.length > 0 && (
          <section className="mb-6">
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-text-secondary">
              Estimates
            </h2>
            <ul className="flex flex-col gap-2">
              {estimates.map((i) => (
                <PortalCard key={i.order_number} item={i} token={token} kind="estimate" />
              ))}
            </ul>
          </section>
        )}

        {orders.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-text-secondary">
              Your orders
            </h2>
            <ul className="flex flex-col gap-2">
              {orders.map((i) => (
                <PortalCard key={i.order_number} item={i} token={token} kind="order" />
              ))}
            </ul>
          </section>
        )}

        {payload.items.length === 0 && (
          <p className="rounded-2xl bg-surface-elevated p-4 text-sm text-text-secondary">
            Nothing to review right now — contact us
            {c.phone ? ` at ${c.phone}` : ''}
            {c.email ? `${c.phone ? ' or' : ' at'} ${c.email}` : ''}.
          </p>
        )}
      </div>
    </div>
  );
}
