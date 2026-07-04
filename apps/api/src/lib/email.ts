// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Email service — Resend API integration plus the branded HTML
 * templates for the two outbound emails:
 *   1. estimate email to the customer (summary + CTA to the public
 *      view + PDF attachment)
 *   2. internal confirmation notification to the business
 *
 * SECURITY: every piece of user-supplied content (names, order
 * numbers, dates) passes through `escapeHtml` before being
 * interpolated into a template, so email HTML injection is impossible
 * regardless of what a consultant types into any field.
 *
 * Sending uses plain `fetch` against the Resend REST API — no SDK
 * dependency, and it throws on non-2xx so callers can keep estimate
 * state untouched when a send fails.
 */

/** Escapes the five HTML-significant characters in user content. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Attachment payload accepted by the Resend API. */
export interface EmailAttachment {
  filename: string;
  /** Base64-encoded file content */
  content: string;
}

/** Minimal Resend send request used by this app. */
export interface EmailRequest {
  to: string;
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
  /** Overrides env.RESEND_REPLY_TO for this send, if set. */
  replyTo?: string;
}

/**
 * Sends an email through the Resend API.
 *
 * @param env - Needs RESEND_API_KEY; RESEND_FROM optionally overrides
 *              the sender (must be on a Resend-verified domain);
 *              RESEND_REPLY_TO optionally sets where customer replies
 *              land (e.g. a shared inbox distinct from the send-from
 *              address)
 * @throws Error with Resend's message when the API responds non-2xx
 */
export async function sendEmail(
  env: { RESEND_API_KEY: string; RESEND_FROM?: string; RESEND_REPLY_TO?: string },
  req: EmailRequest
): Promise<void> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.RESEND_FROM || 'Blinds Nisa <blindsnisa@gmail.com>',
      reply_to: req.replyTo || env.RESEND_REPLY_TO || undefined,
      to: [req.to],
      subject: req.subject,
      html: req.html,
      attachments: req.attachments,
    }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Email service error (${response.status})`);
  }
}

/** Inputs for the customer-facing estimate email template. */
export interface EstimateEmailInputs {
  companyName: string;
  customerFirstName: string;
  orderNumber: string;
  total: number;
  expiryDate: string;
  viewUrl: string;
}

/**
 * Builds the branded customer email: greeting, estimate summary,
 * expiry note, and a CTA button linking to the public view page.
 * All dynamic strings are HTML-escaped.
 */
export function buildEstimateEmailHtml(i: EstimateEmailInputs): string {
  const company = escapeHtml(i.companyName);
  const name = escapeHtml(i.customerFirstName);
  const order = escapeHtml(i.orderNumber);
  const expiry = escapeHtml(i.expiryDate);
  const url = escapeHtml(i.viewUrl);
  return `<!doctype html>
<html><body style="margin:0;background:#f1f3f5;font-family:Arial,Helvetica,sans-serif;color:#212529">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:#4c6ef5;border-radius:12px 12px 0 0;padding:20px 24px">
      <h1 style="margin:0;color:#ffffff;font-size:20px">${company}</h1>
    </div>
    <div style="background:#ffffff;border-radius:0 0 12px 12px;padding:24px">
      <p style="margin:0 0 16px">Hi ${name},</p>
      <p style="margin:0 0 16px">Thank you for choosing ${company}. Your estimate is ready:</p>
      <table style="width:100%;border-collapse:collapse;margin:0 0 16px">
        <tr><td style="padding:6px 0;color:#868e96">Estimate #</td><td style="padding:6px 0;text-align:right;font-weight:bold">${order}</td></tr>
        <tr><td style="padding:6px 0;color:#868e96">Total (incl. HST)</td><td style="padding:6px 0;text-align:right;font-weight:bold">$${i.total.toFixed(2)}</td></tr>
        <tr><td style="padding:6px 0;color:#868e96">Valid until</td><td style="padding:6px 0;text-align:right">${expiry}</td></tr>
      </table>
      <p style="margin:0 0 20px">The full estimate is attached as a PDF. To review and confirm online, use the button below before the expiry date.</p>
      <p style="text-align:center;margin:0 0 20px">
        <a href="${url}" style="display:inline-block;background:#4c6ef5;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:bold">View &amp; Confirm Estimate</a>
      </p>
      <p style="margin:0;color:#868e96;font-size:12px">If the button doesn't work, copy this link: ${url}</p>
    </div>
  </div>
</body></html>`;
}

/** Inputs for the customer-facing installation-time proposal email. */
export interface InstallationProposalInputs {
  companyName: string;
  customerFirstName: string;
  orderNumber: string;
  /** e.g. "Friday, August 7, 2026" */
  dateText: string;
  /** Window start, e.g. "2:00 PM" */
  startText: string;
  /** Window end (start + 1h), e.g. "3:00 PM" */
  endText: string;
  /** Public page where the customer confirms or requests another time */
  viewUrl: string;
}

/**
 * Builds the branded installation-time proposal email. Presents the
 * one-hour arrival window exactly as requested ("We will be there
 * between {start} and {end} on {date} if that works for you.") with a
 * CTA to the public page to confirm or request another time. All
 * dynamic strings are HTML-escaped.
 */
export function buildInstallationProposalHtml(i: InstallationProposalInputs): string {
  const company = escapeHtml(i.companyName);
  const name = escapeHtml(i.customerFirstName);
  const order = escapeHtml(i.orderNumber);
  const dateText = escapeHtml(i.dateText);
  const startText = escapeHtml(i.startText);
  const endText = escapeHtml(i.endText);
  const url = escapeHtml(i.viewUrl);
  return `<!doctype html>
<html><body style="margin:0;background:#f1f3f5;font-family:Arial,Helvetica,sans-serif;color:#212529">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:#4c6ef5;border-radius:12px 12px 0 0;padding:20px 24px">
      <h1 style="margin:0;color:#ffffff;font-size:20px">${company}</h1>
    </div>
    <div style="background:#ffffff;border-radius:0 0 12px 12px;padding:24px">
      <p style="margin:0 0 16px">Hi ${name},</p>
      <p style="margin:0 0 16px">Your order <strong>${order}</strong> is ready for installation. We&apos;d like to propose a time to come by.</p>
      <p style="margin:0 0 20px;font-size:16px">We will be there between <strong>${startText}</strong> and <strong>${endText}</strong> on <strong>${dateText}</strong> if that works for you.</p>
      <p style="text-align:center;margin:0 0 20px">
        <a href="${url}" style="display:inline-block;background:#4c6ef5;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:bold">Confirm or request another time</a>
      </p>
      <p style="margin:0;color:#868e96;font-size:12px">If the button doesn't work, copy this link: ${url}</p>
    </div>
  </div>
</body></html>`;
}

/** Inputs for the internal "installation response" notification. */
export interface InstallationNoticeInputs {
  orderNumber: string;
  customerName: string;
  /** true = confirmed the proposed time; false = requested another */
  confirmed: boolean;
  /** the customer's requested-change note (when confirmed = false) */
  note?: string;
}

/**
 * Builds the short internal notification sent to the business when a
 * customer responds to an installation-time proposal. Escaped.
 */
export function buildInstallationNoticeHtml(i: InstallationNoticeInputs): string {
  const order = escapeHtml(i.orderNumber);
  const name = escapeHtml(i.customerName);
  const note = escapeHtml(i.note ?? '');
  const headline = i.confirmed
    ? `✅ Installation time confirmed`
    : `🕑 New installation time requested`;
  const body = i.confirmed
    ? `<strong>${name}</strong> confirmed the proposed installation time for order <strong>${order}</strong>.`
    : `<strong>${name}</strong> requested a different installation time for order <strong>${order}</strong>.` +
      (note ? `<br>Note: <em>${note}</em>` : '');
  return `<!doctype html>
<html><body style="margin:0;font-family:Arial,Helvetica,sans-serif;color:#212529">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <h2 style="margin:0 0 12px">${headline}</h2>
    <p style="margin:0 0 8px">${body}</p>
  </div>
</body></html>`;
}

/** Inputs for the internal "customer confirmed" notification. */
export interface ConfirmationNoticeInputs {
  orderNumber: string;
  customerName: string;
  total: number;
}

/**
 * Builds the short internal notification sent to the business when a
 * customer confirms an estimate. All dynamic strings are escaped.
 */
export function buildConfirmationNoticeHtml(i: ConfirmationNoticeInputs): string {
  const order = escapeHtml(i.orderNumber);
  const name = escapeHtml(i.customerName);
  return `<!doctype html>
<html><body style="margin:0;font-family:Arial,Helvetica,sans-serif;color:#212529">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <h2 style="margin:0 0 12px">✅ Estimate confirmed</h2>
    <p style="margin:0 0 8px"><strong>${name}</strong> confirmed estimate <strong>${order}</strong>.</p>
    <p style="margin:0 0 8px">Total: <strong>$${i.total.toFixed(2)}</strong> (incl. HST)</p>
    <p style="margin:0;color:#868e96">50% deposit instructions were shown to the customer.</p>
  </div>
</body></html>`;
}
