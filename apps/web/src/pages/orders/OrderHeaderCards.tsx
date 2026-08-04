// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Header cards for the order editor (`OrderDetail`): the customer card
 * and the order-dates card that sits directly below it.
 *
 * `CustomerCard` keeps the existing picker as its title row — tapping it
 * opens the searchable customer sheet owned by `OrderDetail` — and adds
 * a disclosure that expands the full customer record (contact plus
 * shipping/billing addresses) inline as read-only text fields, so a
 * consultant can read or copy an address without leaving the order.
 * Editing a customer stays in the Customers module; nothing here writes
 * back to the customer row.
 *
 * `OrderDatesCard` owns the order/expiry date pair and the expiry term
 * shortcuts from `lib/expiryTerms` ("On receipt", 1/3/7/15 days, 1
 * month). It is presentational: the chosen term, the resolved dates and
 * the recompute-on-order-date behaviour all live in `OrderDetail` state,
 * because the expiry date is part of the order payload sent to the
 * Worker.
 *
 * Both cards are rendered inside `OrderDetail`'s `fieldset`, so they
 * inherit its disabled state and need no separate read-only styling
 * beyond suppressing the picker click.
 */

import { useState } from 'react';
import DatePicker from '../../components/DatePicker';
import { displayName } from '../../lib/customerName';
import { EXPIRY_PRESETS, type ExpiryPresetId } from '../../lib/expiryTerms';
import type { Customer } from '../../types';

/**
 * One labelled read-only value inside the expanded customer card.
 * Rendered as a real `input` rather than text so the value keeps the
 * field affordance of the surrounding form and stays selectable /
 * copyable (phone numbers, postal codes) on touch devices. Empty values
 * render a muted em dash placeholder instead of a blank box.
 */
function DetailField({
  label,
  value,
  className = '',
}: {
  label: string;
  value: string | null | undefined;
  className?: string;
}) {
  return (
    <div className={className}>
      <span className="block text-xs font-medium text-text-secondary">{label}</span>
      <input
        readOnly
        value={value?.trim() ? value : ''}
        placeholder="—"
        className="mt-1 h-11 w-full rounded-md border border-border-input bg-surface-sunken px-3 text-sm text-text-primary"
      />
    </div>
  );
}

/**
 * Customer card: searchable picker as the title row plus an expandable
 * read-only detail panel.
 *
 * @param customer  Currently selected customer, or `null` while unset.
 * @param onPick    Opens the customer search sheet owned by `OrderDetail`.
 * @param readOnly  Suppresses the picker click (the card still expands).
 */
export function CustomerCard({
  customer,
  onPick,
  readOnly,
}: {
  customer: Customer | null;
  onPick: () => void;
  readOnly: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  // Nothing to reveal until a customer is chosen.
  const canExpand = Boolean(customer);
  const open = expanded && canExpand;

  return (
    <section className="flex flex-col gap-3.5 rounded-xl border border-border-light bg-surface p-4 shadow-md">
      <div>
        <span className="mb-1.5 block text-xs font-medium text-text-secondary">Customer</span>
        <div className="flex items-stretch gap-2">
          <button
            type="button"
            onClick={() => !readOnly && onPick()}
            className="flex h-11 min-w-0 flex-1 items-center justify-between rounded-md border border-border-input bg-surface px-3 text-left"
          >
            <span className={`truncate text-sm ${customer ? 'text-text-primary' : 'text-text-muted'}`}>
              {customer ? displayName(customer) : 'Select customer…'}
            </span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-muted" />
            </svg>
          </button>
          {canExpand && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={open}
              aria-controls="customer-details"
              aria-label={open ? 'Hide customer details' : 'Show customer details'}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border-input bg-surface text-text-muted hover:bg-surface-muted"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
                className={`transition-transform ${open ? 'rotate-180' : ''}`}
              >
                <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {open && customer && (
        <div id="customer-details" className="flex flex-col gap-3.5 border-t border-border-light pt-3.5">
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <DetailField label="First name" value={customer.first_name} />
            <DetailField label="Last name" value={customer.last_name} />
            <DetailField label="Email" value={customer.email} />
            <DetailField label="Phone" value={customer.phone} />
          </div>

          <div className="flex flex-col gap-3.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              Shipping address
            </span>
            <DetailField label="Address line 1" value={customer.shipping_address_line1} />
            <DetailField label="Address line 2" value={customer.shipping_address_line2} />
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
              <DetailField label="City" value={customer.shipping_city} />
              <DetailField label="Province" value={customer.shipping_province} />
              <DetailField label="Postal code" value={customer.shipping_postal_code} />
            </div>
          </div>

          <div className="flex flex-col gap-3.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              Billing address
            </span>
            {customer.billing_same_as_shipping ? (
              <p className="text-sm text-text-secondary">Same as shipping address.</p>
            ) : (
              <>
                <DetailField label="Address line 1" value={customer.billing_address_line1} />
                <DetailField label="Address line 2" value={customer.billing_address_line2} />
                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
                  <DetailField label="City" value={customer.billing_city} />
                  <DetailField label="Province" value={customer.billing_province} />
                  <DetailField label="Postal code" value={customer.billing_postal_code} />
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Order-dates card: the order/expiry date pair, the expiry term chips
 * and the order number.
 *
 * The chips are a shortcut for the expiry DatePicker, not a separate
 * value: picking one lets the caller keep the expiry pinned to
 * `orderDate + term`, while picking a date directly clears the term
 * (`expiryPreset === null`) and freezes that date.
 *
 * @param orderNumber Server-assigned number; `null` before the first save.
 */
export function OrderDatesCard({
  orderDate,
  onOrderDate,
  expiryDate,
  onExpiryDate,
  expiryPreset,
  onExpiryPreset,
  orderNumber,
}: {
  orderDate: Date;
  onOrderDate: (d: Date) => void;
  expiryDate: Date | null;
  onExpiryDate: (d: Date) => void;
  expiryPreset: ExpiryPresetId | null;
  onExpiryPreset: (id: ExpiryPresetId) => void;
  orderNumber: string | null;
}) {
  return (
    <section className="flex flex-col gap-3.5 rounded-xl border border-border-light bg-surface p-4 shadow-md">
      <div className="grid grid-cols-2 gap-3.5">
        <DatePicker label="Order date" value={orderDate} onChange={onOrderDate} />
        <DatePicker label="Expiry date" value={expiryDate} onChange={onExpiryDate} />
      </div>

      <div>
        <span className="mb-1.5 block text-xs font-medium text-text-secondary">Expires</span>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {EXPIRY_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onExpiryPreset(p.id)}
              aria-pressed={expiryPreset === p.id}
              className={`h-11 rounded-md border px-1 text-[13px] font-medium ${
                expiryPreset === p.id
                  ? 'border-brand-600 bg-brand-100 text-brand-600'
                  : 'border-border-input bg-surface text-text-secondary hover:bg-surface-muted'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="text-xs text-text-muted">
        Order #:{' '}
        <span className="font-mono font-medium text-text-secondary">
          {orderNumber ?? 'assigned on save'}
        </span>
      </div>
    </section>
  );
}
