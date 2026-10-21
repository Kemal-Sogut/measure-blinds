// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Staff Inbox API (authenticated, mounted at `/api/inbox`).
 *
 * Reads the conversations the inbox cron (`lib/inbox/run.ts`) stores,
 * lets staff triage them (category, customer/order link, New/Handled),
 * and manages the filter rules (Settings → Email Rules). Nothing here
 * talks to Titan: the app never changes the mailbox.
 *
 * Route order matters (locked Hono pattern): every literal path —
 * `/rules`, `/rules/reorder`, `/rules/reapply`, `/status`, `/unread` — is
 * registered before `/:threadId`. Ids are checked as UUIDs up front so
 * a bad id is a 404, not a Postgres cast error.
 *
 * Unread: the sync marks a conversation unread when an incoming email
 * arrives; `POST /:threadId/read` (sent when staff open it) clears it, and
 * `GET /unread` counts unread conversations per category for the dots.
 *
 * Thread updates: picking a category by hand sets `category_locked`
 * (Re-apply rules then leaves the thread alone); `handled` stamps
 * `handled_at`; linking an order also links that order's customer;
 * changing or clearing the customer clears the order.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { createSupabaseAdmin } from '../lib/supabase';
import { EMAIL_CATEGORIES, type EmailCategory } from '../lib/inbox/types';
import { RULE_ACTIONS, RULE_FIELDS, RULE_MATCH_TYPES, classify, type EmailRule } from '../lib/inbox/rules';
import type { AuthVariables } from '../middleware/auth';
import type { Env } from '../index';

const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

/** Conversations per page — fixed, like the Notifications page. */
export const INBOX_PAGE_SIZE = 15;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Batch size for `in()` filters, keeping request URLs short. */
const ID_CHUNK = 200;

/**
 * `?category=&status=&page=` for the conversation list. `category=all`
 * (the default, the Inbox's first tab) lists every category together.
 */
const listQuerySchema = z
  .object({
    category: z.enum([...EMAIL_CATEGORIES, 'all']).default('all'),
    status: z.enum(['new', 'handled']).default('new'),
    page: z.coerce.number().int().min(1).default(1),
  })
  .strict();

/** A new rule. Position is assigned by the server (appended last). */
const ruleSchema = z
  .object({
    field: z.enum(RULE_FIELDS),
    match_type: z.enum(RULE_MATCH_TYPES),
    value: z.string().trim().min(1).max(200),
    action: z.enum(RULE_ACTIONS),
    enabled: z.boolean().default(true),
  })
  .strict();

/** Any non-empty subset of a rule's editable fields. */
const ruleUpdateSchema = z
  .object({
    field: z.enum(RULE_FIELDS).optional(),
    match_type: z.enum(RULE_MATCH_TYPES).optional(),
    value: z.string().trim().min(1).max(200).optional(),
    action: z.enum(RULE_ACTIONS).optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

/** The full rule order, first rule first. */
const reorderSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }).strict();

/** Any non-empty subset of a thread's triage fields. */
const threadUpdateSchema = z
  .object({
    category: z.enum(EMAIL_CATEGORIES).optional(),
    customer_id: z.string().uuid().nullable().optional(),
    order_id: z.string().uuid().nullable().optional(),
    status: z.enum(['new', 'handled']).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

/** First Zod issue as "path: message" (same wording as the other route groups). */
function firstZodIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid payload';
  const path = issue.path.join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}

/** Splits ids into `in()`-sized batches. */
function chunks<T>(items: T[], size = ID_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** All rules, first-match order. */
app.get('/rules', async (c) => {
  const sb = createSupabaseAdmin(c.env);
  const { data, error } = await sb
    .from('email_rules')
    .select('id, position, field, match_type, value, action, enabled, created_at, updated_at')
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ data: data ?? [] });
});

/** Creates a rule at the end of the list. */
app.post('/rules', async (c) => {
  const parsed = ruleSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: firstZodIssue(parsed.error) }, 400);
  const sb = createSupabaseAdmin(c.env);
  const { data: last, error: lastError } = await sb
    .from('email_rules')
    .select('position')
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastError) return c.json({ error: lastError.message }, 500);
  const { data, error } = await sb
    .from('email_rules')
    .insert({ ...parsed.data, position: ((last?.position as number | undefined) ?? -1) + 1 })
    .select('id, position, field, match_type, value, action, enabled, created_at, updated_at')
    .single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ data }, 201);
});

/** Sets every listed rule's position to its index. */
app.post('/rules/reorder', async (c) => {
  const parsed = reorderSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: firstZodIssue(parsed.error) }, 400);
  const sb = createSupabaseAdmin(c.env);
  for (const [index, id] of parsed.data.ids.entries()) {
    const { error } = await sb.from('email_rules').update({ position: index }).eq('id', id);
    if (error) return c.json({ error: error.message }, 500);
  }
  return c.json({ data: { ok: true } });
});

/**
 * Re-classifies every unlocked thread with the current enabled rules
 * (an `ignore` verdict becomes `other`: stored mail is never deleted).
 * First-message bodies are loaded only when some rule tests the body.
 */
app.post('/rules/reapply', async (c) => {
  const sb = createSupabaseAdmin(c.env);
  const { data: rules, error: rulesError } = await sb
    .from('email_rules')
    .select('id, position, field, match_type, value, action, enabled')
    .eq('enabled', true)
    .order('position', { ascending: true });
  if (rulesError) return c.json({ error: rulesError.message }, 500);
  const { data: threads, error: threadsError } = await sb
    .from('email_threads')
    .select('id, subject, counterpart_address, category')
    .eq('category_locked', false);
  if (threadsError) return c.json({ error: threadsError.message }, 500);

  const ruleList = (rules ?? []) as EmailRule[];
  const threadList = (threads ?? []) as Array<{ id: string; subject: string; counterpart_address: string; category: EmailCategory }>;

  const firstBody = new Map<string, string>();
  if (ruleList.some((r) => r.field === 'body')) {
    for (const batch of chunks(threadList.map((t) => t.id))) {
      const { data: messages, error } = await sb
        .from('email_messages')
        .select('thread_id, reply_text, sent_at')
        .in('thread_id', batch)
        .order('sent_at', { ascending: true });
      if (error) return c.json({ error: error.message }, 500);
      for (const m of messages ?? []) {
        if (!firstBody.has(m.thread_id as string)) firstBody.set(m.thread_id as string, m.reply_text as string);
      }
    }
  }

  const moves = new Map<EmailCategory, string[]>();
  for (const t of threadList) {
    const verdict = classify(
      { counterpart: t.counterpart_address, subject: t.subject, body: firstBody.get(t.id) ?? '' },
      ruleList
    );
    const category: EmailCategory = verdict.action === 'ignore' ? 'other' : verdict.category;
    if (category !== t.category) moves.set(category, [...(moves.get(category) ?? []), t.id]);
  }

  let changed = 0;
  for (const [category, ids] of moves) {
    for (const batch of chunks(ids)) {
      const { error } = await sb.from('email_threads').update({ category }).in('id', batch);
      if (error) return c.json({ error: error.message }, 500);
      changed += batch.length;
    }
  }
  return c.json({ data: { changed } });
});

/** Edits one rule. */
app.put('/rules/:ruleId', async (c) => {
  const id = c.req.param('ruleId');
  if (!UUID_RE.test(id)) return c.json({ error: 'Rule not found' }, 404);
  const parsed = ruleUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: firstZodIssue(parsed.error) }, 400);
  const sb = createSupabaseAdmin(c.env);
  const { data, error } = await sb
    .from('email_rules')
    .update(parsed.data)
    .eq('id', id)
    .select('id, position, field, match_type, value, action, enabled, created_at, updated_at')
    .maybeSingle();
  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: 'Rule not found' }, 404);
  return c.json({ data });
});

/** Deletes one rule. */
app.delete('/rules/:ruleId', async (c) => {
  const id = c.req.param('ruleId');
  if (!UUID_RE.test(id)) return c.json({ error: 'Rule not found' }, 404);
  const sb = createSupabaseAdmin(c.env);
  const { data, error } = await sb.from('email_rules').delete().eq('id', id).select('id').maybeSingle();
  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: 'Rule not found' }, 404);
  return c.json({ data });
});

/** Per-folder sync health for the Settings page. */
app.get('/status', async (c) => {
  const sb = createSupabaseAdmin(c.env);
  const { data, error } = await sb
    .from('email_sync_state')
    .select('folder, folder_name, last_run_at, last_success_at, last_error')
    .order('folder', { ascending: true });
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ data: data ?? [] });
});

/**
 * Unread conversations per category (any status) plus the total — drives
 * the dots on the Inbox tabs and on the sidebar's Inbox item. Reads only
 * unread rows (partial index `email_threads_unread_idx`).
 */
app.get('/unread', async (c) => {
  const sb = createSupabaseAdmin(c.env);
  const { data, error } = await sb.from('email_threads').select('category').eq('unread', true);
  if (error) return c.json({ error: error.message }, 500);
  const counts: Record<EmailCategory, number> = { inquiry: 0, supplier: 0, payment: 0, other: 0 };
  for (const row of data ?? []) {
    const category = row.category as EmailCategory;
    if (category in counts) counts[category] += 1;
  }
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  return c.json({ data: { ...counts, total } });
});

/** One page of conversations for a category tab (or All) + status, newest activity first. */
app.get('/', async (c) => {
  const parsed = listQuerySchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: firstZodIssue(parsed.error) }, 400);
  const { category, status, page } = parsed.data;
  const fromRow = (page - 1) * INBOX_PAGE_SIZE;

  const sb = createSupabaseAdmin(c.env);
  let query = sb
    .from('email_threads')
    .select(
      'id, subject, counterpart_address, counterpart_name, category, status, unread, last_message_at, last_direction, last_snippet, message_count, customer_id, order_id, customer:customers(id, first_name, last_name)',
      { count: 'exact' }
    )
    .eq('status', status);
  if (category !== 'all') query = query.eq('category', category);
  const { data, count, error } = await query
    .order('last_message_at', { ascending: false })
    .order('id', { ascending: false })
    .range(fromRow, fromRow + INBOX_PAGE_SIZE - 1);
  if (error) return c.json({ error: error.message }, 500);

  const total = count ?? 0;
  return c.json({
    data: data ?? [],
    page,
    page_size: INBOX_PAGE_SIZE,
    total,
    total_pages: Math.max(1, Math.ceil(total / INBOX_PAGE_SIZE)),
  });
});

/** One conversation with every message (oldest first) and the linked customer's orders. */
app.get('/:threadId', async (c) => {
  const id = c.req.param('threadId');
  if (!UUID_RE.test(id)) return c.json({ error: 'Conversation not found' }, 404);
  const sb = createSupabaseAdmin(c.env);

  const { data: thread, error } = await sb
    .from('email_threads')
    .select(
      'id, subject, counterpart_address, counterpart_name, category, category_locked, status, handled_at, unread, last_message_at, last_direction, last_snippet, message_count, customer_id, order_id, customer:customers(id, first_name, last_name), order:orders(id, order_number, status)'
    )
    .eq('id', id)
    .maybeSingle();
  if (error) return c.json({ error: error.message }, 500);
  if (!thread) return c.json({ error: 'Conversation not found' }, 404);

  const { data: messages, error: messagesError } = await sb
    .from('email_messages')
    .select('id, direction, from_name, from_address, to_addresses, sent_at, reply_text, text_body, attachments')
    .eq('thread_id', id)
    .order('sent_at', { ascending: true })
    .order('created_at', { ascending: true });
  if (messagesError) return c.json({ error: messagesError.message }, 500);

  let customerOrders: unknown[] = [];
  if (thread.customer_id) {
    const { data: orders, error: ordersError } = await sb
      .from('orders')
      .select('id, order_number, status')
      .eq('customer_id', thread.customer_id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (ordersError) return c.json({ error: ordersError.message }, 500);
    customerOrders = orders ?? [];
  }

  return c.json({ data: { ...thread, messages: messages ?? [], customer_orders: customerOrders } });
});

/** Marks a conversation read (staff opened it); the next incoming email marks it unread again. */
app.post('/:threadId/read', async (c) => {
  const id = c.req.param('threadId');
  if (!UUID_RE.test(id)) return c.json({ error: 'Conversation not found' }, 404);
  const sb = createSupabaseAdmin(c.env);
  const { data, error } = await sb.from('email_threads').update({ unread: false }).eq('id', id).select('id').maybeSingle();
  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: 'Conversation not found' }, 404);
  return c.json({ data });
});

/** Triage update (see the module comment for the link rules). */
app.put('/:threadId', async (c) => {
  const id = c.req.param('threadId');
  if (!UUID_RE.test(id)) return c.json({ error: 'Conversation not found' }, 404);
  const parsed = threadUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: firstZodIssue(parsed.error) }, 400);
  const input = parsed.data;
  const sb = createSupabaseAdmin(c.env);

  const update: Record<string, unknown> = {};
  if (input.category !== undefined) {
    update.category = input.category;
    update.category_locked = true;
  }
  if (input.status !== undefined) {
    update.status = input.status;
    update.handled_at = input.status === 'handled' ? new Date().toISOString() : null;
  }
  if (input.order_id !== undefined) {
    update.order_id = input.order_id;
    if (input.order_id) {
      const { data: order, error } = await sb
        .from('orders')
        .select('id, customer_id')
        .eq('id', input.order_id)
        .maybeSingle();
      if (error) return c.json({ error: error.message }, 500);
      if (!order) return c.json({ error: 'Order not found' }, 400);
      if (input.customer_id && input.customer_id !== order.customer_id) {
        return c.json({ error: 'That order belongs to a different customer.' }, 400);
      }
      update.customer_id = order.customer_id;
    }
  }
  if (input.customer_id !== undefined && update.customer_id === undefined) {
    if (input.customer_id) {
      const { data: customer, error } = await sb
        .from('customers')
        .select('id')
        .eq('id', input.customer_id)
        .is('deleted_at', null)
        .maybeSingle();
      if (error) return c.json({ error: error.message }, 500);
      if (!customer) return c.json({ error: 'Customer not found' }, 400);
    }
    update.customer_id = input.customer_id;
    if (input.order_id === undefined) update.order_id = null;
  }

  const { data, error } = await sb.from('email_threads').update(update).eq('id', id).select('id').maybeSingle();
  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: 'Conversation not found' }, 404);
  return c.json({ data });
});

export default app;
