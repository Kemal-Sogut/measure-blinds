// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Staff email for a new website lead (spec D5): one plain internal
 * notice to `company_settings.email`, in the same unbranded style as the
 * other staff notices in `lib/email.ts` (confirmation, cancellation). Its
 * Reply-To is the visitor, so answering the email reaches them directly.
 *
 * Lives beside `email.ts`, not inside it: that module is already past the
 * 800-line guideline (AI_GUIDELINES §6), and this template uses none of its
 * branded customer-facing shell.
 *
 * Best effort by contract (`sendLeadNotice` never throws). The lead and its
 * customer are already stored when this runs: persist-then-alert, which is
 * deliberately the reverse of the estimate's email-then-persist rule,
 * because here the stored row is the thing that must not be lost. A
 * successful send stamps `leads.email_sent_at`, so a silent failure shows up
 * on the Leads page instead of only in the Worker logs.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { escapeHtml, sendEmail } from './email';
import type { CustomerMatch } from './leadCustomer';
import type { LeadInput } from './leadSchema';

/** Display labels for the form's covering ids (must match `COVERS` in lead-form.js). */
export const COVERING_LABELS: Record<LeadInput['coverings'][number], string> = {
  zebra: 'Zebra',
  roller: 'Roller',
  solar: 'Solar',
  honeycomb: 'Honeycomb',
  roman: 'Roman',
  shutters: 'Shutters',
  drapery: 'Drapery',
  smart: 'Smart / Motorized',
  unsure: 'Not sure yet',
};

/** Everything the notice shows. `appUrl` is the staff app origin (env.APP_URL). */
export interface LeadNoticeInputs {
  lead: LeadInput;
  customerId: string;
  match: CustomerMatch;
  appUrl: string;
}

/** One-line address, skipping blank parts: "12 Elm St, Unit 4, Ottawa, ON K1A 0B1". */
export function leadAddressLine(lead: {
  street: string;
  unit: string;
  city: string;
  province: string;
  postal_code: string;
}): string {
  const street = [lead.street, lead.unit ? `Unit ${lead.unit}` : ''].filter(Boolean).join(', ');
  const region = [lead.province, lead.postal_code].filter(Boolean).join(' ');
  return [street, lead.city, region].filter(Boolean).join(', ');
}

/** Subject line: "🪟 New website lead: Jane Doe (Ottawa)". The city is omitted when blank. */
export function leadNoticeSubject(lead: Pick<LeadInput, 'first_name' | 'last_name' | 'city'>): string {
  const name = `${lead.first_name} ${lead.last_name}`.trim();
  return `🪟 New website lead: ${name}${lead.city ? ` (${lead.city})` : ''}`;
}

/**
 * The notice body. Every visitor-supplied string passes through
 * `escapeHtml` (AI_GUIDELINES §2), the message included. `tel:` and
 * `mailto:` hrefs are built from the escaped values too.
 */
export function buildLeadNoticeHtml(i: LeadNoticeInputs): string {
  const { lead } = i;
  const name = escapeHtml(`${lead.first_name} ${lead.last_name}`.trim());
  const email = escapeHtml(lead.email);
  const phone = escapeHtml(lead.phone);
  const telHref = escapeHtml(lead.phone.replace(/[^\d+]/g, ''));
  const covers = escapeHtml(lead.coverings.map((c) => COVERING_LABELS[c]).join(', '));
  const customerUrl = escapeHtml(`${i.appUrl.replace(/\/$/, '')}/customers/${i.customerId}`);
  const customerNote =
    i.match === 'created'
      ? 'A new customer was created from this request.'
      : 'This email already belonged to a customer. The request was added to that customer, and any blank details were filled in.';
  const row = (label: string, value: string) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#868e96;vertical-align:top;white-space:nowrap">${label}</td><td style="padding:4px 0">${value}</td></tr>`;
  const message = lead.message
    ? `<p style="margin:16px 0 4px;color:#868e96">Message</p>
    <p style="margin:0;white-space:pre-wrap;border-left:3px solid #dee2e6;padding-left:10px">${escapeHtml(lead.message)}</p>`
    : '';
  return `<!doctype html>
<html><body style="margin:0;font-family:Arial,Helvetica,sans-serif;color:#212529">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <h2 style="margin:0 0 12px">🪟 New free-estimate request</h2>
    <p style="margin:0 0 12px"><strong>${name}</strong> asked for a free in-home estimate on the website.</p>
    <table style="border-collapse:collapse;font-size:14px">
      ${row('Phone', `<a href="tel:${telHref}">${phone}</a>`)}
      ${row('Email', `<a href="mailto:${email}">${email}</a>`)}
      ${row('Address', escapeHtml(leadAddressLine(lead)))}
      ${row('Coverings', covers)}
      ${row('Windows', escapeHtml(lead.window_count))}
    </table>${message}
    <p style="margin:16px 0 8px">${customerNote}</p>
    <p style="margin:0"><a href="${customerUrl}">Open the customer in the app</a></p>
    <p style="margin:16px 0 0;color:#868e96;font-size:12px">Reply to this email to answer ${name} directly.</p>
  </div>
</body></html>`;
}

/** Env subset the sender needs (a structural slice of the Worker `Env`). */
interface LeadNoticeEnv {
  RESEND_API_KEY: string;
  RESEND_FROM?: string;
  RESEND_REPLY_TO?: string;
  APP_URL: string;
}

/**
 * Emails the shop about a stored lead and stamps `email_sent_at`. It never
 * throws: every failure (no company email configured, Resend refusing, the
 * stamp failing) is logged, and the visitor still gets their success
 * screen, because the lead is already saved.
 */
export async function sendLeadNotice(
  env: LeadNoticeEnv,
  sb: SupabaseClient,
  leadId: string,
  inputs: Omit<LeadNoticeInputs, 'appUrl'>
): Promise<void> {
  try {
    const { data: company } = await sb.from('company_settings').select('email').eq('id', 1).single();
    const to = (company as { email?: string } | null)?.email?.trim();
    if (!to) {
      console.error('Lead notice skipped: company_settings.email is blank');
      return;
    }
    await sendEmail(env, {
      to,
      subject: leadNoticeSubject(inputs.lead),
      html: buildLeadNoticeHtml({ ...inputs, appUrl: env.APP_URL }),
      replyTo: inputs.lead.email,
    });
    const { error } = await sb
      .from('leads')
      .update({ email_sent_at: new Date().toISOString() })
      .eq('id', leadId);
    if (error) console.error('Lead notice sent but email_sent_at not stamped:', error.message);
  } catch (e) {
    console.error('Lead notice failed:', e);
  }
}
