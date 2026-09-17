// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Unit tests for the warranty email template — pins the content the
 * customer must see (order number, coverage dates), the single template
 * with its motorization exclusion footer, and the HTML-escaping contract that keeps customer
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
  expiry: '20 August 2036',
  viewUrl: 'https://example.com/customer/abc-123',
};

describe('buildWarrantyEmailHtml', () => {
  it('states the order number, the customer and both coverage dates', () => {
    const html = buildWarrantyEmailHtml(BASE);
    expect(html).toContain('T0408-126');
    expect(html).toContain('Kemal');
    expect(html).toContain('20 August 2026');
    expect(html).toContain('20 August 2036');
    expect(html).toContain('https://example.com/customer/abc-123');
    expect(html).toContain('10 years on blinds, fabric and hardware');
  });

  it('never promises a motor term, and ends with the motorization exclusion', () => {
    const html = buildWarrantyEmailHtml(BASE);
    expect(html).not.toMatch(/2 years|motorised parts/i);
    const note = html.lastIndexOf('Motorization-related products');
    expect(note).toBeGreaterThan(html.indexOf('To make a claim'));
    expect(html).toContain('solar panels, remotes');
    expect(html).toContain('are excluded from this warranty');
  });

  it('states the parts-only limit and the service fee in the email itself', () => {
    const html = buildWarrantyEmailHtml(BASE);
    // A customer who never opens the attached PDF must still learn that
    // a call-out costs them money.
    expect(html).toContain('Parts only.');
    expect(html).toContain('Workmanship and labour are not covered');
    expect(html).toContain('service fee applies to every visit');
  });

  it('never ticks workmanship as covered', () => {
    const html = buildWarrantyEmailHtml(BASE);
    // The checklist renders accent check marks; a "workmanship" line
    // inside it would promise free labour for a decade.
    const checklist = html.slice(html.indexOf('What&#39;s covered'), html.indexOf('Parts only.'));
    expect(checklist).not.toMatch(/workmanship/i);
    expect(checklist).toContain('Replacement parts for 10 years');
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
