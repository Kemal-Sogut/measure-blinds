// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Order Overview page (`/orders/:id/overview`).
 *
 * A read-only, print-friendly itemised listing of an order, opened in a
 * NEW TAB from the Order Overview action available at every post-draft
 * stage on the order detail page. It fetches the order and renders the
 * line items as TABLES — one column per field, and a SEPARATE table per
 * blind type (Roller, Zebra, …, grouped by the snapshotted
 * `blinds_type`), plus one "Other Items" table for preset/custom lines:
 *
 *   - Blind tables: Room | Size (cm) | Material | Colour | Cassette |
 *     Control | Qty | Unit | Total | Note.
 *   - Other Items: Type | Description | Qty | Unit | Total.
 *
 * All names and money come from the SERVER row — the snapshotted
 * `material_name` / `cassette_name` / `control_name` and the stored
 * `unit_price` / `line_total` / totals — so the page reflects exactly
 * what was priced, independent of later catalog changes and of any
 * unsaved edits on the detail page. Tables scroll horizontally on
 * narrow screens; a Print button (hidden on paper) calls
 * `window.print()`.
 */

import { useMemo, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import StatusBadge from '../../components/StatusBadge';
import { useOrder } from '../../hooks/useOrders';
import type { LineItem } from '../../types';

/** Formats a number as dollars, e.g. `$1234.50`. */
function money(value: number | null | undefined): string {
  return `$${(Number(value) || 0).toFixed(2)}`;
}

/** Sums a group's stored line totals for the table-header subtotal. */
function groupTotal(items: LineItem[]): number {
  return items.reduce((sum, it) => sum + (Number(it.line_total) || 0), 0);
}

/** Shared table header cell (matches the app's grid-table header style). */
function Th({ children, right = false }: { children: ReactNode; right?: boolean }) {
  return (
    <th
      className={`whitespace-nowrap px-3 py-2 text-xs font-semibold uppercase tracking-wide text-text-muted ${right ? 'text-right' : 'text-left'}`}
    >
      {children}
    </th>
  );
}

/** Shared table body cell. `mono` marks money/size figures. */
function Td({
  children,
  right = false,
  mono = false,
}: {
  children: ReactNode;
  right?: boolean;
  mono?: boolean;
}) {
  return (
    <td
      className={`px-3 py-2 text-[13px] text-text-secondary ${right ? 'text-right' : 'text-left'} ${mono ? 'whitespace-nowrap font-mono' : ''}`}
    >
      {children}
    </td>
  );
}

/**
 * Card wrapper for one item table: a title row (group name, item count,
 * group subtotal) above a horizontally scrollable table so the many
 * field columns never squash on phones (the page body never scrolls
 * sideways).
 */
function TableCard({
  title,
  items,
  children,
}: {
  title: string;
  items: LineItem[];
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface print:break-inside-avoid">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
        <h3 className="text-base font-semibold text-text-primary">
          {title}{' '}
          <span className="text-sm font-normal text-text-muted">
            ({items.length} item{items.length !== 1 ? 's' : ''})
          </span>
        </h3>
        <span className="font-mono text-sm font-semibold text-text-primary">
          {money(groupTotal(items))}
        </span>
      </div>
      <div className="overflow-x-auto">{children}</div>
    </section>
  );
}

/**
 * One blind type's table — a row per blind with one column per field.
 * Sizes are `panel widths × height` in cm; option names are the
 * pricing-time snapshots stored on the line item.
 */
function BlindTypeTable({ title, items }: { title: string; items: LineItem[] }) {
  return (
    <TableCard title={title} items={items}>
      <table className="w-full min-w-[760px] border-collapse">
        <thead>
          <tr className="border-b border-border bg-surface-muted">
            <Th>Room</Th>
            <Th>Size (cm)</Th>
            <Th>Material</Th>
            <Th>Colour</Th>
            <Th>Cassette</Th>
            <Th>Control</Th>
            <Th right>Qty</Th>
            <Th right>Unit</Th>
            <Th right>Total</Th>
            <Th>Note</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-light">
          {items.map((item, i) => {
            const widths = item.panels.filter((w) => w > 0);
            return (
              <tr key={item.id}>
                <Td>{item.room_name || `Blind ${i + 1}`}</Td>
                <Td mono>
                  {widths.length ? `${widths.join(' + ')} × ${item.height_cm ?? '—'}` : '—'}
                </Td>
                <Td>{item.material_name ?? '—'}</Td>
                <Td>{item.color || '—'}</Td>
                <Td>{item.cassette_name ?? '—'}</Td>
                <Td>{item.control_name ?? '—'}</Td>
                <Td right mono>
                  {item.quantity}
                </Td>
                <Td right mono>
                  {money(item.unit_price)}
                </Td>
                <Td right mono>
                  {money(item.line_total)}
                </Td>
                <Td>{item.note || '—'}</Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableCard>
  );
}

/** The preset/custom lines table — one column per field. */
function FlatItemsTable({ items }: { items: LineItem[] }) {
  return (
    <TableCard title="Other Items" items={items}>
      <table className="w-full min-w-[520px] border-collapse">
        <thead>
          <tr className="border-b border-border bg-surface-muted">
            <Th>Type</Th>
            <Th>Description</Th>
            <Th right>Qty</Th>
            <Th right>Unit</Th>
            <Th right>Total</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-light">
          {items.map((item, i) => (
            <tr key={item.id}>
              <Td>{item.item_type === 'preset' ? 'Preset' : 'Custom'}</Td>
              <Td>{item.description || `Item ${i + 1}`}</Td>
              <Td right mono>
                {item.quantity}
              </Td>
              <Td right mono>
                {money(item.unit_price)}
              </Td>
              <Td right mono>
                {money(item.line_total)}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableCard>
  );
}

export default function OrderOverview() {
  const { id } = useParams<{ id: string }>();
  const { data: order, isLoading, error } = useOrder(id);

  const customerName = order?.customer
    ? `${order.customer.first_name} ${order.customer.last_name}`.trim()
    : '';
  // Stable reference so the grouping memos below don't recompute (and
  // re-trigger the exhaustive-deps rule) on every render.
  const lineItems = order?.line_items;
  const items = useMemo(() => lineItems ?? [], [lineItems]);
  const amountPaid = Number(order?.amount_paid ?? 0);
  const balance = order ? Math.round((Number(order.total) - amountPaid) * 100) / 100 : 0;

  // One table per blind type (insertion order preserved), plus one
  // trailing group for preset/custom lines.
  const blindGroups = useMemo(() => {
    const groups = new Map<string, LineItem[]>();
    for (const item of items) {
      if (item.item_type !== 'blind') continue;
      const type = item.blinds_type || 'Blind';
      const group = groups.get(type);
      if (group) group.push(item);
      else groups.set(type, [item]);
    }
    return [...groups.entries()];
  }, [items]);
  const flatItems = useMemo(() => items.filter((it) => it.item_type !== 'blind'), [items]);

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

            {/* Itemised tables — one per blind type + Other Items */}
            {items.length === 0 && (
              <p className="rounded-lg border border-border bg-surface p-4 text-[13px] text-text-muted">
                This order has no items.
              </p>
            )}
            {blindGroups.map(([type, group]) => (
              <BlindTypeTable key={type} title={type} items={group} />
            ))}
            {flatItems.length > 0 && <FlatItemsTable items={flatItems} />}

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
