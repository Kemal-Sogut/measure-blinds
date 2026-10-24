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
  buildEstimatesEmailHtml,
  buildInvoiceEmailHtml,
  buildReceiptEmailHtml,
  buildConfirmationNoticeHtml,
  buildAppointmentBookedHtml,
  buildAppointmentReminderHtml,
  buildInstallReminderHtml,
  buildReviewRequestHtml,
  buildCancellationDeniedHtml,
  buildCancellationNoticeHtml,
  estimateEmailSubject,
  estimatesEmailSubject,
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

describe('buildInvoiceEmailHtml', () => {
  const baseInputs = {
    company: { name: 'Blinds Nisa', email: 'info@blindsnisa.com' },
    customerFirstName: '<b>Kemal</b>',
    orderNumber: 'F2606-1226',
    orderTotal: 2148,
    paidToDate: 1074,
    balance: 1074,
    viewUrl: 'https://app.example.com/customer/abc-123',
  };

  it('escapes injected markup in user-supplied strings', () => {
    const html = buildInvoiceEmailHtml(baseInputs);
    expect(html).not.toContain('<b>Kemal</b>');
    expect(html).toContain('&lt;b&gt;Kemal&lt;/b&gt;');
  });

  it('shows the order total, paid to date and the balance due as the headline amount', () => {
    const html = buildInvoiceEmailHtml(baseInputs);
    expect(html).toContain('Order total');
    expect(html).toContain('$2,148.00');
    expect(html).toContain('Paid to date');
    expect(html).toContain('Balance due');
    expect(html).toContain('$1,074.00');
    expect(html).not.toContain('Total (incl. HST)');
    expect(html).not.toContain('Paid in full');
  });

  it('renders "Paid in full" and no balance line when nothing is owed', () => {
    const html = buildInvoiceEmailHtml({ ...baseInputs, paidToDate: 2148, balance: 0 });
    expect(html).toContain('Paid in full');
    expect(html).not.toContain('Balance due');
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

describe('buildEstimatesEmailHtml', () => {
  const base = {
    company: { name: 'Blinds Nisa' },
    customerFirstName: 'Jane',
    viewUrl: 'https://app.example.com/c/abc-123',
    estimates: [{ order_number: 'M2010-126', title: null }],
    liveCount: 1,
  };

  it('says "Your estimate is ready" for one estimate', () => {
    const html = buildEstimatesEmailHtml(base);
    expect(html).toContain('Your estimate is ready');
    expect(html).not.toContain('Your estimates are ready');
  });

  it('says "Your estimates are ready" for several', () => {
    const html = buildEstimatesEmailHtml({
      ...base,
      estimates: [
        { order_number: 'M2010-126', title: 'Option A' },
        { order_number: 'M2010-127', title: 'Option B' },
      ],
      liveCount: 2,
    });
    expect(html).toContain('Your estimates are ready');
    expect(html).not.toContain('Your estimate is ready');
  });

  it('names every estimate by order number, and its title when set', () => {
    const html = buildEstimatesEmailHtml({
      ...base,
      estimates: [
        { order_number: 'M2010-126', title: 'Option A' },
        { order_number: 'M2010-127', title: null },
      ],
      liveCount: 2,
    });
    expect(html).toContain('M2010-126');
    expect(html).toContain('Option A');
    expect(html).toContain('M2010-127');
    expect(html).toContain('<strong>M2010-127</strong></td>');
  });

  it('prints no money', () => {
    expect(buildEstimatesEmailHtml(base)).not.toContain('$');
  });

  it('states the live count, not the sent count', () => {
    const html = buildEstimatesEmailHtml({ ...base, liveCount: 3 });
    expect(html).toContain('You have 3 estimates');
  });

  it('omits the choice line when liveCount is 1', () => {
    expect(buildEstimatesEmailHtml(base)).not.toContain('You have');
  });

  it('links the button and the fallback to viewUrl', () => {
    const html = buildEstimatesEmailHtml(base);
    expect(html.split('https://app.example.com/c/abc-123')).toHaveLength(3);
    expect(html).toContain('href="https://app.example.com/c/abc-123"');
    expect(html).toContain('Review &amp; confirm');
  });

  it('says the order is not placed until the customer confirms online', () => {
    expect(buildEstimatesEmailHtml(base)).toContain('isn&#39;t placed until you confirm it online');
  });

  it('makes no attachment promise', () => {
    const html = buildEstimatesEmailHtml({ ...base, liveCount: 3 });
    expect(html).not.toMatch(/attached/i);
    expect(html).not.toMatch(/PDF/i);
  });

  it('escapes the consultant note', () => {
    const html = buildEstimatesEmailHtml({ ...base, message: '<script>alert(1)</script>' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes a title', () => {
    const html = buildEstimatesEmailHtml({
      ...base,
      estimates: [{ order_number: 'M2010-126', title: 'Option <A>' }],
    });
    expect(html).toContain('Option &lt;A&gt;');
    expect(html).not.toContain('Option <A>');
  });

  it('escapes the order number, customer name and company name', () => {
    const html = buildEstimatesEmailHtml({
      ...base,
      company: { name: 'Blinds <Nisa> & Co' },
      customerFirstName: '<b>Kemal</b>',
      estimates: [{ order_number: '<i>9</i>', title: null }],
    });
    expect(html).not.toContain('<b>Kemal</b>');
    expect(html).not.toContain('<i>9</i>');
    expect(html).toContain('&lt;b&gt;Kemal&lt;/b&gt;');
    expect(html).toContain('Blinds &lt;Nisa&gt; &amp; Co');
    expect(html).toContain('&lt;i&gt;9&lt;/i&gt;');
  });

  it('renders the branded footer', () => {
    const html = buildEstimatesEmailHtml({
      ...base,
      company: { name: 'Blinds Nisa', phone: '(613) 699-1837', email: 'info@blindsnisa.com' },
    });
    expect(html).toContain('(613) 699-1837');
    expect(html).toContain('mailto:info@blindsnisa.com');
    expect(html).toContain('Confidentiality notice');
  });
});

describe('estimatesEmailSubject', () => {
  it('names the order number and title for one estimate', () => {
    expect(estimatesEmailSubject('Blinds Nisa', [{ order_number: 'M2010-126', title: 'Option A' }])).toBe(
      'Your estimate M2010-126 – Option A from Blinds Nisa'
    );
  });
  it('omits the title for one untitled estimate', () => {
    expect(estimatesEmailSubject('Blinds Nisa', [{ order_number: 'M2010-126', title: null }])).toBe(
      'Your estimate M2010-126 from Blinds Nisa'
    );
  });
  it('drops to a plain subject for several', () => {
    expect(
      estimatesEmailSubject('Blinds Nisa', [
        { order_number: 'M2010-126', title: 'Option A' },
        { order_number: 'M2010-127', title: 'Option B' },
      ])
    ).toBe('Your estimates from Blinds Nisa');
  });
});

describe('estimateEmailSubject', () => {
  it('omits the title when none is set', () => {
    expect(estimateEmailSubject('M2010-126', 'Blinds Nisa', null)).toBe('Your estimate M2010-126 from Blinds Nisa');
  });
  it('includes the title', () => {
    expect(estimateEmailSubject('M2010-126', 'Blinds Nisa', 'Option A')).toBe(
      'Your estimate M2010-126 – Option A from Blinds Nisa'
    );
  });
});
