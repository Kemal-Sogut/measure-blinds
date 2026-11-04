// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Staff Leads route group. It is authenticated, mounted at `/api/leads`
 * behind `requireAuth`.
 *
 * Endpoints:
 *   GET /summary   `{ new_count }` for the sidebar dot and count
 *   GET /          one page of leads, newest first, with optional `?status=`
 *   PUT /:id       `{ status }` (move a lead between new / contacted / archived)
 *
 * Rows are written only by the public form intake (`routes/leadIntake.ts`).
 * Staff never create or edit a lead's submitted details here: the lead is
 * the record of what the visitor typed, and the customer it is linked to is
 * where staff keep the real, editable details.
 *
 * `/summary` is registered before `/:id` (locked Hono pattern: literal
 * routes before param routes in the same group).
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { createSupabaseAdmin } from '../lib/supabase';
import type { AuthVariables } from '../middleware/auth';
import type { Env } from '../index';

const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

/** Leads per page. It is fixed and is not a client parameter. */
export const LEADS_PAGE_SIZE = 20;

/** The statuses `leads.status` accepts (migration 52 CHECK). */
export const LEAD_STATUSES = ['new', 'contacted', 'archived'] as const;

/**
 * `?status=` (one status, or `all`, the default) and `?page=`. The schema is
 * strict, so an unexpected parameter is a 400 rather than being ignored.
 */
const listQuerySchema = z
  .object({
    status: z.enum([...LEAD_STATUSES, 'all']).default('all'),
    page: z.coerce.number().int().min(1).default(1),
  })
  .strict();

/** Body of `PUT /:id`: only the status can change. */
const updateSchema = z.object({ status: z.enum(LEAD_STATUSES) }).strict();

/**
 * Lead columns plus the linked customer's id, name and soft-delete stamp.
 * The Leads page uses those to link to the customer, or to say the
 * customer was deleted.
 */
const LEAD_SELECT =
  'id, status, first_name, last_name, email, phone, street, unit, city, province, postal_code, ' +
  'coverings, window_count, message, consent, source_url, customer_id, customer_match, ' +
  'email_sent_at, created_at, updated_at, ' +
  'customer:customers(id, first_name, last_name, deleted_at)';

/** UUID shape. Junk ids are rejected before the database is touched. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Counts leads still in `new`. The count is exact and reads no rows
 * (`head: true`).
 */
async function countNew(sb: ReturnType<typeof createSupabaseAdmin>) {
  return sb.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'new');
}

/** Number of leads nobody has handled yet. The sidebar polls this. */
app.get('/summary', async (c) => {
  const { count, error } = await countNew(createSupabaseAdmin(c.env));
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ new_count: count ?? 0 });
});

/**
 * One page of leads, newest first. `id` breaks ties so rows never swap
 * between pages. The envelope matches `GET /api/notifications` (`page`,
 * `page_size`, `total`, `total_pages` ≥ 1), plus `new_count` so the filter
 * chips show the backlog without a second request.
 */
app.get('/', async (c) => {
  const parsed = listQuerySchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: 'Invalid filter' }, 400);
  const { status, page } = parsed.data;

  const fromRow = (page - 1) * LEADS_PAGE_SIZE;
  const toRow = fromRow + LEADS_PAGE_SIZE - 1;

  const sb = createSupabaseAdmin(c.env);
  let query = sb.from('leads').select(LEAD_SELECT, { count: 'exact' });
  if (status !== 'all') query = query.eq('status', status);
  const [list, fresh] = await Promise.all([
    query.order('created_at', { ascending: false }).order('id', { ascending: false }).range(fromRow, toRow),
    countNew(sb),
  ]);
  if (list.error) return c.json({ error: list.error.message }, 500);
  if (fresh.error) return c.json({ error: fresh.error.message }, 500);

  const total = list.count ?? 0;
  return c.json({
    data: list.data ?? [],
    page,
    page_size: LEADS_PAGE_SIZE,
    total,
    total_pages: Math.max(1, Math.ceil(total / LEADS_PAGE_SIZE)),
    new_count: fresh.count ?? 0,
  });
});

/** Moves one lead to another status. 404 when the id matches no lead. */
app.put('/:id', async (c) => {
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) return c.json({ error: 'Lead not found' }, 404);
  const parsed = updateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Invalid status' }, 400);

  const { data, error } = await createSupabaseAdmin(c.env)
    .from('leads')
    .update({ status: parsed.data.status })
    .eq('id', id)
    .select(LEAD_SELECT)
    .maybeSingle();
  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: 'Lead not found' }, 404);
  return c.json({ data });
});

export default app;
