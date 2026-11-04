// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins the staff lead email: visitor text is HTML-escaped everywhere
 * (AI_GUIDELINES §2), the customer link and the matched/created note are
 * right, and blank parts drop out of the address and subject cleanly.
 */

import { describe, it, expect } from 'vitest';
import { buildLeadNoticeHtml, leadAddressLine, leadNoticeSubject } from './leadAlerts';
import { leadInputSchema } from './leadSchema';
import { FORM_PAYLOAD } from './leadFixture';

const lead = leadInputSchema.parse(FORM_PAYLOAD);

describe('leadAddressLine', () => {
  it('joins the parts and skips blanks', () => {
    expect(leadAddressLine(lead)).toBe('12 Elm St, Ottawa, ON K1A 0B1');
    expect(leadAddressLine({ ...lead, unit: '4' })).toBe('12 Elm St, Unit 4, Ottawa, ON K1A 0B1');
    expect(leadAddressLine({ street: '', unit: '', city: '', province: '', postal_code: '' })).toBe('');
  });
});

describe('leadNoticeSubject', () => {
  it('names the visitor and city', () => {
    expect(leadNoticeSubject(lead)).toBe('🪟 New website lead: Jane Doe (Ottawa)');
    expect(leadNoticeSubject({ ...lead, city: '' })).toBe('🪟 New website lead: Jane Doe');
  });
});

describe('buildLeadNoticeHtml', () => {
  it('escapes every visitor string, the message included', () => {
    const html = buildLeadNoticeHtml({
      lead: { ...lead, first_name: '<b>Jane</b>', message: '<script>alert(1)</script>' },
      customerId: 'c1',
      match: 'created',
      appUrl: 'https://app.example/',
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>Jane</b>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('links the customer and says whether it was created or matched', () => {
    const created = buildLeadNoticeHtml({ lead, customerId: 'c1', match: 'created', appUrl: 'https://app.example/' });
    expect(created).toContain('href="https://app.example/customers/c1"');
    expect(created).toContain('A new customer was created');
    const matched = buildLeadNoticeHtml({ lead, customerId: 'c1', match: 'matched', appUrl: 'https://app.example' });
    expect(matched).toContain('already belonged to a customer');
    expect(matched).toContain('Zebra, Roller');
    expect(matched).toContain('href="tel:6135550123"');
  });
});
