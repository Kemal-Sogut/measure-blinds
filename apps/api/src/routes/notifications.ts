// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Staff Alerts feed (authenticated, mounted at `/api/notifications`).
 *
 * Read-only: rows are written by `lib/notifications.ts` from the public
 * confirm / edit-request routes and the e-Transfer webhook. This module
 * only pages through them for the sidebar's Alerts page — newest first,
 * 15 per page, with the same pager envelope as `GET /api/appointments`
 * (`page`, `page_size`, `total`, `total_pages`) so the client renders the
 * pager without a second count request.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { createSupabaseAdmin } from '../lib/supabase';
import type { AuthVariables } from '../middleware/auth';
import type { Env } from '../index';

const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

/** Alerts per page — fixed by product decision, not a client parameter. */
export const NOTIFICATIONS_PAGE_SIZE = 15;

/**
 * `?page=` arrives as a string; coerced and validated so `?page=abc` or
 * `?page=0` is a 400 rather than a query from row NaN. Strict so an
 * unexpected parameter (e.g. a client trying to set its own page size)
 * fails loudly.
 */
const listQuerySchema = z
  .object({ page: z.coerce.number().int().min(1).default(1) })
  .strict();

/**
 * One page of alerts, newest first. `id` breaks ties between events
 * stamped in the same instant so rows never swap between pages.
 * `amount` is numeric in Postgres and arrives as a string from
 * PostgREST, so it is normalised to a number (or null) here.
 */
app.get('/', async (c) => {
  const parsed = listQuerySchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: 'Invalid page' }, 400);
  const { page } = parsed.data;

  const fromRow = (page - 1) * NOTIFICATIONS_PAGE_SIZE;
  const toRow = fromRow + NOTIFICATIONS_PAGE_SIZE - 1;

  const sb = createSupabaseAdmin(c.env);
  const { data, count, error } = await sb
    .from('notifications')
    .select('id, kind, order_id, order_number, customer_name, amount, created_at', {
      count: 'exact',
    })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(fromRow, toRow);
  if (error) return c.json({ error: error.message }, 500);

  const total = count ?? 0;
  return c.json({
    data: (data ?? []).map((n) => ({
      ...n,
      amount: n.amount === null ? null : Number(n.amount),
    })),
    page,
    page_size: NOTIFICATIONS_PAGE_SIZE,
    total,
    total_pages: Math.max(1, Math.ceil(total / NOTIFICATIONS_PAGE_SIZE)),
  });
});

export default app;
