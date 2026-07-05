// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Orders route group — mounted at `/api/orders` behind `requireAuth`.
 *
 * An ORDER is the first-class record (customer, line items, totals,
 * lifecycle). An "estimate" is just the PDF/email artifact we send
 * about an order; an "invoice" is the same document once a payment has
 * been recorded.
 *
 * Lifecycle: draft → sent → awaiting_payment → in_progress → completed
 * (plus `expired` for sent estimates whose validity date lapses).
 *
 * Endpoints:
 *   GET    /              list with `?status=` and `?q=` filters
 *   POST   /              create — server generates the order number
 *                         (retrying on the UNIQUE index) and computes
 *                         ALL pricing from catalog prices it fetches
 *   GET    /:id           order + ordered line items + customer +
 *                         payments, with a defensive expiry check
 *   PUT    /:id           replace fields + line items, full recalc;
 *                         only draft/sent orders are editable
 *   GET    /:id/pdf       stream the Estimate (or Invoice once paid) PDF
 *   POST   /:id/send      email the estimate to the customer (→ sent)
 *   POST   /:id/confirm   user confirm (draft/sent → awaiting_payment)
 *   POST   /:id/unconfirm reverse a confirmation (awaiting_payment → sent)
 *   POST   /:id/payments  record a payment (awaiting_payment → in_progress
 *                         on the first one); balance derived from ledger
 *   POST   /:id/ready     goods ready to install (in_progress → ready)
 *   POST   /:id/installed terminal state (ready → installed)
 *   POST   /:id/install/propose  email the customer a 1-hour arrival
 *                         window + link to confirm or request another
 *   POST   /:id/install/cancel   clear a set installation time
 *   POST   /:id/revert    move an order back to an earlier stage
 *   DELETE /:id           delete an order (+ line items + payments)
 *
 * AUTHORITATIVE PRICING: clients send measurements and option IDs only.
 * The Worker fetches fabric/cassette/control prices from the catalog,
 * snapshots names + prices onto each line item, and computes unit
 * prices, line totals, and order totals with lib/pricing + lib/totals.
 * Client-computed money values are never trusted or persisted.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdmin } from '../lib/supabase';
import { calculateBlindUnitPrice } from '../lib/pricing';
import { calculateTotals } from '../lib/totals';
import { generateOrderNumber, parseDateOnly } from '../lib/orderNumber';
import { buildDocumentPdf, fetchLogo, type PdfDocumentData } from '../lib/pdf';
import {
  sendEmail,
  buildEstimateEmailHtml,
  buildInvoiceEmailHtml,
  buildInstallationProposalHtml,
} from '../lib/email';
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
const orderSchema = z
  .object({
    customer_id: z.string().uuid(),
    order_date: isoDate.optional(),
    expiry_date: isoDate.optional(),
    discount_type: z.enum(['fixed', 'percent']).default('fixed'),
    discount_value: z.number().min(0).max(1_000_000).default(0),
    line_items: z.array(lineItemSchema).max(200).default([]),
  })
  .strict();

/** Payload for POST /:id/payments — a single ledger entry. */
const paymentSchema = z
  .object({
    amount: z.number().positive().max(10_000_000),
    paid_on: isoDate.optional(),
    note: z.string().max(500).default(''),
  })
  .strict();

/** 24-hour clock time, HH:MM. */
const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

/** Payload for POST /:id/install/propose — a proposed start time. */
const installProposeSchema = z
  .object({
    install_date: isoDate,
    install_time: clockTime,
    message: z.string().max(1000).optional(),
  })
  .strict();

/** Optional consultant note accepted when emailing an estimate/invoice. */
const sendMessageSchema = z
  .object({ message: z.string().max(1000).optional() })
  .strict();

/** Statuses that accept edits and estimate sends. */
const EDITABLE = ['draft', 'sent'] as const;

/** Confirmed statuses — the order is now an Invoice, not an Estimate. */
const CONFIRMED = ['awaiting_payment', 'in_progress', 'ready', 'installed'] as const;
function isConfirmed(status: string): boolean {
  return (CONFIRMED as readonly string[]).includes(status);
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Formats "HH:MM" (24h) as a 12-hour clock string, e.g. "2:00 PM". */
function to12Hour(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const hour12 = ((h + 11) % 12) + 1;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

/**
 * Builds the human-readable installation window from a stored date +
 * start time: the date as "Friday, August 7, 2026" and the one-hour
 * arrival window [start, start + 1h]. Formatting is done by hand (no
 * `Intl` locale data) so it is identical under workerd and Node.
 */
function installWindow(dateIso: string, time: string): {
  dateText: string;
  startText: string;
  endText: string;
} {
  const [y, mo, d] = dateIso.split('-').map(Number);
  const dow = new Date(y, mo - 1, d).getDay();
  const dateText = `${WEEKDAYS[dow]}, ${MONTHS[mo - 1]} ${d}, ${y}`;
  const [h, m] = time.split(':').map(Number);
  const endTime = `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return { dateText, startText: to12Hour(time), endText: to12Hour(endTime) };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Row shape inserted into line_items (before order_id/position). */
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

  // IMPORTANT: every row must carry the SAME column set. PostgREST
  // bulk inserts unify keys across rows and fill gaps with NULL, which
  // violates the not-null defaults (e.g. description on blind rows) —
  // caught by the live E2E run.
  return items.map((it, position) => {
    if (it.item_type !== 'blind') {
      const unit = Math.round(it.unit_price * 100) / 100;
      return {
        item_type: it.item_type,
        position,
        room_name: '',
        blinds_type: '',
        panels: [],
        height_cm: null,
        fabric_id: null,
        fabric_name: null,
        fabric_price_per_sqm: null,
        cassette_id: null,
        cassette_name: null,
        cassette_price_per_m: null,
        control_id: null,
        control_name: null,
        control_price_per_item: null,
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
      description: '',
      quantity: it.quantity,
      unit_price,
      line_total: Math.round(unit_price * it.quantity * 100) / 100,
    };
  });
}

/** Column selection for single-order reads (items + payments joined). */
const DETAIL_SELECT = '*, line_items(*), customer:customers(*), payments(*)';

/** Sums a payment ledger to 2dp. */
function sumPayments(payments: Array<{ amount: number | string }> | null | undefined): number {
  const total = (payments ?? []).reduce((acc, p) => acc + Number(p.amount), 0);
  return Math.round(total * 100) / 100;
}

/**
 * Defensive expiry: if a sent order's estimate validity date has
 * passed, mark it expired in the DB before returning it, so reads are
 * correct even if the daily cron hasn't run yet. Only `sent` orders
 * expire — once confirmed/paid, an order never lapses.
 */
export async function applyDefensiveExpiry(
  sb: SupabaseClient,
  order: { id: string; status: string; expiry_date: string }
): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  if (order.status === 'sent' && order.expiry_date < today) {
    await sb.from('orders').update({ status: 'expired' }).eq('id', order.id);
    return 'expired';
  }
  return order.status;
}

/** Extracts the first user-relevant message from a ZodError. */
function firstZodIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue ? `${issue.path.join('.') || 'payload'}: ${issue.message}` : 'Invalid payload';
}

/** Reads one full order (items ordered, payments oldest-first). */
async function readDetail(sb: SupabaseClient, id: string) {
  return sb
    .from('orders')
    .select(DETAIL_SELECT)
    .eq('id', id)
    .order('position', { referencedTable: 'line_items' })
    .order('paid_on', { referencedTable: 'payments' })
    .maybeSingle();
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

/** Statuses selectable as a direct `?status=` filter. */
const LIST_STATUSES = ['draft', 'sent', 'awaiting_payment', 'in_progress', 'ready', 'installed', 'expired'];

/** Lists orders with status tab + search filters. */
app.get('/', async (c) => {
  const sb = createSupabaseAdmin(c.env);
  let query = sb
    .from('orders')
    .select('*, customer:customers(id, first_name, last_name), payments(amount)')
    .order('created_at', { ascending: false })
    .limit(100);

  const status = c.req.query('status') ?? '';
  if (status === 'active') query = query.in('status', ['draft', 'sent']);
  else if (LIST_STATUSES.includes(status)) query = query.eq('status', status);

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
  // Attach a derived amount_paid so list rows can show a balance chip.
  const rows = (data ?? []).map((o: Record<string, any>) => ({
    ...o,
    amount_paid: sumPayments(o.payments),
  }));
  return c.json({ data: rows });
});

/** Creates an order with server-generated order number + pricing. */
app.post('/', async (c) => {
  const parsed = orderSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: firstZodIssue(parsed.error) }, 400);
  const input = parsed.data;
  const sb = createSupabaseAdmin(c.env);

  // Resolve dates: default order_date = today, expiry = +default_expiry_days.
  const order_date = input.order_date ?? new Date().toISOString().slice(0, 10);
  let expiry_date = input.expiry_date;
  if (!expiry_date) {
    const { data: company } = await sb
      .from('company_settings')
      .select('default_expiry_days')
      .eq('id', 1)
      .single();
    const d = parseDateOnly(order_date);
    d.setDate(d.getDate() + (company?.default_expiry_days ?? 14));
    expiry_date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  if (expiry_date < order_date) {
    return c.json({ error: 'Expiry date cannot be before the order date.' }, 400);
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
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('order_date', order_date);
  let order: Record<string, unknown> | null = null;
  let lastError = 'Could not create order.';
  for (let n = (count ?? 0) + 1; n <= (count ?? 0) + 5; n++) {
    const order_number = generateOrderNumber(parseDateOnly(order_date), n);
    const { data, error } = await sb
      .from('orders')
      .insert({
        order_number,
        customer_id: input.customer_id,
        order_date,
        expiry_date,
        discount_type: input.discount_type,
        discount_value: input.discount_value,
        ...totals,
      })
      .select()
      .single();
    if (data) {
      order = data;
      break;
    }
    lastError = error?.message ?? lastError;
    if (error?.code !== '23505') return c.json({ error: lastError }, 500);
  }
  if (!order) return c.json({ error: lastError }, 500);

  if (rows.length) {
    const { error: liError } = await sb
      .from('line_items')
      .insert(rows.map((r) => ({ ...r, order_id: order!.id })));
    if (liError) {
      await sb.from('orders').delete().eq('id', order.id); // best-effort cleanup
      return c.json({ error: liError.message }, 500);
    }
  }

  const { data: full } = await readDetail(sb, order.id as string);
  return c.json({ data: full ?? order }, 201);
});

/** Returns one order with line items + customer + payments. */
app.get('/:id', async (c) => {
  const sb = createSupabaseAdmin(c.env);
  const { data, error } = await readDetail(sb, c.req.param('id'));
  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: 'Order not found' }, 404);
  data.status = await applyDefensiveExpiry(sb, data);
  data.amount_paid = sumPayments(data.payments);
  return c.json({ data });
});

/** Updates an order (draft/sent only) with full server recalc. */
app.put('/:id', async (c) => {
  const parsed = orderSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: firstZodIssue(parsed.error) }, 400);
  const input = parsed.data;
  const id = c.req.param('id');
  const sb = createSupabaseAdmin(c.env);

  const { data: existing } = await sb
    .from('orders')
    .select('id, status, expiry_date')
    .eq('id', id)
    .maybeSingle();
  if (!existing) return c.json({ error: 'Order not found' }, 404);
  if (!EDITABLE.includes(existing.status)) {
    return c.json({ error: `A ${existing.status} order can no longer be edited.` }, 409);
  }

  const order_date = input.order_date ?? new Date().toISOString().slice(0, 10);
  const expiry_date = input.expiry_date ?? existing.expiry_date;
  if (expiry_date < order_date) {
    return c.json({ error: 'Expiry date cannot be before the order date.' }, 400);
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
    .from('orders')
    .update({
      customer_id: input.customer_id,
      order_date,
      expiry_date,
      discount_type: input.discount_type,
      discount_value: input.discount_value,
      ...totals,
    })
    .eq('id', id);
  if (upError) return c.json({ error: upError.message }, 500);

  // Replace line items wholesale — simplest correct model for a
  // single-editor tool; row counts are tiny at this scale.
  const { error: delError } = await sb.from('line_items').delete().eq('order_id', id);
  if (delError) return c.json({ error: delError.message }, 500);
  if (rows.length) {
    const { error: insError } = await sb
      .from('line_items')
      .insert(rows.map((r) => ({ ...r, order_id: id })));
    if (insError) return c.json({ error: insError.message }, 500);
  }

  const { data: full, error: readError } = await readDetail(sb, id);
  if (readError) return c.json({ error: readError.message }, 500);
  if (full) full.amount_paid = sumPayments(full.payments);
  return c.json({ data: full });
});

/* ------------------------------------------------------------------ */
/* PDF, send, confirm/unconfirm, payments, complete                    */
/* ------------------------------------------------------------------ */

/**
 * Loads everything the PDF/email need for one order: the order with
 * ordered line items + customer + payments, and the company settings
 * row. Returns null when the order does not exist.
 */
async function loadOrderBundle(sb: SupabaseClient, id: string) {
  const [{ data: order }, { data: company }] = await Promise.all([
    readDetail(sb, id),
    sb.from('company_settings').select('*').eq('id', 1).single(),
  ]);
  if (!order || !company) return null;
  return { order, company };
}

/**
 * Maps a loaded bundle into the PDF module's input shape. `docType`
 * decides the document title (Estimate vs Invoice); the invoice
 * variant also carries the payment ledger and outstanding balance.
 */
async function toPdfData(
  order: Record<string, any>,
  company: Record<string, any>,
  terms: string
): Promise<PdfDocumentData> {
  const amount_paid = sumPayments(order.payments);
  const total = Number(order.total);
  // Estimate until the order is confirmed; Invoice for every confirmed
  // stage (awaiting_payment onward), regardless of payments recorded.
  const docType: 'estimate' | 'invoice' = isConfirmed(order.status) ? 'invoice' : 'estimate';
  return {
    docType,
    order: {
      order_number: order.order_number,
      order_date: order.order_date,
      expiry_date: order.expiry_date,
      subtotal: Number(order.subtotal),
      discount_amount: Number(order.discount_amount),
      taxable_amount: Number(order.taxable_amount),
      tax_amount: Number(order.tax_amount),
      total,
      amount_paid,
      balance: Math.round((total - amount_paid) * 100) / 100,
    },
    payments: (order.payments ?? []).map((p: Record<string, any>) => ({
      amount: Number(p.amount),
      paid_on: p.paid_on,
      note: p.note ?? '',
    })),
    line_items: (order.line_items ?? []).map((li: Record<string, any>) => ({
      ...li,
      quantity: Number(li.quantity),
      unit_price: Number(li.unit_price),
      line_total: Number(li.line_total),
      height_cm: li.height_cm === null ? null : Number(li.height_cm),
    })),
    customer: order.customer,
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

/** Streams the order as a downloadable PDF (Estimate, or Invoice once paid). */
app.get('/:id/pdf', async (c) => {
  const sb = createSupabaseAdmin(c.env);
  const bundle = await loadOrderBundle(sb, c.req.param('id'));
  if (!bundle) return c.json({ error: 'Order not found' }, 404);
  const terms = bundle.order.terms_snapshot ?? bundle.company.terms_and_conditions ?? '';
  try {
    const data = await toPdfData(bundle.order, bundle.company, terms);
    const pdf = await buildDocumentPdf(data);
    // Re-slice into a plain ArrayBuffer — Hono's body type rejects
    // Uint8Array<ArrayBufferLike> views directly.
    const body = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;
    const label = data.docType === 'invoice' ? 'invoice' : 'estimate';
    return c.body(body, 200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${bundle.order.order_number}-${label}.pdf"`,
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
 * failed send leaves the order exactly as it was. Resends reuse the
 * existing public_token so previously emailed links keep working.
 */
app.post('/:id/send', async (c) => {
  const parsed = sendMessageSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: firstZodIssue(parsed.error) }, 400);
  const message = parsed.data.message;
  const sb = createSupabaseAdmin(c.env);
  const id = c.req.param('id');
  const bundle = await loadOrderBundle(sb, id);
  if (!bundle) return c.json({ error: 'Order not found' }, 404);
  const { order, company } = bundle;

  if (!EDITABLE.includes(order.status)) {
    return c.json({ error: `A ${order.status} order's estimate cannot be re-sent.` }, 409);
  }
  const today = new Date().toISOString().slice(0, 10);
  if (order.expiry_date < today) {
    return c.json({ error: 'This estimate has expired — update the expiry date first.' }, 400);
  }
  const email = order.customer?.email;
  if (!email) return c.json({ error: 'This customer has no email address.' }, 400);

  const publicToken: string = order.public_token ?? crypto.randomUUID();
  const terms: string = order.terms_snapshot ?? company.terms_and_conditions ?? '';
  const viewUrl = `${c.env.APP_URL}/customer/${publicToken}`;

  let pdf: Uint8Array;
  try {
    // An unsent order has no payments yet, so this is always an Estimate.
    pdf = await buildDocumentPdf(await toPdfData(order, company, terms));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'PDF generation failed' }, 500);
  }

  try {
    await sendEmail(c.env, {
      to: email,
      subject: `Your estimate ${order.order_number} from ${company.company_name || 'Blinds Nisa'}`,
      html: buildEstimateEmailHtml({
        companyName: company.company_name || 'Blinds Nisa',
        customerFirstName: order.customer.first_name,
        orderNumber: order.order_number,
        total: Number(order.total),
        message,
        expiryDate: order.expiry_date,
        viewUrl,
      }),
      attachments: [
        {
          filename: `${order.order_number}-estimate.pdf`,
          content: toBase64(pdf),
        },
      ],
    });
  } catch (e) {
    // Send failed → order stays untouched (still draft / previous state).
    return c.json({ error: e instanceof Error ? e.message : 'Email send failed' }, 502);
  }

  const { error } = await sb
    .from('orders')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      public_token: publicToken,
      terms_snapshot: terms,
    })
    .eq('id', id);
  if (error) return c.json({ error: error.message }, 500);

  const { data: updated } = await readDetail(sb, id);
  if (updated) updated.amount_paid = sumPayments(updated.payments);
  return c.json({ data: updated });
});

/**
 * Emails the customer their invoice (confirmed orders only) with the
 * Invoice PDF attached and an optional consultant note. This is a
 * document re-send: the order's lifecycle stage is NOT changed. The
 * public token is reused (minted if the order was never emailed) so the
 * online view link keeps working.
 */
app.post('/:id/send-invoice', async (c) => {
  const parsed = sendMessageSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: firstZodIssue(parsed.error) }, 400);
  const message = parsed.data.message;
  const sb = createSupabaseAdmin(c.env);
  const id = c.req.param('id');
  const bundle = await loadOrderBundle(sb, id);
  if (!bundle) return c.json({ error: 'Order not found' }, 404);
  const { order, company } = bundle;

  if (!isConfirmed(order.status)) {
    return c.json(
      { error: `An invoice can only be sent for a confirmed order (this one is ${order.status}).` },
      409
    );
  }
  const email = order.customer?.email;
  if (!email) return c.json({ error: 'This customer has no email address.' }, 400);

  const publicToken: string = order.public_token ?? crypto.randomUUID();
  const terms: string = order.terms_snapshot ?? company.terms_and_conditions ?? '';
  const viewUrl = `${c.env.APP_URL}/customer/${publicToken}`;

  let pdf: Uint8Array;
  try {
    // toPdfData renders an Invoice because the order is confirmed.
    pdf = await buildDocumentPdf(await toPdfData(order, company, terms));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'PDF generation failed' }, 500);
  }

  try {
    await sendEmail(c.env, {
      to: email,
      subject: `Your invoice ${order.order_number} from ${company.company_name || 'Blinds Nisa'}`,
      html: buildInvoiceEmailHtml({
        companyName: company.company_name || 'Blinds Nisa',
        customerFirstName: order.customer.first_name,
        orderNumber: order.order_number,
        total: Number(order.total),
        viewUrl,
        message,
      }),
      attachments: [
        {
          filename: `${order.order_number}-invoice.pdf`,
          content: toBase64(pdf),
        },
      ],
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Email send failed' }, 502);
  }

  // Persist the token (and terms snapshot) if this order had never been
  // emailed; the lifecycle status is deliberately left unchanged.
  if (!order.public_token) {
    const { error } = await sb
      .from('orders')
      .update({ public_token: publicToken, terms_snapshot: terms })
      .eq('id', id);
    if (error) return c.json({ error: error.message }, 500);
  }

  const { data: updated } = await readDetail(sb, id);
  if (updated) updated.amount_paid = sumPayments(updated.payments);
  return c.json({ data: updated });
});

/** User confirm — moves a draft/sent order into awaiting_payment. */
app.post('/:id/confirm', async (c) => {
  const sb = createSupabaseAdmin(c.env);
  const id = c.req.param('id');
  const { data: existing } = await sb
    .from('orders')
    .select('id, status')
    .eq('id', id)
    .maybeSingle();
  if (!existing) return c.json({ error: 'Order not found' }, 404);
  if (!EDITABLE.includes(existing.status)) {
    return c.json({ error: `Order is already ${existing.status}.` }, 409);
  }
  const { error } = await sb
    .from('orders')
    .update({ status: 'awaiting_payment', confirmed_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return c.json({ error: error.message }, 500);

  const { data } = await readDetail(sb, id);
  if (data) data.amount_paid = sumPayments(data.payments);
  return c.json({ data });
});

/**
 * Reverses a confirmation (user-only): awaiting_payment → sent.
 * A confirmation can be undone ONLY before any payment is recorded —
 * once money is in, the order is in_progress and this is refused.
 */
app.post('/:id/unconfirm', async (c) => {
  const sb = createSupabaseAdmin(c.env);
  const id = c.req.param('id');
  const { data: existing } = await sb
    .from('orders')
    .select('id, status')
    .eq('id', id)
    .maybeSingle();
  if (!existing) return c.json({ error: 'Order not found' }, 404);
  if (existing.status !== 'awaiting_payment') {
    return c.json(
      { error: `Only an awaiting-payment order can be reversed (this one is ${existing.status}).` },
      409
    );
  }
  const { error } = await sb
    .from('orders')
    .update({ status: 'sent', confirmed_at: null })
    .eq('id', id);
  if (error) return c.json({ error: error.message }, 500);

  const { data } = await readDetail(sb, id);
  if (data) data.amount_paid = sumPayments(data.payments);
  return c.json({ data });
});

/**
 * Records a payment against an order. The first payment moves
 * awaiting_payment → in_progress; further payments keep the order
 * in_progress. The outstanding balance is derived from the ledger, so
 * it is returned but never stored. Payments are accepted while the
 * order is awaiting_payment or in_progress.
 */
app.post('/:id/payments', async (c) => {
  const parsed = paymentSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: firstZodIssue(parsed.error) }, 400);
  const input = parsed.data;
  const id = c.req.param('id');
  const sb = createSupabaseAdmin(c.env);

  const { data: existing } = await sb
    .from('orders')
    .select('id, status')
    .eq('id', id)
    .maybeSingle();
  if (!existing) return c.json({ error: 'Order not found' }, 404);
  // Payments may be applied at any post-confirmation stage.
  if (!['awaiting_payment', 'in_progress', 'ready', 'installed'].includes(existing.status)) {
    return c.json(
      { error: `Payments can only be recorded on a confirmed order (this one is ${existing.status}).` },
      409
    );
  }

  const paid_on = input.paid_on ?? new Date().toISOString().slice(0, 10);
  const { error: payError } = await sb
    .from('payments')
    .insert({ order_id: id, amount: input.amount, paid_on, note: input.note });
  if (payError) return c.json({ error: payError.message }, 500);

  // First payment advances the lifecycle.
  if (existing.status === 'awaiting_payment') {
    await sb.from('orders').update({ status: 'in_progress' }).eq('id', id);
  }

  const { data } = await readDetail(sb, id);
  if (data) data.amount_paid = sumPayments(data.payments);
  return c.json({ data }, 201);
});

/**
 * Deletes a single payment from the ledger. If the order is
 * `in_progress` and this was the last payment, the status is
 * automatically reverted to `awaiting_payment`.
 */
app.delete('/:id/payments/:paymentId', async (c) => {
  const sb = createSupabaseAdmin(c.env);
  const id = c.req.param('id');
  const paymentId = c.req.param('paymentId');

  // Verify the payment exists and belongs to this order.
  const { data: payment } = await sb
    .from('payments')
    .select('id, order_id')
    .eq('id', paymentId)
    .eq('order_id', id)
    .maybeSingle();
  if (!payment) return c.json({ error: 'Payment not found on this order.' }, 404);

  const { error: delError } = await sb.from('payments').delete().eq('id', paymentId);
  if (delError) return c.json({ error: delError.message }, 500);

  // Auto-revert: if the order is in_progress and no payments remain,
  // roll back to awaiting_payment.
  const { data: order } = await sb
    .from('orders')
    .select('id, status')
    .eq('id', id)
    .maybeSingle();
  if (order && order.status === 'in_progress') {
    const { count } = await sb
      .from('payments')
      .select('id', { count: 'exact', head: true })
      .eq('order_id', id);
    if (count === 0) {
      await sb.from('orders').update({ status: 'awaiting_payment' }).eq('id', id);
    }
  }

  const { data } = await readDetail(sb, id);
  if (data) data.amount_paid = sumPayments(data.payments);
  return c.json({ data });
});

/**
 * Moves an awaiting-payment order into in_progress WITHOUT a payment.
 * (Recording the first payment also does this automatically; this is the
 * manual path when work starts before any money is collected.)
 */
app.post('/:id/in-progress', async (c) => {
  const sb = createSupabaseAdmin(c.env);
  const id = c.req.param('id');
  const { data: existing } = await sb
    .from('orders')
    .select('id, status')
    .eq('id', id)
    .maybeSingle();
  if (!existing) return c.json({ error: 'Order not found' }, 404);
  if (existing.status !== 'awaiting_payment') {
    return c.json(
      { error: `Only an awaiting-payment order can be started (this one is ${existing.status}).` },
      409
    );
  }
  const { error } = await sb.from('orders').update({ status: 'in_progress' }).eq('id', id);
  if (error) return c.json({ error: error.message }, 500);

  const { data } = await readDetail(sb, id);
  if (data) data.amount_paid = sumPayments(data.payments);
  return c.json({ data });
});

/** Marks an in-progress order as ready (goods ready to install). */
app.post('/:id/ready', async (c) => {
  const sb = createSupabaseAdmin(c.env);
  const id = c.req.param('id');
  const { data: existing } = await sb
    .from('orders')
    .select('id, status')
    .eq('id', id)
    .maybeSingle();
  if (!existing) return c.json({ error: 'Order not found' }, 404);
  // Forward jump allowed from any confirmed stage before Ready
  // (awaiting_payment or in_progress) — intermediate steps may be skipped.
  if (existing.status !== 'awaiting_payment' && existing.status !== 'in_progress') {
    return c.json(
      { error: `A confirmed order is needed to mark it ready (this one is ${existing.status}).` },
      409
    );
  }
  const { error } = await sb.from('orders').update({ status: 'ready' }).eq('id', id);
  if (error) return c.json({ error: error.message }, 500);

  const { data } = await readDetail(sb, id);
  if (data) data.amount_paid = sumPayments(data.payments);
  return c.json({ data });
});

/** Marks a ready order installed — the terminal state (user action). */
app.post('/:id/installed', async (c) => {
  const sb = createSupabaseAdmin(c.env);
  const id = c.req.param('id');
  const { data: existing } = await sb
    .from('orders')
    .select('id, status')
    .eq('id', id)
    .maybeSingle();
  if (!existing) return c.json({ error: 'Order not found' }, 404);
  // Forward jump allowed from any confirmed stage before Installed —
  // intermediate steps (in_progress / ready) may be skipped.
  if (!isConfirmed(existing.status) || existing.status === 'installed') {
    return c.json(
      { error: `A confirmed order is needed to mark it installed (this one is ${existing.status}).` },
      409
    );
  }
  const { error } = await sb.from('orders').update({ status: 'installed' }).eq('id', id);
  if (error) return c.json({ error: error.message }, 500);

  const { data } = await readDetail(sb, id);
  if (data) data.amount_paid = sumPayments(data.payments);
  return c.json({ data });
});

/**
 * Proposes an installation time to the customer (ready orders only).
 *
 * Ordering mirrors the estimate send: email FIRST, then persist —
 * a failed send leaves the schedule untouched. Reuses the order's
 * existing public_token (minting one if the order was never emailed) so
 * the customer confirms/requests on the same token'd public page. The
 * emailed window is [install_time, install_time + 1 hour] on
 * install_date.
 */
app.post('/:id/install/propose', async (c) => {
  const parsed = installProposeSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: firstZodIssue(parsed.error) }, 400);
  const input = parsed.data;
  const id = c.req.param('id');
  const sb = createSupabaseAdmin(c.env);

  const bundle = await loadOrderBundle(sb, id);
  if (!bundle) return c.json({ error: 'Order not found' }, 404);
  const { order, company } = bundle;
  if (order.status !== 'ready') {
    return c.json(
      { error: `Installation can only be proposed on a ready order (this one is ${order.status}).` },
      409
    );
  }
  const email = order.customer?.email;
  if (!email) return c.json({ error: 'This customer has no email address.' }, 400);

  const publicToken: string = order.public_token ?? crypto.randomUUID();
  const viewUrl = `${c.env.APP_URL}/customer/${publicToken}`;
  const win = installWindow(input.install_date, input.install_time);

  try {
    await sendEmail(c.env, {
      to: email,
      subject: `Installation time for order ${order.order_number}`,
      html: buildInstallationProposalHtml({
        companyName: company.company_name || 'Blinds Nisa',
        customerFirstName: order.customer.first_name,
        orderNumber: order.order_number,
        dateText: win.dateText,
        startText: win.startText,
        endText: win.endText,
        viewUrl,
        message: input.message,
      }),
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Email send failed' }, 502);
  }

  const { error } = await sb
    .from('orders')
    .update({
      install_date: input.install_date,
      install_time: input.install_time,
      install_status: 'proposed',
      install_confirmed_at: null,
      install_response_note: '',
      public_token: publicToken,
    })
    .eq('id', id);
  if (error) return c.json({ error: error.message }, 500);

  const { data } = await readDetail(sb, id);
  if (data) data.amount_paid = sumPayments(data.payments);
  return c.json({ data });
});

/** Linear lifecycle order used to validate backward `revert` moves. */
const STAGE_ORDER = ['draft', 'sent', 'awaiting_payment', 'in_progress', 'ready', 'installed'];

const revertSchema = z
  .object({
    to: z.enum(['draft', 'sent', 'awaiting_payment', 'in_progress', 'ready', 'installed']),
  })
  .strict();

/**
 * Reverts an order to an EARLIER lifecycle stage (manual override).
 * Only backward moves are allowed. Stage-dependent metadata is reset to
 * match the target: confirmed_at cleared below awaiting_payment, sent_at
 * cleared below sent, and the installation schedule cleared below ready.
 * Payments are a ledger and are never deleted by a revert. An `expired`
 * order is treated as just past `sent`, so it can be reverted to draft
 * or sent (i.e. re-activated).
 */
app.post('/:id/revert', async (c) => {
  const parsed = revertSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: firstZodIssue(parsed.error) }, 400);
  const to = parsed.data.to;
  const id = c.req.param('id');
  const sb = createSupabaseAdmin(c.env);

  const { data: existing } = await sb
    .from('orders')
    .select('id, status')
    .eq('id', id)
    .maybeSingle();
  if (!existing) return c.json({ error: 'Order not found' }, 404);

  const curIdx =
    existing.status === 'expired' ? 2 : STAGE_ORDER.indexOf(existing.status);
  const toIdx = STAGE_ORDER.indexOf(to);
  if (curIdx < 0) return c.json({ error: `Cannot revert from ${existing.status}.` }, 409);
  if (toIdx >= curIdx) {
    return c.json({ error: 'Revert only moves an order to an earlier stage.' }, 409);
  }

  const update: Record<string, unknown> = { status: to };
  if (toIdx < STAGE_ORDER.indexOf('awaiting_payment')) update.confirmed_at = null;
  if (toIdx < STAGE_ORDER.indexOf('sent')) update.sent_at = null;
  if (toIdx < STAGE_ORDER.indexOf('ready')) {
    update.install_status = 'unscheduled';
    update.install_date = null;
    update.install_time = null;
    update.install_confirmed_at = null;
    update.install_response_note = '';
  }

  const { error } = await sb.from('orders').update(update).eq('id', id);
  if (error) return c.json({ error: error.message }, 500);

  const { data } = await readDetail(sb, id);
  if (data) data.amount_paid = sumPayments(data.payments);
  return c.json({ data });
});

/** Clears a proposed/confirmed installation time (back to unscheduled). */
app.post('/:id/install/cancel', async (c) => {
  const sb = createSupabaseAdmin(c.env);
  const id = c.req.param('id');
  const { data: existing } = await sb
    .from('orders')
    .select('id, install_status')
    .eq('id', id)
    .maybeSingle();
  if (!existing) return c.json({ error: 'Order not found' }, 404);
  if (existing.install_status === 'unscheduled') {
    return c.json({ error: 'No installation time is set.' }, 409);
  }
  const { error } = await sb
    .from('orders')
    .update({
      install_status: 'unscheduled',
      install_date: null,
      install_time: null,
      install_confirmed_at: null,
      install_response_note: '',
    })
    .eq('id', id);
  if (error) return c.json({ error: error.message }, 500);

  const { data } = await readDetail(sb, id);
  if (data) data.amount_paid = sumPayments(data.payments);
  return c.json({ data });
});

/** Deletes an order and its line items + payments (ON DELETE CASCADE). */
app.delete('/:id', async (c) => {
  const sb = createSupabaseAdmin(c.env);
  const id = c.req.param('id');
  const { data: existing } = await sb
    .from('orders')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (!existing) return c.json({ error: 'Order not found' }, 404);
  const { error } = await sb.from('orders').delete().eq('id', id);
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ data: { id } });
});

export default app;
