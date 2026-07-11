// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Customer create/edit form.
 *
 * One component serves both /customers/new and /customers/:id — the
 * presence of a route id switches it into edit mode (loads the record,
 * shows Delete). The "Billing same as shipping" checkbox toggles the
 * billing address block's visibility and is persisted as
 * `billing_same_as_shipping`; hidden billing fields keep their values
 * so unchecking restores what was previously entered.
 */

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import PageHeader from '../../components/PageHeader';
import AddressAutocomplete from '../../components/AddressAutocomplete';
import type { AddressSuggestion } from '../../lib/addressSearch';
import {
  useCustomer,
  useCreateCustomer,
  useUpdateCustomer,
  useDeleteCustomer,
  type CustomerInput,
} from '../../hooks/useCustomers';

/** Editable form fields, all held as strings for direct input binding. */
interface FormState {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  shipping_address_line1: string;
  shipping_address_line2: string;
  shipping_city: string;
  shipping_province: string;
  shipping_postal_code: string;
  billing_same_as_shipping: boolean;
  billing_address_line1: string;
  billing_address_line2: string;
  billing_city: string;
  billing_province: string;
  billing_postal_code: string;
}

const EMPTY: FormState = {
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  shipping_address_line1: '',
  shipping_address_line2: '',
  shipping_city: '',
  shipping_province: 'ON',
  shipping_postal_code: '',
  billing_same_as_shipping: true,
  billing_address_line1: '',
  billing_address_line2: '',
  billing_city: '',
  billing_province: '',
  billing_postal_code: '',
};

const INPUT_CLS =
  'h-11 w-full rounded-sm border border-border-input bg-surface px-3 text-sm text-text-primary';

/** Labeled text input bound to one FormState key. */
function Field({
  label,
  value,
  onChange,
  type = 'text',
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  inputMode?: 'email' | 'tel' | 'text';
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-text-secondary">{label}</span>
      <input
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT_CLS}
      />
    </label>
  );
}

export default function CustomerForm() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const { data: existing, isLoading, error } = useCustomer(id);
  const create = useCreateCustomer();
  const update = useUpdateCustomer();
  const remove = useDeleteCustomer();

  const [form, setForm] = useState<FormState>(EMPTY);
  const [loaded, setLoaded] = useState(false);

  // Populate once when editing an existing customer.
  useEffect(() => {
    if (isEdit && existing && !loaded) {
      setForm({ ...EMPTY, ...existing });
      setLoaded(true);
    }
  }, [isEdit, existing, loaded]);

  /** Field updater preserving the rest of the form. */
  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  /**
   * Fills a whole address block (shipping or billing) from a chosen
   * autocomplete suggestion in one update. Line 2 is intentionally left
   * untouched — unit/suite numbers rarely come back from the geocoder
   * and the consultant may have already typed one. Literal keys (not a
   * computed `${prefix}_…`) keep the update strictly typed against
   * FormState, whose `billing_same_as_shipping` boolean would otherwise
   * clash with an inferred string index signature.
   */
  function applyAddress(prefix: 'shipping' | 'billing', s: AddressSuggestion) {
    setForm((f) =>
      prefix === 'shipping'
        ? {
            ...f,
            shipping_address_line1: s.line1,
            shipping_city: s.city || f.shipping_city,
            shipping_province: s.province || f.shipping_province,
            shipping_postal_code: s.postal_code || f.shipping_postal_code,
          }
        : {
            ...f,
            billing_address_line1: s.line1,
            billing_city: s.city || f.billing_city,
            billing_province: s.province || f.billing_province,
            billing_postal_code: s.postal_code || f.billing_postal_code,
          }
    );
  }

  /** Validates and saves; navigates back to the list on success. */
  function handleSave() {
    if (!form.first_name.trim()) return toast.error('First name is required.');
    if (!form.last_name.trim()) return toast.error('Last name is required.');
    if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) {
      return toast.error('Enter a valid email or leave it empty.');
    }

    const payload: CustomerInput = {
      ...form,
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
    };
    const opts = {
      onSuccess: () => {
        toast.success(isEdit ? 'Customer updated.' : 'Customer created.');
        navigate('/customers');
      },
      onError: (e: Error) => toast.error(e.message),
    };
    if (isEdit && id) update.mutate({ id, patch: payload }, opts);
    else create.mutate(payload, opts);
  }

  /** Confirms then soft-deletes the customer. */
  function handleDelete() {
    if (!id) return;
    if (!window.confirm('Delete this customer? Their existing orders are kept.')) return;
    remove.mutate(id, {
      onSuccess: () => {
        toast.success('Customer deleted.');
        navigate('/customers');
      },
      onError: (e) => toast.error(e.message),
    });
  }

  if (isEdit && (isLoading || (!existing && !error))) {
    return (
      <div className="min-h-screen bg-surface-muted">
        <PageHeader title="Edit Customer" backTo="/customers" />
        <p className="p-4 text-text-muted">Loading…</p>
      </div>
    );
  }
  if (isEdit && error) {
    return (
      <div className="min-h-screen bg-surface-muted">
        <PageHeader title="Edit Customer" backTo="/customers" />
        <p className="p-4 text-danger">{error.message}</p>
      </div>
    );
  }

  const pending = create.isPending || update.isPending;

  return (
    <div className="min-h-screen bg-surface-muted pb-28">
      <PageHeader title={isEdit ? 'Edit Customer' : 'New Customer'} backTo="/customers" />
      <div className="mx-auto flex max-w-lg flex-col gap-4 p-4 lg:p-8">
        {/* Contact */}
        <section className="flex flex-col gap-3.5 rounded-sm border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-text-primary">Contact</h2>
          <div className="grid grid-cols-2 gap-3.5">
            <Field label="First Name" value={form.first_name} onChange={(v) => set('first_name', v)} />
            <Field label="Last Name" value={form.last_name} onChange={(v) => set('last_name', v)} />
          </div>
          <Field label="Email" type="email" inputMode="email" value={form.email} onChange={(v) => set('email', v)} />
          <Field label="Phone" type="tel" inputMode="tel" value={form.phone} onChange={(v) => set('phone', v)} />
        </section>

        {/* Shipping address */}
        <section className="flex flex-col gap-3.5 rounded-sm border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-text-primary">Shipping Address</h2>
          <AddressAutocomplete
            label="Address Line 1"
            value={form.shipping_address_line1}
            onChange={(v) => set('shipping_address_line1', v)}
            onSelect={(s) => applyAddress('shipping', s)}
          />
          <Field label="Address Line 2" value={form.shipping_address_line2} onChange={(v) => set('shipping_address_line2', v)} />
          <div className="grid grid-cols-2 gap-3.5">
            <Field label="City" value={form.shipping_city} onChange={(v) => set('shipping_city', v)} />
            <Field label="Province" value={form.shipping_province} onChange={(v) => set('shipping_province', v)} />
          </div>
          <Field label="Postal Code" value={form.shipping_postal_code} onChange={(v) => set('shipping_postal_code', v)} />
        </section>

        {/* Billing address */}
        <section className="flex flex-col gap-3.5 rounded-sm border border-border bg-surface p-4">
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              checked={form.billing_same_as_shipping}
              onChange={(e) => set('billing_same_as_shipping', e.target.checked)}
              className="h-5 w-5 rounded-sm accent-brand-600"
            />
            <span className="text-sm font-medium text-text-primary">Billing same as shipping</span>
          </label>
          {!form.billing_same_as_shipping && (
            <>
              <AddressAutocomplete
                label="Address Line 1"
                value={form.billing_address_line1}
                onChange={(v) => set('billing_address_line1', v)}
                onSelect={(s) => applyAddress('billing', s)}
              />
              <Field label="Address Line 2" value={form.billing_address_line2} onChange={(v) => set('billing_address_line2', v)} />
              <div className="grid grid-cols-2 gap-3.5">
                <Field label="City" value={form.billing_city} onChange={(v) => set('billing_city', v)} />
                <Field label="Province" value={form.billing_province} onChange={(v) => set('billing_province', v)} />
              </div>
              <Field label="Postal Code" value={form.billing_postal_code} onChange={(v) => set('billing_postal_code', v)} />
            </>
          )}
        </section>

        {isEdit && (
          <button
            onClick={handleDelete}
            disabled={remove.isPending}
            className="h-11 rounded-sm border border-border-input bg-surface text-[13px] font-medium text-danger hover:bg-surface-muted disabled:opacity-40"
          >
            {remove.isPending ? 'Deleting…' : 'Delete Customer'}
          </button>
        )}
      </div>

      {/* Sticky save bar */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-surface p-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))]">
        <button
          onClick={handleSave}
          disabled={pending}
          className="mx-auto flex h-12 w-full max-w-lg items-center justify-center rounded-sm bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
        >
          {pending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Customer'}
        </button>
      </div>
    </div>
  );
}
