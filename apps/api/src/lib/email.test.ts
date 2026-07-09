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
  buildAppointmentProposalHtml,
  buildAppointmentReminderHtml,
  buildInstallReminderHtml,
  buildReviewRequestHtml,
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
    company: {
      name: 'Blinds <Nisa> & Co',
      address: '22-174 Colonnade Road, Nepean ON',
      phone: '(613) 699-1837',
      email: 'info@blindsnisa.com',
    },
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
    expect(html).toContain('$1,234.50');
    expect(html).toContain('2026-07-17');
    expect(html).toContain('https://app.example.com/customer/abc-123');
    expect(html).toContain('View your estimate');
  });

  it('renders the branded footer with contact details and the confidentiality notice', () => {
    expect(html).toContain('22-174 Colonnade Road, Nepean ON');
    expect(html).toContain('(613) 699-1837');
    expect(html).toContain('mailto:info@blindsnisa.com');
    expect(html).toContain('Confidentiality notice');
  });
});

const scheduleInputs = {
  company: { name: 'Blinds Nisa', phone: '(613) 699-1837', email: 'info@blindsnisa.com' },
  customerFirstName: '<i>Sarah</i>',
  customerFullName: 'Sarah <Bennett>',
  orderNumber: 'EST-0148',
  dateText: 'Thursday, July 16, 2026',
  startText: '2:00 PM',
  endText: '3:00 PM',
  locationText: '148 Maple Grove Ave, Nepean ON',
};

describe('buildAppointmentProposalHtml', () => {
  const html = buildAppointmentProposalHtml({
    ...scheduleInputs,
    viewUrl: 'https://app.example.com/customer/abc-123',
    message: 'See <you> soon',
  });

  it('escapes user fields and renders the proposed window with both CTAs', () => {
    expect(html).not.toContain('<i>Sarah</i>');
    expect(html).toContain('Sarah &lt;Bennett&gt;');
    expect(html).toContain('See &lt;you&gt; soon');
    expect(html).toContain('Thursday, July 16, 2026');
    expect(html).toContain('2:00 PM');
    expect(html).toContain('148 Maple Grove Ave');
    expect(html).toContain('Confirm this time');
    expect(html).toContain('Request another time');
    expect(html).toContain('https://app.example.com/customer/abc-123');
  });
});

describe('buildAppointmentReminderHtml', () => {
  const html = buildAppointmentReminderHtml(scheduleInputs);

  it('renders the confirmed window and the before-we-arrive checklist', () => {
    expect(html).toContain('See you tomorrow');
    expect(html).toContain('Thursday, July 16, 2026');
    expect(html).toContain('Before we arrive');
    expect(html).toContain('(613) 699-1837');
  });
});

describe('buildInstallReminderHtml', () => {
  const html = buildInstallReminderHtml(scheduleInputs);

  it('renders the confirmed window and the preparation checklist', () => {
    expect(html).toContain('Installation is tomorrow');
    expect(html).toContain('Before the team arrives');
    expect(html).toContain('EST-0148');
  });
});

describe('buildReviewRequestHtml', () => {
  const html = buildReviewRequestHtml({
    company: { name: 'Blinds Nisa', email: 'info@blindsnisa.com' },
    customerFirstName: 'Sarah',
    reviewUrl: 'https://g.page/r/xyz/review',
  });

  it('renders the stars and the Google review CTA', () => {
    expect(html).toContain('How do your new blinds look?');
    expect(html).toContain('&#9733;');
    expect(html).toContain('Review us on Google');
    expect(html).toContain('https://g.page/r/xyz/review');
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
