// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Header cards for the order editor (`OrderDetail`): the customer card
 * and the order-dates card that sits directly below it.
 *
 * `CustomerCard` keeps the existing picker as its title row — tapping it
 * opens the searchable customer sheet owned by `OrderDetail` — and adds
 * a disclosure that expands the customer record inline as PLAIN TEXT
 * laid out like an address label: name / phone / email, then the
 * shipping block, with billing beside it only when the two differ. Not
 * form fields — this is something to read, and boxes around unchangeable
 * values invite edits that cannot happen. Editing a customer stays in
 * the Customers module; nothing here writes back to the customer row.
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
 * Formats one address as the two printed lines used on letters:
 *
 *   123 Main Street, Toronto, ON
 *   X0X X0X Canada
 *
 * Line 2 of the street address (unit/buzzer) folds into the first line
 * rather than getting a line of its own, so a two-line block stays two
 * lines. Empty parts are dropped, and the country word is only appended
 * behind a postal code — this shop's address search is Canada-only, but
 * "Canada" alone under an otherwise empty address would be noise.
 * Returns an empty array when the customer has no address at all, which
 * is the caller's signal to skip the block.
 */
function addressLines(a: {
  line1: string;
  line2: string;
  city: string;
  province: string;
  postal: string;
}): string[] {
  const street = [a.line1, a.line2, a.city, a.province]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
    .join(', ');
  const postal = (a.postal ?? '').trim();
  return [street, postal && `${postal} Canada`].filter(Boolean);
}

/**
 * One address block inside the expanded customer card: a "Shipping
 * Address:" / "Billing Address:" caption over its formatted lines.
 * Renders nothing when the address is empty, so a customer with only a
 * shipping address never shows a dangling caption.
 */
function AddressBlock({ label, lines }: { label: string; lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <div>
      <p className="font-medium text-text-secondary">{label}</p>
      {/* Index keys: a static, never-reordered list of formatted lines. */}
      {lines.map((line, i) => (
        <p key={i}>{line}</p>
      ))}
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

  // Name / phone / email, in that reading order, with blanks dropped so
  // a partially-filled record never shows a gap.
  const contact = customer
    ? [displayName(customer), customer.phone, customer.email]
        .map((s) => (s ?? '').trim())
        .filter(Boolean)
    : [];
  const shipping = customer
    ? addressLines({
        line1: customer.shipping_address_line1,
        line2: customer.shipping_address_line2,
        city: customer.shipping_city,
        province: customer.shipping_province,
        postal: customer.shipping_postal_code,
      })
    : [];
  // Billing is shown ONLY when it actually differs from shipping.
  const billing =
    customer && !customer.billing_same_as_shipping
      ? addressLines({
          line1: customer.billing_address_line1,
          line2: customer.billing_address_line2,
          city: customer.billing_city,
          province: customer.billing_province,
          postal: customer.billing_postal_code,
        })
      : [];

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
        <div
          id="customer-details"
          className="flex flex-col gap-3.5 border-t border-border-light pt-3.5 text-sm text-text-primary"
        >
          {/* Contact block — one value per line, empties dropped. */}
          <div>
            {contact.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>

          {/*
            Addresses side by side, shipping left. Billing is omitted
            entirely when it mirrors shipping — repeating the same lines
            under a second caption tells the reader nothing — which is
            also why the grid only splits into two columns when there is
            a second block to put in one.
          */}
          {(shipping.length > 0 || billing.length > 0) && (
            <div className={`grid gap-3.5 ${billing.length > 0 ? 'sm:grid-cols-2' : ''}`}>
              <AddressBlock label="Shipping Address:" lines={shipping} />
              <AddressBlock label="Billing Address:" lines={billing} />
            </div>
          )}
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
