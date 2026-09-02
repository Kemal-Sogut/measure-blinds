// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * CustomerEditModal — edits an existing customer record from inside
 * another flow, currently the order editor's customer card.
 *
 * The case it exists for: a wrong phone number or a mistyped street
 * noticed while writing up an order. Before it, fixing that meant
 * abandoning the order editor for the customers module and navigating
 * back.
 *
 * Writes the `customers` row and nothing else — the order is neither
 * saved nor dirtied by this dialog, so order pricing and totals are
 * untouched (AI_GUIDELINES rule 1 is not in play). The saved row is
 * handed back through `onSaved` so the opener can refresh whatever it
 * renders from it; `useUpdateCustomer` separately refreshes the
 * customer detail and list caches, so the customers module reflects
 * the change with no extra plumbing here.
 *
 * Sibling of `CustomerCreateModal` and follows the same contract:
 * callers mount it conditionally rather than toggling a prop, so it
 * passes `open` as a constant `true`. Escape handling, backdrop
 * dismissal, body scroll lock and focus all come from `Modal` — this
 * file must not add its own, or the close handler would fire twice.
 *
 * Rendered at z-50 (by `Modal`) so it stacks above the z-40 sheets that
 * open it.
 */

import { useState } from 'react';
import toast from 'react-hot-toast';
import CustomerFields from './CustomerFields';
import Modal from './ui/Modal';
import Button from './ui/Button';
import { useUpdateCustomer } from '../hooks/useCustomers';
import { displayName } from '../lib/customerName';
import {
  toCustomerFormState,
  toCustomerInput,
  validateCustomerForm,
  type CustomerFormState,
} from '../lib/customerForm';
import type { Customer } from '../types';

export default function CustomerEditModal({
  customer,
  onSaved,
  onClose,
}: {
  /** The record to edit; seeds the form once, on mount. */
  customer: Customer;
  /** Called with the saved row so the opener can refresh its copy. */
  onSaved: (customer: Customer) => void;
  onClose: () => void;
}) {
  const updateMut = useUpdateCustomer();
  // Seeded once by the initializer, not synced from the prop: while the
  // dialog is open the user's typing is the truth, and re-seeding from
  // a re-rendered prop would discard it mid-edit.
  const [form, setForm] = useState<CustomerFormState>(() => toCustomerFormState(customer));

  /**
   * Validates and saves. A failure toasts and leaves the dialog open
   * with the typed values intact — closing it would throw away work the
   * user can no longer recover.
   */
  async function submit() {
    const message = validateCustomerForm(form);
    if (message) return toast.error(message);
    try {
      const saved = await updateMut.mutateAsync({
        id: customer.id,
        patch: toCustomerInput(form),
      });
      toast.success(`Customer ${displayName(saved)} updated.`);
      onSaved(saved);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update the customer.');
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit customer"
      subtitle="Changes apply to the customer record everywhere"
      size="lg"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={submit} loading={updateMut.isPending}>
            {updateMut.isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <CustomerFields value={form} onChange={setForm} variant="modal" autoFocus />
      </div>
    </Modal>
  );
}
