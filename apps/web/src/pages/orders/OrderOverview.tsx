// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Order Overview page (`/orders/:id/overview`).
 *
 * A read-only, print-friendly itemised listing of an order, opened in a
 * NEW TAB from the Order Overview action available at every post-draft
 * stage on the order detail page. It fetches the order and renders each
 * line item in an organized format:
 *
 *   - Blind items: room name, blind type, size (panel widths × height),
 *     material, colour, cassette, control, quantity, note and line total.
 *   - Preset/custom items: description, quantity × unit price and total.
 *
 * All names and money come from the SERVER row — the snapshotted
 * `material_name` / `cassette_name` / `control_name` and the stored
 * `unit_price` / `line_total` / totals — so the page reflects exactly
 * what was priced, independent of later catalog changes and of any
 * unsaved edits on the detail page. A Print button (hidden on paper)
 * calls `window.print()`.
 */

import { useParams } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import StatusBadge from '../../components/StatusBadge';
import { useOrder } from '../../hooks/useOrders';
import type { LineItem } from '../../types';

/** Formats a number as dollars, e.g. `$1,234.50` without the comma grouping. */
function money(value: number | null | undefined): string {
  return `$${(Number(value) || 0).toFixed(2)}`;
}

/** One "label: value" detail row inside a blind item card. */
function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 text-[13px]">
      <span className="w-[76px] shrink-0 text-text-muted">{label}</span>
      <span className="min-w-0 flex-1 text-text-secondary">{value}</span>
    </div>
  );
}

/**
 * Renders one persisted line item. Blinds get the full detail block from
 * the snapshotted option names; preset/custom lines are a single
 * description + qty × unit price row.
 */
function ItemRow({ item, index }: { item: LineItem; index: number }) {
  if (item.item_type !== 'blind') {
    return (
      <li className="flex flex-col gap-1 py-3 print:break-inside-avoid">
        <div className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 text-sm font-medium text-text-primary">
            {item.description || `Item ${index + 1}`}
          </span>
          <span className="shrink-0 font-mono text-[13px] text-text-primary">
            {money(item.line_total)}
          </span>
        </div>
        <span className="text-[13px] text-text-muted">
          {item.item_type === 'preset' ? 'Preset item' : 'Custom item'} · Qty {item.quantity} ×{' '}
          {money(item.unit_price)}
        </span>
      </li>
    );
  }

  const widths = item.panels.filter((w) => w > 0);
  const details: [string, string][] = [
    ['Type', item.blinds_type || '—'],
    [
      'Size',
      widths.length ? `${widths.join(' + ')} × ${item.height_cm ?? '—'} cm` : '—',
    ],
    ['Material', item.material_name ?? '—'],
  ];
  if (item.color) details.push(['Colour', item.color]);
  details.push(
    ['Cassette', item.cassette_name ?? '—'],
    ['Control', item.control_name ?? '—'],
    ['Quantity', `${item.quantity} × ${money(item.unit_price)}`]
  );
  if (item.note) details.push(['Note', item.note]);

  return (
    <li className="flex flex-col gap-1.5 py-3 print:break-inside-avoid">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 text-sm font-medium text-text-primary">
          {item.room_name || `Blind ${index + 1}`}
        </span>
        <span className="shrink-0 font-mono text-[13px] text-text-primary">
          {money(item.line_total)}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        {details.map(([label, value]) => (
          <DetailRow key={label} label={label} value={value} />
        ))}
      </div>
    </li>
  );
}

export default function OrderOverview() {
  const { id } = useParams<{ id: string }>();
  const { data: order, isLoading, error } = useOrder(id);

  const customerName = order?.customer
    ? `${order.customer.first_name} ${order.customer.last_name}`.trim()
    : '';
  const items = order?.line_items ?? [];
  const amountPaid = Number(order?.amount_paid ?? 0);
  const balance = order ? Math.round((Number(order.total) - amountPaid) * 100) / 100 : 0;

  return (
    <div className="min-h-screen bg-surface-muted print:bg-white">
      <PageHeader
        title="Order Overview"
        backTo={id ? `/orders/${id}` : '/orders'}
        right={
          <button
            onClick={() => window.print()}
            className="flex h-9 items-center gap-1.5 rounded-sm border border-border-input bg-surface px-3 text-sm font-medium text-text-secondary hover:bg-surface-sunken print:hidden"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <path d="M6 14h12v8H6z" />
            </svg>
            Print
          </button>
        }
      />

      <div className="mx-auto max-w-3xl p-4 lg:p-8">
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

            {/* Itemised listing */}
            <section className="rounded-lg border border-border bg-surface p-4">
              <h3 className="mb-1 text-base font-semibold text-text-primary">
                Items ({items.length})
              </h3>
              {items.length === 0 ? (
                <p className="py-2 text-[13px] text-text-muted">This order has no items.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {items.map((item, i) => (
                    <ItemRow key={item.id} item={item} index={i} />
                  ))}
                </ul>
              )}
            </section>

            {/* Totals (server-authoritative row values) */}
            <section className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface p-4 print:break-inside-avoid">
              <div className="flex items-baseline justify-between text-[13px]">
                <span className="text-text-secondary">Subtotal</span>
                <span className="font-mono text-text-primary">{money(order.subtotal)}</span>
              </div>
              {Number(order.discount_amount) > 0 && (
                <div className="flex items-baseline justify-between text-[13px]">
                  <span className="text-text-secondary">Discount</span>
                  <span className="font-mono text-text-primary">−{money(order.discount_amount)}</span>
                </div>
              )}
              <div className="flex items-baseline justify-between text-[13px]">
                <span className="text-text-secondary">Tax ({Number(order.tax_rate)}%)</span>
                <span className="font-mono text-text-primary">{money(order.tax_amount)}</span>
              </div>
              <div className="mt-1 flex items-baseline justify-between border-t border-border pt-2">
                <span className="text-sm font-semibold text-text-primary">Total</span>
                <span className="font-mono text-sm font-semibold text-text-primary">
                  {money(order.total)}
                </span>
              </div>
              {amountPaid > 0 && (
                <>
                  <div className="flex items-baseline justify-between text-[13px]">
                    <span className="text-text-secondary">Paid</span>
                    <span className="font-mono text-text-primary">−{money(amountPaid)}</span>
                  </div>
                  <div className="flex items-baseline justify-between text-[13px]">
                    <span className="text-text-secondary">Balance due</span>
                    <span
                      className={`font-mono font-semibold ${balance <= 0 ? 'text-success' : 'text-text-primary'}`}
                    >
                      {money(balance)}
                    </span>
                  </div>
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
