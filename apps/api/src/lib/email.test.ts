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
  buildReceiptEmailHtml,
  buildConfirmationNoticeHtml,
  buildAppointmentBookedHtml,
  buildAppointmentReminderHtml,
  buildInstallReminderHtml,
  buildReviewRequestHtml,
  buildCancellationDeniedHtml,
  buildCancellationNoticeHtml,
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

describe('buildReceiptEmailHtml', () => {
  const baseInputs = {
    company: { name: 'Blinds Nisa', email: 'info@blindsnisa.com' },
    customerFirstName: '<script>alert(1)</script>',
    orderNumber: 'F2606-<1226>',
    paymentAmount: 500,
    paidOnText: 'July 21, 2026',
    orderTotal: 2148,
    paidToDate: 500,
    balance: 1648,
    viewUrl: 'https://app.example.com/customer/abc-123',
  };

  it('escapes injected markup in user-supplied strings', () => {
    const html = buildReceiptEmailHtml(baseInputs);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('F2606-<1226>');
    expect(html).toContain('F2606-&lt;1226&gt;');
  });

  it('renders the receipt card rows with formatted amounts', () => {
    const html = buildReceiptEmailHtml(baseInputs);
    expect(html).toContain('Payment receipt');
    expect(html).toContain('$500.00');
    expect(html).toContain('July 21, 2026');
    expect(html).toContain('$2,148.00');
  });

  it('renders "Balance remaining" with the formatted amount when a balance is owed', () => {
    const html = buildReceiptEmailHtml(baseInputs);
    expect(html).toContain('Balance remaining');
    expect(html).toContain('$1,648.00');
    expect(html).not.toContain('Paid in full');
  });

  it('renders "Paid in full" and no balance line when the balance is zero or less', () => {
    const html = buildReceiptEmailHtml({
      ...baseInputs,
      paidToDate: 2148,
      balance: 0,
    });
    expect(html).toContain('Paid in full');
    expect(html).not.toContain('Balance remaining');
  });

  it('links the CTA button and the fallback line to the view URL', () => {
    const html = buildReceiptEmailHtml(baseInputs);
    expect(html).toContain('View your order');
    const occurrences = html.split('https://app.example.com/customer/abc-123').length - 1;
    expect(occurrences).toBe(2);
  });

  it('renders the consultant message when given and omits the block when absent', () => {
    const withMessage = buildReceiptEmailHtml({
      ...baseInputs,
      message: 'Thanks again <Kemal>',
    });
    expect(withMessage).toContain('Thanks again &lt;Kemal&gt;');
    const without = buildReceiptEmailHtml(baseInputs);
    expect(without).not.toContain('Thanks again');
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

describe('buildAppointmentBookedHtml', () => {
  const html = buildAppointmentBookedHtml({
    ...scheduleInputs,
    viewUrl: 'https://app.example.com/customer/abc-123',
    message: 'See <you> soon',
  });

  it('escapes user fields and renders the booked window with NO confirm step', () => {
    expect(html).not.toContain('<i>Sarah</i>');
    expect(html).toContain('Sarah &lt;Bennett&gt;');
    expect(html).toContain('See &lt;you&gt; soon');
    expect(html).toContain('Thursday, July 16, 2026');
    expect(html).toContain('2:00 PM');
    expect(html).toContain('148 Maple Grove Ave');
    expect(html).toContain('is booked');
    expect(html).toContain('View appointment');
    expect(html).not.toContain('Confirm this time');
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

describe('buildCancellationDeniedHtml', () => {
  const base = {
    company: { name: 'Blinds Nisa', email: 'info@blindsnisa.com' },
    customerFirstName: 'Ada',
    orderNumber: 'F2606-1226',
    total: 500,
    viewUrl: 'https://app.example.com/customer/tok',
  };

  it('escapes the consultant message, which is free text staff type', () => {
    const html = buildCancellationDeniedHtml({
      ...base,
      message: '<img src=x onerror=alert(1)>',
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it('states the order still stands and links back to the summary', () => {
    const html = buildCancellationDeniedHtml(base);
    expect(html).toContain('About your cancellation request');
    expect(html).toContain('Still confirmed');
    expect(html).toContain('$500.00');
    expect(html).toContain('https://app.example.com/customer/tok');
  });
});

describe('buildCancellationNoticeHtml', () => {
  it('escapes the customer-supplied reason and prompts staff to answer', () => {
    const html = buildCancellationNoticeHtml({
      orderNumber: 'F2606-1226',
      customerName: 'Ada',
      total: 500,
      withdrawn: false,
      note: '<script>alert(1)</script>',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Cancellation requested');
    expect(html).toContain('confirm or deny');
  });

  it('reads as a stand-down when the customer withdrew, with no reason line', () => {
    const html = buildCancellationNoticeHtml({
      orderNumber: 'F2606-1226',
      customerName: 'Ada',
      total: 500,
      withdrawn: true,
    });
    expect(html).toContain('withdrawn');
    expect(html).not.toContain('Reason:');
  });
});
