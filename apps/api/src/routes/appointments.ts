// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Appointments route group — mounted at `/api/appointments` behind
 * `requireAuth`. One APPOINTMENT models a scheduled home visit of
 * either kind:
 *   kind = 'estimate'      — free in-home estimate visit, attached to a
 *                            CUSTOMER only (never to an order).
 *   kind = 'installation'  — attached to the (ready) order being
 *                            installed; its emails reference the order
 *                            number.
 *
 * Endpoints:
 *   GET    /calendar       unified events for the Calendar tab —
 *                          `?from=&to=` (inclusive ISO dates)
 *   GET    /order/:orderId the installation visit attached to an order
 *                          (or null) — the order page's panel
 *   POST   /               create + email the customer
 *   POST   /:id/propose    re-propose a new time (same public link)
 *   POST   /:id/confirm    staff-side confirm — the customer agreed
 *                          through another channel; no email is sent
 *   DELETE /:id            remove an appointment
 *
 * Estimate visits are CONFIRMED the moment they are created — there is
 * no approval step for the customer. Their email is a booking
 * confirmation whose public page (`/appointment/:token`) still lets
 * them request a different time. Installations keep the proposal flow:
 * the email asks the customer to confirm the window or request another
 * time. Either way the ordering mirrors the order emails: email FIRST,
 * persist after — a failed send leaves the schedule untouched.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdmin } from '../lib/supabase';
import {
  sendEmail,
  brandFromSettings,
  buildAppointmentBookedHtml,
  buildInstallationProposalHtml,
} from '../lib/email';
import { scheduleWindow, customerLocation } from '../lib/timeText';
import type { AuthVariables } from '../middleware/auth';
import type { Env } from '../index';

const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

/* ------------------------------------------------------------------ */
/* Validation schemas                                                  */
/* ------------------------------------------------------------------ */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/** 24-hour clock time, HH:MM. */
const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

/** Query params for GET /calendar — an inclusive date-only range. */
const calendarRangeSchema = z.object({ from: isoDate, to: isoDate }).strict();

/** Fixed page size for the paginated "See All" appointments list. */
const LIST_PAGE_SIZE = 20;

/**
 * Query params for GET / (the "See All" list): an optional kind filter
 * and a 1-based page number. Both arrive as strings on the query and
 * are coerced/validated here so a bad `?page=abc` fails loudly (400)
 * rather than silently paging from row NaN.
 */
const listQuerySchema = z
  .object({
    kind: z.enum(['estimate', 'installation', 'all']).default('all'),
    page: z.coerce.number().int().min(1).default(1),
  })
  .strict();

/**
 * Payload for POST / — an estimate visit targets a customer, an
 * installation targets a ready order (its customer is derived).
 */
const createSchema = z
  .object({
    kind: z.enum(['estimate', 'installation']),
    customer_id: z.string().uuid().optional(),
    order_id: z.string().uuid().optional(),
    appointment_date: isoDate,
    appointment_time: clockTime,
    message: z.string().max(1000).optional(),
  })
  .strict();

/** Payload for POST /:id/propose — a new time for an existing visit. */
const reproposeSchema = z
  .object({
    appointment_date: isoDate,
    appointment_time: clockTime,
    message: z.string().max(1000).optional(),
  })
  .strict();

function firstZodIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue ? `${issue.path.join('.') || 'payload'}: ${issue.message}` : 'Invalid payload';
}

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

/** Columns + joins every read in this module uses. */
const APPT_SELECT =
  'id, kind, order_id, appointment_date, appointment_time, status, response_note, public_token, ' +
  'customer:customers(*), order:orders(id, order_number, status)';

/** Best-effort activity-trail entry on an installation's order. */
async function logOrderEvent(sb: SupabaseClient, orderId: string, message: string): Promise<void> {
  try {
    await sb.from('order_logs').insert({ order_id: orderId, message });
  } catch {
    // Logging is diagnostic only — never block the caller's mutation.
  }
}

/**
 * Emails the kind-appropriate message for a visit window. Estimate
 * visits get the booking-confirmation template (customer name, no
 * order reference — the time is already settled); installations get
 * the installation proposal with the order number and a confirm step.
 * Throws on send failure so callers can leave state untouched.
 */
async function sendProposalEmail(
  env: Env,
  opts: {
    company: Record<string, any>;
    customer: Record<string, any>;
    kind: 'estimate' | 'installation';
    orderNumber?: string;
    dateIso: string;
    time: string;
    token: string;
    message?: string;
  }
): Promise<void> {
  const win = scheduleWindow(opts.dateIso, opts.time);
  const viewUrl = `${env.APP_URL}/appointment/${opts.token}`;
  const fullName =
    `${opts.customer.first_name ?? ''} ${opts.customer.last_name ?? ''}`.trim();
  if (opts.kind === 'installation') {
    await sendEmail(env, {
      to: opts.customer.email,
      subject: `Installation time for order ${opts.orderNumber}`,
      html: buildInstallationProposalHtml({
        company: brandFromSettings(opts.company),
        customerFirstName: opts.customer.first_name,
        orderNumber: opts.orderNumber ?? '',
        dateText: win.dateText,
        startText: win.startText,
        endText: win.endText,
        viewUrl,
        message: opts.message,
      }),
    });
  } else {
    await sendEmail(env, {
      to: opts.customer.email,
      subject: 'Your estimate appointment is booked',
      html: buildAppointmentBookedHtml({
        company: brandFromSettings(opts.company),
        customerFirstName: opts.customer.first_name,
        customerFullName: fullName,
        dateText: win.dateText,
        startText: win.startText,
        endText: win.endText,
        locationText: customerLocation(opts.customer),
        viewUrl,
        message: opts.message,
      }),
    });
  }
}

/** Loads the company settings singleton (needed for email branding). */
async function loadCompany(sb: SupabaseClient) {
  const { data } = await sb.from('company_settings').select('*').eq('id', 1).single();
  return data;
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

/**
 * Paginated "See All" appointments list (the calendar's See All page):
 * every appointment (optionally filtered to one kind), newest first
 * (date desc, then time desc), 20 per page. Returns the same
 * lightweight event shape as `/calendar` plus pagination metadata
 * (`page`, `page_size`, `total`, `total_pages`) so the client can
 * render the pager without a second count request.
 *
 * Registered before `/:id` so the literal path wins (locked routing
 * pattern: literal routes precede param routes in a Hono group).
 */
app.get('/', async (c) => {
  const parsed = listQuerySchema.safeParse({
    kind: c.req.query('kind') ?? undefined,
    page: c.req.query('page') ?? undefined,
  });
  if (!parsed.success) return c.json({ error: firstZodIssue(parsed.error) }, 400);
  const { kind, page } = parsed.data;

  const sb = createSupabaseAdmin(c.env);
  const fromRow = (page - 1) * LIST_PAGE_SIZE;
  const toRow = fromRow + LIST_PAGE_SIZE - 1;

  let query = sb
    .from('appointments')
    .select(
      'id, kind, order_id, appointment_date, appointment_time, status, ' +
        'order:orders(order_number), customer:customers(first_name, last_name)',
      { count: 'exact' }
    )
    .order('appointment_date', { ascending: false })
    .order('appointment_time', { ascending: false })
    .range(fromRow, toRow);
  if (kind !== 'all') query = query.eq('kind', kind);

  const { data, count, error } = await query;
  if (error) return c.json({ error: error.message }, 500);

  const events = (data ?? []).map((a: Record<string, any>) => ({
    id: a.id,
    kind: a.kind,
    date: a.appointment_date,
    time: a.appointment_time,
    schedule_status: a.status,
    order_id: a.order_id,
    order_number: a.order?.order_number ?? '',
    customer: a.customer,
  }));
  const total = count ?? 0;
  return c.json({
    data: events,
    page,
    page_size: LIST_PAGE_SIZE,
    total,
    total_pages: Math.max(1, Math.ceil(total / LIST_PAGE_SIZE)),
  });
});

/**
 * Unified calendar events for the Calendar tab: both kinds in one list,
 * sorted by date then time. `order_id`/`order_number` are null/'' for
 * estimate visits.
 */
app.get('/calendar', async (c) => {
  const parsed = calendarRangeSchema.safeParse({
    from: c.req.query('from'),
    to: c.req.query('to'),
  });
  if (!parsed.success) return c.json({ error: firstZodIssue(parsed.error) }, 400);
  const { from, to } = parsed.data;

  const sb = createSupabaseAdmin(c.env);
  const { data, error } = await sb
    .from('appointments')
    .select(
      'id, kind, order_id, appointment_date, appointment_time, status, ' +
        'order:orders(order_number), customer:customers(first_name, last_name)'
    )
    .gte('appointment_date', from)
    .lte('appointment_date', to)
    .order('appointment_date', { ascending: true })
    .order('appointment_time', { ascending: true });
  if (error) return c.json({ error: error.message }, 500);

  const events = (data ?? []).map((a: Record<string, any>) => ({
    id: a.id,
    kind: a.kind,
    date: a.appointment_date,
    time: a.appointment_time,
    schedule_status: a.status,
    order_id: a.order_id,
    order_number: a.order?.order_number ?? '',
    customer: a.customer,
  }));
  return c.json({ data: events });
});

/**
 * The installation appointment attached to one order, or null when the
 * order has nothing scheduled — read by the order page's Installation
 * panel. (An order has at most one appointment — unique index.)
 */
app.get('/order/:orderId', async (c) => {
  const orderId = c.req.param('orderId');
  const sb = createSupabaseAdmin(c.env);
  const { data, error } = await sb
    .from('appointments')
    .select(APPT_SELECT)
    .eq('order_id', orderId)
    .maybeSingle();
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ data: data ?? null });
});

/**
 * A single appointment by its id, with its joined customer (full
 * record, so the details page can show contact + address) and, for
 * installations, the summary order fields. Drives the staff-side
 * appointment-details page (`/appointments/:id`) reached by tapping any
 * appointment on the calendar or the See All list.
 *
 * Registered after the literal `/calendar` and `/order/:orderId` reads
 * so those paths are not swallowed by this `/:id` param route.
 * 404 when the id is unknown.
 */
app.get('/:id', async (c) => {
  const id = c.req.param('id');
  const sb = createSupabaseAdmin(c.env);
  const { data, error } = await sb
    .from('appointments')
    .select(APPT_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: 'Appointment not found' }, 404);
  return c.json({ data });
});

/**
 * Books a new visit and emails the customer.
 *
 * kind='estimate': requires `customer_id`; the customer must have an
 * email. NO order is attached — ever. The visit is created CONFIRMED
 * (no approval step) and the email is a booking confirmation.
 * kind='installation': requires `order_id` pointing at a READY order;
 * the customer comes from the order. An order has at most one
 * installation appointment (unique index) — re-booking replaces the
 * schedule on the existing row so previously emailed links keep
 * working.
 */
app.post('/', async (c) => {
  const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: firstZodIssue(parsed.error) }, 400);
  const input = parsed.data;
  const sb = createSupabaseAdmin(c.env);

  const company = await loadCompany(sb);
  if (!company) return c.json({ error: 'Company settings not found' }, 500);

  if (input.kind === 'estimate') {
    if (!input.customer_id) return c.json({ error: 'customer_id is required for an estimate appointment.' }, 400);
    if (input.order_id) return c.json({ error: 'An estimate appointment never attaches to an order.' }, 400);

    const { data: customer } = await sb
      .from('customers')
      .select('*')
      .eq('id', input.customer_id)
      .is('deleted_at', null)
      .maybeSingle();
    if (!customer) return c.json({ error: 'Customer not found' }, 404);
    if (!customer.email) return c.json({ error: 'This customer has no email address.' }, 400);

    const token = crypto.randomUUID();
    try {
      await sendProposalEmail(c.env, {
        company,
        customer,
        kind: 'estimate',
        dateIso: input.appointment_date,
        time: input.appointment_time,
        token,
        message: input.message,
      });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'Email send failed' }, 502);
    }

    const { data, error } = await sb
      .from('appointments')
      .insert({
        kind: 'estimate',
        customer_id: customer.id,
        appointment_date: input.appointment_date,
        appointment_time: input.appointment_time,
        // No approval step — an estimate visit is booked as confirmed.
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
        public_token: token,
      })
      .select(APPT_SELECT)
      .single();
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ data });
  }

  // kind === 'installation'
  if (!input.order_id) return c.json({ error: 'order_id is required for an installation.' }, 400);

  const { data: order } = await sb
    .from('orders')
    .select('id, order_number, status, customer:customers(*)')
    .eq('id', input.order_id)
    .maybeSingle();
  if (!order) return c.json({ error: 'Order not found' }, 404);
  if (order.status !== 'ready') {
    return c.json(
      { error: `Installation can only be proposed on a ready order (this one is ${order.status}).` },
      409
    );
  }
  const customer = order.customer as Record<string, any> | null;
  if (!customer?.email) return c.json({ error: 'This customer has no email address.' }, 400);

  // Reuse the order's existing installation appointment (and its token)
  // when re-booking; mint a fresh row + token otherwise.
  const { data: existing } = await sb
    .from('appointments')
    .select('id, public_token')
    .eq('order_id', order.id)
    .maybeSingle();
  const token: string = existing?.public_token ?? crypto.randomUUID();

  try {
    await sendProposalEmail(c.env, {
      company,
      customer,
      kind: 'installation',
      orderNumber: order.order_number,
      dateIso: input.appointment_date,
      time: input.appointment_time,
      token,
      message: input.message,
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Email send failed' }, 502);
  }

  const fields = {
    appointment_date: input.appointment_date,
    appointment_time: input.appointment_time,
    status: 'proposed',
    confirmed_at: null,
    response_note: '',
    reminder_sent_at: null,
  };
  const { data, error } = existing
    ? await sb
        .from('appointments')
        .update(fields)
        .eq('id', existing.id)
        .select(APPT_SELECT)
        .single()
    : await sb
        .from('appointments')
        .insert({
          ...fields,
          kind: 'installation',
          customer_id: customer.id,
          order_id: order.id,
          public_token: token,
        })
        .select(APPT_SELECT)
        .single();
  if (error) return c.json({ error: error.message }, 500);

  await logOrderEvent(
    sb,
    order.id,
    `Installation proposed for ${input.appointment_date} at ${input.appointment_time}.`
  );
  return c.json({ data });
});

/**
 * Re-proposes a new time for an existing visit (either kind): clears
 * the customer's previous response and the reminder stamp, keeps the
 * SAME public token (already-emailed links stay valid), and emails a
 * fresh message. Installations reset to `proposed` (the customer
 * confirms again); estimate visits have no approval step, so the new
 * time lands directly as `confirmed`.
 */
app.post('/:id/propose', async (c) => {
  const parsed = reproposeSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: firstZodIssue(parsed.error) }, 400);
  const input = parsed.data;
  const id = c.req.param('id');
  const sb = createSupabaseAdmin(c.env);

  const { data: apptRow } = await sb
    .from('appointments')
    .select(APPT_SELECT)
    .eq('id', id)
    .maybeSingle();
  const appt = apptRow as Record<string, any> | null;
  if (!appt) return c.json({ error: 'Appointment not found' }, 404);
  const customer = appt.customer as Record<string, any> | null;
  if (!customer?.email) return c.json({ error: 'This customer has no email address.' }, 400);

  const company = await loadCompany(sb);
  if (!company) return c.json({ error: 'Company settings not found' }, 500);

  try {
    await sendProposalEmail(c.env, {
      company,
      customer,
      kind: appt.kind,
      orderNumber: (appt.order as Record<string, any> | null)?.order_number,
      dateIso: input.appointment_date,
      time: input.appointment_time,
      token: appt.public_token,
      message: input.message,
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Email send failed' }, 502);
  }

  const isEstimate = appt.kind === 'estimate';
  const { data, error } = await sb
    .from('appointments')
    .update({
      appointment_date: input.appointment_date,
      appointment_time: input.appointment_time,
      status: isEstimate ? 'confirmed' : 'proposed',
      confirmed_at: isEstimate ? new Date().toISOString() : null,
      response_note: '',
      reminder_sent_at: null,
    })
    .eq('id', id)
    .select(APPT_SELECT)
    .single();
  if (error) return c.json({ error: error.message }, 500);

  if (appt.order_id) {
    await logOrderEvent(
      sb,
      appt.order_id,
      `Installation re-proposed for ${input.appointment_date} at ${input.appointment_time}.`
    );
  }
  return c.json({ data });
});

/**
 * Staff-side confirm — the user records that the customer agreed to
 * the time through another channel (phone, text, in person). Unlike
 * the customer's public confirm this works from any non-confirmed
 * status and sends NO email.
 * 404 unknown id · 409 already confirmed.
 */
app.post('/:id/confirm', async (c) => {
  const id = c.req.param('id');
  const sb = createSupabaseAdmin(c.env);
  const { data: appt } = await sb
    .from('appointments')
    .select('id, kind, order_id, status')
    .eq('id', id)
    .maybeSingle();
  if (!appt) return c.json({ error: 'Appointment not found' }, 404);
  if (appt.status === 'confirmed') {
    return c.json({ error: 'This appointment is already confirmed.' }, 409);
  }

  const { data, error } = await sb
    .from('appointments')
    .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
    .eq('id', id)
    .select(APPT_SELECT)
    .single();
  if (error) return c.json({ error: error.message }, 500);

  if (appt.order_id) {
    await logOrderEvent(sb, appt.order_id, 'Installation time confirmed by staff.');
  }
  return c.json({ data });
});

/** Removes a visit from the schedule entirely. */
app.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const sb = createSupabaseAdmin(c.env);
  const { data: existing } = await sb
    .from('appointments')
    .select('id, kind, order_id')
    .eq('id', id)
    .maybeSingle();
  if (!existing) return c.json({ error: 'Appointment not found' }, 404);
  const { error } = await sb.from('appointments').delete().eq('id', id);
  if (error) return c.json({ error: error.message }, 500);
  if (existing.order_id) {
    await logOrderEvent(sb, existing.order_id, 'Installation time cleared.');
  }
  return c.json({ data: { id } });
});

export default app;
