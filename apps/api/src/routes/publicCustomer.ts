// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Public customer link — `GET /public/customer/:token` (spec 2026-10-20).
 *
 * Lists everything a customer may currently act on: live estimates and
 * confirmed orders (rules in `lib/customerPortal`). Each item carries the
 * order's own public token, so the web detail view reuses the existing
 * `/public/estimate/:token` routes for confirm, edit requests and
 * cancellation; this route grants nothing those per-estimate links did
 * not already grant the same customer.
 *
 * Mounted by `public.ts` under `/customer`, AFTER its rate limiter and
 * maintenance gate, so both apply here unchanged. Unknown and malformed
 * tokens get the same 404 wording as the estimate routes, so nothing
 * leaks about which tokens exist.
 */

import { Hono } from 'hono';
import { createSupabaseAdmin } from '../lib/supabase';
import { ensureOrderToken } from '../lib/customerLink';
import {
  PORTAL_STATUSES,
  isPortalVisible,
  toPortalItem,
  type PortalItem,
  type PortalOrderRow,
} from '../lib/customerPortal';
import type { Env } from '../index';

const app = new Hono<{ Bindings: Env }>();

const TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND = 'Estimate not found';

/** The customer's visible estimates and orders, newest first. */
app.get('/:token', async (c) => {
  const token = c.req.param('token');
  if (!TOKEN_RE.test(token)) return c.json({ error: NOT_FOUND }, 404);

  const sb = createSupabaseAdmin(c.env);
  const { data: customer } = await sb
    .from('customers')
    .select('id, first_name')
    .eq('public_token', token)
    .is('deleted_at', null)
    .maybeSingle();
  if (!customer) return c.json({ error: NOT_FOUND }, 404);

  const { data: rows, error } = await sb
    .from('orders')
    .select(
      'id, order_number, title, status, order_date, expiry_date, total, public_token, payments(amount)'
    )
    .eq('customer_id', customer.id)
    .in('status', [...PORTAL_STATUSES])
    .order('order_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) return c.json({ error: error.message }, 500);

  const today = new Date().toISOString().slice(0, 10);
  const items: PortalItem[] = [];
  try {
    for (const row of (rows ?? []) as PortalOrderRow[]) {
      if (!isPortalVisible(row, today)) continue;
      items.push(toPortalItem(row, await ensureOrderToken(sb, row.id, row.public_token)));
    }
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Could not load your estimates.' }, 500);
  }

  const { data: company } = await sb
    .from('company_settings')
    .select('company_name, logo_url, email, phone')
    .eq('id', 1)
    .single();

  return c.json({
    data: {
      company: {
        company_name: company?.company_name ?? '',
        logo_url: company?.logo_url ?? null,
        email: company?.email ?? '',
        phone: company?.phone ?? '',
      },
      customer: { first_name: (customer.first_name as string | null) ?? '' },
      items,
    },
  });
});

export default app;
