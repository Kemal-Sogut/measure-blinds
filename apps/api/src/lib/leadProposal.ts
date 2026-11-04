// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * "Propose visit" for a website lead: email the visitor a thank-you plus a
 * proposed time for their free in-home estimate, and book that time as an
 * ESTIMATE appointment in `proposed` status.
 *
 * The visit reuses the installation-style proposal round trip that the
 * public appointment page already supports for both kinds
 * (`/appointment/:token`, `routes/public.ts`): the customer confirms the
 * time or asks for another one, and the shop gets the usual "confirmed" /
 * "change requested" email. A visit booked from the Calendar is different:
 * it is confirmed at once. A lead proposal waits for the visitor, because
 * they never picked the time.
 *
 * Email first, persist after (AI_GUIDELINES §2): a failed send leaves the
 * calendar and the lead untouched, so staff can simply try again. A second
 * proposal for the same lead re-times the visit it already has, keeping
 * the public token, so a link from the first email still works.
 *
 * The caller (`routes/leads.ts`, `POST /:id/propose`) marks the lead
 * handled and links it to the returned appointment id.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  brandFromSettings,
  brandedShell,
  buttonPairHtml,
  escapeHtml,
  finePrintHtml,
  headingHtml,
  introHtml,
  linkFallbackHtml,
  messageBlockHtml,
  primaryButtonHtml,
  secondaryButtonHtml,
  sendEmail,
  summaryCardHtml,
  type CompanyBrand,
} from './email';
import { leadAddressLine } from './leadAlerts';
import { scheduleWindow } from './timeText';
import type { Env } from '../index';

/** What staff picked in the Leads page's "Propose visit" dialog (already validated). */
export interface LeadProposalInput {
  /** YYYY-MM-DD. */
  appointment_date: string;
  /** HH:MM, 24-hour; the visitor sees a one-hour window starting here. */
  appointment_time: string;
  /** Optional personal note shown above the buttons. */
  message?: string;
}

/** Inputs of the visitor-facing proposal email. Every string is escaped by the builder. */
export interface LeadProposalEmailInputs {
  company: CompanyBrand;
  /** The first name the visitor typed into the form. */
  firstName: string;
  /** "Jane Doe", shown on the summary card. */
  fullName: string;
  /** One-line visit address from the form; the row is left out when blank. */
  locationText: string;
  /** e.g. "Friday, November 6, 2026". */
  dateText: string;
  /** e.g. "10:00 AM". */
  startText: string;
  /** Start + 1 hour, e.g. "11:00 AM". */
  endText: string;
  /** Public page where the visitor confirms or asks for another time. */
  viewUrl: string;
  message?: string;
}

/** Subject of the proposal email. It names the day so it reads well in an inbox list. */
export function leadProposalSubject(dateText: string): string {
  return `Thank you! Your free in-home estimate: proposed for ${dateText}`;
}

/**
 * Builds the visitor's proposal email: thanks for the request, the proposed
 * one-hour window in the tinted summary card, an optional note, and paired
 * Confirm / Request another time buttons to the public appointment page.
 * Same branded shell and blocks as the installation proposal.
 */
export function buildLeadProposalHtml(i: LeadProposalEmailInputs): string {
  const company = escapeHtml(i.company.name);
  const name = escapeHtml(i.firstName);
  const dateText = escapeHtml(i.dateText);
  const startText = escapeHtml(i.startText);
  const endText = escapeHtml(i.endText);
  const url = escapeHtml(i.viewUrl);
  const rows: Array<[string, string]> = [['Customer', escapeHtml(i.fullName)]];
  if (i.locationText.trim()) rows.push(['Location', escapeHtml(i.locationText.trim())]);
  const body = `${headingHtml('Thank you for your request')}
    ${introHtml(`Hi ${name} &mdash; thank you for asking ${company} for a free in-home estimate. We would love to visit between <strong>${startText}</strong> and <strong>${endText}</strong> on <strong>${dateText}</strong>, if that works for you.`)}
    ${summaryCardHtml({
      eyebrow: 'Proposed estimate visit',
      headline: `${dateText} &middot; ${startText} &ndash; ${endText}`,
      rows,
    })}
    ${messageBlockHtml(i.message)}
    ${buttonPairHtml(primaryButtonHtml(url, 'Confirm this time'), secondaryButtonHtml(url, 'Request another time'))}
    ${finePrintHtml(`The visit takes about an hour &mdash; we measure your windows, show samples, and leave you with a written estimate. No obligation. Prefer a different time? Use the buttons above or reply to this email.`)}
    ${linkFallbackHtml(url)}`;
  return brandedShell(i.company, body);
}

/** Result of `sendLeadProposal`: the booked visit, or an HTTP status and a message for staff. */
export type LeadProposalResult =
  | { ok: true; appointmentId: string; email: string }
  | { ok: false; status: 404 | 409 | 500 | 502; error: string };

/**
 * Emails the proposal, then books or re-times the lead's estimate visit.
 *
 * - 404 when the lead does not exist.
 * - 409 when the lead's customer was deleted: the visit has nobody to belong to.
 * - 502 when the email fails. Nothing has been written at that point.
 * - 500 for a database error.
 *
 * The email goes to the address the visitor typed on the form (`leads.email`),
 * which is the address they asked to be contacted at.
 */
export async function sendLeadProposal(
  env: Env,
  sb: SupabaseClient,
  leadId: string,
  input: LeadProposalInput
): Promise<LeadProposalResult> {
  const { data: leadRow, error: leadErr } = await sb
    .from('leads')
    .select(
      'id, first_name, last_name, email, street, unit, city, province, postal_code, appointment_id, ' +
        'customer:customers(id, deleted_at)'
    )
    .eq('id', leadId)
    .maybeSingle();
  if (leadErr) return { ok: false, status: 500, error: leadErr.message };
  const lead = leadRow as Record<string, any> | null;
  if (!lead) return { ok: false, status: 404, error: 'Lead not found' };
  const customer = lead.customer as { id: string; deleted_at: string | null } | null;
  if (!customer || customer.deleted_at) {
    return { ok: false, status: 409, error: 'The linked customer was removed, so the visit has no one to belong to.' };
  }

  const { data: company } = await sb.from('company_settings').select('*').eq('id', 1).single();
  if (!company) return { ok: false, status: 500, error: 'Company settings not found' };

  // Re-proposing keeps the visit (and its public link) the first email used.
  let existing: { id: string; public_token: string } | null = null;
  if (lead.appointment_id) {
    const { data } = await sb
      .from('appointments')
      .select('id, public_token')
      .eq('id', lead.appointment_id)
      .maybeSingle();
    existing = (data as { id: string; public_token: string } | null) ?? null;
  }
  const token = existing?.public_token ?? crypto.randomUUID();

  const win = scheduleWindow(input.appointment_date, input.appointment_time);
  try {
    await sendEmail(env, {
      to: lead.email,
      subject: leadProposalSubject(win.dateText),
      html: buildLeadProposalHtml({
        company: brandFromSettings(company),
        firstName: lead.first_name || 'there',
        fullName: `${lead.first_name} ${lead.last_name}`.trim() || lead.email,
        locationText: leadAddressLine(lead as Parameters<typeof leadAddressLine>[0]),
        dateText: win.dateText,
        startText: win.startText,
        endText: win.endText,
        viewUrl: `${env.APP_URL}/appointment/${token}`,
        message: input.message,
      }),
    });
  } catch (e) {
    return { ok: false, status: 502, error: e instanceof Error ? e.message : 'Email send failed' };
  }

  // The visitor still has to answer, so the visit starts as `proposed`.
  const fields = {
    appointment_date: input.appointment_date,
    appointment_time: input.appointment_time,
    status: 'proposed',
    confirmed_at: null,
    response_note: '',
    reminder_sent_at: null,
  };
  const { data: appt, error: apptErr } = existing
    ? await sb.from('appointments').update(fields).eq('id', existing.id).select('id').single()
    : await sb
        .from('appointments')
        .insert({ ...fields, kind: 'estimate', customer_id: customer.id, public_token: token })
        .select('id')
        .single();
  if (apptErr || !appt) return { ok: false, status: 500, error: apptErr?.message ?? 'Could not save the visit' };
  return { ok: true, appointmentId: (appt as { id: string }).id, email: lead.email };
}
