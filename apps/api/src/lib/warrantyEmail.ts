// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Customer email template for the warranty certificate — the one email
 * sent when an order is paid in full.
 *
 * It announces that coverage has started, states both expiry dates, and
 * carries the certificate itself as a PDF attachment (added by the
 * caller, not by this module). It deliberately shows NO money: the
 * balance reaching zero is what triggered it, but a warranty is about
 * cover, not payment — the receipt email already reports the money.
 *
 * Rendered with the shared building blocks exported by `email.ts`, so it
 * sits in the same branded card as every other customer email. It lives
 * in its own module because `email.ts` is already past the 800-line
 * guideline (AI_GUIDELINES §6).
 *
 * SECURITY (§2): every dynamic string is passed through `escapeHtml`
 * before it reaches the markup — including both dates, which come from
 * the database rather than from a caller-controlled literal.
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
import { WARRANTY_YEARS_MOTOR, WARRANTY_YEARS_STANDARD } from './warranty';

/** Inputs for the customer-facing warranty email template. */
export interface WarrantyEmailInputs {
  company: CompanyBrand;
  /** What to put after "Hi" — see `greetingName`. */
  customerFirstName: string;
  orderNumber: string;
  /** Coverage start, already formatted for humans (e.g. "20 August 2026"). */
  coverageStart: string;
  /** Ten-year product expiry, already formatted for humans. */
  standardExpiry: string;
  /** Two-year motor expiry, already formatted for humans. */
  motorExpiry: string;
  /** Whether the order contains a motorised product; hides the 2-year lines when false. */
  hasMotorised: boolean;
  /** Public order page (`/customer/:token`) the CTA links to. */
  viewUrl: string;
  /** Optional consultant note shown in a highlighted block. */
  message?: string;
}

/**
 * Builds the warranty email HTML: heading, intro confirming the order is
 * paid in full, a summary card with the order number and every coverage
 * date, a "what's covered" checklist, the optional consultant note, and
 * a CTA to the customer's order page.
 *
 * The motorised row and the motor checklist item are omitted entirely
 * when the order has no motor — an email that mentions a 2-year motor
 * term to someone who bought chain-controlled blinds reads as a mistake
 * and invites a support call.
 */
export function buildWarrantyEmailHtml(i: WarrantyEmailInputs): string {
  const company = escapeHtml(i.company.name);
  const name = escapeHtml(i.customerFirstName);
  const order = escapeHtml(i.orderNumber);
  const start = escapeHtml(i.coverageStart);
  const standard = escapeHtml(i.standardExpiry);
  const motor = escapeHtml(i.motorExpiry);
  const url = escapeHtml(i.viewUrl);

  const rows: Array<[string, string]> = [
    ['Customer', name],
    ['Cover starts', start],
    [`Covered until`, standard],
  ];
  if (i.hasMotorised) rows.push(['Motorised parts', motor]);

  const covered = [
    `${WARRANTY_YEARS_STANDARD} years on blinds, fabric and hardware`,
    ...(i.hasMotorised ? [`${WARRANTY_YEARS_MOTOR} years on motors and motorised parts`] : []),
    'Manufacturing defects in materials and workmanship under normal residential use',
  ];

  const body = `${headingHtml('Your warranty certificate')}
    ${introHtml(`Hi ${name} &mdash; your order is paid in full and your warranty is now active. Your certificate is attached to this email; please keep it, it is your proof of cover.`)}
    ${summaryCardHtml({
      eyebrow: 'Warranty summary',
      badge: order,
      rows,
    })}
    ${checklistHtml("What&#39;s covered", covered)}
    ${messageBlockHtml(i.message)}
    <div style="margin:0 0 24px;">${primaryButtonHtml(url, 'View your order')}</div>
    ${finePrintHtml(`To make a claim, reply to this email or contact ${company} quoting order ${order}. Full terms are set out on the attached certificate.`)}
    ${linkFallbackHtml(url)}`;
  return brandedShell(i.company, body);
}
