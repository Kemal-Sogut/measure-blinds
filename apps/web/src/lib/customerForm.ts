// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pure state, conversion and validation for the customer edit form.
 *
 * Extracted so the two surfaces that edit a customer — the customers
 * page (`pages/customers/CustomerForm`) and the order editor's inline
 * dialog (`components/CustomerEditModal`) — share one definition of
 * what the form holds, what gets sent, and what counts as valid. The
 * validation rule in particular must not fork: it mirrors the server's
 * create refinement in `apps/api/src/routes/customers.ts`, and a copy
 * that drifts turns a clear client-side message into an opaque 400.
 *
 * Deliberately free of React and of the network layer, so it is
 * testable without a DOM — `apps/web` has no DOM test harness.
 */

import type { CustomerInput } from '../hooks/useCustomers';
import type { Customer } from '../types';

/**
 * The editable subset of a customer row, all held as strings for direct
 * binding to controlled inputs. `billing_same_as_shipping` is the one
 * boolean because it drives a checkbox, not a text field.
 *
 * Excludes `id` and the timestamp columns on purpose: the server's
 * update schema is `.strict()`, so a payload carrying them is rejected
 * with a 400 rather than silently cleaned.
 */
export interface CustomerFormState {
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

/**
 * Blank form for a brand-new customer.
 *
 * Two fields are not blank: the province defaults to Ontario (this shop
 * is Ontario-only, and pre-filling it removes a keystroke from every
 * new record), and billing defaults to mirroring shipping, which is
 * true for nearly every residential customer.
 */
export const EMPTY_CUSTOMER_FORM: CustomerFormState = {
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

/**
 * Copies just the editable fields off a server row.
 *
 * Field-by-field rather than a spread, for two reasons. The row also
 * carries `id` and the timestamp columns, and the update schema is
 * strict — spreading it wholesale would make every save 400. And the
 * text columns are nullable in the database despite the TypeScript
 * type: a `null` reaching an input turns it uncontrolled and React
 * warns, so every text field coalesces to `''`.
 */
export function toCustomerFormState(row: Customer): CustomerFormState {
  return {
    first_name: row.first_name ?? '',
    last_name: row.last_name ?? '',
    email: row.email ?? '',
    phone: row.phone ?? '',
    shipping_address_line1: row.shipping_address_line1 ?? '',
    shipping_address_line2: row.shipping_address_line2 ?? '',
    shipping_city: row.shipping_city ?? '',
    shipping_province: row.shipping_province ?? EMPTY_CUSTOMER_FORM.shipping_province,
    shipping_postal_code: row.shipping_postal_code ?? '',
    billing_same_as_shipping: row.billing_same_as_shipping ?? true,
    billing_address_line1: row.billing_address_line1 ?? '',
    billing_address_line2: row.billing_address_line2 ?? '',
    billing_city: row.billing_city ?? '',
    billing_province: row.billing_province ?? '',
    billing_postal_code: row.billing_postal_code ?? '',
  };
}

/**
 * Converts form state into the create/update payload.
 *
 * Only the four identity fields are trimmed. They are what the server's
 * "not wholly anonymous" refinement inspects and what search matches
 * against, so stray whitespace there is a data defect. Address fields
 * are left verbatim — a trailing space in a street line is harmless,
 * and silently rewriting what someone typed is worse than keeping it.
 */
export function toCustomerInput(form: CustomerFormState): CustomerInput {
  return {
    ...form,
    first_name: form.first_name.trim(),
    last_name: form.last_name.trim(),
    email: form.email.trim(),
    phone: form.phone.trim(),
  };
}

/**
 * Validates the form, returning a user-facing message or `null` when it
 * is safe to save.
 *
 * Mirrors `createSchema` in `apps/api/src/routes/customers.ts`. Names
 * are optional — a customer met on site is often nothing but a phone
 * number — but a record with no name, email or phone is unsearchable,
 * un-emailable, and indistinguishable from every other blank row, so at
 * least one identifier is required. The email check is shape-only and
 * skipped when the field is empty, because an empty email is valid.
 *
 * Returned rather than thrown or toasted here: this module stays free
 * of UI concerns, and each caller decides how to present the message.
 */
export function validateCustomerForm(form: CustomerFormState): string | null {
  const identified =
    form.first_name.trim() || form.last_name.trim() || form.email.trim() || form.phone.trim();
  if (!identified) return 'Enter a name, email or phone number.';
  if (form.email.trim() && !/^\S+@\S+\.\S+$/.test(form.email.trim())) {
    return 'Enter a valid email or leave it empty.';
  }
  return null;
}

/**
 * Reports whether the form differs from the row it was seeded from.
 *
 * Drives the discard confirmation, so a false positive costs the user a
 * pointless prompt and a false negative costs them their typing.
 *
 * Billing fields are compared ONLY when billing differs from shipping.
 * While the "same as shipping" box is checked those inputs are hidden
 * and their values are irrelevant — the form deliberately retains them
 * so unchecking restores what was entered — and treating a value the
 * user cannot see as an unsaved change would prompt them to discard
 * nothing.
 */
export function isCustomerFormDirty(form: CustomerFormState, row: Customer): boolean {
  const seeded = toCustomerFormState(row);
  if (form.billing_same_as_shipping !== seeded.billing_same_as_shipping) return true;

  const billingKeys = [
    'billing_address_line1',
    'billing_address_line2',
    'billing_city',
    'billing_province',
    'billing_postal_code',
  ] as const;
  const skip: ReadonlySet<string> = form.billing_same_as_shipping
    ? new Set<string>(billingKeys)
    : new Set<string>();

  return (Object.keys(seeded) as (keyof CustomerFormState)[]).some(
    (key) => !skip.has(key) && form[key] !== seeded[key]
  );
}
