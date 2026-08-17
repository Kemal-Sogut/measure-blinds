// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Settings route group — company info, catalog entities (cassette
 * options, bottom rail options, control options, pleat types,
 * installation options, preset line items, blind types), Materials (a
 * catalog with many-to-many blind-type links), and the company logo
 * upload. Mounted at `/api/settings` behind `requireAuth`.
 *
 * Cassette, bottom rail, control and installation options each carry
 * `blind_type_ids` — the blind types they are offered for — synced into a
 * `<catalog>_blind_types` join table by the shared factory. An option
 * with no links is offered for no type, which is how a hardware slot is
 * switched off for a blind type entirely (migration 35). Pleat types
 * remain a Curtains-only attribute catalog with no scoping: a curtain's
 * price depends on the pleat's fullness ratio, resolved from the id
 * server-side when an order is saved (see `resolveLineItems`) and never
 * sent by a client.
 *
 * Every write is Zod-validated before touching the database. The simple
 * catalog entities share one route factory since they differ only in
 * table name, price column, ordering, and whether they are scoped.
 * Materials keep their own handlers: their links carry the OPPOSITE
 * convention (no links = every blind type), so folding them into the
 * factory would put two contradictory rules behind one flag. All of this
 * is still the single "settings endpoints" responsibility, kept well
 * under the 800-line limit.
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
/* Catalog entities (cassettes / bottom rails / controls / presets /   */
/* blind types)                                                        */
/* ------------------------------------------------------------------ */

/**
 * Blind-type scoping for a catalog whose options are offered per blind
 * type — cassette, bottom rail, control and installation.
 *
 * An option with NO links is offered for NO blind type. That is the
 * OPPOSITE of the Materials convention, and deliberately so: it is what
 * lets the shop switch a whole hardware slot off for a blind type from
 * the settings page (migration 35). The line-item form renders a slot's
 * dropdown only while at least one active option is scoped to the type,
 * and the Worker enforces the save on the same rule.
 */
interface CatalogLinks {
  /** Join table (e.g. 'cassette_option_blind_types'). */
  table: string;
  /** Option-side foreign key column in that table. */
  fk: string;
}

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
  /**
   * Blind-type scoping, for the four catalogs that have it. Present means
   * rows carry `blind_type_ids` on the way in and out; absent means the
   * field is rejected, because a pleat type or a preset has no such
   * notion.
   */
  links?: CatalogLinks;
}

/** Shared field fragments for catalog schemas. */
const name = z.string().min(1, 'Name is required').max(200);
const price = z.number().min(0, 'Price cannot be negative').finite();
const active = z.boolean();
const sortOrder = z.number().int().min(0);

/**
 * How a hardware option's price is charged. Mirrors the `price_basis`
 * check constraint added by migration 36 and the `PriceBasis` union the
 * pricing modules switch on — all three must list the same members, or a
 * row could be saved that the formula cannot price.
 */
const priceBasis = z.enum(['per_m', 'per_sqm', 'per_unit', 'per_panel']);

/**
 * The shape shared by all four hardware catalogs since migration 36:
 * a name, one rate, the basis that rate is charged on, and the usual
 * flags. Identical across the four, which is also what lets the Worker
 * resolve them through a single lookup.
 */
const hardwareSchema = z.object({
  name,
  price,
  price_basis: priceBasis,
  active,
  sort_order: sortOrder,
});

const catalogs: CatalogConfig[] = [
  {
    path: 'cassette-options',
    table: 'cassette_options',
    schema: hardwareSchema,
    orderBy: [{ column: 'sort_order', ascending: true }, { column: 'name', ascending: true }],
    links: { table: 'cassette_option_blind_types', fk: 'cassette_option_id' },
  },
  {
    // Priced per linear metre of width, the same basis as the cassette.
    path: 'bottom-rail-options',
    table: 'bottom_rail_options',
    schema: hardwareSchema,
    orderBy: [{ column: 'sort_order', ascending: true }, { column: 'name', ascending: true }],
    links: { table: 'bottom_rail_option_blind_types', fk: 'bottom_rail_option_id' },
  },
  {
    path: 'control-options',
    table: 'control_options',
    schema: hardwareSchema,
    orderBy: [{ column: 'sort_order', ascending: true }, { column: 'name', ascending: true }],
    links: { table: 'control_option_blind_types', fk: 'control_option_id' },
  },
  {
    // Curtains fullness ratios. NOT the shared `price` fragment: that
    // allows 0, and a 0 multiplier would zero the whole curtain line.
    path: 'pleat-types',
    table: 'pleat_types',
    schema: z.object({
      name,
      multiplier: z.number().positive('Multiplier must be greater than 0').max(20).finite(),
      active,
      sort_order: sortOrder,
    }),
    orderBy: [{ column: 'sort_order', ascending: true }, { column: 'name', ascending: true }],
  },
  {
    // Rod / track, charged once per blind rather than per metre.
    path: 'installation-options',
    table: 'installation_options',
    schema: hardwareSchema,
    orderBy: [{ column: 'sort_order', ascending: true }, { column: 'name', ascending: true }],
    links: { table: 'installation_option_blind_types', fk: 'installation_option_id' },
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
 * Replaces one option's blind-type links with the given set, returning an
 * error message or null.
 *
 * Delete-then-insert rather than a diff: the set is a handful of rows, and
 * a diff would have to reason about a concurrent edit to stay correct.
 * An empty list deletes everything and inserts nothing, which is exactly
 * "offered for no blind type".
 */
async function syncCatalogLinks(
  sb: ReturnType<typeof createSupabaseAdmin>,
  links: CatalogLinks,
  rowId: string,
  blindTypeIds: string[]
): Promise<string | null> {
  const del = await sb.from(links.table).delete().eq(links.fk, rowId);
  if (del.error) return del.error.message;
  if (blindTypeIds.length === 0) return null;
  const { error } = await sb
    .from(links.table)
    .insert(blindTypeIds.map((blind_type_id) => ({ [links.fk]: rowId, blind_type_id })));
  return error ? error.message : null;
}

/**
 * Flattens the join embed a scoped catalog is selected with into a plain
 * `blind_type_ids: string[]`, so clients never see the join table's shape.
 */
function flattenCatalogLinks(
  row: Record<string, unknown>,
  links: CatalogLinks
): Record<string, unknown> {
  const { [links.table]: embed, ...rest } = row;
  const ids = ((embed ?? []) as { blind_type_id: string }[]).map((l) => l.blind_type_id);
  return { ...rest, blind_type_ids: ids };
}

/**
 * Registers GET (list), POST (create), PUT /:id (update), and
 * DELETE /:id for one catalog entity. Create requires all schema
 * fields except `active`/`sort_order` (defaulted); update is partial.
 *
 * A catalog with `links` also accepts and returns `blind_type_ids`, kept
 * in sync with its join table. A catalog without them REJECTS the field,
 * because the schemas are strict and a silently ignored scoping list
 * would look like it had been saved.
 */
function registerCatalog(target: SettingsApp, cfg: CatalogConfig): void {
  const links = cfg.links;
  /** Row shape including the scoping list, when the catalog has one. */
  const fullSchema = links
    ? cfg.schema.extend({ blind_type_ids: z.array(z.string().uuid()).max(50) })
    : cfg.schema;
  // `.strict()`, so a field this catalog does not have is a 400 rather
  // than a silent strip — a scoping list sent to an unscoped catalog
  // would otherwise look saved and simply never take effect.
  const createSchema = fullSchema
    .partial({
      active: true,
      sort_order: true,
      ...(links ? { blind_type_ids: true } : {}),
    } as never)
    .strict();
  const updateSchema = fullSchema.partial().strict();
  const selectCols = links ? `*, ${links.table}(blind_type_id)` : '*';

  target.get(`/${cfg.path}`, async (c) => {
    const sb = createSupabaseAdmin(c.env);
    let query = sb.from(cfg.table).select(selectCols);
    for (const o of cfg.orderBy) query = query.order(o.column, { ascending: o.ascending });
    const { data, error } = await query;
    if (error) return c.json({ error: error.message }, 500);
    if (!links) return c.json({ data });
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    return c.json({ data: rows.map((r) => flattenCatalogLinks(r, links)) });
  });

  target.post(`/${cfg.path}`, async (c) => {
    const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: firstZodIssue(parsed.error) }, 400);
    const sb = createSupabaseAdmin(c.env);
    const { blind_type_ids = [], ...fields } = parsed.data as Record<string, unknown> & {
      blind_type_ids?: string[];
    };
    const { data, error } = await sb.from(cfg.table).insert(fields).select().single();
    if (error) return c.json({ error: error.message }, 500);
    if (!links) return c.json({ data }, 201);
    const linkError = await syncCatalogLinks(sb, links, (data as { id: string }).id, blind_type_ids);
    if (linkError) return c.json({ error: linkError }, 500);
    return c.json({ data: { ...data, blind_type_ids } }, 201);
  });

  target.put(`/${cfg.path}/:id`, async (c) => {
    const parsed = updateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: firstZodIssue(parsed.error) }, 400);
    const sb = createSupabaseAdmin(c.env);
    const id = c.req.param('id');
    const { blind_type_ids, ...fields } = parsed.data as Record<string, unknown> & {
      blind_type_ids?: string[];
    };

    // A links-only edit must not issue an empty UPDATE — PostgREST
    // rejects one, and there is nothing on the row to change.
    if (Object.keys(fields).length > 0) {
      const { error } = await sb.from(cfg.table).update(fields).eq('id', id);
      if (error) return c.json({ error: error.message }, 500);
    }
    if (links && blind_type_ids !== undefined) {
      const linkError = await syncCatalogLinks(sb, links, id, blind_type_ids);
      if (linkError) return c.json({ error: linkError }, 500);
    }

    const { data, error } = await sb
      .from(cfg.table)
      .select(selectCols)
      .eq('id', id)
      .maybeSingle();
    if (error) return c.json({ error: error.message }, 500);
    if (!data) return c.json({ error: 'Not found' }, 404);
    if (!links) return c.json({ data });
    return c.json({ data: flattenCatalogLinks(data as unknown as Record<string, unknown>, links) });
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
/* Blind-type defaults (one row per blind type)                        */
/* ------------------------------------------------------------------ */

/**
 * Payload for saving one blind type's defaults. `.strict()` and fully
 * nullable: null CLEARS a default field rather than requiring a
 * different verb to un-set it. Money never appears here — these are
 * catalog ids only; prices stay server-resolved at order time, exactly
 * like every other catalog-carrying payload in this file.
 */
const blindTypeDefaultsSchema = z
  .object({
    material_id: z.string().uuid().nullable(),
    cassette_id: z.string().uuid().nullable(),
    bottom_rail_id: z.string().uuid().nullable(),
    control_id: z.string().uuid().nullable(),
    installation_id: z.string().uuid().nullable(),
  })
  .strict();

/**
 * Field → (join table, join FK, options table, label) driving the PUT
 * handler's per-id validation below.
 *
 * The four hardware entries are copied from `SLOT_TABLES` in
 * `lib/optionScoping.ts` — the same join tables `loadSlotScoping` reads
 * to enforce "active AND linked" on order saves — so a stored default
 * can never disagree with what a line item is allowed to carry.
 *
 * The Material entry targets `material_blind_types` and is validated
 * with that SAME strict "a link row must exist" rule, deliberately NOT
 * the friendlier "no links = offered for every blind type" convention
 * described in this file's Materials section and in migration 20's
 * comment. That convention is not actually what the shipped web form
 * implements: `materialsForType` (apps/web/src/pages/orders/
 * lineItemDrafts.ts) filters with a plain `blind_type_ids.includes(id)`
 * and has no empty-means-all branch, so in practice an unlinked Material
 * already renders in NO blind type's dropdown. Mirroring that strict
 * behavior here — rather than the documented-but-unimplemented
 * convention — is what guarantees a saved Material default is always
 * something the order form can actually apply.
 */
const DEFAULT_LINKS = [
  { field: 'material_id', join: 'material_blind_types', fk: 'material_id', options: 'materials', label: 'Material' },
  { field: 'cassette_id', join: 'cassette_option_blind_types', fk: 'cassette_option_id', options: 'cassette_options', label: 'Cassette' },
  { field: 'bottom_rail_id', join: 'bottom_rail_option_blind_types', fk: 'bottom_rail_option_id', options: 'bottom_rail_options', label: 'Bottom rail' },
  { field: 'control_id', join: 'control_option_blind_types', fk: 'control_option_id', options: 'control_options', label: 'Control' },
  { field: 'installation_id', join: 'installation_option_blind_types', fk: 'installation_option_id', options: 'installation_options', label: 'Installation' },
] as const;

/**
 * Lists every saved blind-type defaults row — at most one per blind
 * type, keyed by `blind_type_id`. A blind type that has never had
 * defaults saved is simply absent from the array; callers (the settings
 * page, the order form) treat a missing row the same as one whose five
 * fields are all null, so no placeholder row needs to exist up front.
 */
app.get('/blind-type-defaults', async (c) => {
  const sb = createSupabaseAdmin(c.env);
  const { data, error } = await sb.from('blind_type_defaults').select('*');
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ data });
});

/**
 * Upserts one blind type's defaults after validating every non-null id
 * against `DEFAULT_LINKS`: it must be an ACTIVE option linked to
 * `blindTypeId` in that catalog's join table — the "active AND linked"
 * rule `loadSlotScoping` enforces for hardware at order-save time,
 * applied here to all five slots including Material. This is what keeps
 * a stored default from ever producing a draft the order form cannot
 * save. Responds 500 if any lookup itself fails (transport/permission/DB
 * error — never mistaken for a genuine not-found, so infrastructure
 * failures stay visible instead of masquerading as bad input), 404 when
 * `blindTypeId` does not name a `blind_types` row, and 400 naming the
 * offending field on the first check that fails (not-linked and inactive
 * are reported as distinct messages so the settings page can explain
 * which). A `null` field is left unvalidated and clears any existing
 * default for that slot.
 */
app.put('/blind-type-defaults/:blindTypeId', async (c) => {
  const parsed = blindTypeDefaultsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: firstZodIssue(parsed.error) }, 400);
  const blindTypeId = c.req.param('blindTypeId');
  const sb = createSupabaseAdmin(c.env);

  const { data: type, error: typeError } = await sb
    .from('blind_types')
    .select('id')
    .eq('id', blindTypeId)
    .maybeSingle();
  if (typeError) return c.json({ error: typeError.message }, 500);
  if (!type) return c.json({ error: 'Unknown blind type.' }, 404);

  for (const { field, join, fk, options, label } of DEFAULT_LINKS) {
    const id = parsed.data[field];
    if (!id) continue;
    const { data: link, error: linkError } = await sb
      .from(join)
      .select(fk)
      .eq(fk, id)
      .eq('blind_type_id', blindTypeId)
      .maybeSingle();
    if (linkError) return c.json({ error: linkError.message }, 500);
    if (!link) return c.json({ error: `${label} default is not offered for this blind type.` }, 400);
    const { data: opt, error: optError } = await sb
      .from(options)
      .select('id')
      .eq('id', id)
      .eq('active', true)
      .maybeSingle();
    if (optError) return c.json({ error: optError.message }, 500);
    if (!opt) return c.json({ error: `${label} default is inactive.` }, 400);
  }

  const { data, error } = await sb
    .from('blind_type_defaults')
    .upsert({ blind_type_id: blindTypeId, ...parsed.data })
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ data });
});

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
