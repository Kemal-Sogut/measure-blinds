// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Print-agent routes — mounted at /agent, deliberately OUTSIDE the
 * /api/* JWT prefix.
 *
 * The consumer is a headless Node process on a shop PC with no Supabase
 * session and no way to obtain one, so it authenticates with a shared
 * bearer secret (PRINT_AGENT_SECRET) exactly the way routes/webhook.ts
 * does. A Worker with no secret configured rejects everything: this
 * path hands out rendered print jobs, so it must fail closed.
 *
 * DIRECTION: the API is a Cloudflare Worker and cannot open a
 * connection into the shop LAN, so the agent polls. `GET next` claims
 * at most one job and answers 204 the vast majority of the time — at a
 * 30-second interval that is ~2,880 requests a day for a handful of
 * prints. Cheap, and it survives NAT, Wi-Fi drops, and a printer that
 * is switched off.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { Context } from 'hono';
import { createSupabaseAdmin } from '../lib/supabase';
import type { Env } from '../index';

const app = new Hono<{ Bindings: Env }>();

/** Body for the agent's completion report. */
const resultSchema = z
  .object({ ok: z.boolean(), error: z.string().max(2000).optional() })
  .strict();

/**
 * Shared-secret check. Returns false when the binding is unset so an
 * unconfigured Worker cannot be polled by anyone.
 */
function authorized(c: Context<{ Bindings: Env }>): boolean {
  const secret = c.env.PRINT_AGENT_SECRET;
  const auth = c.req.header('Authorization') ?? '';
  return Boolean(secret) && auth === `Bearer ${secret}`;
}

/**
 * Claims the oldest waiting job and hands the agent its TSPL payload.
 *
 * Claiming is the `claim_print_job()` RPC rather than a PostgREST
 * update because two agent instances racing on the same row would print
 * the same labels twice; the RPC uses FOR UPDATE SKIP LOCKED and also
 * re-queues jobs whose agent died mid-print.
 *
 * 204 means the queue is empty — the normal answer.
 */
app.get('/print-jobs/next', async (c) => {
  if (!authorized(c)) return c.json({ error: 'Unauthorized' }, 401);

  const sb = createSupabaseAdmin(c.env);
  const { data, error } = await sb.rpc('claim_print_job');
  if (error) return c.json({ error: error.message }, 500);

  const job = Array.isArray(data) ? data[0] : null;
  if (!job) return c.body(null, 204);
  return c.json({ data: job });
});

/**
 * Records the outcome of a claimed job.
 *
 * The update is filtered on `status = 'printing'`, so a report that
 * arrives twice — the agent retried after a network blip — is a no-op
 * the second time rather than a state corruption. The response is 200
 * either way; the agent has nothing useful to do with the difference.
 */
app.post('/print-jobs/:id/result', async (c) => {
  if (!authorized(c)) return c.json({ error: 'Unauthorized' }, 401);

  const parsed = resultSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'Body must be { ok: boolean, error?: string }.' }, 400);
  }

  const sb = createSupabaseAdmin(c.env);
  const status = parsed.data.ok ? 'done' : 'failed';
  const last_error = parsed.data.ok ? '' : (parsed.data.error ?? '').slice(0, 500);

  const { error } = await sb
    .from('print_jobs')
    .update({ status, last_error })
    .eq('id', c.req.param('id'))
    .eq('status', 'printing');
  if (error) return c.json({ error: error.message }, 500);

  return c.json({ data: { status } });
});

export default app;
