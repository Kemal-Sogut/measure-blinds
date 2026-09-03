// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Unit tests for `lib/customerForm` — the pure half of the customer
 * edit surface. These cover the three rules that silently corrupt a
 * save when they regress: nullable columns must not reach a controlled
 * input as `null`, the strict server schema must never see `id` or a
 * timestamp column, and the client validation must match the server's
 * create refinement in `apps/api/src/routes/customers.ts`.
 */

import { describe, expect, it } from 'vitest';
import {
  EMPTY_CUSTOMER_FORM,
  isCustomerFormDirty,
  toCustomerFormState,
  toCustomerInput,
  validateCustomerForm,
} from './customerForm';
import type { Customer } from '../types';

/**
 * A fully populated row. Tests derive their fixtures from this so each
 * one states only the field it is about.
 */
const ROW: Customer = {
  id: 'c-1',
  first_name: 'Kemal',
  last_name: 'Sogut',
  email: 'kemal@example.com',
  phone: '4165550142',
  shipping_address_line1: '12 Bay St',
  shipping_address_line2: 'Unit 4',
  shipping_city: 'Toronto',
  shipping_province: 'ON',
  shipping_postal_code: 'M5J 2R8',
  billing_same_as_shipping: true,
  billing_address_line1: '',
  billing_address_line2: '',
  billing_city: '',
  billing_province: '',
  billing_postal_code: '',
  deleted_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
};

/** Builds a row with some fields overridden. */
function row(patch: Partial<Customer>): Customer {
  return { ...ROW, ...patch };
}

describe('toCustomerFormState', () => {
  it('copies the editable fields off a row', () => {
    expect(toCustomerFormState(ROW)).toEqual({
      first_name: 'Kemal',
      last_name: 'Sogut',
      email: 'kemal@example.com',
      phone: '4165550142',
      shipping_address_line1: '12 Bay St',
      shipping_address_line2: 'Unit 4',
      shipping_city: 'Toronto',
      shipping_province: 'ON',
      shipping_postal_code: 'M5J 2R8',
      billing_same_as_shipping: true,
      billing_address_line1: '',
      billing_address_line2: '',
      billing_city: '',
      billing_province: '',
      billing_postal_code: '',
    });
  });

  it('omits id and the timestamp columns, which the strict update schema rejects', () => {
    // Through `unknown`: an interface has no index signature, so it does
    // not overlap `Record<string, unknown>` directly.
    const form = toCustomerFormState(ROW) as unknown as Record<string, unknown>;
    expect(form).not.toHaveProperty('id');
    expect(form).not.toHaveProperty('created_at');
    expect(form).not.toHaveProperty('updated_at');
    expect(form).not.toHaveProperty('deleted_at');
  });

  it('coalesces null text columns to empty strings so inputs stay controlled', () => {
    // Older rows predate the NOT NULL defaults; the TS type lies about this.
    const legacy = row({
      first_name: null as unknown as string,
      shipping_city: null as unknown as string,
    });
    const form = toCustomerFormState(legacy);
    expect(form.first_name).toBe('');
    expect(form.shipping_city).toBe('');
  });

  it('falls back to the ON province default when the column is null', () => {
    const form = toCustomerFormState(row({ shipping_province: null as unknown as string }));
    expect(form.shipping_province).toBe('ON');
  });

  it('falls back to billing_same_as_shipping = true when the column is null', () => {
    const form = toCustomerFormState(row({ billing_same_as_shipping: null as unknown as boolean }));
    expect(form.billing_same_as_shipping).toBe(true);
  });
});

describe('toCustomerInput', () => {
  it('trims the four identity fields', () => {
    const input = toCustomerInput({
      ...EMPTY_CUSTOMER_FORM,
      first_name: '  Kemal  ',
      last_name: ' Sogut ',
      email: ' kemal@example.com ',
      phone: ' 4165550142 ',
    });
    expect(input.first_name).toBe('Kemal');
    expect(input.last_name).toBe('Sogut');
    expect(input.email).toBe('kemal@example.com');
    expect(input.phone).toBe('4165550142');
  });

  it('leaves address fields exactly as typed', () => {
    const input = toCustomerInput({ ...EMPTY_CUSTOMER_FORM, shipping_address_line2: ' Unit 4 ' });
    expect(input.shipping_address_line2).toBe(' Unit 4 ');
  });
});

describe('validateCustomerForm', () => {
  it('rejects a wholly anonymous record', () => {
    expect(validateCustomerForm(EMPTY_CUSTOMER_FORM)).toBe('Enter a name, email or phone number.');
  });

  it.each(['first_name', 'last_name', 'phone'] as const)(
    'accepts a record identified by %s alone',
    (field) => {
      expect(validateCustomerForm({ ...EMPTY_CUSTOMER_FORM, [field]: 'x' })).toBeNull();
    }
  );

  it('accepts a record identified by email alone', () => {
    expect(validateCustomerForm({ ...EMPTY_CUSTOMER_FORM, email: 'a@b.co' })).toBeNull();
  });

  it('treats whitespace as absent', () => {
    expect(validateCustomerForm({ ...EMPTY_CUSTOMER_FORM, first_name: '   ' })).toBe(
      'Enter a name, email or phone number.'
    );
  });

  it('rejects a malformed email', () => {
    expect(validateCustomerForm({ ...EMPTY_CUSTOMER_FORM, phone: '416', email: 'nope' })).toBe(
      'Enter a valid email or leave it empty.'
    );
  });

  it('accepts an empty email when another identifier is present', () => {
    expect(validateCustomerForm({ ...EMPTY_CUSTOMER_FORM, phone: '416', email: '' })).toBeNull();
  });
});

describe('isCustomerFormDirty', () => {
  it('is false for a freshly seeded form', () => {
    expect(isCustomerFormDirty(toCustomerFormState(ROW), ROW)).toBe(false);
  });

  it('is true when a text field changed', () => {
    const form = { ...toCustomerFormState(ROW), phone: '4165550143' };
    expect(isCustomerFormDirty(form, ROW)).toBe(true);
  });

  it('is true when the province changed', () => {
    const form = { ...toCustomerFormState(ROW), shipping_province: 'QC' };
    expect(isCustomerFormDirty(form, ROW)).toBe(true);
  });

  it('is true when billing_same_as_shipping was toggled', () => {
    const form = { ...toCustomerFormState(ROW), billing_same_as_shipping: false };
    expect(isCustomerFormDirty(form, ROW)).toBe(true);
  });

  it('ignores hidden billing values while billing mirrors shipping', () => {
    // Unchecking, typing, and re-checking must not leave the form dirty:
    // those values are not sent and not shown.
    const form = { ...toCustomerFormState(ROW), billing_city: 'Ottawa' };
    expect(isCustomerFormDirty(form, ROW)).toBe(false);
  });

  it('does compare billing values once billing differs from shipping', () => {
    const differing = row({ billing_same_as_shipping: false, billing_city: 'Toronto' });
    const form = { ...toCustomerFormState(differing), billing_city: 'Ottawa' };
    expect(isCustomerFormDirty(form, differing)).toBe(true);
  });
});
