// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Read-only presentation of a customer record — the default state of
 * `/customers/:id`, which the pen button in the page header flips into
 * the editable field set.
 *
 * Mirrors `components/CustomerFields` section for section (Contact,
 * Shipping Address, Billing Address) so the two states of the screen
 * read as the same document rather than two different pages. Values are
 * label/value rows, not disabled inputs: a greyed-out box reads as
 * broken rather than read-only, and an empty one says nothing, where a
 * dash says "we do not have this".
 *
 * Email and phone are the two things a consultant opens this screen to
 * act on, so they render as `mailto:` and `tel:` links — this app is
 * used on a phone, in the field.
 *
 * Purely presentational: no state, no queries, no mutations. The owning
 * page fetches the record and owns the view/edit toggle.
 */

import type { Customer } from '../../types';

/** Section chrome, matching the `page` variant of `CustomerFields`. */
const SECTION_CLS =
  'flex flex-col gap-3.5 rounded-xl border border-border-light bg-surface p-4 shadow-md';

/**
 * One label/value row.
 *
 * A blank or whitespace-only value renders an em dash in muted type, so
 * every field the record could hold keeps its line and the layout does
 * not shift between a complete record and a sparse one.
 *
 * `href` turns the value into a link (`mailto:`/`tel:`); it is ignored
 * when there is no value to link to.
 */
function DetailRow({ label, value, href }: { label: string; value: string; href?: string }) {
  const text = (value ?? '').trim();
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
      <span className="text-xs font-semibold text-text-secondary sm:w-36 sm:shrink-0">{label}</span>
      {text ? (
        href ? (
          <a
            href={href}
            className="break-words text-[15px] text-brand-600 underline-offset-2 hover:underline"
          >
            {text}
          </a>
        ) : (
          <span className="break-words text-[15px] text-text-primary">{text}</span>
        )
      ) : (
        <span className="text-[15px] text-text-muted">—</span>
      )}
    </div>
  );
}

export default function CustomerDetailView({ customer }: { customer: Customer }) {
  const email = (customer.email ?? '').trim();
  const phone = (customer.phone ?? '').trim();

  return (
    <>
      {/* Contact */}
      <section className={SECTION_CLS}>
        <h2 className="text-[15px] font-bold text-text-primary">Contact</h2>
        <DetailRow label="First Name" value={customer.first_name ?? ''} />
        <DetailRow label="Last Name" value={customer.last_name ?? ''} />
        <DetailRow label="Email" value={email} href={email ? `mailto:${email}` : undefined} />
        {/* Spaces and dashes are legal in a tel: URI but confuse some
            dialers, so the href is stripped to dialable characters
            while the label keeps whatever was entered. */}
        <DetailRow
          label="Phone"
          value={phone}
          href={phone ? `tel:${phone.replace(/[^\d+]/g, '')}` : undefined}
        />
      </section>

      {/* Shipping address */}
      <section className={SECTION_CLS}>
        <h2 className="text-[15px] font-bold text-text-primary">Shipping Address</h2>
        <DetailRow label="Address Line 1" value={customer.shipping_address_line1 ?? ''} />
        <DetailRow label="Address Line 2" value={customer.shipping_address_line2 ?? ''} />
        <DetailRow label="City" value={customer.shipping_city ?? ''} />
        <DetailRow label="Province" value={customer.shipping_province ?? ''} />
        <DetailRow label="Postal Code" value={customer.shipping_postal_code ?? ''} />
      </section>

      {/* Billing address — collapses to one line when it mirrors
          shipping, because repeating the same five rows under a second
          heading tells the reader nothing. */}
      <section className={SECTION_CLS}>
        <h2 className="text-[15px] font-bold text-text-primary">Billing Address</h2>
        {customer.billing_same_as_shipping ? (
          <p className="text-[15px] text-text-secondary">Same as shipping address</p>
        ) : (
          <>
            <DetailRow label="Address Line 1" value={customer.billing_address_line1 ?? ''} />
            <DetailRow label="Address Line 2" value={customer.billing_address_line2 ?? ''} />
            <DetailRow label="City" value={customer.billing_city ?? ''} />
            <DetailRow label="Province" value={customer.billing_province ?? ''} />
            <DetailRow label="Postal Code" value={customer.billing_postal_code ?? ''} />
          </>
        )}
      </section>
    </>
  );
}
