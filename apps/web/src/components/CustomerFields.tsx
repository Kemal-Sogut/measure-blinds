// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * The editable customer field set: contact details, shipping address,
 * and a billing address behind a "same as shipping" disclosure.
 *
 * Single owner of this markup. It is rendered by the customers page in
 * edit mode (`pages/customers/CustomerForm`) and by the order editor's
 * inline dialog (`components/CustomerEditModal`); before it existed the
 * same three sections were about to be written a third time, with the
 * usual result that a field added to one copy is missing from the rest.
 *
 * Fully controlled and stateless — the whole `CustomerFormState` comes
 * in as `value` and every edit goes back out through `onChange`, so the
 * owning surface keeps the single copy of the form and can compare it
 * against the server row for its dirty-check.
 *
 * NOT shared with `CustomerCreateModal`, whose compact, billing-less
 * layout is a deliberate difference for a quick add inside a picker.
 *
 * @see lib/customerForm for the state shape, validation and dirty-check.
 */

import AddressAutocomplete from './AddressAutocomplete';
import { inputClass } from './ui';
import type { AddressSuggestion } from '../lib/addressSearch';
import type { CustomerFormState } from '../lib/customerForm';

/**
 * This form's control treatment. Composed from the shared `inputClass`
 * so it cannot drift from every other input in the app, plus the fixed
 * height the two-column grids rely on to stay aligned.
 */
const INPUT_CLS = `h-11 ${inputClass}`;

/**
 * Section chrome per variant. `page` gives each section the app's
 * standard bordered card; `modal` drops the border and padding, because
 * the `Modal` primitive already supplies both and nesting cards inside
 * a dialog reads as a panel inside a panel.
 */
const SECTION_CLS = {
  page: 'flex flex-col gap-3.5 rounded-xl border border-border-light bg-surface p-4 shadow-md',
  modal: 'flex flex-col gap-3.5',
} as const;

/** Labelled text input bound to one `CustomerFormState` key. */
function Field({
  label,
  value,
  onChange,
  type = 'text',
  inputMode,
  autoFocus = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  inputMode?: 'email' | 'tel' | 'text';
  autoFocus?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-text-secondary">{label}</span>
      <input
        type={type}
        inputMode={inputMode}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT_CLS}
      />
    </label>
  );
}

export default function CustomerFields({
  value,
  onChange,
  variant = 'page',
  autoFocus = false,
}: {
  /** The complete form state. This component holds none of its own. */
  value: CustomerFormState;
  /** Receives the whole next state, not a patch. */
  onChange: (next: CustomerFormState) => void;
  /** Section chrome: bordered cards on a page, flush inside a dialog. */
  variant?: 'page' | 'modal';
  /** Focuses the first name field on mount — for dialogs, not pages. */
  autoFocus?: boolean;
}) {
  const sectionCls = SECTION_CLS[variant];

  /** Single-field updater preserving the rest of the form. */
  function set<K extends keyof CustomerFormState>(key: K, next: CustomerFormState[K]) {
    onChange({ ...value, [key]: next });
  }

  /**
   * Fills a whole address block from a chosen autocomplete suggestion in
   * one update. Line 2 is intentionally left untouched — unit and buzzer
   * numbers rarely come back from the geocoder and the consultant may
   * have already typed one. Literal keys (not a computed `${prefix}_…`)
   * keep the update strictly typed against `CustomerFormState`, whose
   * `billing_same_as_shipping` boolean would otherwise clash with an
   * inferred string index signature.
   */
  function applyAddress(prefix: 'shipping' | 'billing', s: AddressSuggestion) {
    onChange(
      prefix === 'shipping'
        ? {
            ...value,
            shipping_address_line1: s.line1,
            shipping_city: s.city || value.shipping_city,
            shipping_province: s.province || value.shipping_province,
            shipping_postal_code: s.postal_code || value.shipping_postal_code,
          }
        : {
            ...value,
            billing_address_line1: s.line1,
            billing_city: s.city || value.billing_city,
            billing_province: s.province || value.billing_province,
            billing_postal_code: s.postal_code || value.billing_postal_code,
          }
    );
  }

  return (
    <>
      {/* Contact */}
      <section className={sectionCls}>
        <h2 className="text-[15px] font-bold text-text-primary">Contact</h2>
        <div className="grid grid-cols-2 gap-3.5">
          {/* Neither name is required — see `validateCustomerForm`. */}
          <Field
            label="First Name"
            value={value.first_name}
            onChange={(v) => set('first_name', v)}
            autoFocus={autoFocus}
          />
          <Field label="Last Name" value={value.last_name} onChange={(v) => set('last_name', v)} />
        </div>
        <Field
          label="Email"
          type="email"
          inputMode="email"
          value={value.email}
          onChange={(v) => set('email', v)}
        />
        <Field
          label="Phone"
          type="tel"
          inputMode="tel"
          value={value.phone}
          onChange={(v) => set('phone', v)}
        />
      </section>

      {/* Shipping address */}
      <section className={sectionCls}>
        <h2 className="text-[15px] font-bold text-text-primary">Shipping Address</h2>
        <AddressAutocomplete
          label="Address Line 1"
          value={value.shipping_address_line1}
          onChange={(v) => set('shipping_address_line1', v)}
          onSelect={(s) => applyAddress('shipping', s)}
        />
        <Field
          label="Address Line 2"
          value={value.shipping_address_line2}
          onChange={(v) => set('shipping_address_line2', v)}
        />
        <div className="grid grid-cols-2 gap-3.5">
          <Field label="City" value={value.shipping_city} onChange={(v) => set('shipping_city', v)} />
          <Field
            label="Province"
            value={value.shipping_province}
            onChange={(v) => set('shipping_province', v)}
          />
        </div>
        <Field
          label="Postal Code"
          value={value.shipping_postal_code}
          onChange={(v) => set('shipping_postal_code', v)}
        />
      </section>

      {/* Billing address */}
      <section className={sectionCls}>
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            checked={value.billing_same_as_shipping}
            onChange={(e) => set('billing_same_as_shipping', e.target.checked)}
            className="h-5 w-5 rounded-sm accent-brand-600"
          />
          <span className="text-sm font-medium text-text-primary">Billing same as shipping</span>
        </label>
        {/* Hidden fields keep their values, so unchecking restores what
            was previously entered. `isCustomerFormDirty` knows to ignore
            them while they are hidden. */}
        {!value.billing_same_as_shipping && (
          <>
            <AddressAutocomplete
              label="Address Line 1"
              value={value.billing_address_line1}
              onChange={(v) => set('billing_address_line1', v)}
              onSelect={(s) => applyAddress('billing', s)}
            />
            <Field
              label="Address Line 2"
              value={value.billing_address_line2}
              onChange={(v) => set('billing_address_line2', v)}
            />
            <div className="grid grid-cols-2 gap-3.5">
              <Field label="City" value={value.billing_city} onChange={(v) => set('billing_city', v)} />
              <Field
                label="Province"
                value={value.billing_province}
                onChange={(v) => set('billing_province', v)}
              />
            </div>
            <Field
              label="Postal Code"
              value={value.billing_postal_code}
              onChange={(v) => set('billing_postal_code', v)}
            />
          </>
        )}
      </section>
    </>
  );
}
