// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Unit tests for the warranty email template — pins the content the
 * customer must see (order number, every coverage date), the conditional
 * motorised lines, and the HTML-escaping contract that keeps customer
 * and company names from injecting markup.
 *
 * Kept beside `warrantyEmail.ts` rather than in `email.test.ts` for the
 * same reason the template is its own module.
 */

import { describe, it, expect } from 'vitest';
import { buildWarrantyEmailHtml, type WarrantyEmailInputs } from './warrantyEmail';

const BASE: WarrantyEmailInputs = {
  company: {
    name: 'Blinds Nisa',
    address: '22-174 Colonnade Road, Nepean ON',
    phone: '613-555-0199',
    email: 'blindsnisa@gmail.com',
  },
  customerFirstName: 'Kemal',
  orderNumber: 'T0408-126',
  coverageStart: '20 August 2026',
  standardExpiry: '20 August 2036',
  motorExpiry: '20 August 2028',
  hasMotorised: true,
  viewUrl: 'https://example.com/customer/abc-123',
};

describe('buildWarrantyEmailHtml', () => {
  it('states the order number, the customer and every coverage date', () => {
    const html = buildWarrantyEmailHtml(BASE);
    expect(html).toContain('T0408-126');
    expect(html).toContain('Kemal');
    expect(html).toContain('20 August 2026');
    expect(html).toContain('20 August 2036');
    expect(html).toContain('20 August 2028');
    expect(html).toContain('https://example.com/customer/abc-123');
  });

  it('omits the motor term entirely when the order has no motorised product', () => {
    const html = buildWarrantyEmailHtml({ ...BASE, hasMotorised: false });
    expect(html).not.toContain('20 August 2028');
    expect(html).not.toContain('Motorised parts');
    expect(html).not.toContain('2 years on motors');
    // The ten-year cover is still stated.
    expect(html).toContain('10 years on blinds, fabric and hardware');
  });

  it('states both terms when the order is motorised', () => {
    const html = buildWarrantyEmailHtml(BASE);
    expect(html).toContain('Motorised parts');
    expect(html).toContain('2 years on motors and motorised parts');
    expect(html).toContain('10 years on blinds, fabric and hardware');
  });

  it('escapes a customer name that contains markup', () => {
    const html = buildWarrantyEmailHtml({
      ...BASE,
      customerFirstName: '<script>alert(1)</script>',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
