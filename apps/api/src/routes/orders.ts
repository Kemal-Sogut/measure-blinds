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
 *                         editable at ANY lifecycle stage
 *   GET    /:id/logs      activity trail (newest first)
 *   GET    /:id/pdf       stream the Estimate (or Invoice once paid) PDF
 *   POST   /:id/send      email the estimate to the customer (→ sent)
 *   POST   /:id/mark-sent mark as sent WITHOUT emailing (draft → sent)
 *   POST   /:id/public-token
 *                         return the customer-facing capability token,
 *                         minting one if absent — backs the staff
 *                         "Customer View" preview on unsent drafts
 *   POST   /:id/confirm   user confirm (draft/sent → awaiting_payment)
 *   POST   /:id/unconfirm reverse a confirmation (awaiting_payment → sent)
 *   POST   /:id/payments  record a payment (awaiting_payment → in_progress
 *                         on the first one); balance derived from ledger
 *   POST   /:id/payments/:paymentId/receipt
 *                         email a branded receipt for one payment with
 *                         server-computed paid-to-date and balance;
 *                         stamps payments.receipt_sent_at on success
 *   POST   /:id/cancel-request/resolve
 *                         answer a customer's cancellation request:
 *                         accept (reverses the confirmation, no email)
 *                         or deny (keeps it, emails the customer)
 *   POST   /:id/ready     goods ready to install (in_progress → ready)
 *   POST   /:id/installed terminal state (ready → installed)
 *   POST   /:id/revert    move an order back to an earlier stage
 *
 * Scheduling (estimate visits + installations) lives in the standalone
 * `appointments` table and is served by routes/appointments.ts — this
 * module no longer carries any calendar or visit-proposal endpoints.
 *   DELETE /:id           delete an order (+ line items + payments)
 *
 * AUTHORITATIVE PRICING: clients send measurements and option IDs only.
 * The Worker fetches material/cassette/bottom-rail/control prices from
 * the catalog, snapshots names + prices onto each line item, and
 * computes unit prices, line totals, and order totals with lib/pricing
 * + lib/totals. Client-computed money values are never trusted or
 * persisted.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdmin } from '../lib/supabase';
import { calculateBlindUnitPriceForType } from '../lib/pricing';
import { getBlindType } from '../lib/blindTypes';
import type {
  CatalogResolver,
  CatalogSlot,
  HardwareCharge,
  PriceBasis,
} from '../lib/blindTypes/base';
import { loadSlotScoping } from '../lib/optionScoping';
import { calculateTotals } from '../lib/totals';
import { applyPriceAdjustments, type Addon } from '../lib/lineItemAdjustments';
import { describePriceChanges } from '../lib/lineItemAuditLog';
import { recordOrderPayment } from '../lib/payments';
import { generateOrderNumber, parseDateOnly } from '../lib/orderNumber';
import { buildDocumentPdf, fetchLogo, toBase64, type PdfDocumentData } from '../lib/pdf';
import { greetingName } from '../lib/customerName';
import { formatDateLong } from '../lib/timeText';
import { issueWarrantyIfPaid } from '../lib/warrantyIssue';
import { toDuplicateInput } from '../lib/orderDuplicate';
import { buildWarrantyCoverage } from '../lib/warranty';
import { buildWarrantyPdf } from '../lib/warrantyPdf';
import {
  sendEmail,
  brandFromSettings,
  buildEstimateEmailHtml,
  buildInvoiceEmailHtml,
  buildReceiptEmailHtml,
  buildCancellationDeniedHtml,
} from '../lib/email';
import type { AuthVariables } from '../middleware/auth';
import type { Env } from '../index';

const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

/* ------------------------------------------------------------------ */
/* Validation schemas                                                  */
/* ------------------------------------------------------------------ */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/**
 * One consultant-added extra on a line item.
 *
 * `addons[].price` and `unit_price_override` below are, alongside a
 * custom item's own `unit_price`, the ONLY money a client may dictate —
 * a deliberate, named widening of AI_GUIDELINES rule 1 rather than a
 * loosened schema. The bounds here are the whole guard, and every value
 * that gets through is written to the order activity log on save.
 *
 * `.strict()` is what stops a future `taxable` or `cost` field from
 * riding along inside an add-on unnoticed.
 */
const addonSchema = z
  .object({
    label: z.string().min(1, 'Add-on needs a label').max(200),
    price: z.number().min(0).max(1_000_000),
  })
  .strict();

/** Adjustment fields shared by every line-item shape. */
const adjustmentFields = {
  addons: z.array(addonSchema).max(10, 'At most 10 add-ons per item').default([]),
  show_original_price: z.boolean().default(true),
};

/**
 * The identity and visibility fields every line-item shape carries.
 *
 * `uid` is optional on the wire: an item the client has never saved has
 * none, and the Worker mints one. An item that HAS been saved sends back
 * the uid it was given, which is the only way `PUT /:id` can tell —
 * across the wholesale delete/insert every save performs — whether a
 * given item's visibility changed. Position cannot answer that: it moves
 * whenever an item is added, removed or reordered.
 *
 * `hidden` keeps an item in the editor while removing it from the order
 * total and from every customer- and production-facing document. It
 * defaults to false, so any caller that omits it leaves every item
 * visible.
 */
const identityFields = {
  uid: z.string().uuid().optional(),
  hidden: z.boolean().default(false),
};

/**
 * Consultant-typed unit price replacing the calculated one. Absent from
 * `customItemBase` on purpose — a custom item's price is already freely
 * typed, so a second price field would be two names for one number.
 */
const overrideField = z.number().min(0).max(1_000_000).nullable().default(null);

/**
 * Blind line item: measurements + catalog option ids — deliberately
 * `.strict()` so any client-supplied money field (unit_price etc.) is
 * REJECTED with 400 rather than silently stripped; pricing is
 * exclusively server-side apart from the declared adjustment fields.
 */
const blindItemSchema = z
  .object({
    item_type: z.literal('blind'),
    room_name: z.string().max(200).default(''),
    blinds_type: z.string().max(100).default(''),
    panels: z.array(z.number().positive().max(1000)).min(1, 'At least one panel').max(10),
    height_cm: z.number().positive().max(1000),
    material_id: z.string().uuid(),
    /**
     * All four nullable because a blind type may not use a slot at all —
     * Curtains has neither a cassette nor a bottom rail. WHICH slots a
     * type uses is DATA (the `<catalog>_blind_types` join tables,
     * migration 35) and is enforced in `resolveLineItems` via
     * `loadSlotScoping`, not here: Zod cannot branch on the sibling
     * `blinds_type` field. Sending an id for a slot the type does not use
     * is rejected there, so the form and the price cannot disagree.
     *
     * `control_id` joined the nullable set with migration 35: a type with
     * no control option scoped to it prices its control at 0 and stores
     * null, exactly as the cassette already did.
     */
    cassette_id: z.string().uuid().nullable().default(null),
    bottom_rail_id: z.string().uuid().nullable().default(null),
    control_id: z.string().uuid().nullable().default(null),
    installation_id: z.string().uuid().nullable().default(null),
    color: z.string().max(100).default(''),
    note: z.string().max(1000).default(''),
    /**
     * The blind type's own extra inputs. Accepted loosely here and
     * re-parsed in `resolveLineItems` through that type's own
     * `attributeSchema`, because the discriminator this shape needs
     * (`blinds_type`) is a sibling field — Zod cannot branch on it in
     * the same object. That second parse is `.strict()`, so an
     * undeclared key is still a 400.
     */
    attributes: z.record(z.unknown()).default({}),
    quantity: z.number().int().min(1).max(999),
    unit_price_override: overrideField,
    ...adjustmentFields,
    ...identityFields,
  })
  .strict();

/**
 * Preset line item: a catalog reference the Worker prices itself.
 *
 * `unit_price` survives ONLY for rows created before `preset_id` existed
 * — an order saved back with a legacy preset item still has to
 * round-trip. When `preset_id` is present the sent `unit_price` is
 * ignored entirely and the catalog price wins, which is what makes
 * "reset to calculated" mean something on a preset.
 *
 * Left UN-refined: `z.discriminatedUnion` requires each member to be a
 * plain object schema, and `.refine()` would return a `ZodEffects` it
 * refuses. The cross-field rules live on the union's `superRefine`.
 */
const presetItemBase = z
  .object({
    item_type: z.literal('preset'),
    preset_id: z.string().uuid().nullable().default(null),
    title: z.string().max(200).default(''),
    description: z.string().max(2000).default(''),
    quantity: z.number().int().min(1).max(999),
    unit_price: z.number().min(0).max(1_000_000).optional(),
    unit_price_override: overrideField,
    ...adjustmentFields,
    ...identityFields,
  })
  .strict();

/** Custom line item: free-form title, multi-line description, typed price. */
const customItemBase = z
  .object({
    item_type: z.literal('custom'),
    title: z.string().max(200).default(''),
    description: z.string().max(2000).default(''),
    quantity: z.number().int().min(1).max(999),
    unit_price: z.number().min(0).max(1_000_000),
    ...adjustmentFields,
    ...identityFields,
  })
  .strict();

/**
 * The three item shapes, plus the rules that span two fields at once and
 * therefore cannot live on either field alone.
 */
const lineItemSchema = z
  .discriminatedUnion('item_type', [blindItemSchema, presetItemBase, customItemBase])
  .superRefine((it, ctx) => {
    if (it.item_type === 'blind') return;
    // A flat item with no text at all would print as a nameless row on
    // every document. Either field alone is enough.
    if (it.title.trim() === '' && it.description.trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Give the item a title or a description',
      });
    }
    // A preset is priced from the catalog OR carries a legacy typed
    // price. With neither there is nothing to charge.
    if (it.item_type === 'preset' && it.preset_id === null && it.unit_price === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Preset item needs a preset or a price',
      });
    }
  });

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
    /** When set, links & marks this pending e-Transfer as applied. */
    etransfer_id: z.string().uuid().optional(),
  })
  .strict();

/** Optional consultant note accepted when emailing an estimate/invoice/receipt. */
const sendMessageSchema = z
  .object({ message: z.string().max(1000).optional() })
  .strict();

/**
 * Payload for POST /:id/cancel-request/resolve.
 *
 * `accept` mirrors the `/cut-done { done }` shape. `message` is the
 * consultant's optional explanation, included in the denial email and
 * ignored entirely when `accept` is true (an accepted request sends no
 * email — the order simply returns to `sent`).
 */
const resolveCancelSchema = z
  .object({ accept: z.boolean(), message: z.string().max(1000).optional() })
  .strict();

/** Statuses that accept edits and estimate sends. */
const EDITABLE = ['draft', 'sent'] as const;

/** Confirmed statuses — the order is now an Invoice, not an Estimate. */
const CONFIRMED = ['awaiting_payment', 'in_progress', 'ready', 'installed'] as const;
function isConfirmed(status: string): boolean {
  return (CONFIRMED as readonly string[]).includes(status);
}


/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Row shape inserted into line_items (before order_id/position).
 *
 * `line_total`, `hidden` and `uid` are named rather than left to the
 * index signature because the totals sum and the visibility diff read
 * them directly, and neither should have to do so through `unknown`.
 */
type LineItemRow = Record<string, unknown> & {
  line_total: number;
  hidden: boolean;
  uid: string;
};

/**
 * Resolves validated line-item inputs into insertable rows:
 * fetches catalog prices for blind options, snapshots names + prices,
 * and computes unit_price / line_total server-side.
 *
 * @throws Error with a user-readable message when an option id is
 *         unknown (e.g. a material was deleted mid-edit).
 */
async function resolveLineItems(
  sb: SupabaseClient,
  items: z.infer<typeof lineItemSchema>[]
): Promise<LineItemRow[]> {
  const ids = {
    materials: new Set<string>(),
    cassette_options: new Set<string>(),
    bottom_rail_options: new Set<string>(),
    control_options: new Set<string>(),
    installation_options: new Set<string>(),
  };
  /**
   * Ids referenced from `attributes` rather than from a column, keyed by
   * table, together with the numeric column that table snapshots. Driven
   * entirely by each blind type's `catalogRefs`, so this loop needs no
   * knowledge of which types have diverged — it is empty for every type
   * that declares none.
   */
  const refIds = new Map<string, { valueColumn: string; ids: Set<string> }>();
  /**
   * Preset items carrying catalog provenance. Collected here so their
   * prices are fetched in the same batch as every other catalog price —
   * a preset is no more client-priced than a material is.
   */
  const presetIds = new Set<string>();
  for (const it of items) {
    if (it.item_type === 'preset') {
      if (it.preset_id) presetIds.add(it.preset_id);
      continue;
    }
    if (it.item_type !== 'blind') continue;
    ids.materials.add(it.material_id);
    if (it.cassette_id) ids.cassette_options.add(it.cassette_id);
    if (it.bottom_rail_id) ids.bottom_rail_options.add(it.bottom_rail_id);
    if (it.control_id) ids.control_options.add(it.control_id);
    if (it.installation_id) ids.installation_options.add(it.installation_id);
    for (const ref of getBlindType(it.blinds_type).catalogRefs) {
      const raw = (it.attributes as Record<string, unknown>)[ref.attrKey];
      if (typeof raw !== 'string' || raw === '') continue;
      const entry = refIds.get(ref.table) ?? {
        valueColumn: ref.valueColumn,
        ids: new Set<string>(),
      };
      entry.ids.add(raw);
      refIds.set(ref.table, entry);
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

  /**
   * Fetches id → {name, price, basis} for one HARDWARE catalog.
   *
   * All four share the same two column names since migration 36, which is
   * what lets one helper serve them where there used to be four calls
   * differing only in a price column. The basis comes from the row and is
   * never client-supplied — it decides what the rate MEANS, so a client
   * that could pick it could pick the price.
   */
  async function hardwareLookup(table: string, idSet: Set<string>) {
    const empty = new Map<string, { name: string; price: number; basis: PriceBasis }>();
    if (idSet.size === 0) return empty;
    const { data, error } = await sb
      .from(table)
      .select('id, name, price, price_basis')
      .in('id', [...idSet]);
    if (error) throw new Error(error.message);
    return new Map(
      (data as unknown as Record<string, unknown>[]).map((r) => [
        String(r.id),
        {
          name: String(r.name),
          price: Number(r.price),
          basis: String(r.price_basis) as PriceBasis,
        },
      ])
    );
  }

  const [materials, cassettes, bottomRails, controls, installations, presets, scoping] =
    await Promise.all([
      lookup('materials', ids.materials, 'price_per_sqm'),
      hardwareLookup('cassette_options', ids.cassette_options),
      hardwareLookup('bottom_rail_options', ids.bottom_rail_options),
      hardwareLookup('control_options', ids.control_options),
      hardwareLookup('installation_options', ids.installation_options),
      lookup('preset_line_items', presetIds, 'unit_price'),
      // Which hardware slots each blind type uses. Data, not code — see
      // `lib/optionScoping.ts` and migration 35.
      loadSlotScoping(
        sb,
        items.flatMap((it) => (it.item_type === 'blind' ? [it.blinds_type] : []))
      ),
    ]);

  // One query per referenced catalog table. Empty for every blind type
  // that declares no refs, which today is all of them but Curtains.
  const refRows = new Map<string, Map<string, { name: string; price: number }>>();
  await Promise.all(
    [...refIds].map(async ([table, entry]) => {
      refRows.set(table, await lookup(table, entry.ids, entry.valueColumn));
    })
  );

  /** Backs `resolveCatalogRefs` with the rows just fetched. */
  const resolveRef: CatalogResolver = (table, id) => {
    const hit = refRows.get(table)?.get(id);
    return hit ? { name: hit.name, value: hit.price } : undefined;
  };

  // IMPORTANT: every row must carry the SAME column set. PostgREST
  // bulk inserts unify keys across rows and fill gaps with NULL, which
  // violates the not-null defaults (e.g. description on blind rows) —
  // caught by the live E2E run.
  return items.map((it, position) => {
    if (it.item_type !== 'blind') {
      // A preset with provenance is priced by the SERVER from the
      // catalog; any unit_price the client sent is ignored, exactly as a
      // material's price is. Only a legacy preset (saved before
      // preset_id existed) and a custom item fall back to the typed
      // figure.
      let base: number;
      if (it.item_type === 'preset' && it.preset_id) {
        const preset = presets.get(it.preset_id);
        if (!preset) throw new Error('Selected preset item no longer exists.');
        base = preset.price;
      } else {
        base = it.unit_price ?? 0;
      }
      // A custom item's price is already typed by the consultant, and a
      // legacy preset has no catalog default to return to — in both cases
      // `base` IS the typed figure, so an override would be a second name
      // for one number.
      const canOverride = it.item_type === 'preset' && it.preset_id !== null;
      const adjusted = applyPriceAdjustments({
        base,
        quantity: it.quantity,
        override: canOverride ? it.unit_price_override : null,
        addons: it.addons as Addon[],
      });
      return {
        item_type: it.item_type,
        position,
        // Minted here when the client has none — an item saved for the
        // first time has no identity yet, and this is where it gets one.
        uid: it.uid ?? crypto.randomUUID(),
        hidden: it.hidden,
        room_name: '',
        blinds_type: '',
        panels: [],
        height_cm: null,
        material_id: null,
        material_name: null,
        material_price_per_sqm: null,
        cassette_id: null,
        cassette_name: null,
        cassette_price_per_m: null,
        cassette_price_basis: null,
        bottom_rail_id: null,
        bottom_rail_name: null,
        bottom_rail_price_per_m: null,
        bottom_rail_price_basis: null,
        control_id: null,
        control_name: null,
        control_price_per_item: null,
        control_price_basis: null,
        installation_id: null,
        installation_name: null,
        installation_price_per_item: null,
        installation_price_basis: null,
        title: it.title,
        preset_id: it.item_type === 'preset' ? it.preset_id : null,
        description: it.description,
        note: '',
        color: '',
        // Flat items carry no per-type inputs, but the key MUST be present:
        // PostgREST unifies keys across bulk-inserted rows and NULL-fills
        // any row missing one, and `attributes` is not-null.
        attributes: {},
        quantity: it.quantity,
        show_original_price: it.show_original_price,
        unit_price: adjusted.unit_price,
        base_unit_price: adjusted.base_unit_price,
        addons: adjusted.addons,
        line_total: adjusted.line_total,
      };
    }
    const blindType = getBlindType(it.blinds_type);
    const label = it.blinds_type || 'this blind type';
    const material = materials.get(it.material_id);
    if (!material) throw new Error('Selected material no longer exists.');

    // Resolve the chosen rows FIRST. An id that no longer resolves is
    // reported as the deletion it is; deferring this behind the slot
    // gates below would report a deleted option as "this type does not
    // take one", because deleting the row cascades its scoping links away
    // and the slot goes quiet in the same breath.
    const cassette = it.cassette_id ? cassettes.get(it.cassette_id) : null;
    const bottomRail = it.bottom_rail_id ? bottomRails.get(it.bottom_rail_id) : null;
    const control = it.control_id ? controls.get(it.control_id) : null;
    const installation = it.installation_id ? installations.get(it.installation_id) : null;
    if (it.cassette_id && !cassette) throw new Error('Selected cassette option no longer exists.');
    if (it.bottom_rail_id && !bottomRail) {
      throw new Error('Selected bottom rail option no longer exists.');
    }
    if (it.control_id && !control) throw new Error('Selected control option no longer exists.');
    if (it.installation_id && !installation) {
      throw new Error('Selected installation option no longer exists.');
    }

    // A type either uses a hardware slot or it does not. Storing an id
    // for a slot the type has no formula for would name that option on
    // every document while contributing nothing to the price, so the
    // form and the total would disagree.
    //
    // An UNKNOWN blind type — legacy free text, or one since deleted from
    // Settings — has no scoping rows to consult and is left unconstrained:
    // demanding ids it never carried would make every pre-dropdown order
    // permanently unsavable.
    const enforced = scoping.isKnownType(it.blinds_type);
    const uses = (slot: CatalogSlot) => scoping.usesSlot(it.blinds_type, slot);
    if (enforced && uses('cassette') !== Boolean(it.cassette_id)) {
      throw new Error(
        it.cassette_id
          ? `Item ${position + 1}: ${label} does not take a cassette.`
          : `Item ${position + 1}: a cassette option is required.`
      );
    }
    if (enforced && uses('bottom_rail') !== Boolean(it.bottom_rail_id)) {
      throw new Error(
        it.bottom_rail_id
          ? `Item ${position + 1}: ${label} does not take a bottom rail.`
          : `Item ${position + 1}: a bottom rail option is required.`
      );
    }
    if (enforced && uses('control') !== Boolean(it.control_id)) {
      throw new Error(
        it.control_id
          ? `Item ${position + 1}: ${label} does not take a control option.`
          : `Item ${position + 1}: a control option is required.`
      );
    }
    if (enforced && uses('installation') !== Boolean(it.installation_id)) {
      throw new Error(
        it.installation_id
          ? `Item ${position + 1}: ${label} does not take an installation option.`
          : `Item ${position + 1}: an installation option is required.`
      );
    }
    // Second, type-aware gate: the loose `z.record` on the payload schema
    // only proved the blob is an object. This parses it through the blind
    // type's own strict schema, so an undeclared key — a price above all
    // — is a 400 rather than a silent write into the jsonb column.
    const parsedAttrs = blindType.attributeSchema.safeParse(it.attributes);
    if (!parsedAttrs.success) {
      throw new Error(`Item ${position + 1}: ${label} does not accept those options.`);
    }
    // Snapshot AFTER the parse, and always overwriting: this is the only
    // way a catalog-backed price (a pleat multiplier, an installation
    // charge) enters the blob, so a client can never supply one.
    const attributes = blindType.resolveCatalogRefs(
      parsedAttrs.data as Record<string, string | number | boolean>,
      resolveRef
    );

    // The charges this blind actually carries, each with the basis its
    // own catalog row declares. A slot with no chosen option is ABSENT
    // rather than zeroed — there is no charge to make, and a 0 entry
    // would claim there was one at no cost.
    const hardware: Partial<Record<CatalogSlot, HardwareCharge>> = {};
    if (cassette) hardware.cassette = { price: cassette.price, basis: cassette.basis };
    if (bottomRail) hardware.bottom_rail = { price: bottomRail.price, basis: bottomRail.basis };
    if (control) hardware.control = { price: control.price, basis: control.basis };
    if (installation) {
      hardware.installation = { price: installation.price, basis: installation.basis };
    }

    // Dispatch to the blind type's own module (falls back to the
    // shared default when the type has no dedicated formula yet).
    const base = calculateBlindUnitPriceForType(it.blinds_type, {
      panels: it.panels,
      height_cm: it.height_cm,
      material_price_per_sqm: material.price,
      hardware,
      attributes,
    });
    const adjusted = applyPriceAdjustments({
      base,
      quantity: it.quantity,
      override: it.unit_price_override,
      addons: it.addons as Addon[],
    });
    return {
      item_type: 'blind',
      position,
      uid: it.uid ?? crypto.randomUUID(),
      hidden: it.hidden,
      room_name: it.room_name,
      blinds_type: it.blinds_type,
      panels: it.panels,
      height_cm: it.height_cm,
      material_id: it.material_id,
      material_name: material.name,
      material_price_per_sqm: material.price,
      // The rate columns keep their original names (migration 36 left
      // them alone: nothing reads them, and renaming would rewrite the
      // audit trail). The basis beside each is what makes the rate
      // readable — "$12" alone says nothing about what was charged.
      cassette_id: it.cassette_id,
      cassette_name: cassette?.name ?? null,
      cassette_price_per_m: cassette?.price ?? null,
      cassette_price_basis: cassette?.basis ?? null,
      bottom_rail_id: it.bottom_rail_id,
      bottom_rail_name: bottomRail?.name ?? null,
      bottom_rail_price_per_m: bottomRail?.price ?? null,
      bottom_rail_price_basis: bottomRail?.basis ?? null,
      control_id: it.control_id,
      control_name: control?.name ?? null,
      control_price_per_item: control?.price ?? null,
      control_price_basis: control?.basis ?? null,
      installation_id: it.installation_id,
      installation_name: installation?.name ?? null,
      installation_price_per_item: installation?.price ?? null,
      installation_price_basis: installation?.basis ?? null,
      title: '',
      preset_id: null,
      description: '',
      note: it.note,
      color: it.color,
      attributes,
      quantity: it.quantity,
      show_original_price: it.show_original_price,
      unit_price: adjusted.unit_price,
      base_unit_price: adjusted.base_unit_price,
      addons: adjusted.addons,
      line_total: adjusted.line_total,
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
 * Appends one row to the order's activity trail. Best-effort: a logging
 * failure must never fail the request it is describing, so errors are
 * swallowed (mirrors the "best-effort cleanup" pattern used elsewhere).
 *
 * `source` marks who caused the entry: 'staff' (the default, so all
 * existing call sites are unchanged) or 'customer' for anything driven
 * from the token'd public page. The web trail renders customer rows on
 * a light-blue background.
 */
async function logOrderEvent(
  sb: SupabaseClient,
  orderId: string,
  message: string,
  source: 'staff' | 'customer' = 'staff'
): Promise<void> {
  try {
    await sb.from('order_logs').insert({ order_id: orderId, message, source });
  } catch {
    // Logging is diagnostic only — never block the caller's mutation.
  }
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
  else if (status === 'all') {
    // No filter — every status, including expired.
  } else if (LIST_STATUSES.includes(status)) query = query.eq('status', status);

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

/**
 * The create path shared by `POST /` and `POST /:id/duplicate`.
 *
 * Both routes must produce an order the same way — server-priced from
 * catalog ids, dated and expiring by the company default, numbered by
 * the daily counter with the UNIQUE-index retry, line items inserted
 * with a uniform column set — so the sequence lives here once rather
 * than being mirrored in a second route that could drift.
 *
 * Returns a discriminated result rather than a `Response` so each caller
 * keeps its own status code and body shape; the caller is also
 * responsible for reading the finished order back.
 *
 * @param sb         Service-role client.
 * @param input      An already-parsed `orderSchema` payload.
 * @param logMessage The first line of the new order's activity trail.
 */
async function createOrderFromInput(
  sb: SupabaseClient,
  input: z.infer<typeof orderSchema>,
  logMessage: string
): Promise<{ order: Record<string, unknown> } | { error: string; status: 400 | 500 }> {
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
    return { error: 'Expiry date cannot be before the order date.', status: 400 };
  }

  let rows: LineItemRow[];
  try {
    rows = await resolveLineItems(sb, input.line_items);
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : 'Invalid line items',
      status: 400,
    };
  }
  // A hidden item is priced and stored like any other, but it is not
  // part of what the customer is being charged — so it never reaches the
  // subtotal. Mirrored by the live preview in the web OrderDetail.
  const totals = calculateTotals(
    rows.filter((r) => !r.hidden).map((r) => r.line_total),
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
    if (error?.code !== '23505') return { error: lastError, status: 500 };
  }
  if (!order) return { error: lastError, status: 500 };

  if (rows.length) {
    const { error: liError } = await sb
      .from('line_items')
      .insert(rows.map((r) => ({ ...r, order_id: order!.id })));
    if (liError) {
      await sb.from('orders').delete().eq('id', order.id); // best-effort cleanup
      return { error: liError.message, status: 500 };
    }
  }

  await logOrderEvent(sb, order.id as string, logMessage);
  return { order };
}

/** Creates an order with server-generated order number + pricing. */
app.post('/', async (c) => {
  const parsed = orderSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: firstZodIssue(parsed.error) }, 400);
  const sb = createSupabaseAdmin(c.env);

  const result = await createOrderFromInput(sb, parsed.data, 'Order created.');
  if ('error' in result) return c.json({ error: result.error }, result.status);

  const { data: full } = await readDetail(sb, result.order.id as string);
  return c.json({ data: full ?? result.order }, 201);
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

/** Updates an order — editable at ANY lifecycle stage, with full server recalc. */
app.put('/:id', async (c) => {
  const parsed = orderSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: firstZodIssue(parsed.error) }, 400);
  const input = parsed.data;
  const id = c.req.param('id');
  const sb = createSupabaseAdmin(c.env);

  // The line items come along so the hand-entered money on them can be
  // diffed against what is about to replace them; they are read BEFORE
  // the wholesale delete below, which is the only chance to see them.
  const { data: existing } = await sb
    .from('orders')
    // Kept on ONE line: supabase-js parses the select string at the type
    // level, and a concatenated one degrades the row type to
    // `GenericStringError`, taking `status` and `line_items` with it.
    .select('id, status, expiry_date, line_items(position, uid, hidden, unit_price, base_unit_price, addons)')
    .eq('id', id)
    .maybeSingle();
  if (!existing) return c.json({ error: 'Order not found' }, 404);

  const order_date = input.order_date ?? new Date().toISOString().slice(0, 10);
  const expiry_date = input.expiry_date ?? existing.expiry_date;
  if (expiry_date < order_date) {
    return c.json({ error: 'Expiry date cannot be before the order date.' }, 400);
  }

  // Visibility is a pre-confirmation decision. Once an order is an
  // invoice, hiding or showing a line would silently move a total the
  // customer has already been quoted — and, while money is owed, the
  // balance they are paying against. Every other edit stays legal at
  // every stage; `POST /:id/unconfirm` is the way back.
  //
  // The comparison is by `uid`, never by position: the line items are
  // replaced wholesale below, so positions shift whenever an item is
  // added, removed or reordered, and a position-based diff would reject
  // those edits too.
  if (isConfirmed(existing.status)) {
    const previous = new Map<string, boolean>(
      ((existing.line_items ?? []) as Record<string, unknown>[]).map((li) => [
        String(li.uid),
        Boolean(li.hidden),
      ])
    );
    const changed = input.line_items.some((it) => {
      const before = it.uid ? previous.get(it.uid) : undefined;
      // An item this order has never seen is new: it may join a confirmed
      // order, but not already hidden — that would be the same silent
      // total move by another route.
      return before === undefined ? it.hidden : it.hidden !== before;
    });
    if (changed) {
      return c.json(
        { error: 'Visibility can only be changed before the order is confirmed.' },
        400
      );
    }
  }

  let rows: LineItemRow[];
  try {
    rows = await resolveLineItems(sb, input.line_items);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Invalid line items' }, 400);
  }
  // A hidden item is priced and stored like any other, but it is not
  // part of what the customer is being charged — so it never reaches the
  // subtotal. Mirrored by the live preview in the web OrderDetail.
  const totals = calculateTotals(
    rows.filter((r) => !r.hidden).map((r) => r.line_total),
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

  await logOrderEvent(sb, id, `Order edited (was ${existing.status}).`);

  // Hand-entered money is the one thing on an order that no formula can
  // explain afterwards, so every override and add-on change gets its own
  // line in the trail. Ordered by position, matching the editor.
  const previousItems = ((existing.line_items ?? []) as Record<string, unknown>[])
    .slice()
    .sort((a, b) => Number(a.position) - Number(b.position))
    .map((li) => ({
      unit_price: Number(li.unit_price),
      base_unit_price: li.base_unit_price === null ? null : Number(li.base_unit_price),
      addons: (li.addons ?? []) as Addon[],
    }));
  const nextItems = rows.map((r) => ({
    unit_price: Number(r.unit_price),
    base_unit_price: r.base_unit_price === null ? null : Number(r.base_unit_price),
    addons: (r.addons ?? []) as Addon[],
  }));
  for (const message of describePriceChanges(previousItems, nextItems)) {
    await logOrderEvent(sb, id, message);
  }

  const { data: full, error: readError } = await readDetail(sb, id);
  if (readError) return c.json({ error: readError.message }, 500);
  if (full) full.amount_paid = sumPayments(full.payments);
  return c.json({ data: full });
});

/** Returns an order's activity trail, newest first. */
app.get('/:id/logs', async (c) => {
  const sb = createSupabaseAdmin(c.env);
  const { data, error } = await sb
    .from('order_logs')
    .select('id, order_id, message, created_at')
    .eq('order_id', c.req.param('id'))
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ data: data ?? [] });
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
 *
 * `viewUrl` is the customer's order-page URL for the "View your order
 * online" button. Every caller already resolves the public token (they
 * either just minted it or reuse the stored one), so it is passed in
 * rather than derived here — this helper stays free of `c.env` and of
 * any database write.
 */
async function toPdfData(
  order: Record<string, any>,
  company: Record<string, any>,
  terms: string,
  viewUrl: string | null
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
    // Hidden items are dropped HERE, at the single assembly point every
    // document passes through, for the same reason `base_unit_price` is
    // masked below: a PDF's text layer is extractable whether or not the
    // row was ever drawn on a page.
    line_items: (order.line_items ?? [])
      .filter((li: Record<string, any>) => !li.hidden)
      .map((li: Record<string, any>) => ({
      ...li,
      quantity: Number(li.quantity),
      unit_price: Number(li.unit_price),
      line_total: Number(li.line_total),
      height_cm: li.height_cm === null ? null : Number(li.height_cm),
      addons: (li.addons ?? []).map((a: Record<string, any>) => ({
        label: String(a.label),
        price: Number(a.price),
      })),
      // Honour the per-item toggle HERE, at the single assembly point for
      // every document. The spread above would otherwise carry a hidden
      // original into the PDF, and a PDF's text layer is extractable
      // whether or not the figure was drawn.
      base_unit_price:
        li.show_original_price && li.base_unit_price !== null && li.base_unit_price !== undefined
          ? Number(li.base_unit_price)
          : null,
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
    viewUrl,
  };
}

/**
 * Streams the order as a downloadable PDF (Estimate, or Invoice once paid).
 *
 * The document carries the customer's order-page button, so this GET
 * mints and persists `public_token` when the order never had one —
 * exactly the reuse-or-mint rule the send routes and `POST
 * /:id/public-token` follow, and for the same reason: a link printed on
 * a document that leaves the building must resolve. Minting is logged
 * once; a download of an order that already has a token writes nothing.
 */
app.get('/:id/pdf', async (c) => {
  const sb = createSupabaseAdmin(c.env);
  const id = c.req.param('id');
  const bundle = await loadOrderBundle(sb, id);
  if (!bundle) return c.json({ error: 'Order not found' }, 404);
  const terms = bundle.order.terms_snapshot ?? bundle.company.terms_and_conditions ?? '';

  const publicToken: string = bundle.order.public_token ?? crypto.randomUUID();
  if (!bundle.order.public_token) {
    const { error } = await sb.from('orders').update({ public_token: publicToken }).eq('id', id);
    if (error) return c.json({ error: error.message }, 500);
    await logOrderEvent(sb, id, 'Customer view link created.');
  }
  const viewUrl = `${c.env.APP_URL}/customer/${publicToken}`;

  try {
    const data = await toPdfData(bundle.order, bundle.company, terms, viewUrl);
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
    pdf = await buildDocumentPdf(await toPdfData(order, company, terms, viewUrl));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'PDF generation failed' }, 500);
  }

  try {
    await sendEmail(c.env, {
      to: email,
      subject: `Your estimate ${order.order_number} from ${company.company_name || 'Blinds Nisa'}`,
      html: buildEstimateEmailHtml({
        company: brandFromSettings(company),
        customerFirstName: greetingName(order.customer),
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

  await logOrderEvent(sb, id, `Estimate emailed to ${email}.`);

  const { data: updated } = await readDetail(sb, id);
  if (updated) updated.amount_paid = sumPayments(updated.payments);
  return c.json({ data: updated });
});

/**
 * Marks the estimate as sent WITHOUT emailing anything — a status-only
 * `draft → sent` transition.
 *
 * This backs the Progress-timeline advance control, for estimates handed
 * over in person, printed, or delivered through some other channel. The
 * "Estimate Ready" email belongs exclusively to `POST /:id/send`:
 * advancing the lifecycle stage must never put mail in a customer's
 * inbox, otherwise a consultant tidying up the pipeline silently emails
 * people.
 *
 * Differences from `/send`, all deliberate: no customer email address is
 * required (nothing is delivered), and neither `public_token` nor
 * `terms_snapshot` is written — there is no customer-facing link to keep
 * alive and no terms to freeze until a document actually goes out. A
 * later real `/send` mints both lazily, so nothing is lost. The lapsed-
 * expiry guard mirrors `/send` because `applyDefensiveExpiry` flips a
 * `sent` order whose validity date has passed straight to `expired` on
 * the next read, which would make this action look broken.
 */
app.post('/:id/mark-sent', async (c) => {
  const sb = createSupabaseAdmin(c.env);
  const id = c.req.param('id');
  const { data: existing } = await sb
    .from('orders')
    .select('id, status, expiry_date')
    .eq('id', id)
    .maybeSingle();
  if (!existing) return c.json({ error: 'Order not found' }, 404);
  if (!EDITABLE.includes(existing.status)) {
    return c.json({ error: `A ${existing.status} order cannot be marked as sent.` }, 409);
  }
  const today = new Date().toISOString().slice(0, 10);
  if (existing.expiry_date < today) {
    return c.json({ error: 'This estimate has expired — update the expiry date first.' }, 400);
  }

  const { error } = await sb
    .from('orders')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return c.json({ error: error.message }, 500);

  await logOrderEvent(sb, id, 'Marked as sent (no email).');

  const { data } = await readDetail(sb, id);
  if (data) data.amount_paid = sumPayments(data.payments);
  return c.json({ data });
});

/**
 * Returns the order's public capability token, minting one if it has
 * none yet.
 *
 * Exists so staff can preview the customer's page BEFORE the estimate is
 * sent: `public_token` is normally created by the send, and without this
 * the "Customer View" button would have nothing to open on a draft.
 *
 * Idempotent and inert — it never changes `status`, never emails, and a
 * second call returns the same token and logs nothing. Minting IS
 * logged, once, because it brings a customer-reachable URL into
 * existence and that is worth a line in the trail.
 */
app.post('/:id/public-token', async (c) => {
  const sb = createSupabaseAdmin(c.env);
  const id = c.req.param('id');

  const { data: existing } = await sb
    .from('orders')
    .select('id, public_token')
    .eq('id', id)
    .maybeSingle();
  if (!existing) return c.json({ error: 'Order not found' }, 404);

  if (existing.public_token) {
    return c.json({ data: { public_token: existing.public_token } });
  }

  const token = crypto.randomUUID();
  const { error } = await sb.from('orders').update({ public_token: token }).eq('id', id);
  if (error) return c.json({ error: error.message }, 500);

  await logOrderEvent(sb, id, 'Customer view link created.');
  return c.json({ data: { public_token: token } });
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
    pdf = await buildDocumentPdf(await toPdfData(order, company, terms, viewUrl));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'PDF generation failed' }, 500);
  }

  try {
    await sendEmail(c.env, {
      to: email,
      subject: `Your invoice ${order.order_number} from ${company.company_name || 'Blinds Nisa'}`,
      html: buildInvoiceEmailHtml({
        company: brandFromSettings(company),
        customerFirstName: greetingName(order.customer),
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

  await logOrderEvent(sb, id, `Invoice emailed to ${email}.`);

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

  await logOrderEvent(sb, id, 'Order confirmed.');

  const { data } = await readDetail(sb, id);
  if (data) data.amount_paid = sumPayments(data.payments);
  return c.json({ data });
});

/**
 * Duplicates an order into a NEW draft.
 *
 * The copy is produced by running the ordinary create path over a
 * payload derived from the stored rows, so its prices come from TODAY's
 * catalog rather than from the source order's snapshots — the same rule
 * that governs every other write. Only the commercial content travels:
 * customer, discount, and line items with their visibility flags and
 * hand-entered adjustments. Payments, the activity trail, the
 * appointment, warranty state, the public token and any cancellation
 * request belong to the source order's own history and are left there.
 *
 * A catalog row deleted since the source order was written surfaces as
 * the same readable 400 an ordinary save would give ("Selected material
 * no longer exists."), naming what needs fixing.
 */
app.post('/:id/duplicate', async (c) => {
  const sb = createSupabaseAdmin(c.env);
  const id = c.req.param('id');
  const { data: source, error: readError } = await readDetail(sb, id);
  if (readError) return c.json({ error: readError.message }, 500);
  if (!source) return c.json({ error: 'Order not found' }, 404);

  // Parsed, never trusted: a row written under an older schema must fail
  // as a readable 400 rather than slip past validation on age alone.
  const parsed = orderSchema.safeParse(toDuplicateInput(source));
  if (!parsed.success) return c.json({ error: firstZodIssue(parsed.error) }, 400);

  const result = await createOrderFromInput(
    sb,
    parsed.data,
    `Duplicated from ${source.order_number}.`
  );
  if ('error' in result) return c.json({ error: result.error }, result.status);

  await logOrderEvent(sb, id, `Duplicated to ${result.order.order_number as string}.`);

  const { data: full } = await readDetail(sb, result.order.id as string);
  return c.json({ data: full ?? result.order }, 201);
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

  await logOrderEvent(sb, id, 'Confirmation reversed.');

  const { data } = await readDetail(sb, id);
  if (data) data.amount_paid = sumPayments(data.payments);
  return c.json({ data });
});

/**
 * Records a payment against an order. Reaching the 50% deposit moves
 * awaiting_payment → in_progress (the automatic production trigger, in
 * `lib/payments.ts`); a smaller payment is recorded but leaves the order
 * awaiting_payment. The outstanding balance is derived from the ledger,
 * so it is returned but never stored. Payments are accepted at any
 * post-confirmation stage (awaiting_payment through installed).
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
  const result = await recordOrderPayment(sb, id, existing.status, {
    amount: input.amount,
    paid_on,
    note: input.note,
  });
  if ('errorMessage' in result) return c.json({ error: result.errorMessage }, 500);

  // When applying an unmatched e-Transfer, mark it resolved + linked.
  if (input.etransfer_id) {
    await sb
      .from('etransfers')
      .update({ status: 'applied', order_id: id, payment_id: result.paymentId })
      .eq('id', input.etransfer_id);
  }

  await logOrderEvent(sb, id, `Payment of $${input.amount.toFixed(2)} recorded.`);

  // If that payment settled the order, the customer's warranty is due.
  // Deliberately BEFORE readDetail so the refreshed order the UI caches
  // already carries warranty_sent_at. The payment is already committed,
  // so no warranty outcome may fail this request — a send failure is
  // recorded on the activity trail and left for staff to resend.
  const warranty = await issueWarrantyIfPaid(sb, c.env, id);
  if (warranty.status === 'failed') {
    await logOrderEvent(sb, id, `Warranty email failed: ${warranty.message}`);
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
    .select('id, order_id, amount')
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

  await logOrderEvent(sb, id, `Payment of $${Number(payment.amount).toFixed(2)} deleted.`);

  const { data } = await readDetail(sb, id);
  if (data) data.amount_paid = sumPayments(data.payments);
  return c.json({ data });
});

/**
 * Emails the customer a branded receipt for ONE recorded payment, with
 * an optional consultant note. Paid-to-date and the remaining balance
 * are computed server-side from the payments ledger and the order total
 * — nothing money-related is accepted from the client (AUTHORITATIVE
 * PRICING rule). The order's lifecycle stage is NOT changed. The public
 * token is reused (minted + persisted if the order was never emailed,
 * exactly like send-invoice) so the "View your order" link always works.
 *
 * Email-then-persist ordering: `payments.receipt_sent_at` is stamped and
 * the activity log written ONLY after Resend confirms the send; a failed
 * send returns 502 and leaves the payment row untouched. Resending is
 * always allowed — the stamp simply moves forward.
 */
app.post('/:id/payments/:paymentId/receipt', async (c) => {
  const parsed = sendMessageSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: firstZodIssue(parsed.error) }, 400);
  const message = parsed.data.message;
  const sb = createSupabaseAdmin(c.env);
  const id = c.req.param('id');
  const paymentId = c.req.param('paymentId');
  const bundle = await loadOrderBundle(sb, id);
  if (!bundle) return c.json({ error: 'Order not found' }, 404);
  const { order, company } = bundle;

  // The payment must exist AND belong to this order — the ledger from
  // readDetail is already scoped to the order, so a lookup suffices.
  const payment = (order.payments ?? []).find((p: { id: string }) => p.id === paymentId);
  if (!payment) return c.json({ error: 'Payment not found on this order.' }, 404);

  const email = order.customer?.email;
  if (!email) return c.json({ error: 'This customer has no email address on file.' }, 400);

  const publicToken: string = order.public_token ?? crypto.randomUUID();
  const terms: string = order.terms_snapshot ?? company.terms_and_conditions ?? '';
  const viewUrl = `${c.env.APP_URL}/customer/${publicToken}`;

  // Server-authoritative money: both figures derive from the DB ledger.
  const paidToDate = sumPayments(order.payments);
  const balance = Math.round((Number(order.total) - paidToDate) * 100) / 100;

  try {
    await sendEmail(c.env, {
      to: email,
      subject: `Your payment receipt ${order.order_number} from ${company.company_name || 'Blinds Nisa'}`,
      html: buildReceiptEmailHtml({
        company: brandFromSettings(company),
        customerFirstName: greetingName(order.customer),
        orderNumber: order.order_number,
        paymentAmount: Number(payment.amount),
        paidOnText: formatDateLong(payment.paid_on),
        orderTotal: Number(order.total),
        paidToDate,
        balance,
        viewUrl,
        message,
      }),
    });
  } catch (e) {
    // Send failed → no DB writes at all (no stamp, no token, no log).
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

  const { error: stampError } = await sb
    .from('payments')
    .update({ receipt_sent_at: new Date().toISOString() })
    .eq('id', paymentId);
  if (stampError) return c.json({ error: stampError.message }, 500);

  await logOrderEvent(
    sb,
    id,
    `Receipt for $${Number(payment.amount).toFixed(2)} emailed to ${email}.`
  );

  const { data } = await readDetail(sb, id);
  if (data) data.amount_paid = sumPayments(data.payments);
  return c.json({ data });
});

/**
 * Emails (or re-emails) the warranty certificate for a fully paid order.
 *
 * The certificate normally goes out on its own the moment a payment
 * clears the balance — see `issueWarrantyIfPaid`, called from both the
 * payment route and the e-Transfer webhook. This endpoint exists for the
 * cases automation cannot cover: a send that failed, a customer whose
 * email address was added afterwards, a $0 order that never had a
 * payment to trigger on, and a customer who simply lost the email.
 *
 * Resending is always allowed (`force`), exactly like the per-payment
 * receipt: the stamp moves forward and the expiry dates do not, because
 * they are pinned to the snapshotted `warranty_starts_on`.
 *
 * Server-authoritative (§1): the body carries only an optional
 * consultant note. Every date and the paid-in-full test are computed in
 * the Worker from the order total and the payments ledger.
 *
 * 404 unknown order · 409 balance still outstanding · 400 no customer
 * email · 502 the email provider rejected the send (nothing stamped).
 */
app.post('/:id/warranty', async (c) => {
  const parsed = sendMessageSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: firstZodIssue(parsed.error) }, 400);
  const sb = createSupabaseAdmin(c.env);
  const id = c.req.param('id');

  const result = await issueWarrantyIfPaid(sb, c.env, id, {
    force: true,
    message: parsed.data.message,
  });

  if (result.status === 'failed') return c.json({ error: result.message }, 502);
  if (result.status === 'skipped') {
    if (result.reason === 'order_not_found') return c.json({ error: 'Order not found' }, 404);
    if (result.reason === 'no_email') {
      return c.json({ error: 'This customer has no email address on file.' }, 400);
    }
    return c.json(
      { error: 'This order still has an outstanding balance — the warranty is issued once it is paid in full.' },
      409
    );
  }

  const { data } = await readDetail(sb, id);
  if (data) data.amount_paid = sumPayments(data.payments);
  return c.json({ data });
});

/**
 * Streams the warranty certificate as a downloadable PDF — the staff
 * copy of exactly what the customer was emailed.
 *
 * No email is required and none is sent: nothing is delivered, so a
 * customer without an address on file can still have their certificate
 * printed or handed over. Coverage dates come from the snapshotted
 * `warranty_starts_on` when it exists, so a download after the send is
 * byte-for-byte the same document; before any send it previews from the
 * ledger's latest payment date.
 *
 * 404 unknown order · 409 balance still outstanding · 500 render failure.
 */
app.get('/:id/warranty-pdf', async (c) => {
  const sb = createSupabaseAdmin(c.env);
  const id = c.req.param('id');
  const bundle = await loadOrderBundle(sb, id);
  if (!bundle) return c.json({ error: 'Order not found' }, 404);
  const { order, company } = bundle;

  const paid = sumPayments(order.payments);
  const balance = Math.round((Number(order.total) - paid) * 100) / 100;
  if (balance > 0.005) {
    return c.json(
      { error: 'This order still has an outstanding balance — the warranty is issued once it is paid in full.' },
      409
    );
  }

  const payDates: string[] = (order.payments ?? [])
    .map((p: { paid_on?: string | null }) => p.paid_on)
    .filter((d: unknown): d is string => typeof d === 'string');
  const startsOn: string =
    order.warranty_starts_on ??
    [...payDates].sort().pop() ??
    new Date().toISOString().slice(0, 10);

  try {
    const pdf = await buildWarrantyPdf({
      order: { order_number: order.order_number, order_date: order.order_date },
      // A hidden item was never charged for, so nothing covers it.
      coverage: buildWarrantyCoverage(
        (order.line_items ?? []).filter((li: Record<string, any>) => !li.hidden),
        startsOn
      ),
      customer: order.customer,
      company: {
        company_name: company.company_name || 'Blinds Nisa',
        logo_url: company.logo_url,
        email: company.email,
        phone: company.phone,
        address: company.address,
      },
      issuedOn: new Date().toISOString().slice(0, 10),
      logo: await fetchLogo(company.logo_url),
    });
    // Re-slice into a plain ArrayBuffer — Hono's body type rejects
    // Uint8Array<ArrayBufferLike> views directly.
    const body = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;
    return c.body(body, 200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${order.order_number}-warranty.pdf"`,
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'PDF generation failed' }, 500);
  }
});

/**
 * Answers a customer's cancellation request (raised from the public page
 * at POST /public/estimate/:token/cancel-request).
 *
 * `accept: true` grants it — the request flag is cleared AND the
 * confirmation is reversed (awaiting_payment → sent, confirmed_at
 * nulled), exactly the transition `/unconfirm` performs. The same
 * precondition applies: refused once a payment exists, because a
 * confirmation can never be undone with money on the order. No email is
 * sent — the customer's page shows the estimate with its Confirm button
 * again, which is self-explanatory.
 *
 * `accept: false` denies it — the flag is cleared, the status is left
 * alone, and the customer IS emailed (the one outcome worth announcing,
 * since they asked for something and did not get it).
 *
 * Denial uses email-then-persist ordering (SECURITY INVARIANT): a Resend
 * failure returns 502 with the request still open, so staff can retry
 * rather than silently dropping a request the customer is waiting on.
 * The single exception is a customer with no email on file — there the
 * request is cleared without a send and the activity log records why,
 * because a missing address must never trap staff in a request they
 * cannot resolve.
 *
 * 404 unknown order · 409 no open request · 409 accept refused once the
 * order has left awaiting_payment or a payment exists.
 */
app.post('/:id/cancel-request/resolve', async (c) => {
  const parsed = resolveCancelSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: firstZodIssue(parsed.error) }, 400);
  const { accept, message } = parsed.data;

  const sb = createSupabaseAdmin(c.env);
  const id = c.req.param('id');
  const bundle = await loadOrderBundle(sb, id);
  if (!bundle) return c.json({ error: 'Order not found' }, 404);
  const { order, company } = bundle;

  if (!order.cancel_requested_at) {
    return c.json({ error: 'There is no cancellation request on this order.' }, 409);
  }

  const clearRequest = { cancel_requested_at: null, cancel_request_note: '' };

  if (accept) {
    // Granting the request means reversing the confirmation, so the
    // unconfirm preconditions apply unchanged.
    if (order.status !== 'awaiting_payment') {
      return c.json(
        { error: `Only an awaiting-payment order can be reversed (this one is ${order.status}).` },
        409
      );
    }
    if (sumPayments(order.payments) > 0) {
      return c.json(
        { error: 'A payment has been recorded — reverse or delete it before cancelling.' },
        409
      );
    }
    const { error } = await sb
      .from('orders')
      .update({ ...clearRequest, status: 'sent', confirmed_at: null })
      .eq('id', id)
      .eq('status', 'awaiting_payment');
    if (error) return c.json({ error: error.message }, 500);

    await logOrderEvent(sb, id, 'Cancellation request accepted — confirmation reversed.');
    const { data } = await readDetail(sb, id);
    if (data) data.amount_paid = sumPayments(data.payments);
    return c.json({ data });
  }

  // Denial: email first, persist second.
  const email = order.customer?.email;
  if (email) {
    const publicToken: string = order.public_token ?? crypto.randomUUID();
    const viewUrl = `${c.env.APP_URL}/customer/${publicToken}`;
    try {
      await sendEmail(c.env, {
        to: email,
        subject: `About your cancellation request — ${order.order_number}`,
        html: buildCancellationDeniedHtml({
          company: brandFromSettings(company),
          customerFirstName: greetingName(order.customer),
          orderNumber: order.order_number,
          total: Number(order.total),
          viewUrl,
          message,
        }),
      });
    } catch (e) {
      // Request stays open so staff can retry — never silently dropped.
      return c.json({ error: e instanceof Error ? e.message : 'Email send failed' }, 502);
    }
    // The link we just emailed must resolve, so persist a freshly
    // minted token (same reuse-or-mint rule as the send routes).
    if (!order.public_token) {
      const { error } = await sb
        .from('orders')
        .update({ public_token: publicToken })
        .eq('id', id);
      if (error) return c.json({ error: error.message }, 500);
    }
  }

  const { error } = await sb.from('orders').update(clearRequest).eq('id', id);
  if (error) return c.json({ error: error.message }, 500);

  await logOrderEvent(
    sb,
    id,
    email
      ? `Cancellation request denied — customer notified at ${email}.`
      : 'Cancellation request denied — customer has no email address on file.'
  );

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

  await logOrderEvent(sb, id, 'Order moved to In Progress.');

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

  await logOrderEvent(sb, id, 'Order marked Ready.');

  const { data } = await readDetail(sb, id);
  if (data) data.amount_paid = sumPayments(data.payments);
  return c.json({ data });
});

/** Body for the cut-done toggle: the desired state. */
const cutDoneSchema = z.object({ done: z.boolean() }).strict();

/**
 * Toggles the order's workshop "cuts done" milestone (Manufacturer Copy
 * page). REVERSIBLE: `{ done: true }` stamps `cut_done_at = now()` (only
 * if not already set, so re-marking keeps the original date); `{ done:
 * false }` clears it back to null. Allowed only on a confirmed order (past
 * the estimate stage); this is a manufacturing milestone and does NOT
 * change the order's status. No-ops (already in the desired state) skip
 * the write + log but still return the current order.
 */
app.post('/:id/cut-done', async (c) => {
  const parsed = cutDoneSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Body must be { done: boolean }.' }, 400);

  const sb = createSupabaseAdmin(c.env);
  const id = c.req.param('id');
  const { data: existing } = await sb
    .from('orders')
    .select('id, status, cut_done_at')
    .eq('id', id)
    .maybeSingle();
  if (!existing) return c.json({ error: 'Order not found' }, 404);
  if (!isConfirmed(existing.status)) {
    return c.json(
      { error: `A confirmed order is needed to change the cut status (this one is ${existing.status}).` },
      409
    );
  }

  const isDone = Boolean(existing.cut_done_at);
  if (parsed.data.done !== isDone) {
    // Marking done stamps NOW; un-marking clears it. Re-marking an already
    // done order keeps its original date (the `!== isDone` guard skips it).
    const cut_done_at = parsed.data.done ? new Date().toISOString() : null;
    const { error } = await sb.from('orders').update({ cut_done_at }).eq('id', id);
    if (error) return c.json({ error: error.message }, 500);
    await logOrderEvent(sb, id, parsed.data.done ? 'Cuts marked done.' : 'Cut-done cleared.');
  }

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
  // installed_at drives the post-installation review request cron.
  const { error } = await sb
    .from('orders')
    .update({ status: 'installed', installed_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return c.json({ error: error.message }, 500);

  await logOrderEvent(sb, id, 'Order marked Installed.');

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
  // Leaving `installed` un-marks the installation moment. The review
  // request stamp is deliberately kept: a customer who already got the
  // review email should not receive it again after a re-install.
  if (toIdx < STAGE_ORDER.indexOf('installed')) update.installed_at = null;

  const { error } = await sb.from('orders').update(update).eq('id', id);
  if (error) return c.json({ error: error.message }, 500);

  // Below `ready` the goods are no longer installable — drop the order's
  // installation appointment so no stale visit stays on the calendar.
  if (toIdx < STAGE_ORDER.indexOf('ready')) {
    await sb.from('appointments').delete().eq('order_id', id);
  }

  await logOrderEvent(sb, id, `Order reverted from ${existing.status} to ${to}.`);

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
