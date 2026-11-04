// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins the lead → customer rules (spec D3/D4): a new customer gets the
 * whole submission, and an email-matched customer only has BLANK fields
 * filled, with the address copied as one block.
 */

import { describe, it, expect } from 'vitest';
import { blankFieldPatch, formatLeadPhone, newCustomerFromLead, type MatchableCustomer } from './leadCustomer';
import { leadInputSchema } from './leadSchema';
import { FORM_PAYLOAD } from './leadFixture';

const lead = leadInputSchema.parse({ ...FORM_PAYLOAD, unit: '4', phone: '613.555.0123' });

const full: MatchableCustomer = {
  id: 'c1',
  first_name: 'Janet',
  last_name: 'Doe',
  phone: '(613) 000-0000',
  shipping_address_line1: '99 Oak Ave',
};

describe('formatLeadPhone', () => {
  it('formats any 10-digit shape and leaves anything else alone', () => {
    expect(formatLeadPhone('613.555.0123')).toBe('(613) 555-0123');
    expect(formatLeadPhone('1-613-555-0123')).toBe('(613) 555-0123');
    expect(formatLeadPhone(' 555 ')).toBe('555');
  });
});

describe('newCustomerFromLead', () => {
  it('copies the full submission, billing same as shipping', () => {
    expect(newCustomerFromLead(lead)).toEqual({
      first_name: 'Jane',
      last_name: 'Doe',
      email: 'jane.doe@example.com',
      phone: '(613) 555-0123',
      shipping_address_line1: '12 Elm St',
      shipping_address_line2: '4',
      shipping_city: 'Ottawa',
      shipping_province: 'ON',
      shipping_postal_code: 'K1A 0B1',
      billing_same_as_shipping: true,
    });
  });
});

describe('blankFieldPatch', () => {
  it('changes nothing on a complete customer', () => {
    expect(blankFieldPatch(full, lead)).toEqual({});
  });

  it('fills a missing phone only', () => {
    expect(blankFieldPatch({ ...full, phone: ' ' }, lead)).toEqual({ phone: '(613) 555-0123' });
  });

  it('fills the name only when both parts are blank', () => {
    expect(blankFieldPatch({ ...full, first_name: '' }, lead)).toEqual({});
    expect(blankFieldPatch({ ...full, first_name: '', last_name: '' }, lead)).toEqual({
      first_name: 'Jane',
      last_name: 'Doe',
    });
  });

  it('fills the address as one block, only when the street is blank', () => {
    expect(blankFieldPatch({ ...full, shipping_address_line1: '' }, lead)).toEqual({
      shipping_address_line1: '12 Elm St',
      shipping_address_line2: '4',
      shipping_city: 'Ottawa',
      shipping_province: 'ON',
      shipping_postal_code: 'K1A 0B1',
    });
  });
});
