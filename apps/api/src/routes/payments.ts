// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Payment reconciliation endpoints (authenticated). Surfaces the
 * e-Transfers that arrived but couldn't be auto-matched to an order, so
 * the Record Payment popup can show them and let a consultant apply or
 * dismiss each one. Applying happens through the order's normal
 * POST /:id/payments route (which links the e-Transfer when given its
 * id); this module only lists the pending inbox and dismisses entries.
 */

import { Hono } from 'hono';
import { createSupabaseAdmin } from '../lib/supabase';
import type { AuthVariables } from '../middleware/auth';
import type { Env } from '../index';

const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

/** Lists unmatched e-Transfers awaiting manual assignment, newest first. */
app.get('/pending', async (c) => {
  const sb = createSupabaseAdmin(c.env);
  const { data, error } = await sb
    .from('etransfers')
    .select('id, amount, sender, reference_message, received_at, raw_snippet')
    .eq('status', 'pending')
    .order('received_at', { ascending: false });
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ data });
});

/** Dismisses a pending e-Transfer (e.g. a duplicate or a refund). */
app.post('/:id/dismiss', async (c) => {
  const sb = createSupabaseAdmin(c.env);
  const { data, error } = await sb
    .from('etransfers')
    .update({ status: 'dismissed' })
    .eq('id', c.req.param('id'))
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: 'Not found' }, 404);
  return c.json({ data: { id: data.id } });
});

export default app;
