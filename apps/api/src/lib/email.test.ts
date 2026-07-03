// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Unit tests for the email module — pins the HTML-escaping contract
 * (no user-supplied markup can reach the rendered template) and the
 * key content requirements of both templates.
 */

import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  buildEstimateEmailHtml,
  buildConfirmationNoticeHtml,
} from './email';

describe('escapeHtml', () => {
  it('escapes all five HTML-significant characters', () => {
    expect(escapeHtml(`<img src="x" onerror='a'> & more`)).toBe(
      '&lt;img src=&quot;x&quot; onerror=&#39;a&#39;&gt; &amp; more'
    );
  });

  it('leaves normal text untouched', () => {
    expect(escapeHtml('Kemal Sogut — Unit 5, Toronto')).toBe('Kemal Sogut — Unit 5, Toronto');
  });
});

describe('buildEstimateEmailHtml', () => {
  const html = buildEstimateEmailHtml({
    companyName: 'Blinds <Nisa> & Co',
    customerFirstName: '<b>Kemal</b>',
    orderNumber: 'T0408-126',
    total: 1234.5,
    expiryDate: '2026-07-17',
    viewUrl: 'https://app.example.com/customer/abc-123',
  });

  it('escapes injected markup in every user field', () => {
    expect(html).not.toContain('<b>Kemal</b>');
    expect(html).not.toContain('Blinds <Nisa>');
    expect(html).toContain('&lt;b&gt;Kemal&lt;/b&gt;');
    expect(html).toContain('Blinds &lt;Nisa&gt; &amp; Co');
  });

  it('contains the summary values and CTA link', () => {
    expect(html).toContain('T0408-126');
    expect(html).toContain('$1234.50');
    expect(html).toContain('2026-07-17');
    expect(html).toContain('https://app.example.com/customer/abc-123');
    expect(html).toContain('Confirm Estimate');
  });
});

describe('buildConfirmationNoticeHtml', () => {
  it('escapes the customer name and includes order + total', () => {
    const html = buildConfirmationNoticeHtml({
      orderNumber: 'F2606-1226',
      customerName: '<script>alert(1)</script>',
      total: 500,
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('F2606-1226');
    expect(html).toContain('$500.00');
  });
});
