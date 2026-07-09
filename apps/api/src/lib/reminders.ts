// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Daily scheduled email jobs, run by the 10 AM (Toronto) cron trigger:
 *
 *   1. Visit reminders — every CONFIRMED appointment (estimate visit or
 *      installation) happening tomorrow (Toronto calendar) gets its
 *      day-before reminder once; `appointments.reminder_sent_at` is the
 *      dedup stamp, cleared whenever a new time is proposed.
 *   2. Review requests — orders marked installed 2+ days ago (Toronto
 *      calendar date of installed_at) get the Google-review email once
 *      (orders.review_request_sent_at dedup), only when the company has
 *      a google_review_url configured.
 *
 * Every send is per-row best-effort: a failure is logged and the dedup
 * stamp is NOT written, so the next run retries just that row.
 */

import { createSupabaseAdmin } from './supabase';
import {
  sendEmail,
  brandFromSettings,
  buildAppointmentReminderHtml,
  buildInstallReminderHtml,
  buildReviewRequestHtml,
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

/** Runs both daily jobs; see the module doc for what each does. */
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

  /* -- 1. Day-before visit reminders (both kinds) ------------------- */
  const { data: visits } = await sb
    .from('appointments')
    .select(
      'id, kind, appointment_date, appointment_time, ' +
        'customer:customers(*), order:orders(order_number)'
    )
    .eq('status', 'confirmed')
    .eq('appointment_date', tomorrow)
    .is('reminder_sent_at', null);

  for (const visit of (visits ?? []) as Array<Record<string, any>>) {
    const email = visit.customer?.email;
    if (!email) continue;
    const isInstall = visit.kind === 'installation';
    const orderNumber: string | undefined = visit.order?.order_number ?? undefined;
    const win = scheduleWindow(visit.appointment_date, visit.appointment_time);
    try {
      await sendEmail(env, {
        to: email,
        subject: isInstall
          ? `Reminder: installation tomorrow — ${orderNumber ?? ''}`.trim()
          : 'Reminder: your estimate appointment tomorrow',
        html: (isInstall ? buildInstallReminderHtml : buildAppointmentReminderHtml)({
          company: brand,
          customerFirstName: visit.customer?.first_name ?? '',
          customerFullName:
            `${visit.customer?.first_name ?? ''} ${visit.customer?.last_name ?? ''}`.trim(),
          // Estimate visits carry no order — the row shows the customer.
          orderNumber: isInstall ? orderNumber : undefined,
          dateText: win.dateText,
          startText: win.startText,
          endText: win.endText,
          locationText: customerLocation(visit.customer),
        }),
      });
      await sb
        .from('appointments')
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq('id', visit.id);
      if (isInstall) result.installReminders++;
      else result.appointmentReminders++;
    } catch (e) {
      console.error(`Visit reminder failed for appointment ${visit.id}:`, e);
    }
  }

  /* -- 2. Review requests ------------------------------------------ */
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
    for (const order of (installed ?? []) as Array<Record<string, any>>) {
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
