// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Customers route group — mounted at `/api/customers` behind `requireAuth`.
 *
 * Endpoints:
 *   GET    /            list (excludes soft-deleted), optional `?q=` search
 *   POST   /            create (Zod-validated)
 *   GET    /:id         single customer (404 if missing or soft-deleted)
 *   GET    /:id/sendable-estimates  estimates eligible for the multi-estimate send
 *   POST   /:id/send-estimates      emails one link covering several estimates
 *   PUT    /:id         partial update (Zod-validated)
 *   DELETE /:id         soft delete — sets `deleted_at`, keeps history
 *
 * Search uses PostgreSQL ILIKE across name, email, phone, and shipping
 * address fields. The user's term is sanitized before being embedded
 * in the PostgREST `or()` filter so special characters (commas,
 * parentheses, wildcards) cannot break out of the expression.
 *
 * Soft delete keeps estimate → customer references intact forever;
 * deleted customers simply stop appearing in lists and lookups.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { createSupabaseAdmin } from '../lib/supabase';
import { ensureCustomerToken } from '../lib/customerLink';
import { runEstimateSend } from '../lib/estimateSend';
import type { AuthVariables } from '../middleware/auth';
import type { Env } from '../index';

const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

/** Maximum rows returned by the list endpoint. */
const LIST_LIMIT = 100;

/** Address block fields shared by shipping and billing. */
const addressFields = {
  address_line1: z.string().max(200),
  address_line2: z.string().max(200),
  city: z.string().max(100),
  province: z.string().max(50),
  postal_code: z.string().max(20),
};

/** Full customer payload schema; PUT uses `.partial()` of this. */
const customerSchema = z
  .object({
    first_name: z.string().max(100),
    last_name: z.string().max(100),
    email: z.string().email().or(z.literal('')),
    phone: z.string().max(50),
    shipping_address_line1: addressFields.address_line1,
    shipping_address_line2: addressFields.address_line2,
    shipping_city: addressFields.city,
    shipping_province: addressFields.province,
    shipping_postal_code: addressFields.postal_code,
    billing_same_as_shipping: z.boolean(),
    billing_address_line1: addressFields.address_line1,
    billing_address_line2: addressFields.address_line2,
    billing_city: addressFields.city,
    billing_province: addressFields.province,
    billing_postal_code: addressFields.postal_code,
  })
  .partial()
  .strict();

/**
 * Create requires no single field, but refuses a wholly anonymous row:
 * at least one of name / email / phone must be present, or the customer
 * is unsearchable, un-emailable, and indistinguishable from every other
 * blank record in the list.
 *
 * Names became optional on 2026-08-01 — a customer met on site is often
 * just a phone number, and inventing a placeholder name to satisfy the
 * form made those rows harder to find later, not easier.
 *
 * The UPDATE schema (`customerSchema` itself, already `.partial()`) is
 * deliberately NOT refined: an address-only PATCH must not be forced to
 * restate an identifier it is not touching.
 */
const createSchema = customerSchema.refine(
  (v) => Boolean(v.first_name?.trim() || v.last_name?.trim() || v.email?.trim() || v.phone?.trim()),
  { message: 'Enter a name, email or phone number.' }
);

/**
 * Hard cap on the ids one send may carry — a request-size guard, not a
 * product rule. The picker dialog imposes NO selection limit of its own, so
 * a customer holding more than this many live estimates could tick past the
 * cap and be refused; that is accepted because no real customer approaches
 * it, and the cap is what keeps one request from fanning out into an
 * unbounded number of row writes and token mints.
 */
const MAX_SEND_ESTIMATES = 20;

/**
 * Body of `POST /:id/send-estimates`.
 *
 * `.strict()` is load-bearing (AI_GUIDELINES §1): this route freezes
 * prices, so a client-supplied money field such as `total` must be
 * REJECTED with a 400, never silently stripped. Nothing but the ids and
 * an optional note is accepted — the estimates' figures are the server's.
 *
 * The duplicate check is a whole-object refinement rather than an array
 * one so its issue path stays empty and `firstZodIssue` returns the
 * sentence verbatim, as it does for `createSchema`.
 */
const sendEstimatesSchema = z
  .object({
    order_ids: z.array(z.string().uuid()).min(1).max(MAX_SEND_ESTIMATES),
    message: z.string().max(1000).optional(),
  })
  .strict()
  .refine((v) => new Set(v.order_ids).size === v.order_ids.length, {
    message: 'Select each estimate only once.',
  });

/**
 * Strips characters that have structural meaning inside a PostgREST
 * `or()` filter (commas, parens, dots chain separators) and ILIKE
 * wildcards, leaving a safe literal search term.
 */
function sanitizeSearchTerm(q: string): string {
  return q.replace(/[,().%*\\]/g, ' ').trim().slice(0, 100);
}

/** Lists customers, optionally filtered by a `?q=` search term. */
app.get('/', async (c) => {
  const sb = createSupabaseAdmin(c.env);
  let query = sb
    .from('customers')
    .select('*')
    .is('deleted_at', null)
    .order('last_name')
    .order('first_name')
    .limit(LIST_LIMIT);

  const q = sanitizeSearchTerm(c.req.query('q') ?? '');
  if (q) {
    const like = `%${q}%`;
    query = query.or(
      [
        `first_name.ilike.${like}`,
        `last_name.ilike.${like}`,
        `email.ilike.${like}`,
        `phone.ilike.${like}`,
        `shipping_address_line1.ilike.${like}`,
        `shipping_city.ilike.${like}`,
      ].join(',')
    );
  }

  const { data, error } = await query;
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ data });
});

/** Creates a customer. */
app.post('/', async (c) => {
  const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: firstZodIssue(parsed.error) }, 400);
  const sb = createSupabaseAdmin(c.env);
  const { data, error } = await sb.from('customers').insert(parsed.data).select().single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ data }, 201);
});

/** Returns one customer; 404 when missing or soft-deleted. */
app.get('/:id', async (c) => {
  const sb = createSupabaseAdmin(c.env);
  const { data, error } = await sb
    .from('customers')
    .select('*')
    .eq('id', c.req.param('id'))
    .is('deleted_at', null)
    .maybeSingle();
  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: 'Customer not found' }, 404);
  return c.json({ data });
});

/**
 * Returns the customer's link token (`/c/:token`), minting it on first
 * use — backs "Copy customer link" on the Estimates page's customer
 * groups. Idempotent: an existing token is returned untouched, so links
 * already shared keep working. 404 for an unknown customer.
 */
app.post('/:id/public-link', async (c) => {
  const sb = createSupabaseAdmin(c.env);
  try {
    const token = await ensureCustomerToken(sb, c.req.param('id'));
    if (!token) return c.json({ error: 'Customer not found' }, 404);
    return c.json({ data: { public_token: token } });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Could not create the link' }, 500);
  }
});

/**
 * Lists the customer's estimates that can be emailed right now — backs the
 * picker dialog of "Send estimates". An estimate is sendable when it
 * belongs to this customer, is still `draft` or `sent`, has not expired
 * (`expiry_date >= today`, compared as `YYYY-MM-DD` strings) and holds at
 * least one line item. The item filter runs in code over a `line_items(id)`
 * embed because PostgREST cannot filter on an embedded count; the embed is
 * an eligibility input only and is NOT part of the payload, and it is read
 * defensively (`row.line_items ?? []`) exactly as `estimateSend.ts` reads
 * the same embed, since PostgREST omits the key rather than returning `[]`
 * when the relationship resolves to nothing. Newest-created
 * first. 404 for an unknown or soft-deleted customer — checked before the
 * list so a bad id never reads as "no estimates". `total` is coerced to a
 * number because PostgREST returns numerics as strings.
 */
app.get('/:id/sendable-estimates', async (c) => {
  const sb = createSupabaseAdmin(c.env);
  const customerId = c.req.param('id');

  const { data: customer, error: customerError } = await sb
    .from('customers')
    .select('id')
    .eq('id', customerId)
    .is('deleted_at', null)
    .maybeSingle();
  if (customerError) return c.json({ error: customerError.message }, 500);
  if (!customer) return c.json({ error: 'Customer not found' }, 404);

  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await sb
    .from('orders')
    .select('id, order_number, title, status, order_date, expiry_date, total, line_items(id)')
    .eq('customer_id', customerId)
    .in('status', ['draft', 'sent'])
    .gte('expiry_date', today)
    .order('created_at', { ascending: false });
  if (error) return c.json({ error: error.message }, 500);

  const estimates = (data ?? [])
    .filter((row) => (row.line_items ?? []).length > 0)
    .map((row) => ({
      id: row.id,
      order_number: row.order_number,
      title: row.title,
      status: row.status,
      order_date: row.order_date,
      expiry_date: row.expiry_date,
      total: Number(row.total),
    }));
  return c.json({ data: estimates });
});

/**
 * Emails the customer ONE link covering the selected estimates and marks
 * every selected draft as sent — the replacement for the per-order
 * `POST /api/orders/:id/send`.
 *
 * The handler itself only parses and responds: the whole sequence (read,
 * validate the selection, mint tokens, send, then write) lives in
 * `lib/estimateSend.ts`, which owns the ordering rules that make the send
 * safe (AI_GUIDELINES §2 and §6). Statuses are written ONLY after the
 * email succeeds, so a provider failure is a 502 with no database write.
 *
 * A non-empty `failed` still answers 200: the customer already holds the
 * email, so the response tells the consultant which rows did not get
 * marked rather than pretending nothing happened.
 */
app.post('/:id/send-estimates', async (c) => {
  const parsed = sendEstimatesSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: firstZodIssue(parsed.error) }, 400);
  const sb = createSupabaseAdmin(c.env);
  const result = await runEstimateSend(sb, c.env, c.req.param('id'), parsed.data);
  if ('error' in result) return c.json({ error: result.error }, result.status);
  return c.json(result);
});

/** Partially updates a customer. */
app.put('/:id', async (c) => {
  const parsed = customerSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: firstZodIssue(parsed.error) }, 400);
  const sb = createSupabaseAdmin(c.env);
  const { data, error } = await sb
    .from('customers')
    .update(parsed.data)
    .eq('id', c.req.param('id'))
    .is('deleted_at', null)
    .select()
    .maybeSingle();
  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: 'Customer not found' }, 404);
  return c.json({ data });
});

/** Soft-deletes a customer (sets deleted_at, preserves estimates). */
app.delete('/:id', async (c) => {
  const sb = createSupabaseAdmin(c.env);
  const { data, error } = await sb
    .from('customers')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', c.req.param('id'))
    .is('deleted_at', null)
    .select('id')
    .maybeSingle();
  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: 'Customer not found' }, 404);
  return c.json({ data: { id: data.id } });
});

/**
 * Extracts the first user-relevant message from a ZodError.
 *
 * Field issues are prefixed with the field name, which is what makes a
 * 400 actionable. Whole-object refinements (see `createSchema`) carry an
 * EMPTY path, and their messages are already written as complete
 * sentences for the user — prefixing those with a synthetic "payload:"
 * would only add noise, so they are returned verbatim.
 */
function firstZodIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid payload';
  const path = issue.path.join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}

export default app;
