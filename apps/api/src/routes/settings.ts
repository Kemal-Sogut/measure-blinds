// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Settings route group — company info, catalog entities (cassette
 * options, control options, preset line items, blind types), Materials
 * (a catalog with many-to-many blind-type links), and the company logo
 * upload. Mounted at `/api/settings` behind `requireAuth`.
 *
 * Every write is Zod-validated before touching the database. The simple
 * catalog entities share one route factory since they differ only in
 * table name, price column, and ordering. Materials get their own
 * handlers because each Material also carries `blind_type_ids` (which
 * blind types it appears under), synced into the `material_blind_types`
 * join table; that join logic does not fit the generic factory. All of
 * this is still the single "settings endpoints" responsibility, kept
 * well under the 800-line limit.
 *
 * Responses: `{ data: T }` on success, `{ error: string }` on failure.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { createSupabaseAdmin } from '../lib/supabase';
import type { AuthVariables } from '../middleware/auth';
import type { Env } from '../index';

type SettingsApp = Hono<{ Bindings: Env; Variables: AuthVariables }>;

const app: SettingsApp = new Hono();

/* ------------------------------------------------------------------ */
/* Company settings (singleton row, id = 1)                            */
/* ------------------------------------------------------------------ */

/**
 * Validates PUT /company payloads. All fields optional — the route
 * performs a partial update of the singleton row. `logo_url` is
 * excluded on purpose: it is only ever set via the logo upload route.
 */
const companySchema = z
  .object({
    company_name: z.string().max(200),
    email: z.string().email().or(z.literal('')),
    phone: z.string().max(50),
    address: z.string().max(500),
    hst_number: z.string().max(50),
    default_expiry_days: z.number().int().min(1).max(365),
    terms_and_conditions: z.string().max(20_000),
    /** Google review link for the post-installation review request. */
    google_review_url: z.string().url().max(500).or(z.literal('')),
    /** Interac e-Transfer recipient shown on the public order summary. */
    etransfer_email: z.string().email().or(z.literal('')),
    /** Free-text instructions rendered under the e-Transfer address. */
    etransfer_instructions: z.string().max(1000),
  })
  .partial()
  .strict();

/** Returns the singleton company settings row. */
app.get('/company', async (c) => {
  const sb = createSupabaseAdmin(c.env);
  const { data, error } = await sb
    .from('company_settings')
    .select('*')
    .eq('id', 1)
    .single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ data });
});

/** Partially updates the singleton company settings row. */
app.put('/company', async (c) => {
  const parsed = companySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: firstZodIssue(parsed.error) }, 400);
  }
  const sb = createSupabaseAdmin(c.env);
  const { data, error } = await sb
    .from('company_settings')
    .update(parsed.data)
    .eq('id', 1)
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ data });
});

/* ------------------------------------------------------------------ */
/* Company logo upload                                                 */
/* ------------------------------------------------------------------ */

/** Maximum accepted logo size in bytes (2 MB per the plan). */
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

/** Storage bucket for company assets (public read, Worker-only write). */
const ASSETS_BUCKET = 'company-assets';

/**
 * Accepts a multipart/form-data upload (field name `file`), validates
 * it is an image ≤ 2 MB, stores it in Supabase Storage with a
 * timestamped name (cache busting), and saves the public URL onto the
 * company settings row. Returns the updated row.
 */
app.post('/company/logo', async (c) => {
  const body = await c.req.parseBody();
  const file = body['file'];

  if (!(file instanceof File)) {
    return c.json({ error: 'Attach an image as the "file" form field.' }, 400);
  }
  if (!file.type.startsWith('image/')) {
    return c.json({ error: 'Logo must be an image file.' }, 400);
  }
  if (file.size > MAX_LOGO_BYTES) {
    return c.json({ error: 'Logo must be 2 MB or smaller.' }, 400);
  }

  const ext = file.type.split('/')[1]?.replace('+xml', '') || 'png';
  const path = `logo-${Date.now()}.${ext}`;
  const sb = createSupabaseAdmin(c.env);

  const upload = await sb.storage
    .from(ASSETS_BUCKET)
    .upload(path, await file.arrayBuffer(), {
      contentType: file.type,
      upsert: true,
    });
  if (upload.error) return c.json({ error: upload.error.message }, 500);

  const { data: urlData } = sb.storage.from(ASSETS_BUCKET).getPublicUrl(path);
  const { data, error } = await sb
    .from('company_settings')
    .update({ logo_url: urlData.publicUrl })
    .eq('id', 1)
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ data });
});

/* ------------------------------------------------------------------ */
/* Catalog entities (cassettes / controls / presets / blind types)     */
/* ------------------------------------------------------------------ */

/** Configuration for one catalog entity handled by the route factory. */
interface CatalogConfig {
  /** URL segment under /api/settings (e.g. 'cassette-options') */
  path: string;
  /** Postgres table name */
  table: string;
  /** Zod schema for the entity's own fields (id/timestamps excluded) */
  schema: z.ZodObject<z.ZodRawShape>;
  /** Column list used for ordering list responses */
  orderBy: { column: string; ascending: boolean }[];
}

/** Shared field fragments for catalog schemas. */
const name = z.string().min(1, 'Name is required').max(200);
const price = z.number().min(0, 'Price cannot be negative').finite();
const active = z.boolean();
const sortOrder = z.number().int().min(0);

const catalogs: CatalogConfig[] = [
  {
    path: 'cassette-options',
    table: 'cassette_options',
    schema: z.object({ name, price_per_m: price, active, sort_order: sortOrder }),
    orderBy: [{ column: 'sort_order', ascending: true }, { column: 'name', ascending: true }],
  },
  {
    path: 'control-options',
    table: 'control_options',
    schema: z.object({ name, price_per_item: price, active, sort_order: sortOrder }),
    orderBy: [{ column: 'sort_order', ascending: true }, { column: 'name', ascending: true }],
  },
  {
    path: 'presets',
    table: 'preset_line_items',
    schema: z.object({ name, description: z.string().max(1000), unit_price: price, active }),
    orderBy: [{ column: 'name', ascending: true }],
  },
  {
    // Priceless catalog — only labels the blind (name + active + order).
    path: 'blind-types',
    table: 'blind_types',
    schema: z.object({ name, active, sort_order: sortOrder }),
    orderBy: [{ column: 'sort_order', ascending: true }, { column: 'name', ascending: true }],
  },
];

/**
 * Registers GET (list), POST (create), PUT /:id (update), and
 * DELETE /:id for one catalog entity. Create requires all schema
 * fields except `active`/`sort_order` (defaulted); update is partial.
 */
function registerCatalog(target: SettingsApp, cfg: CatalogConfig): void {
  const createSchema = cfg.schema.partial({ active: true, sort_order: true } as never);
  const updateSchema = cfg.schema.partial().strict();

  target.get(`/${cfg.path}`, async (c) => {
    const sb = createSupabaseAdmin(c.env);
    let query = sb.from(cfg.table).select('*');
    for (const o of cfg.orderBy) query = query.order(o.column, { ascending: o.ascending });
    const { data, error } = await query;
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ data });
  });

  target.post(`/${cfg.path}`, async (c) => {
    const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: firstZodIssue(parsed.error) }, 400);
    const sb = createSupabaseAdmin(c.env);
    const { data, error } = await sb.from(cfg.table).insert(parsed.data).select().single();
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ data }, 201);
  });

  target.put(`/${cfg.path}/:id`, async (c) => {
    const parsed = updateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: firstZodIssue(parsed.error) }, 400);
    const sb = createSupabaseAdmin(c.env);
    const { data, error } = await sb
      .from(cfg.table)
      .update(parsed.data)
      .eq('id', c.req.param('id'))
      .select()
      .maybeSingle();
    if (error) return c.json({ error: error.message }, 500);
    if (!data) return c.json({ error: 'Not found' }, 404);
    return c.json({ data });
  });

  target.delete(`/${cfg.path}/:id`, async (c) => {
    const sb = createSupabaseAdmin(c.env);
    const { data, error } = await sb
      .from(cfg.table)
      .delete()
      .eq('id', c.req.param('id'))
      .select('id')
      .maybeSingle();
    if (error) return c.json({ error: error.message }, 500);
    if (!data) return c.json({ error: 'Not found' }, 404);
    return c.json({ data: { id: data.id } });
  });
}

for (const cfg of catalogs) registerCatalog(app, cfg);

/* ------------------------------------------------------------------ */
/* Materials (catalog + many-to-many blind-type links)                 */
/* ------------------------------------------------------------------ */

/**
 * Full Materials schema. `blind_type_ids` is NOT a column — it is the
 * set of blind types this Material appears under, synced into the
 * `material_blind_types` join table. An empty/absent list means the
 * Material is available for ALL blind types (see the line-item editor).
 */
const materialSchema = z.object({
  name,
  price_per_sqm: price,
  active,
  sort_order: sortOrder,
  /**
   * Fabric roll width in cm — a manufacturing input (not money). Positive
   * when present; `null` clears it (the cut planner then assumes 300 cm).
   */
  width_cm: z.number().positive('Width must be greater than 0').finite().nullable(),
  blind_type_ids: z.array(z.string().uuid()).max(50),
});

/** Create: only name + price required; the rest default / optional. */
const materialCreateSchema = materialSchema.partial({
  active: true,
  sort_order: true,
  width_cm: true,
  blind_type_ids: true,
} as never);

/** Update: partial; `.strict()` still rejects unknown fields. */
const materialUpdateSchema = materialSchema.partial().strict();

/** Nested select shape used to attach `blind_type_ids` to a Material. */
type MaterialRow = Record<string, unknown> & {
  material_blind_types?: { blind_type_id: string }[];
};

/** Flattens the join embed into a plain `blind_type_ids: string[]`. */
function withBlindTypeIds(row: MaterialRow) {
  const { material_blind_types, ...rest } = row;
  return { ...rest, blind_type_ids: (material_blind_types ?? []).map((l) => l.blind_type_id) };
}

/** Replaces a Material's blind-type links with the given set. */
async function syncMaterialLinks(
  sb: ReturnType<typeof createSupabaseAdmin>,
  materialId: string,
  blindTypeIds: string[]
): Promise<string | null> {
  const del = await sb.from('material_blind_types').delete().eq('material_id', materialId);
  if (del.error) return del.error.message;
  if (blindTypeIds.length > 0) {
    const ins = await sb
      .from('material_blind_types')
      .insert(blindTypeIds.map((bt) => ({ material_id: materialId, blind_type_id: bt })));
    if (ins.error) return ins.error.message;
  }
  return null;
}

/** Lists Materials (sorted), each with its linked `blind_type_ids`. */
app.get('/materials', async (c) => {
  const sb = createSupabaseAdmin(c.env);
  const { data, error } = await sb
    .from('materials')
    .select('*, material_blind_types(blind_type_id)')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ data: (data ?? []).map((r) => withBlindTypeIds(r as MaterialRow)) });
});

/** Creates a Material and its blind-type links. */
app.post('/materials', async (c) => {
  const parsed = materialCreateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: firstZodIssue(parsed.error) }, 400);
  const { blind_type_ids = [], ...fields } = parsed.data;
  const sb = createSupabaseAdmin(c.env);

  const { data, error } = await sb.from('materials').insert(fields).select().single();
  if (error) return c.json({ error: error.message }, 500);

  const linkError = await syncMaterialLinks(sb, data.id as string, blind_type_ids);
  if (linkError) return c.json({ error: linkError }, 500);
  return c.json({ data: { ...data, blind_type_ids } }, 201);
});

/** Updates a Material's fields and/or its blind-type links (partial). */
app.put('/materials/:id', async (c) => {
  const parsed = materialUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: firstZodIssue(parsed.error) }, 400);
  const id = c.req.param('id');
  const { blind_type_ids, ...fields } = parsed.data;
  const sb = createSupabaseAdmin(c.env);

  if (Object.keys(fields).length > 0) {
    const { error } = await sb.from('materials').update(fields).eq('id', id);
    if (error) return c.json({ error: error.message }, 500);
  }
  if (blind_type_ids !== undefined) {
    const linkError = await syncMaterialLinks(sb, id, blind_type_ids);
    if (linkError) return c.json({ error: linkError }, 500);
  }

  const { data, error } = await sb
    .from('materials')
    .select('*, material_blind_types(blind_type_id)')
    .eq('id', id)
    .maybeSingle();
  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: 'Not found' }, 404);
  return c.json({ data: withBlindTypeIds(data as MaterialRow) });
});

/** Deletes a Material; its blind-type links cascade in the DB. */
app.delete('/materials/:id', async (c) => {
  const sb = createSupabaseAdmin(c.env);
  const { data, error } = await sb
    .from('materials')
    .delete()
    .eq('id', c.req.param('id'))
    .select('id')
    .maybeSingle();
  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: 'Not found' }, 404);
  return c.json({ data: { id: data.id } });
});

/**
 * Extracts the first, most user-relevant message from a ZodError so
 * the frontend can show a single actionable toast.
 */
function firstZodIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue ? `${issue.path.join('.') || 'payload'}: ${issue.message}` : 'Invalid payload';
}

export default app;
