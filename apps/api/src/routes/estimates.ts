// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Estimates route group — mounted at `/api/estimates` behind `requireAuth`.
 *
 * Endpoints:
 *   GET    /        list with `?status=` (waiting|draft|sent|confirmed|expired)
 *                   and `?q=` (order number or customer name) filters
 *   POST   /        create — server generates the order number (retrying on
 *                   the UNIQUE index for concurrent-save races) and computes
 *                   ALL pricing from catalog prices it fetches itself
 *   GET    /:id     estimate + ordered line items + customer, with a
 *                   defensive expiry check before returning
 *   PUT    /:id     replace fields + line items, full server-side recalc;
 *                   only draft/sent estimates are editable
 *
 * AUTHORITATIVE PRICING: clients send measurements and option IDs only.
 * The Worker fetches fabric/cassette/control prices from the catalog,
 * snapshots names + prices onto each line item, and computes unit
 * prices, line totals, and estimate totals with lib/pricing + lib/totals.
 * Client-computed money values are never trusted or persisted.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdmin } from '../lib/supabase';
import { calculateBlindUnitPrice } from '../lib/pricing';
import { calculateTotals } from '../lib/totals';
import { generateOrderNumber, parseDateOnly } from '../lib/orderNumber';
import { buildEstimatePdf, fetchLogo, type PdfEstimateData } from '../lib/pdf';
import { sendEmail, buildEstimateEmailHtml } from '../lib/email';
import type { AuthVariables } from '../middleware/auth';
import type { Env } from '../index';

const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

/* ------------------------------------------------------------------ */
/* Validation schemas                                                  */
/* ------------------------------------------------------------------ */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/**
 * Blind line item: measurements + catalog option ids — deliberately
 * `.strict()` so any client-supplied money field (unit_price etc.) is
 * REJECTED with 400 rather than silently stripped; pricing is
 * exclusively server-side.
 */
const blindItemSchema = z
  .object({
    item_type: z.literal('blind'),
    room_name: z.string().max(200).default(''),
    blinds_type: z.string().max(100).default(''),
    panels: z.array(z.number().positive().max(1000)).min(1, 'At least one panel').max(10),
    height_cm: z.number().positive().max(1000),
    fabric_id: z.string().uuid(),
    cassette_id: z.string().uuid(),
    control_id: z.string().uuid(),
    quantity: z.number().int().min(1).max(999),
  })
  .strict();

/** Preset/custom line item: consultant-entered description + price. */
const flatItemSchema = z
  .object({
    item_type: z.enum(['preset', 'custom']),
    description: z.string().min(1, 'Description is required').max(1000),
    quantity: z.number().int().min(1).max(999),
    unit_price: z.number().min(0).max(1_000_000),
  })
  .strict();

const lineItemSchema = z.discriminatedUnion('item_type', [blindItemSchema, flatItemSchema]);

/** Payload for POST / and PUT /:id. */
const estimateSchema = z
  .object({
    customer_id: z.string().uuid(),
    estimate_date: isoDate.optional(),
    expiry_date: isoDate.optional(),
    discount_type: z.enum(['fixed', 'percent']).default('fixed'),
    discount_value: z.number().min(0).max(1_000_000).default(0),
    line_items: z.array(lineItemSchema).max(200).default([]),
  })
  .strict();

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Row shape inserted into line_items (before estimate_id/position). */
type LineItemRow = Record<string, unknown> & { line_total: number };

/**
 * Resolves validated line-item inputs into insertable rows:
 * fetches catalog prices for blind options, snapshots names + prices,
 * and computes unit_price / line_total server-side.
 *
 * @throws Error with a user-readable message when an option id is
 *         unknown (e.g. a fabric was deleted mid-edit).
 */
async function resolveLineItems(
  sb: SupabaseClient,
  items: z.infer<typeof lineItemSchema>[]
): Promise<LineItemRow[]> {
  const ids = {
    fabrics: new Set<string>(),
    cassette_options: new Set<string>(),
    control_options: new Set<string>(),
  };
  for (const it of items) {
    if (it.item_type === 'blind') {
      ids.fabrics.add(it.fabric_id);
      ids.cassette_options.add(it.cassette_id);
      ids.control_options.add(it.control_id);
    }
  }

  /** Fetches id → {name, price} maps for one catalog table. */
  async function lookup(table: string, idSet: Set<string>, priceCol: string) {
    if (idSet.size === 0) return new Map<string, { name: string; price: number }>();
    const { data, error } = await sb
      .from(table)
      .select(`id, name, ${priceCol}`)
      .in('id', [...idSet]);
    if (error) throw new Error(error.message);
    return new Map(
      (data as unknown as Record<string, unknown>[]).map((r) => [
        String(r.id),
        { name: String(r.name), price: Number(r[priceCol]) },
      ])
    );
  }

  const [fabrics, cassettes, controls] = await Promise.all([
    lookup('fabrics', ids.fabrics, 'price_per_sqm'),
    lookup('cassette_options', ids.cassette_options, 'price_per_m'),
    lookup('control_options', ids.control_options, 'price_per_item'),
  ]);

  return items.map((it, position) => {
    if (it.item_type !== 'blind') {
      const unit = Math.round(it.unit_price * 100) / 100;
      return {
        item_type: it.item_type,
        position,
        description: it.description,
        quantity: it.quantity,
        unit_price: unit,
        line_total: Math.round(unit * it.quantity * 100) / 100,
      };
    }
    const fabric = fabrics.get(it.fabric_id);
    const cassette = cassettes.get(it.cassette_id);
    const control = controls.get(it.control_id);
    if (!fabric) throw new Error('Selected fabric no longer exists.');
    if (!cassette) throw new Error('Selected cassette option no longer exists.');
    if (!control) throw new Error('Selected control option no longer exists.');

    const unit_price = calculateBlindUnitPrice({
      panels: it.panels,
      height_cm: it.height_cm,
      fabric_price_per_sqm: fabric.price,
      cassette_price_per_m: cassette.price,
      control_price_per_item: control.price,
    });
    return {
      item_type: 'blind',
      position,
      room_name: it.room_name,
      blinds_type: it.blinds_type,
      panels: it.panels,
      height_cm: it.height_cm,
      fabric_id: it.fabric_id,
      fabric_name: fabric.name,
      fabric_price_per_sqm: fabric.price,
      cassette_id: it.cassette_id,
      cassette_name: cassette.name,
      cassette_price_per_m: cassette.price,
      control_id: it.control_id,
      control_name: control.name,
      control_price_per_item: control.price,
      quantity: it.quantity,
      unit_price,
      line_total: Math.round(unit_price * it.quantity * 100) / 100,
    };
  });
}

/** Column selection for single-estimate reads (items ordered by position). */
const DETAIL_SELECT = '*, line_items(*), customer:customers(*)';

/**
 * Defensive expiry (plan Phase 9 §6): if a sent estimate's expiry date
 * has passed, mark it expired in the DB before returning it, so reads
 * are correct even if the daily cron hasn't run yet.
 */
export async function applyDefensiveExpiry(
  sb: SupabaseClient,
  estimate: { id: string; status: string; expiry_date: string }
): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  if (estimate.status === 'sent' && estimate.expiry_date < today) {
    await sb.from('estimates').update({ status: 'expired' }).eq('id', estimate.id);
    return 'expired';
  }
  return estimate.status;
}

/** Extracts the first user-relevant message from a ZodError. */
function firstZodIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue ? `${issue.path.join('.') || 'payload'}: ${issue.message}` : 'Invalid payload';
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

/** Lists estimates with status tab + search filters. */
app.get('/', async (c) => {
  const sb = createSupabaseAdmin(c.env);
  let query = sb
    .from('estimates')
    .select('*, customer:customers(id, first_name, last_name)')
    .order('created_at', { ascending: false })
    .limit(100);

  const status = c.req.query('status') ?? '';
  if (status === 'waiting') query = query.in('status', ['draft', 'sent']);
  else if (['draft', 'sent', 'confirmed', 'expired'].includes(status)) {
    query = query.eq('status', status);
  }

  const q = (c.req.query('q') ?? '').replace(/[,().%*\\]/g, ' ').trim().slice(0, 100);
  if (q) {
    // Match order number directly, or resolve customer ids by name first.
    const { data: matches } = await sb
      .from('customers')
      .select('id')
      .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`)
      .limit(50);
    const ids = (matches ?? []).map((m) => m.id);
    query = ids.length
      ? query.or(`order_number.ilike.%${q}%,customer_id.in.(${ids.join(',')})`)
      : query.ilike('order_number', `%${q}%`);
  }

  const { data, error } = await query;
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ data });
});

/** Creates an estimate with server-generated order number + pricing. */
app.post('/', async (c) => {
  const parsed = estimateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: firstZodIssue(parsed.error) }, 400);
  const input = parsed.data;
  const sb = createSupabaseAdmin(c.env);

  // Resolve dates: default estimate_date = today, expiry = +default_expiry_days.
  const estimate_date = input.estimate_date ?? new Date().toISOString().slice(0, 10);
  let expiry_date = input.expiry_date;
  if (!expiry_date) {
    const { data: company } = await sb
      .from('company_settings')
      .select('default_expiry_days')
      .eq('id', 1)
      .single();
    const d = parseDateOnly(estimate_date);
    d.setDate(d.getDate() + (company?.default_expiry_days ?? 14));
    expiry_date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  if (expiry_date < estimate_date) {
    return c.json({ error: 'Expiry date cannot be before the estimate date.' }, 400);
  }

  let rows: LineItemRow[];
  try {
    rows = await resolveLineItems(sb, input.line_items);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Invalid line items' }, 400);
  }
  const totals = calculateTotals(
    rows.map((r) => r.line_total),
    input.discount_type,
    input.discount_value
  );

  // Insert with order-number retry: the UNIQUE index is the hard
  // guarantee against daily-count races; on 23505 we bump N and retry.
  const { count } = await sb
    .from('estimates')
    .select('id', { count: 'exact', head: true })
    .eq('estimate_date', estimate_date);
  let estimate: Record<string, unknown> | null = null;
  let lastError = 'Could not create estimate.';
  for (let n = (count ?? 0) + 1; n <= (count ?? 0) + 5; n++) {
    const order_number = generateOrderNumber(parseDateOnly(estimate_date), n);
    const { data, error } = await sb
      .from('estimates')
      .insert({
        order_number,
        customer_id: input.customer_id,
        estimate_date,
        expiry_date,
        discount_type: input.discount_type,
        discount_value: input.discount_value,
        ...totals,
      })
      .select()
      .single();
    if (data) {
      estimate = data;
      break;
    }
    lastError = error?.message ?? lastError;
    if (error?.code !== '23505') return c.json({ error: lastError }, 500);
  }
  if (!estimate) return c.json({ error: lastError }, 500);

  if (rows.length) {
    const { error: liError } = await sb
      .from('line_items')
      .insert(rows.map((r) => ({ ...r, estimate_id: estimate!.id })));
    if (liError) {
      await sb.from('estimates').delete().eq('id', estimate.id); // best-effort cleanup
      return c.json({ error: liError.message }, 500);
    }
  }

  const { data: full } = await sb
    .from('estimates')
    .select(DETAIL_SELECT)
    .eq('id', estimate.id)
    .order('position', { referencedTable: 'line_items' })
    .single();
  return c.json({ data: full ?? estimate }, 201);
});

/** Returns one estimate with line items + customer (defensive expiry). */
app.get('/:id', async (c) => {
  const sb = createSupabaseAdmin(c.env);
  const { data, error } = await sb
    .from('estimates')
    .select(DETAIL_SELECT)
    .eq('id', c.req.param('id'))
    .order('position', { referencedTable: 'line_items' })
    .maybeSingle();
  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: 'Estimate not found' }, 404);
  data.status = await applyDefensiveExpiry(sb, data);
  return c.json({ data });
});

/** Updates an estimate (draft/sent only) with full server recalc. */
app.put('/:id', async (c) => {
  const parsed = estimateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: firstZodIssue(parsed.error) }, 400);
  const input = parsed.data;
  const id = c.req.param('id');
  const sb = createSupabaseAdmin(c.env);

  const { data: existing } = await sb
    .from('estimates')
    .select('id, status, expiry_date')
    .eq('id', id)
    .maybeSingle();
  if (!existing) return c.json({ error: 'Estimate not found' }, 404);
  if (!['draft', 'sent'].includes(existing.status)) {
    return c.json({ error: `A ${existing.status} estimate can no longer be edited.` }, 409);
  }

  const estimate_date = input.estimate_date ?? new Date().toISOString().slice(0, 10);
  const expiry_date = input.expiry_date ?? existing.expiry_date;
  if (expiry_date < estimate_date) {
    return c.json({ error: 'Expiry date cannot be before the estimate date.' }, 400);
  }

  let rows: LineItemRow[];
  try {
    rows = await resolveLineItems(sb, input.line_items);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Invalid line items' }, 400);
  }
  const totals = calculateTotals(
    rows.map((r) => r.line_total),
    input.discount_type,
    input.discount_value
  );

  const { error: upError } = await sb
    .from('estimates')
    .update({
      customer_id: input.customer_id,
      estimate_date,
      expiry_date,
      discount_type: input.discount_type,
      discount_value: input.discount_value,
      ...totals,
    })
    .eq('id', id);
  if (upError) return c.json({ error: upError.message }, 500);

  // Replace line items wholesale — simplest correct model for a
  // single-editor tool; row counts are tiny at this scale.
  const { error: delError } = await sb.from('line_items').delete().eq('estimate_id', id);
  if (delError) return c.json({ error: delError.message }, 500);
  if (rows.length) {
    const { error: insError } = await sb
      .from('line_items')
      .insert(rows.map((r) => ({ ...r, estimate_id: id })));
    if (insError) return c.json({ error: insError.message }, 500);
  }

  const { data: full, error: readError } = await sb
    .from('estimates')
    .select(DETAIL_SELECT)
    .eq('id', id)
    .order('position', { referencedTable: 'line_items' })
    .single();
  if (readError) return c.json({ error: readError.message }, 500);
  return c.json({ data: full });
});

/* ------------------------------------------------------------------ */
/* PDF, send, and consultant confirm (Phase 8)                         */
/* ------------------------------------------------------------------ */

/**
 * Loads everything the PDF/email need for one estimate: the estimate
 * with ordered line items + customer, and the company settings row.
 * Returns null when the estimate does not exist.
 */
async function loadEstimateBundle(sb: SupabaseClient, id: string) {
  const [{ data: estimate }, { data: company }] = await Promise.all([
    sb
      .from('estimates')
      .select(DETAIL_SELECT)
      .eq('id', id)
      .order('position', { referencedTable: 'line_items' })
      .maybeSingle(),
    sb.from('company_settings').select('*').eq('id', 1).single(),
  ]);
  if (!estimate || !company) return null;
  return { estimate, company };
}

/** Maps a loaded bundle into the PDF module's input shape. */
async function toPdfData(
  estimate: Record<string, any>,
  company: Record<string, any>,
  terms: string
): Promise<PdfEstimateData> {
  return {
    estimate: {
      order_number: estimate.order_number,
      estimate_date: estimate.estimate_date,
      expiry_date: estimate.expiry_date,
      subtotal: Number(estimate.subtotal),
      discount_amount: Number(estimate.discount_amount),
      taxable_amount: Number(estimate.taxable_amount),
      tax_amount: Number(estimate.tax_amount),
      total: Number(estimate.total),
    },
    line_items: (estimate.line_items ?? []).map((li: Record<string, any>) => ({
      ...li,
      quantity: Number(li.quantity),
      unit_price: Number(li.unit_price),
      line_total: Number(li.line_total),
      height_cm: li.height_cm === null ? null : Number(li.height_cm),
    })),
    customer: estimate.customer,
    company: {
      company_name: company.company_name || 'Blinds Nisa',
      logo_url: company.logo_url,
      email: company.email,
      phone: company.phone,
      address: company.address,
      hst_number: company.hst_number,
    },
    terms,
    logo: await fetchLogo(company.logo_url),
  };
}

/**
 * Base64-encodes bytes in 8KB chunks — spreading a large PDF into
 * String.fromCharCode(...) would overflow the call stack.
 */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Streams the estimate as a downloadable PDF. */
app.get('/:id/pdf', async (c) => {
  const sb = createSupabaseAdmin(c.env);
  const bundle = await loadEstimateBundle(sb, c.req.param('id'));
  if (!bundle) return c.json({ error: 'Estimate not found' }, 404);
  const terms = bundle.estimate.terms_snapshot ?? bundle.company.terms_and_conditions ?? '';
  try {
    const pdf = await buildEstimatePdf(await toPdfData(bundle.estimate, bundle.company, terms));
    // Re-slice into a plain ArrayBuffer — Hono's body type rejects
    // Uint8Array<ArrayBufferLike> views directly.
    const body = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;
    return c.body(body, 200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${bundle.estimate.order_number}.pdf"`,
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'PDF generation failed' }, 500);
  }
});

/**
 * Sends the estimate to the customer by email with the PDF attached.
 *
 * Ordering (stability improvement from the plan review): the email is
 * sent FIRST; only after Resend confirms success do we persist
 * status='sent', sent_at, the public token, and the T&C snapshot. A
 * failed send leaves the estimate exactly as it was. Resends reuse
 * the existing public_token so previously emailed links keep working.
 */
app.post('/:id/send', async (c) => {
  const sb = createSupabaseAdmin(c.env);
  const id = c.req.param('id');
  const bundle = await loadEstimateBundle(sb, id);
  if (!bundle) return c.json({ error: 'Estimate not found' }, 404);
  const { estimate, company } = bundle;

  if (!['draft', 'sent'].includes(estimate.status)) {
    return c.json({ error: `A ${estimate.status} estimate cannot be sent.` }, 409);
  }
  const today = new Date().toISOString().slice(0, 10);
  if (estimate.expiry_date < today) {
    return c.json({ error: 'This estimate has expired — update the expiry date first.' }, 400);
  }
  const email = estimate.customer?.email;
  if (!email) return c.json({ error: 'This customer has no email address.' }, 400);

  const publicToken: string = estimate.public_token ?? crypto.randomUUID();
  const terms: string = estimate.terms_snapshot ?? company.terms_and_conditions ?? '';
  const viewUrl = `${c.env.APP_URL}/customer/${publicToken}`;

  let pdf: Uint8Array;
  try {
    pdf = await buildEstimatePdf(await toPdfData(estimate, company, terms));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'PDF generation failed' }, 500);
  }

  try {
    await sendEmail(c.env, {
      to: email,
      subject: `Your estimate ${estimate.order_number} from ${company.company_name || 'Blinds Nisa'}`,
      html: buildEstimateEmailHtml({
        companyName: company.company_name || 'Blinds Nisa',
        customerFirstName: estimate.customer.first_name,
        orderNumber: estimate.order_number,
        total: Number(estimate.total),
        expiryDate: estimate.expiry_date,
        viewUrl,
      }),
      attachments: [
        {
          filename: `${estimate.order_number}.pdf`,
          content: toBase64(pdf),
        },
      ],
    });
  } catch (e) {
    // Send failed → estimate stays untouched (still draft / previous state).
    return c.json({ error: e instanceof Error ? e.message : 'Email send failed' }, 502);
  }

  const { data: updated, error } = await sb
    .from('estimates')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      public_token: publicToken,
      terms_snapshot: terms,
    })
    .eq('id', id)
    .select(DETAIL_SELECT)
    .order('position', { referencedTable: 'line_items' })
    .single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ data: updated });
});

/** Consultant-side confirm — marks a draft/sent estimate confirmed. */
app.post('/:id/confirm', async (c) => {
  const sb = createSupabaseAdmin(c.env);
  const id = c.req.param('id');
  const { data: existing } = await sb
    .from('estimates')
    .select('id, status')
    .eq('id', id)
    .maybeSingle();
  if (!existing) return c.json({ error: 'Estimate not found' }, 404);
  if (!['draft', 'sent'].includes(existing.status)) {
    return c.json({ error: `Estimate is already ${existing.status}.` }, 409);
  }
  const { data, error } = await sb
    .from('estimates')
    .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
    .eq('id', id)
    .select(DETAIL_SELECT)
    .order('position', { referencedTable: 'line_items' })
    .single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ data });
});

export default app;
