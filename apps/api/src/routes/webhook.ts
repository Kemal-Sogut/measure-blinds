// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * e-Transfer webhook — mounted OUTSIDE the /api/* JWT prefix and
 * protected by a shared bearer secret (ETRANSFER_WEBHOOK_SECRET). A
 * Google Apps Script parses Interac notification emails and POSTs the
 * amount + sender + optional message here.
 *
 * Idempotent, and the ORDER of writes is what makes it so: the
 * `etransfers` row is inserted FIRST, and its UNIQUE Gmail message id is
 * the lock. A second delivery of the same email fails that insert
 * (23505) and stops before any payment is recorded. Recording the
 * payment first and the dedupe row second — the previous order — let
 * two concurrent deliveries each record a payment.
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
import { issueWarrantyIfPaid } from '../lib/warrantyIssue';
import { recordNotification } from '../lib/notifications';
import { secretsMatch } from '../lib/secretCompare';
import { torontoDateISO } from '../lib/timeText';
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
  // Shared-secret auth; the secret must be configured.
  const secret = c.env.ETRANSFER_WEBHOOK_SECRET;
  const auth = c.req.header('Authorization') ?? '';
  if (!secret || !(await secretsMatch(auth, `Bearer ${secret}`))) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const parsed = payloadSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Invalid payload' }, 400);
  const p = parsed.data;

  const sb = createSupabaseAdmin(c.env);

  const parsedAt = p.timestamp ? new Date(p.timestamp) : new Date();
  const receivedAt = Number.isNaN(parsedAt.getTime()) ? new Date() : parsedAt;
  // The date the customer paid, on the shop's calendar: an evening
  // transfer in Toronto is already "tomorrow" in UTC.
  const paid_on = torontoDateISO(0, receivedAt);

  // Claim the email FIRST (see the module header). Everything below runs
  // only for the one request that wins this insert.
  const { data: claim, error: claimError } = await sb
    .from('etransfers')
    .insert({
      gmail_message_id: p.message_id ?? null,
      amount: p.amount,
      sender: p.sender,
      reference_message: p.reference_message,
      received_at: receivedAt.toISOString(),
      raw_snippet: p.raw_snippet,
      status: 'pending',
    })
    .select('id')
    .single();
  if (claimError || !claim) {
    if (claimError?.code === '23505') return c.json({ status: 'duplicate' });
    // Non-2xx on purpose: nothing was stored, so the script must retry.
    console.error('e-Transfer ingest: could not store the transfer:', claimError?.message);
    return c.json({ error: 'Could not store the transfer' }, 500);
  }
  const etransferId = String((claim as { id: string }).id);

  const match = await resolveOrder(sb, p.amount, p.sender, p.reference_message);
  if (match) {
    const note = `e-Transfer${p.sender ? ` from ${p.sender}` : ''}`;
    const result = await recordOrderPayment(sb, match.id, match.status, {
      amount: p.amount,
      paid_on,
      note,
    });
    if ('paymentId' in result) {
      const { error: linkError } = await sb
        .from('etransfers')
        .update({ status: 'applied', order_id: match.id, payment_id: result.paymentId })
        .eq('id', etransferId);
      if (linkError) {
        // The money IS recorded; only the inbox row is out of date. Say
        // so on the order, where staff will see it, rather than failing
        // the request and inviting a retry of an applied transfer.
        await sb.from('order_logs').insert({
          order_id: match.id,
          message:
            `An e-Transfer of $${p.amount.toFixed(2)} was recorded automatically but is still listed as pending — ` +
            'dismiss it in the pending e-Transfers list; do not apply it again.',
        });
      }

      // Staff alert. No order_id on purpose: payment alerts do not link,
      // and must outlive the order (see migration 43).
      await recordNotification(sb, {
        kind: 'etransfer_received',
        orderNumber: match.order_number,
        customerName: p.sender,
        amount: p.amount,
      });

      // Same side effect the staff payment route applies: an e-Transfer
      // that settles the order issues the warranty. Never fatal — the
      // Apps Script must not retry an applied transfer because an email
      // bounced, so a failure is only recorded on the activity trail.
      const warranty = await issueWarrantyIfPaid(sb, c.env, match.id);
      if (warranty.status === 'failed') {
        await sb.from('order_logs').insert({
          order_id: match.id,
          message: `Warranty email failed: ${warranty.message}`,
        });
      }

      return c.json({ status: 'applied', order_id: match.id, order_number: match.order_number });
    }
    // Recording failed → the row stays pending for manual handling.
  }

  await recordNotification(sb, {
    kind: 'etransfer_received',
    customerName: p.sender,
    amount: p.amount,
  });
  return c.json({ status: 'pending' });
});

export default app;
