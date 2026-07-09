// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * CustomerCreateModal — a quick "add customer" pop-up used inside other
 * pickers (the order editor's customer selector and the appointment
 * wizard's customer step), so a brand-new customer can be created
 * without leaving the current flow.
 *
 * Deliberately a compact subset of the full CustomerForm page: names,
 * contact details, and the shipping address (billing defaults to
 * "same as shipping"). The created customer is handed back to the
 * caller through `onCreated` so it can be selected immediately.
 *
 * Rendered at z-50 so it stacks above the z-40 sheets/wizards that
 * open it.
 */

import { useState } from 'react';
import toast from 'react-hot-toast';
import { useCreateCustomer } from '../hooks/useCustomers';
import type { Customer } from '../types';

const INPUT_CLS =
  'h-11 w-full rounded-sm border border-border-input bg-surface px-3 text-sm text-text-primary';

/** Small labelled input used by every field in the form. */
function Field({
  label,
  value,
  onChange,
  type = 'text',
  required = false,
  autoFocus = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-text-secondary">
        {label}
        {required && <span className="text-danger"> *</span>}
      </span>
      <input
        type={type}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT_CLS}
      />
    </label>
  );
}

export default function CustomerCreateModal({
  onCreated,
  onClose,
  requireEmail = false,
}: {
  /** Called with the created customer so the opener can select it. */
  onCreated: (customer: Customer) => void;
  onClose: () => void;
  /**
   * Set when the flow that opened the modal emails the customer (e.g.
   * appointment proposals) — an email address becomes mandatory.
   */
  requireEmail?: boolean;
}) {
  const createMut = useCreateCustomer();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');
  const [city, setCity] = useState('');
  const [province, setProvince] = useState('ON');
  const [postal, setPostal] = useState('');

  async function submit() {
    if (!firstName.trim() || !lastName.trim()) {
      return toast.error('First and last name are required.');
    }
    if (requireEmail && !email.trim()) {
      return toast.error('An email address is required to send the proposal.');
    }
    try {
      const created = await createMut.mutateAsync({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        shipping_address_line1: line1.trim(),
        shipping_address_line2: line2.trim(),
        shipping_city: city.trim(),
        shipping_province: province.trim(),
        shipping_postal_code: postal.trim(),
        billing_same_as_shipping: true,
      });
      toast.success(`Customer ${created.first_name} ${created.last_name} added.`);
      onCreated(created);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create the customer.');
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={onClose}
      role="dialog"
      aria-label="Add customer"
    >
      <div
        className="max-h-[85vh] w-full overflow-y-auto rounded-t-sm bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:max-w-md sm:rounded-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-primary">Add customer</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-sm text-text-muted hover:bg-surface-muted"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="First name" value={firstName} onChange={setFirstName} required autoFocus />
            <Field label="Last name" value={lastName} onChange={setLastName} required />
          </div>
          <Field label="Email" type="email" value={email} onChange={setEmail} required={requireEmail} />
          <Field label="Phone" type="tel" value={phone} onChange={setPhone} />
          <Field label="Address line 1" value={line1} onChange={setLine1} />
          <Field label="Address line 2" value={line2} onChange={setLine2} />
          <div className="grid grid-cols-[1fr_5rem_7rem] gap-2">
            <Field label="City" value={city} onChange={setCity} />
            <Field label="Province" value={province} onChange={setProvince} />
            <Field label="Postal code" value={postal} onChange={setPostal} />
          </div>

          <div className="mt-1 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-11 flex-1 rounded-sm border border-border-input bg-surface text-[13px] font-medium text-text-secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={createMut.isPending}
              className="h-11 flex-[2] rounded-sm bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
            >
              {createMut.isPending ? 'Saving…' : 'Add Customer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
