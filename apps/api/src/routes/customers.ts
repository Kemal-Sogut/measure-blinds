// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Customers route group — mounted at `/api/customers` behind `requireAuth`.
 *
 * Endpoints:
 *   GET    /            list (excludes soft-deleted), optional `?q=` search
 *   POST   /            create (Zod-validated)
 *   GET    /:id         single customer (404 if missing or soft-deleted)
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
    first_name: z.string().min(1, 'First name is required').max(100),
    last_name: z.string().min(1, 'Last name is required').max(100),
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

/** Create requires the two name fields; everything else is optional. */
const createSchema = customerSchema.required({ first_name: true, last_name: true });

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

/** Extracts the first user-relevant message from a ZodError. */
function firstZodIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue ? `${issue.path.join('.') || 'payload'}: ${issue.message}` : 'Invalid payload';
}

export default app;
