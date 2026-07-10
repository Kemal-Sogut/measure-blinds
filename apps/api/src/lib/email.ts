// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Email service — Resend API integration plus the branded HTML
 * templates for the outbound customer emails (estimate, invoice,
 * installation proposal) and the short internal notifications.
 *
 * Customer templates follow the "Customer Emails" design doc: a white
 * 640px card on a warm-gray page, logo header, pastel-red (#B4524A)
 * accents, a soft-tinted summary card, and a tinted footer with the
 * company's contact details and a confidentiality notice. Layout uses
 * tables (not flex/grid) so it renders correctly in email clients.
 *
 * SECURITY: every piece of user-supplied content (names, order
 * numbers, dates, company settings) passes through `escapeHtml` before
 * being interpolated into a template, so email HTML injection is
 * impossible regardless of what a consultant types into any field.
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

/* ------------------------------------------------------------------ */
/* Design tokens & shared building blocks (Customer Emails design doc) */
/* ------------------------------------------------------------------ */

const FONT = "'IBM Plex Sans','Segoe UI',system-ui,-apple-system,sans-serif";
const MONO = "'IBM Plex Mono',Consolas,monospace";
const C = {
  pageBg: '#F0EEE9',
  cardBorder: '#E7E2DC',
  accent: '#B4524A',
  heading: '#262625',
  body: '#52504B',
  muted: '#6E6B66',
  faint: '#8A867F',
  faintest: '#9B968E',
  tintBg: '#F9EFED',
  tintDivider: '#EFDBD6',
  footerBg: '#F7EDEA',
  footerBorder: '#EFE1DD',
  secondaryBorder: '#E0D6D1',
} as const;

/** Company identity shown in the header and footer of every customer email. */
export interface CompanyBrand {
  name: string;
  logoUrl?: string;
  address?: string;
  phone?: string;
  email?: string;
}

/** Maps the company_settings row to the brand block used by templates. */
export function brandFromSettings(row: {
  company_name?: string | null;
  logo_url?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
}): CompanyBrand {
  return {
    name: row.company_name || 'Blinds Nisa',
    logoUrl: row.logo_url || undefined,
    address: row.address || undefined,
    phone: row.phone || undefined,
    email: row.email || undefined,
  };
}

/** Formats a dollar amount with thousands separators, e.g. "2,148.00". */
function formatMoney(value: number): string {
  return value.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Logo image when the company has one uploaded, wordmark text otherwise. */
function headerHtml(brand: CompanyBrand): string {
  const name = escapeHtml(brand.name);
  return brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${name}" height="34" style="height:34px;display:block;border:0;">`
    : `<span style="font-size:20px;font-weight:600;color:${C.heading};">${name}</span>`;
}

/** Tinted footer: company name, contact details, confidentiality notice. */
function footerHtml(brand: CompanyBrand): string {
  const name = escapeHtml(brand.name);
  const contactLines: string[] = [];
  if (brand.address) contactLines.push(escapeHtml(brand.address));
  const inlineBits: string[] = [];
  if (brand.phone) inlineBits.push(escapeHtml(brand.phone));
  if (brand.email) {
    const email = escapeHtml(brand.email);
    inlineBits.push(
      `<a href="mailto:${email}" style="color:${C.accent};text-decoration:none;">${email}</a>`
    );
  }
  if (inlineBits.length) contactLines.push(inlineBits.join(' &middot; '));
  const contact = contactLines.length
    ? `<p style="margin:0 0 12px;font-size:12px;line-height:1.7;color:${C.muted};">${contactLines.join('<br>')}</p>`
    : '';
  const notifyAt = brand.email ? ` at ${escapeHtml(brand.email)}` : '';
  return `<p style="margin:0 0 3px;font-size:13px;font-weight:600;color:${C.heading};">${name}</p>
      ${contact}
      <p style="margin:0;font-size:10.5px;line-height:1.6;color:${C.faintest};">Confidentiality notice: this email and any attachments are intended only for the named recipient and may contain private customer information. If you received it in error, please do not read, use, or share its contents &mdash; notify us${notifyAt} and delete it immediately.</p>`;
}

/**
 * Wraps template body content in the shared card shell: warm-gray page,
 * white bordered card with logo header, body, and tinted footer.
 */
function brandedShell(brand: CompanyBrand, bodyHtml: string): string {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:${C.pageBg};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.pageBg};">
    <tr><td align="center" style="padding:32px 12px;">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:640px;max-width:100%;background:#FFFFFF;border:1px solid ${C.cardBorder};border-radius:10px;font-family:${FONT};">
        <tr><td style="padding:32px 40px 0;">${headerHtml(brand)}</td></tr>
        <tr><td style="padding:28px 40px 36px;">${bodyHtml}</td></tr>
        <tr><td style="background:${C.footerBg};border-top:1px solid ${C.footerBorder};border-radius:0 0 10px 10px;padding:24px 40px 26px;">${footerHtml(brand)}</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/** The 22px heading that opens every customer email body. */
function headingHtml(text: string): string {
  return `<h2 style="margin:0 0 12px;font-size:22px;font-weight:600;line-height:1.3;color:${C.heading};">${text}</h2>`;
}

/** The 15px intro paragraph under the heading (value is pre-escaped). */
function introHtml(html: string): string {
  return `<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:${C.body};">${html}</p>`;
}

/** One label/value pair inside the tinted summary card (pre-escaped). */
function detailRowHtml(label: string, valueHtml: string): string {
  return `<tr><td style="padding:3px 16px 3px 0;font-size:14px;color:${C.faint};width:110px;vertical-align:top;">${label}</td><td style="padding:3px 0;font-size:14px;font-weight:500;color:${C.heading};">${valueHtml}</td></tr>`;
}

interface SummaryCardOpts {
  /** Small uppercase accent label, e.g. "Proposed time" (pre-escaped). */
  eyebrow: string;
  /** Optional mono badge right of the eyebrow, e.g. the order number. */
  badge?: string;
  /** Optional 19px headline, e.g. the appointment window (pre-escaped). */
  headline?: string;
  /** Rows of [label, pre-escaped value html]. */
  rows: Array<[string, string]>;
  /** Optional divider-topped total line. */
  total?: { label: string; amount: number };
}

/** The soft-tinted summary card used by every customer template. */
function summaryCardHtml(opts: SummaryCardOpts): string {
  const eyebrowRow = opts.badge
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${C.accent};">${opts.eyebrow}</td>
        <td align="right" style="font-family:${MONO};font-size:13px;font-weight:600;color:${C.muted};">${opts.badge}</td>
      </tr></table>`
    : `<p style="margin:0;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${C.accent};">${opts.eyebrow}</p>`;
  const headline = opts.headline
    ? `<p style="margin:2px 0 12px;font-size:19px;font-weight:600;color:${C.heading};">${opts.headline}</p>`
    : `<div style="height:10px;"></div>`;
  const rows = opts.rows.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0">${opts.rows
        .map(([label, value]) => detailRowHtml(label, value))
        .join('')}</table>`
    : '';
  const total = opts.total
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;border-top:1px solid ${C.tintDivider};"><tr>
        <td style="padding-top:12px;font-size:14px;color:${C.body};">${opts.total.label}</td>
        <td align="right" style="padding-top:12px;font-family:${MONO};font-size:20px;font-weight:600;color:${C.heading};">$${formatMoney(opts.total.amount)}</td>
      </tr></table>`
    : '';
  return `<div style="background:${C.tintBg};border-radius:8px;padding:22px 24px;margin:0 0 20px;">${eyebrowRow}${headline}${rows}${total}</div>`;
}

/** Full-width primary CTA button. */
function primaryButtonHtml(url: string, label: string): string {
  return `<a href="${url}" style="display:block;background:${C.accent};border-radius:6px;padding:14px 0;text-align:center;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;">${label}</a>`;
}

/** Bordered secondary CTA button. */
function secondaryButtonHtml(url: string, label: string): string {
  return `<a href="${url}" style="display:block;background:#FFFFFF;border:1px solid ${C.secondaryBorder};border-radius:6px;padding:13px 0;text-align:center;font-size:15px;font-weight:600;color:${C.body};text-decoration:none;">${label}</a>`;
}

/** Primary + secondary buttons side by side (stacked via table cells). */
function buttonPairHtml(primary: string, secondary: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr>
      <td width="50%" style="padding-right:6px;">${primary}</td>
      <td width="50%" style="padding-left:6px;">${secondary}</td>
    </tr></table>`;
}

/** Muted small print that closes the email body (pre-escaped). */
function finePrintHtml(html: string): string {
  return `<p style="margin:0;font-size:13px;line-height:1.6;color:${C.faint};">${html}</p>`;
}

/** "If the button doesn't work" fallback with the raw link. */
function linkFallbackHtml(url: string): string {
  return `<p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:${C.faintest};word-break:break-all;">If the button doesn&#39;t work, copy this link: ${url}</p>`;
}

/** A highlighted note block for an optional consultant message. */
function messageBlockHtml(message: string | undefined): string {
  return message?.trim()
    ? `<div style="background:${C.tintBg};border-radius:8px;padding:14px 18px;margin:0 0 20px;font-size:14px;line-height:1.6;color:${C.body};white-space:pre-wrap;">${escapeHtml(
        message.trim()
      )}</div>`
    : '';
}

/**
 * A titled checklist with accent check marks (plain "✓" characters —
 * most email clients strip inline SVG). Items are pre-escaped.
 */
function checklistHtml(heading: string, items: string[]): string {
  const rows = items
    .map(
      (item) =>
        `<tr><td style="width:22px;padding:5px 0;font-size:14px;font-weight:700;color:${C.accent};vertical-align:top;">&#10003;</td><td style="padding:5px 0;font-size:14px;line-height:1.5;color:${C.body};">${item}</td></tr>`
    )
    .join('');
  return `<p style="margin:0 0 6px;font-size:14px;font-weight:600;color:${C.heading};">${heading}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">${rows}</table>`;
}

/* ------------------------------------------------------------------ */
/* Customer templates                                                  */
/* ------------------------------------------------------------------ */

/** Inputs for the customer-facing estimate email template. */
export interface EstimateEmailInputs {
  company: CompanyBrand;
  customerFirstName: string;
  orderNumber: string;
  total: number;
  expiryDate: string;
  viewUrl: string;
  /** Optional personal note from the consultant, shown above the CTA. */
  message?: string;
}

/**
 * Builds the branded customer estimate email ("03 — Estimate proposal"
 * in the design doc): greeting, tinted summary card with expiry and
 * total, and a CTA button linking to the public view page. All dynamic
 * strings are HTML-escaped.
 */
export function buildEstimateEmailHtml(i: EstimateEmailInputs): string {
  const company = escapeHtml(i.company.name);
  const name = escapeHtml(i.customerFirstName);
  const order = escapeHtml(i.orderNumber);
  const expiry = escapeHtml(i.expiryDate);
  const url = escapeHtml(i.viewUrl);
  const body = `${headingHtml('Your estimate is ready')}
    ${introHtml(`Hi ${name} &mdash; thank you for choosing ${company}. Your written estimate is ready to review online, with every window and option we discussed.`)}
    ${summaryCardHtml({
      eyebrow: 'Estimate summary',
      badge: order,
      rows: [
        ['Customer', name],
        ['Valid until', expiry],
      ],
      total: { label: 'Estimated total (incl. HST)', amount: i.total },
    })}
    ${messageBlockHtml(i.message)}
    <div style="margin:0 0 24px;">${primaryButtonHtml(url, 'View your estimate')}</div>
    ${finePrintHtml(`The full estimate is attached as a PDF. Questions or changes? Reply to this email &mdash; we&#39;re happy to adjust anything before you decide.`)}
    ${linkFallbackHtml(url)}`;
  return brandedShell(i.company, body);
}

/** Inputs for the customer-facing invoice email template. */
export interface InvoiceEmailInputs {
  company: CompanyBrand;
  customerFirstName: string;
  orderNumber: string;
  total: number;
  viewUrl: string;
  /** Optional personal note from the consultant, shown above the CTA. */
  message?: string;
}

/**
 * Builds the branded invoice email sent for a confirmed order, in the
 * same visual system as the estimate email: greeting, invoice summary
 * card, optional note, and a CTA linking to the public view page (no
 * "confirm" step — the order is already confirmed). All dynamic strings
 * are HTML-escaped.
 */
export function buildInvoiceEmailHtml(i: InvoiceEmailInputs): string {
  const company = escapeHtml(i.company.name);
  const name = escapeHtml(i.customerFirstName);
  const order = escapeHtml(i.orderNumber);
  const url = escapeHtml(i.viewUrl);
  const body = `${headingHtml('Your invoice')}
    ${introHtml(`Hi ${name} &mdash; thank you for your order with ${company}. Your invoice is attached, and you can view your order online any time.`)}
    ${summaryCardHtml({
      eyebrow: 'Invoice summary',
      badge: order,
      rows: [['Customer', name]],
      total: { label: 'Total (incl. HST)', amount: i.total },
    })}
    ${messageBlockHtml(i.message)}
    <div style="margin:0 0 24px;">${primaryButtonHtml(url, 'View your order')}</div>
    ${finePrintHtml(`The full invoice is attached as a PDF. Questions? Reply to this email &mdash; we&#39;re happy to help.`)}
    ${linkFallbackHtml(url)}`;
  return brandedShell(i.company, body);
}

/** Inputs for the customer-facing installation-time proposal email. */
export interface InstallationProposalInputs {
  company: CompanyBrand;
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
  /** Optional personal note from the consultant, shown above the CTA. */
  message?: string;
}

/**
 * Builds the branded installation-time proposal email ("04 —
 * Installation proposal" in the design doc): the proposed one-hour
 * arrival window in a tinted card, with paired CTAs to the public page
 * to confirm or request another time. All dynamic strings are
 * HTML-escaped.
 */
export function buildInstallationProposalHtml(i: InstallationProposalInputs): string {
  const name = escapeHtml(i.customerFirstName);
  const order = escapeHtml(i.orderNumber);
  const dateText = escapeHtml(i.dateText);
  const startText = escapeHtml(i.startText);
  const endText = escapeHtml(i.endText);
  const url = escapeHtml(i.viewUrl);
  const body = `${headingHtml('Your blinds are ready to install')}
    ${introHtml(`Great news, ${name} &mdash; your order is ready. We will be there between <strong>${startText}</strong> and <strong>${endText}</strong> on <strong>${dateText}</strong> if that works for you.`)}
    ${summaryCardHtml({
      eyebrow: 'Proposed installation',
      headline: `${dateText} &middot; ${startText} &ndash; ${endText}`,
      rows: [['Order', `<span style="font-family:${MONO};">${order}</span>`]],
    })}
    ${messageBlockHtml(i.message)}
    ${buttonPairHtml(
      primaryButtonHtml(url, 'View &amp; confirm installation'),
      secondaryButtonHtml(url, 'Request another time')
    )}
    ${finePrintHtml(`Someone 18 or older should be home during the visit. Need to change the time? Use the buttons above or reply to this email.`)}
    ${linkFallbackHtml(url)}`;
  return brandedShell(i.company, body);
}

/** Shared inputs for the appointment proposal/reminder templates. */
export interface AppointmentEmailInputs {
  company: CompanyBrand;
  customerFirstName: string;
  /** Full customer name shown on the first row of the summary card. */
  customerFullName: string;
  /**
   * Set for INSTALLATION visits only — estimate appointments are not
   * attached to an order and never reference a number.
   */
  orderNumber?: string;
  /** e.g. "Thursday, July 16, 2026" */
  dateText: string;
  /** Window start, e.g. "2:00 PM" */
  startText: string;
  /** Window end (start + 1h), e.g. "3:00 PM" */
  endText: string;
  /** One-line visit address; omitted from the card when empty. */
  locationText?: string;
}

/** Rows shared by the appointment summary cards (pre-escaped values). */
function appointmentRows(i: AppointmentEmailInputs): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    i.orderNumber
      ? [
          'Order',
          `${escapeHtml(i.customerFullName)} &middot; <span style="font-family:${MONO};">${escapeHtml(i.orderNumber)}</span>`,
        ]
      : ['Customer', escapeHtml(i.customerFullName)],
  ];
  if (i.locationText?.trim()) rows.push(['Location', escapeHtml(i.locationText.trim())]);
  return rows;
}

/** Inputs for the estimate-appointment booking-confirmation email. */
export interface AppointmentBookedInputs extends AppointmentEmailInputs {
  /** Public page where the customer views the visit or requests another time */
  viewUrl: string;
  /** Optional personal note from the consultant, shown above the CTA. */
  message?: string;
}

/**
 * Builds the estimate-appointment booking confirmation ("01 —
 * Appointment confirmation" in the design doc): the visit is booked
 * as soon as it is created — no confirm step for the customer — so
 * the card presents the time as settled, with a link to the public
 * page where they can request a different time if needed. All dynamic
 * strings are HTML-escaped.
 */
export function buildAppointmentBookedHtml(i: AppointmentBookedInputs): string {
  const company = escapeHtml(i.company.name);
  const name = escapeHtml(i.customerFirstName);
  const url = escapeHtml(i.viewUrl);
  const body = `${headingHtml('Your estimate appointment is booked')}
    ${introHtml(`Hi ${name} &mdash; thanks for booking a free in-home estimate with ${company}. You&#39;re all set for the time below &mdash; no need to do anything else.`)}
    ${summaryCardHtml({
      eyebrow: 'Booked time',
      headline: `${escapeHtml(i.dateText)} &middot; ${escapeHtml(i.startText)} &ndash; ${escapeHtml(i.endText)}`,
      rows: appointmentRows(i),
    })}
    ${messageBlockHtml(i.message)}
    <div style="margin:0 0 24px;">${primaryButtonHtml(url, 'View appointment')}</div>
    ${finePrintHtml(`The visit takes about an hour &mdash; we measure your windows, show samples, and leave you with a written estimate. No obligation. Need a different time? Use the button above or reply to this email.`)}
    ${linkFallbackHtml(url)}`;
  return brandedShell(i.company, body);
}

/**
 * Builds the day-before estimate-appointment reminder ("02 —
 * Appointment reminder" in the design doc): the confirmed window plus
 * a short "before we arrive" checklist. All dynamic strings are
 * HTML-escaped.
 */
export function buildAppointmentReminderHtml(i: AppointmentEmailInputs): string {
  const name = escapeHtml(i.customerFirstName);
  const phone = i.company.phone?.trim();
  const contact = phone ? ` or call us at ${escapeHtml(phone)}` : '';
  const body = `${headingHtml(`See you tomorrow, ${name}`)}
    ${introHtml(`A quick reminder about your estimate appointment &mdash; here&#39;s everything you need.`)}
    ${summaryCardHtml({
      eyebrow: 'Confirmed',
      headline: `${escapeHtml(i.dateText)} &middot; ${escapeHtml(i.startText)} &ndash; ${escapeHtml(i.endText)}`,
      rows: appointmentRows(i),
    })}
    ${checklistHtml('Before we arrive', [
      'Clear easy access to the windows you&#39;d like covered',
      'Have a rough idea of style &mdash; we&#39;ll bring samples of everything',
      'Set aside about an hour &mdash; measuring included',
    ])}
    ${finePrintHtml(`Need to change the time? Reply to this email${contact}.`)}`;
  return brandedShell(i.company, body);
}

/**
 * Builds the day-before installation reminder ("05 — Installation
 * reminder" in the design doc): the confirmed window plus a checklist
 * that prepares the home for the install team. All dynamic strings are
 * HTML-escaped.
 */
export function buildInstallReminderHtml(i: AppointmentEmailInputs): string {
  const name = escapeHtml(i.customerFirstName);
  const phone = i.company.phone?.trim();
  const contact = phone ? ` or call ${escapeHtml(phone)}` : '';
  const body = `${headingHtml('Installation is tomorrow')}
    ${introHtml(`Hi ${name} &mdash; our team arrives tomorrow to install your blinds. A few things that make the visit go smoothly:`)}
    ${summaryCardHtml({
      eyebrow: 'Confirmed',
      headline: `${escapeHtml(i.dateText)} &middot; ${escapeHtml(i.startText)} &ndash; ${escapeHtml(i.endText)}`,
      rows: appointmentRows(i),
    })}
    ${checklistHtml('Before the team arrives', [
      'Move furniture and d&eacute;cor away from the windows',
      'Take down existing window coverings, or ask us to when we arrive',
      'Keep pets in a separate room while we work',
    ])}
    ${finePrintHtml(`Need to reschedule? Reply to this email${contact} as soon as possible.`)}`;
  return brandedShell(i.company, body);
}

/** Inputs for the post-installation review request email. */
export interface ReviewRequestInputs {
  company: CompanyBrand;
  customerFirstName: string;
  /** The company's Google review link. */
  reviewUrl: string;
}

/**
 * Builds the post-installation review request ("06 — Review request"
 * in the design doc): five accent stars and a centered CTA to the
 * company's Google review page. All dynamic strings are HTML-escaped.
 */
export function buildReviewRequestHtml(i: ReviewRequestInputs): string {
  const name = escapeHtml(i.customerFirstName);
  const url = escapeHtml(i.reviewUrl);
  const stars = `<div style="font-size:24px;line-height:1;letter-spacing:4px;color:${C.accent};margin:0 0 12px;">&#9733;&#9733;&#9733;&#9733;&#9733;</div>`;
  const body = `${headingHtml('How do your new blinds look?')}
    ${introHtml(`Hi ${name} &mdash; it was a pleasure working with you. Your installation is complete, and we hope everything looks exactly the way you imagined.`)}
    <div style="background:${C.tintBg};border-radius:8px;padding:24px;margin:0 0 24px;text-align:center;">
      ${stars}
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:${C.body};">If you have two minutes, a Google review helps neighbours find us &mdash; and it means a lot to our small team.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto;"><tr><td style="width:280px;">${primaryButtonHtml(url, 'Review us on Google')}</td></tr></table>
    </div>
    ${finePrintHtml(`Anything not quite right? Reply to this email first &mdash; we&#39;ll make it right before anything else.`)}`;
  return brandedShell(i.company, body);
}

/* ------------------------------------------------------------------ */
/* Internal notifications (plain, not part of the customer design set) */
/* ------------------------------------------------------------------ */

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

/**
 * Builds the short internal notification sent to the business when a
 * customer responds to an estimate-appointment proposal. Escaped.
 */
export function buildAppointmentNoticeHtml(i: InstallationNoticeInputs): string {
  const order = escapeHtml(i.orderNumber);
  const name = escapeHtml(i.customerName);
  const note = escapeHtml(i.note ?? '');
  const headline = i.confirmed
    ? `✅ Estimate appointment confirmed`
    : `🕑 New appointment time requested`;
  const body = i.confirmed
    ? `<strong>${name}</strong> confirmed the proposed estimate appointment for order <strong>${order}</strong>.`
    : `<strong>${name}</strong> requested a different estimate appointment time for order <strong>${order}</strong>.` +
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
