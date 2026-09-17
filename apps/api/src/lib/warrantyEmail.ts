// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Customer email template for the warranty certificate — the one email
 * sent when an order is paid in full.
 *
 * It announces that coverage has started, states the expiry date, and
 * carries the certificate itself as a PDF attachment (added by the
 * caller, not by this module). It deliberately shows NO money: the
 * balance reaching zero is what triggered it, but a warranty is about
 * cover, not payment — the receipt email already reports the money.
 *
 * SCOPE: this is a PARTS warranty, and the email must not read as more
 * than that. Every checklist line names a part being replaced rather
 * than a repair being performed, and the parts-only limit — labour
 * excluded, service fee on every visit — is stated immediately under the
 * checklist rather than left to the attached certificate. A customer who
 * reads the email and never opens the PDF must still know a call-out
 * costs them money.
 *
 * ONE TEMPLATE: the same wording goes to every order. There is no
 * motor-specific line — motorised items cannot be identified reliably
 * from an order — so the footer carries the standing motorization
 * exclusion from `warranty.ts` instead.
 *
 * Rendered with the shared building blocks exported by `email.ts`, so it
 * sits in the same branded card as every other customer email. It lives
 * in its own module because `email.ts` is already past the 800-line
 * guideline (AI_GUIDELINES §6).
 *
 * SECURITY (§2): every dynamic string is passed through `escapeHtml`
 * before it reaches the markup — including both dates, which come from
 * the database rather than from a caller-controlled literal. The
 * exclusion note is a constant but is escaped too, so editing its wording
 * can never break the markup.
 */

import {
  brandedShell,
  checklistHtml,
  escapeHtml,
  finePrintHtml,
  headingHtml,
  introHtml,
  linkFallbackHtml,
  messageBlockHtml,
  primaryButtonHtml,
  summaryCardHtml,
  type CompanyBrand,
} from './email';
import { MOTORIZATION_EXCLUSION_NOTE, WARRANTY_YEARS_STANDARD } from './warranty';

/** Inputs for the customer-facing warranty email template. */
export interface WarrantyEmailInputs {
  company: CompanyBrand;
  /** What to put after "Hi" — see `greetingName`. */
  customerFirstName: string;
  orderNumber: string;
  /** Coverage start, already formatted for humans (e.g. "20 August 2026"). */
  coverageStart: string;
  /** Ten-year product expiry, already formatted for humans. */
  expiry: string;
  /** Public order page (`/customer/:token`) the CTA links to. */
  viewUrl: string;
  /** Optional consultant note shown in a highlighted block. */
  message?: string;
}

/**
 * Builds the warranty email HTML: heading, intro confirming the order is
 * paid in full, a summary card with the order number and coverage dates,
 * a "what's covered" checklist, the optional consultant note, a CTA to
 * the customer's order page, and a footer note excluding
 * motorization-related products (identical for every order).
 */
export function buildWarrantyEmailHtml(i: WarrantyEmailInputs): string {
  const company = escapeHtml(i.company.name);
  const name = escapeHtml(i.customerFirstName);
  const order = escapeHtml(i.orderNumber);
  const start = escapeHtml(i.coverageStart);
  const expiry = escapeHtml(i.expiry);
  const url = escapeHtml(i.viewUrl);

  const rows: Array<[string, string]> = [
    ['Customer', name],
    ['Cover starts', start],
    ['Covered until', expiry],
  ];

  // Parts only. Every line here names a PART being replaced, never a
  // repair being performed — a tick beside "workmanship" would promise
  // labour this warranty does not cover.
  const covered = [
    `Replacement parts for ${WARRANTY_YEARS_STANDARD} years on blinds, fabric and hardware`,
    'Defective components supplied free of charge within that period',
  ];

  const body = `${headingHtml('Your warranty certificate')}
    ${introHtml(`Hi ${name} &mdash; your order is paid in full and your warranty is now active. Your certificate is attached to this email; please keep it, it is your proof of cover.`)}
    ${summaryCardHtml({
      eyebrow: 'Warranty summary',
      badge: order,
      rows,
    })}
    ${checklistHtml("What&#39;s covered", covered)}
    ${finePrintHtml(`<strong>Parts only.</strong> Workmanship and labour are not covered &mdash; our standard service fee applies to every visit, including one where the replacement part itself is free under this warranty.`)}
    <div style="height:20px;"></div>
    ${messageBlockHtml(i.message)}
    <div style="margin:0 0 24px;">${primaryButtonHtml(url, 'View your order')}</div>
    ${finePrintHtml(`To make a claim, reply to this email or contact ${company} quoting order ${order}. Full terms are set out on the attached certificate.`)}
    ${linkFallbackHtml(url)}
    <div style="height:16px;"></div>
    ${finePrintHtml(`<strong>${escapeHtml(MOTORIZATION_EXCLUSION_NOTE)}</strong>`)}`;
  return brandedShell(i.company, body);
}
