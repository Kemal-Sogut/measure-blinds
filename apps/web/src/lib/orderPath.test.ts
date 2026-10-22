// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins the staff order URL `/<customer-slug>/<order-number>[/<sub>]`:
 * the slug is readable but cosmetic, never carries an email or phone
 * number, and can never collide with an app route.
 */

import { describe, it, expect } from 'vitest';
import { customerSlug, orderPath, customerLinkPath } from './orderPath';

describe('customerSlug', () => {
  it('slugs first + last name', () => {
    expect(customerSlug({ first_name: 'Jane', last_name: 'Smith' })).toBe('jane-smith');
  });
  it('strips accents and punctuation', () => {
    expect(customerSlug({ first_name: 'Zoë', last_name: "O'Brien-Çelik" })).toBe('zoe-o-brien-celik');
  });
  it('falls back to "customer" with no name (never email/phone)', () => {
    expect(customerSlug({ first_name: '', last_name: '' })).toBe('customer');
    expect(customerSlug(null)).toBe('customer');
  });
  it('prefixes slugs that would collide with app routes', () => {
    expect(customerSlug({ first_name: 'Settings', last_name: '' })).toBe('customer-settings');
    expect(customerSlug({ first_name: 'C', last_name: '' })).toBe('customer-c');
  });
  it('caps the length at 60', () => {
    expect(customerSlug({ first_name: 'a'.repeat(100), last_name: '' }).length).toBe(60);
  });
});

describe('orderPath', () => {
  const order = { order_number: 'M2010-126', customer: { first_name: 'Jane', last_name: 'Smith' } };
  it('builds the detail path', () => {
    expect(orderPath(order)).toBe('/jane-smith/M2010-126');
  });
  it('appends a sub-page', () => {
    expect(orderPath(order, 'present')).toBe('/jane-smith/M2010-126/present');
  });
});

describe('customerLinkPath', () => {
  it('builds the portal path', () => {
    expect(customerLinkPath('t')).toBe('/c/t');
  });
});
