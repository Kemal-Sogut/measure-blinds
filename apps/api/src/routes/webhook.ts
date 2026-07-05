// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * e-Transfer webhook — mounted OUTSIDE the /api/* JWT prefix and
 * protected by a shared bearer secret (ETRANSFER_WEBHOOK_SECRET). A
 * Google Apps Script parses Interac notification emails and POSTs the
 * amount + sender + optional message here.
 *
 * Idempotent: the sender's Gmail message id is stored UNIQUE, so a
 * retried or duplicated email never double-records a payment.
 *
 * Resolution: order number in the message (fast path) → confident
 * customer-name + amount match → otherwise parked as 'pending' for
 * manual assignment in the Record Payment popup.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { createSupabaseAdmin } from '../lib/supabase';
import { recordOrderPayment } from '../lib/payments';
import { resolveOrder } from '../lib/etransferMatch';
import type { Env } from '../index';

const app = new Hono<{ Bindings: Env }>();

const payloadSchema = z
  .object({
    amount: z.number().positive().max(10_000_000),
    sender: z.string().max(200).default(''),
    reference_message: z.string().max(2000).default(''),
    /** ISO string or epoch millis from message.getDate(). */
    timestamp: z.union([z.string(), z.number()]).optional(),
    /** Gmail message id — dedupe key. */
    message_id: z.string().max(200).optional(),
    raw_snippet: z.string().max(4000).default(''),
  })
  .passthrough();

app.post('/etransfer', async (c) => {
  // Shared-secret auth (constant work; the secret must be configured).
  const secret = c.env.ETRANSFER_WEBHOOK_SECRET;
  const auth = c.req.header('Authorization') ?? '';
  if (!secret || auth !== `Bearer ${secret}`) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const parsed = payloadSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Invalid payload' }, 400);
  const p = parsed.data;

  const sb = createSupabaseAdmin(c.env);

  const receivedAt = p.timestamp ? new Date(p.timestamp) : new Date();
  const received_at = Number.isNaN(receivedAt.getTime())
    ? new Date().toISOString()
    : receivedAt.toISOString();
  const paid_on = received_at.slice(0, 10);

  // Idempotency: skip an email we've already ingested.
  if (p.message_id) {
    const { data: dup } = await sb
      .from('etransfers')
      .select('id, status')
      .eq('gmail_message_id', p.message_id)
      .maybeSingle();
    if (dup) return c.json({ status: 'duplicate', id: dup.id });
  }

  const base = {
    gmail_message_id: p.message_id ?? null,
    amount: p.amount,
    sender: p.sender,
    reference_message: p.reference_message,
    received_at,
    raw_snippet: p.raw_snippet,
  };

  const match = await resolveOrder(sb, p.amount, p.sender, p.reference_message);
  if (match) {
    const note = `e-Transfer${p.sender ? ` from ${p.sender}` : ''}`;
    const result = await recordOrderPayment(sb, match.id, match.status, {
      amount: p.amount,
      paid_on,
      note,
    });
    if ('paymentId' in result) {
      await sb
        .from('etransfers')
        .insert({ ...base, status: 'applied', order_id: match.id, payment_id: result.paymentId });
      return c.json({ status: 'applied', order_id: match.id, order_number: match.order_number });
    }
    // Recording failed → fall through and park it for manual handling.
  }

  const { error } = await sb.from('etransfers').insert({ ...base, status: 'pending' });
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ status: 'pending' });
});

export default app;
