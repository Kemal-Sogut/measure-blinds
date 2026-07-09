// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Daily scheduled email jobs, run by the 10 AM (Toronto) cron trigger:
 *
 *   1. Estimate-appointment reminders — every order whose CONFIRMED
 *      appointment is tomorrow (Toronto calendar) gets the "see you
 *      tomorrow" email once (appointment_reminder_sent_at dedup).
 *   2. Installation reminders — same pattern for confirmed
 *      installations (install_reminder_sent_at dedup).
 *   3. Review requests — orders marked installed 2+ days ago (Toronto
 *      calendar date of installed_at) get the Google-review email once
 *      (review_request_sent_at dedup), only when the company has a
 *      google_review_url configured.
 *
 * Every send is per-order best-effort: a failure is logged and the
 * dedup stamp is NOT written, so the next run retries just that order.
 */

import { createSupabaseAdmin } from './supabase';
import {
  sendEmail,
  brandFromSettings,
  buildAppointmentReminderHtml,
  buildInstallReminderHtml,
  buildReviewRequestHtml,
  type CompanyBrand,
} from './email';
import { scheduleWindow, torontoDateISO, customerLocation } from './timeText';

/** Env subset the jobs need (matches the Worker Env). */
interface JobsEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  RESEND_API_KEY: string;
  RESEND_FROM?: string;
  RESEND_REPLY_TO?: string;
}

/** How many of each email the run actually sent. */
export interface DailyJobsResult {
  appointmentReminders: number;
  installReminders: number;
  reviewRequests: number;
}

/** Order row shape shared by the reminder queries. */
interface ReminderRow {
  id: string;
  order_number: string;
  customer: Record<string, any> | null;
  [key: string]: unknown;
}

/** Runs all three daily jobs; see the module doc for what each does. */
export async function runDailyEmailJobs(env: JobsEnv): Promise<DailyJobsResult> {
  const result: DailyJobsResult = {
    appointmentReminders: 0,
    installReminders: 0,
    reviewRequests: 0,
  };
  const sb = createSupabaseAdmin(env);
  const { data: company } = await sb
    .from('company_settings')
    .select('*')
    .eq('id', 1)
    .single();
  if (!company) return result;
  const brand = brandFromSettings(company);
  const tomorrow = torontoDateISO(1);

  /* -- 1. Appointment reminders ----------------------------------- */
  const { data: appointments } = await sb
    .from('orders')
    .select('id, order_number, appointment_date, appointment_time, customer:customers(*)')
    .eq('appointment_status', 'confirmed')
    .eq('appointment_date', tomorrow)
    .is('appointment_reminder_sent_at', null);
  for (const order of (appointments ?? []) as unknown as ReminderRow[]) {
    const sent = await sendReminder(env, sb, brand, order, {
      dateIso: order.appointment_date as string,
      time: order.appointment_time as string,
      stampColumn: 'appointment_reminder_sent_at',
      subject: `Reminder: your estimate appointment tomorrow — ${order.order_number}`,
      build: buildAppointmentReminderHtml,
    });
    if (sent) result.appointmentReminders++;
  }

  /* -- 2. Installation reminders ----------------------------------- */
  const { data: installs } = await sb
    .from('orders')
    .select('id, order_number, install_date, install_time, customer:customers(*)')
    .eq('install_status', 'confirmed')
    .eq('install_date', tomorrow)
    .is('install_reminder_sent_at', null);
  for (const order of (installs ?? []) as unknown as ReminderRow[]) {
    const sent = await sendReminder(env, sb, brand, order, {
      dateIso: order.install_date as string,
      time: order.install_time as string,
      stampColumn: 'install_reminder_sent_at',
      subject: `Reminder: installation tomorrow — ${order.order_number}`,
      build: buildInstallReminderHtml,
    });
    if (sent) result.installReminders++;
  }

  /* -- 3. Review requests ------------------------------------------ */
  const reviewUrl = String(company.google_review_url ?? '').trim();
  if (reviewUrl) {
    // Send on the 2nd Toronto calendar day after the install was marked.
    const cutoff = torontoDateISO(-2);
    const { data: installed } = await sb
      .from('orders')
      .select('id, order_number, installed_at, customer:customers(*)')
      .eq('status', 'installed')
      .not('installed_at', 'is', null)
      .is('review_request_sent_at', null);
    for (const order of (installed ?? []) as unknown as ReminderRow[]) {
      const installedDay = torontoDateISO(0, new Date(order.installed_at as string));
      const email = order.customer?.email;
      if (installedDay > cutoff || !email) continue;
      try {
        await sendEmail(env, {
          to: email,
          subject: `How do your new blinds look?`,
          html: buildReviewRequestHtml({
            company: brand,
            customerFirstName: order.customer?.first_name ?? '',
            reviewUrl,
          }),
        });
        await sb
          .from('orders')
          .update({ review_request_sent_at: new Date().toISOString() })
          .eq('id', order.id);
        result.reviewRequests++;
      } catch (e) {
        console.error(`Review request failed for ${order.order_number}:`, e);
      }
    }
  }

  return result;
}

/**
 * Sends one day-before reminder and stamps its dedup column. Returns
 * whether the email actually went out; failures are logged so the next
 * run retries.
 */
async function sendReminder(
  env: JobsEnv,
  sb: ReturnType<typeof createSupabaseAdmin>,
  brand: CompanyBrand,
  order: ReminderRow,
  opts: {
    dateIso: string;
    time: string;
    stampColumn: 'appointment_reminder_sent_at' | 'install_reminder_sent_at';
    subject: string;
    build: (i: {
      company: CompanyBrand;
      customerFirstName: string;
      customerFullName: string;
      orderNumber: string;
      dateText: string;
      startText: string;
      endText: string;
      locationText?: string;
    }) => string;
  }
): Promise<boolean> {
  const email = order.customer?.email;
  if (!email) return false;
  const win = scheduleWindow(opts.dateIso, opts.time);
  try {
    await sendEmail(env, {
      to: email,
      subject: opts.subject,
      html: opts.build({
        company: brand,
        customerFirstName: order.customer?.first_name ?? '',
        customerFullName:
          `${order.customer?.first_name ?? ''} ${order.customer?.last_name ?? ''}`.trim(),
        orderNumber: order.order_number,
        dateText: win.dateText,
        startText: win.startText,
        endText: win.endText,
        locationText: customerLocation(order.customer),
      }),
    });
    await sb
      .from('orders')
      .update({ [opts.stampColumn]: new Date().toISOString() })
      .eq('id', order.id);
    return true;
  } catch (e) {
    console.error(`Reminder failed for ${order.order_number}:`, e);
    return false;
  }
}
