// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Public website lead intake, mounted at `/intake` with NO authentication.
 * Posted to by the embeddable "Free Estimate" form
 * (`apps/web/public/embed/lead-form.js`) from the WordPress site.
 *
 * Endpoint:
 *   POST /lead   validate → bot checks → find-or-create customer →
 *                insert lead → Notifications row → shop email
 *
 * Why it is NOT under `/public`: that group's maintenance gate answers 503
 * while staff have the customer pages in maintenance, and a new
 * customer's estimate request must never be turned away because of it.
 *
 * Abuse controls, none of which need any account set up (spec D2):
 *   - `rateLimit(INTAKE_RATE_LIMIT)` per IP (per isolate; see its header).
 *   - honeypot + minimum fill time (`looksLikeBot`). A bot gets the SAME
 *     201 a person gets, so it has nothing to tune against, and nothing
 *     is stored.
 *   - Turnstile, only when `TURNSTILE_SECRET` is set (403 on a bad token).
 *
 * Order of writes: customer first, then the lead row carrying its
 * `customer_id`, then the best-effort alerts. That is persist-then-alert:
 * the alert announces a row that already exists, and the alert failing never
 * loses the lead. A failure in the customer or lead write is a 500, and the
 * form then tells the visitor to call.
 *
 * The success body is a constant `{ ok: true }`. It never says whether the
 * email matched an existing customer, and it never returns ids, so the form
 * cannot be used to probe the customer list.
 *
 * CORS for this group is set in `index.ts` (any origin, no credentials).
 */

import { Hono } from 'hono';
import { createSupabaseAdmin } from '../lib/supabase';
import { rateLimit } from '../middleware/rateLimit';
import { leadInputSchema, looksLikeBot } from '../lib/leadSchema';
import { findOrCreateLeadCustomer, formatLeadPhone, formatPostal } from '../lib/leadCustomer';
import { sendLeadNotice } from '../lib/leadAlerts';
import { recordNotification } from '../lib/notifications';
import { verifyTurnstile } from '../lib/turnstile';
import type { Env } from '../index';

const app = new Hono<{ Bindings: Env }>();

/**
 * Submissions per IP per minute. A visitor who mistypes and resubmits needs
 * two or three. Note that `rateLimit`'s counters are shared per IP across
 * every group that uses it (one module-level map), so `/public` traffic
 * from the same IP counts toward this budget too.
 */
export const INTAKE_RATE_LIMIT = 5;

/** The success body, identical for people, bots and matched or new customers. */
const OK = { ok: true } as const;

app.use('*', rateLimit(INTAKE_RATE_LIMIT, 60_000));

/** Accepts one lead from the website form. See the module header for the flow. */
app.post('/lead', async (c) => {
  const parsed = leadInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.join('.') || 'body';
    return c.json({ error: issue?.message ?? 'Invalid request', field }, 400);
  }
  const lead = parsed.data;

  if (looksLikeBot(lead)) return c.json(OK, 201);

  const secret = c.env.TURNSTILE_SECRET?.trim();
  if (secret) {
    const ok = await verifyTurnstile(secret, lead.turnstile_token, c.req.header('CF-Connecting-IP'));
    if (!ok) return c.json({ error: 'Verification failed' }, 403);
  }

  const sb = createSupabaseAdmin(c.env);

  let customer: Awaited<ReturnType<typeof findOrCreateLeadCustomer>>;
  try {
    customer = await findOrCreateLeadCustomer(sb, lead);
  } catch (e) {
    console.error('Lead intake:', e);
    return c.json({ error: 'Could not save your request' }, 500);
  }

  const { data: row, error } = await sb
    .from('leads')
    .insert({
      first_name: lead.first_name,
      last_name: lead.last_name,
      email: lead.email,
      phone: formatLeadPhone(lead.phone),
      street: lead.street,
      unit: lead.unit,
      city: lead.city,
      province: lead.province,
      postal_code: formatPostal(lead.postal_code),
      coverings: lead.coverings,
      window_count: lead.window_count,
      message: lead.message,
      consent: lead.consent,
      source_url: lead.source_url,
      customer_id: customer.customerId,
      customer_match: customer.match,
    })
    .select('id')
    .single();
  if (error || !row) {
    console.error('Lead intake: lead insert failed:', error?.message);
    return c.json({ error: 'Could not save your request' }, 500);
  }
  const leadId = (row as { id: string }).id;

  await recordNotification(sb, {
    kind: 'lead_received',
    leadId,
    customerName: `${lead.first_name} ${lead.last_name}`.trim(),
    subject: lead.city,
  });
  await sendLeadNotice(c.env, sb, leadId, { lead, customerId: customer.customerId, match: customer.match });

  return c.json(OK, 201);
});

export default app;
