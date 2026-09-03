// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Customer create / view / edit page.
 *
 * One component serves both routes. At `/customers/new` there is no
 * record yet, so the page opens straight into the editable field set.
 * At `/customers/:id` it opens READ-ONLY: looking a customer up (a
 * phone number before calling, an address before driving) is the common
 * visit, and a live form makes every one of those visits a chance to
 * change the record by accident. The pen button in the header enters
 * edit mode; Cancel and Save return to the view.
 *
 * Entering edit seeds the form from the freshly loaded record rather
 * than from a value cached on first render, so the form can never show
 * a stale copy of a customer that was saved a moment ago.
 *
 * Delete lives inside edit mode. The default state of this screen is
 * something to read, and a destructive control does not belong there.
 *
 * The field set itself and the form's state rules are not here — see
 * `components/CustomerFields` and `lib/customerForm`, which the order
 * editor's `CustomerEditModal` shares.
 */

import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import PageHeader from '../../components/PageHeader';
import CustomerFields from '../../components/CustomerFields';
import CustomerDetailView from './CustomerDetailView';
import { displayName } from '../../lib/customerName';
import {
  EMPTY_CUSTOMER_FORM,
  isCustomerFormDirty,
  toCustomerFormState,
  toCustomerInput,
  validateCustomerForm,
  type CustomerFormState,
} from '../../lib/customerForm';
import {
  useCustomer,
  useCreateCustomer,
  useUpdateCustomer,
  useDeleteCustomer,
} from '../../hooks/useCustomers';

/**
 * Pen glyph for the "edit this record" control. Inline because this
 * codebase carries no icon dependency; `currentColor` lets the button
 * own the colour.
 */
function PencilIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16v4Z"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="m13.5 6.5 4 4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

export default function CustomerForm() {
  const { id } = useParams<{ id: string }>();
  /** True on `/customers/:id` — the route addresses a saved record. */
  const isExisting = Boolean(id);
  const navigate = useNavigate();

  const { data: existing, isLoading, error } = useCustomer(id);
  const create = useCreateCustomer();
  const update = useUpdateCustomer();
  const remove = useDeleteCustomer();

  /**
   * Whether the field set is showing. A new customer has nothing to
   * read, so it starts open; a saved one starts closed.
   */
  const [editing, setEditing] = useState(!isExisting);
  const [form, setForm] = useState<CustomerFormState>(EMPTY_CUSTOMER_FORM);

  /** Seeds the form from the loaded record and opens the field set. */
  function startEditing() {
    if (!existing) return;
    setForm(toCustomerFormState(existing));
    setEditing(true);
  }

  /**
   * Leaves edit mode, confirming first when there is typed work to
   * lose. A new customer has no view to fall back to, so Cancel there
   * returns to the list instead.
   */
  function cancelEditing() {
    if (!isExisting) return navigate('/customers');
    if (existing && isCustomerFormDirty(form, existing)) {
      if (!window.confirm('Discard changes?')) return;
    }
    setEditing(false);
  }

  /**
   * Validates and saves.
   *
   * On an existing customer this returns to the read-only view with the
   * refreshed record — the screen the user came from — rather than
   * bouncing to the list. Creating still goes to the list, because a
   * brand-new record's next step is usually the next record.
   *
   * A failure keeps the field set open with the typed values intact.
   */
  function handleSave() {
    const message = validateCustomerForm(form);
    if (message) return toast.error(message);

    const payload = toCustomerInput(form);
    if (isExisting && id) {
      update.mutate(
        { id, patch: payload },
        {
          onSuccess: () => {
            toast.success('Customer updated.');
            setEditing(false);
          },
          onError: (e) => toast.error(e.message),
        }
      );
    } else {
      create.mutate(payload, {
        onSuccess: () => {
          toast.success('Customer created.');
          navigate('/customers');
        },
        onError: (e) => toast.error(e.message),
      });
    }
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

  if (isExisting && (isLoading || (!existing && !error))) {
    return (
      <div className="min-h-screen bg-surface-muted">
        <PageHeader title="Customer" backTo="/customers" />
        <p className="p-4 text-text-muted">Loading…</p>
      </div>
    );
  }
  if (isExisting && error) {
    return (
      <div className="min-h-screen bg-surface-muted">
        <PageHeader title="Customer" backTo="/customers" />
        <p className="p-4 text-danger">{error.message}</p>
      </div>
    );
  }

  const pending = create.isPending || update.isPending;

  // Read-only view. Reachable only with a loaded record, since the
  // guards above cover every other state of an existing customer.
  if (!editing && existing) {
    return (
      <div className="min-h-screen bg-surface-muted pb-8">
        <PageHeader
          title={displayName(existing)}
          eyebrow="Customer"
          backTo="/customers"
          right={
            <button
              type="button"
              onClick={startEditing}
              aria-label="Edit customer"
              className="flex h-11 w-11 items-center justify-center rounded-md border border-border-input bg-surface text-text-secondary hover:bg-surface-sunken"
            >
              <PencilIcon />
            </button>
          }
        />
        <div className="page-container flex flex-col gap-4 py-4 md:py-6 lg:py-8 [--page-max:48rem]">
          <CustomerDetailView customer={existing} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-muted pb-28">
      <PageHeader title={isExisting ? 'Edit Customer' : 'New Customer'} backTo="/customers" />
      <div className="page-container flex flex-col gap-4 py-4 md:py-6 lg:py-8 [--page-max:48rem]">
        <CustomerFields value={form} onChange={setForm} variant="page" />

        {isExisting && (
          <button
            onClick={handleDelete}
            disabled={remove.isPending}
            className="h-11 rounded-md border border-border-input bg-surface text-[13px] font-medium text-danger hover:bg-surface-muted disabled:opacity-40"
          >
            {remove.isPending ? 'Deleting…' : 'Delete Customer'}
          </button>
        )}
      </div>

      {/* Sticky action bar */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-surface p-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex w-full max-w-lg gap-2.5">
          <button
            onClick={cancelEditing}
            disabled={pending}
            className="flex h-12 flex-1 items-center justify-center rounded-md border border-border-input bg-surface text-sm font-semibold text-text-primary hover:bg-surface-sunken disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={pending}
            className="flex h-12 flex-[2] items-center justify-center rounded-md bg-brand-600 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-40"
          >
            {pending ? 'Saving…' : isExisting ? 'Save Changes' : 'Create Customer'}
          </button>
        </div>
      </div>
    </div>
  );
}
