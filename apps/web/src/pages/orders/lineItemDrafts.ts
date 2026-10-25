// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Line-item draft models and the pure functions over them — no JSX.
 *
 * A "draft" is the editable state of one line item while the user is
 * typing. Every numeric field is held as a STRING so partially-typed
 * values ("12.", "") never fight the keyboard; parsing happens here and
 * at save time, never in a form component.
 *
 * This module is deliberately JSX-free and lives apart from
 * `LineItemEditor.tsx`. Mixing these exports into a `.tsx` file breaks
 * React Fast Refresh (`react/only-export-components`), because a module
 * that exports both components and plain functions cannot be hot-swapped
 * safely — the editor would do a full reload on every keystroke-level
 * edit to a form.
 *
 * The pricing helpers mirror `apps/api`'s authoritative recalculation
 * closely enough to preview a price, but they are ONLY a preview: the
 * Worker recomputes every line item from catalog prices it fetches
 * itself, so nothing here can influence what is charged.
 */

import { calculateBlindUnitPriceForType, type BlindInputs } from '../../lib/pricing';
import { applyPriceAdjustments } from '../../lib/lineItemAdjustments';
import { lockApplies, type PriceLock, type PriceLockInput } from '../../lib/priceLock';
import { getBlindType } from '../../lib/blindTypes';
import type {
  BlindAttributes,
  CatalogResolver,
  CatalogSlot,
  HardwareCharge,
} from '../../lib/blindTypes/base';
import type {
  Material,
  CassetteOption,
  BottomRailOption,
  ControlOption,
  BlindType,
  BlindTypeDefaults,
  PleatType,
  InstallationOption,
} from '../../types';

/* ------------------------------------------------------------------ */
/* Draft models                                                        */
/* ------------------------------------------------------------------ */

/**
 * One editable add-on row. `price` is a raw string for the same reason
 * every other numeric draft field is: a half-typed "12." must not fight
 * the keyboard. `key` is a React list key only and never leaves the
 * browser — `parseAddons` strips it.
 */
export interface DraftAddon {
  key: string;
  label: string;
  price: string;
}

/**
 * The price-adjustment fields every editable line item carries.
 *
 * Extended by both draft shapes rather than nested, so the shared
 * `PriceBlock` control can read and write them without knowing which
 * kind of item it is editing.
 */
export interface PriceAdjustmentDraft {
  /** Raw override text; `''` means "charge the calculated price". */
  unit_price_override: string;
  show_original_price: boolean;
  addons: DraftAddon[];
  /**
   * The price this item was FROZEN at when the estimate went out to the
   * customer, and the fingerprint of the inputs behind it (migration 39).
   * `null` on every item of a DRAFT order and on any item added in this
   * editing session — nothing is frozen until the Worker says so.
   *
   * The preview consults it exactly as the Worker does: while the
   * fingerprint still matches, this is the price, no formula runs, and
   * a catalog change made since the send is invisible here because it is
   * invisible in the database too. Never sent back — the payload
   * schema is `.strict()` and the lock is server-owned.
   */
  lock: PriceLock | null;
  /**
   * True when this item was ALREADY on an order whose prices are frozen
   * (`holdsPriceLock`) when the editor loaded it — so it carries a price
   * the customer has been quoted.
   *
   * Set once per load from the order's status, never as the consultant
   * types; it is the draft-local half of the rule in
   * {@link isAlreadyQuoted}, whose live half is the lock. False for every
   * item created in this session, including one added to a sent order:
   * a brand-new line is being quoted now and must satisfy today's
   * requirements.
   */
  previously_quoted: boolean;
  /**
   * The calculated base unit price this item carried at the LAST SEND
   * (`line_items.quoted_base_price`, migration 48), or null on an order
   * no send has stamped.
   *
   * Distinct from {@link lock}, which a save re-writes at the new figure
   * for an edited item. This one only a send writes, which is what lets
   * {@link quotedPriceChange} keep showing a price-update notice after
   * the edit has been saved, until the estimate goes out again.
   */
  quoted_base: number | null;
  /**
   * The figure staff dismissed this item's price-update notice at
   * (`line_items.quoted_notice_ack_base`), or null while the notice has
   * not been dismissed.
   *
   * Server-owned like {@link lock} and {@link quoted_base}: it is
   * written by `POST /api/orders/:id/dismiss-price-notice`, never sent
   * back, and cleared by the next send. {@link quotedPriceChange} stays
   * silent while today's base still matches it, so dismissing settles
   * ONE move rather than muting the item for good.
   */
  notice_ack_base: number | null;
}

/**
 * The neutral adjustment fields: no override, no add-ons, and the
 * original price shown if one is ever set later.
 *
 * Every freshly created item spreads this in as its starting point:
 * `newBlindDraft` below (and so, transitively, every blind it seeds),
 * `OrderDetail.tsx`'s `addPreset` and `addCustom`, and `bulkAdd.ts`'s
 * `expandBulkSections` (each row it expands into a blind item). Sharing
 * one constant across every creation path is what keeps "a new item" from
 * coming to mean a different starting price shape on some of them.
 */
export const NO_ADJUSTMENTS: PriceAdjustmentDraft = {
  unit_price_override: '',
  show_original_price: true,
  addons: [],
  // A new item was never quoted, so it is live-priced — even when it is
  // being added to an order whose other items are frozen. The Worker
  // prices it from today's catalog and locks it on that save. For the
  // same reason it is neither previously quoted nor stamped: it must
  // satisfy today's hardware requirements, and there is no earlier figure
  // for a price-update notice to measure against.
  lock: null,
  previously_quoted: false,
  quoted_base: null,
  notice_ack_base: null,
};

/** Editable state of one blind line item (strings for free typing). */
export interface BlindDraft extends PriceAdjustmentDraft {
  key: string;
  /**
   * The persisted item's `uid`, or null for an item added in this
   * editing session and never saved. Null is sent as an ABSENT field and
   * the Worker mints the uid — which is also why a cloned draft must
   * reset this: two rows claiming one identity would make the Worker's
   * visibility diff ambiguous.
   *
   * Distinct from `key`, which is a render-time list key that changes
   * every time the editor rebuilds its drafts.
   */
  uid: string | null;
  /**
   * Excluded from the live total and from every document while true.
   * Only editable before the order is confirmed.
   */
  hidden: boolean;
  item_type: 'blind';
  room_name: string;
  blinds_type: string;
  panels: string[];
  height_cm: string;
  material_id: string;
  cassette_id: string;
  bottom_rail_id: string;
  control_id: string;
  /**
   * Rod/track slot, a real line-item column since migration 35. `''` when
   * the selected blind type has no installation option scoped to it —
   * which is also when the form hides the dropdown entirely.
   */
  installation_id: string;
  color: string;
  note: string;
  /**
   * The blind type's extra inputs, held as raw strings for the same
   * reason `panels` and `height_cm` are: a half-typed "12." must not
   * fight the keyboard. `parseDraftAttributes` is the only converter.
   */
  attributes: Record<string, string>;
  quantity: string;
}

/** Editable state of one preset/custom line item. */
export interface FlatDraft extends PriceAdjustmentDraft {
  key: string;
  /** As `BlindDraft.uid` — null until the item has been saved once. */
  uid: string | null;
  /** As `BlindDraft.hidden` — excluded from totals and documents. */
  hidden: boolean;
  item_type: 'preset' | 'custom';
  /** Headline shown above the description on every surface. */
  title: string;
  /** Free text; newlines are preserved and printed as separate lines. */
  description: string;
  /**
   * Catalog provenance for preset items. `null` on custom items and on
   * preset rows saved before provenance existed — and it is exactly this
   * that decides whether the item can be overridden, because without it
   * there is no calculated price to override or reset to.
   */
  preset_id: string | null;
  quantity: string;
  /**
   * The CALCULATED unit price: the catalog figure for a preset, the
   * consultant's own for a custom item. An override never lands here —
   * it lives in `unit_price_override` — so reopening a saved order can
   * never promote an override into the base and lose the original.
   */
  unit_price: string;
}

export type ItemDraft = BlindDraft | FlatDraft;

/**
 * Hardware `newBlindDraft` seeds a brand-new blind with before any blind
 * type is chosen. Every caller now passes all-empty ids (`''`): nothing is
 * scoped until a type is picked, so guessing a house default here would
 * just be overwritten — or wrong — the moment `applyTypeDefaults` runs.
 * That helper is what actually fills these slots, from each type's SAVED
 * defaults (`/settings/defaults`, the `blind_type_defaults` table) the
 * instant `BlindTypeSelect` (or `addBlind`, or a bulk-add section) sets a
 * type.
 *
 * Kept as its own parameter, rather than inlined as `''` in this function,
 * so the shape stays explicit at every call site and a future caller that
 * legitimately has a starting pick (none does today) has somewhere to put
 * it. This module stays pure either way — no catalog lookup happens here.
 */
export interface BlindDraftDefaults {
  cassette_id: string;
  bottom_rail_id: string;
  control_id: string;
}

/**
 * A blank blind draft carrying nothing but the house default hardware.
 *
 * Blind type, material and installation stay EMPTY: nothing is scoped
 * until a type is chosen, and `BlindTypeSelect` then clears whichever of
 * the defaults that type turns out not to use.
 *
 * The shared factory behind every blind-creating call site: `addBlind`'s
 * "Add Standard Blind" button in `OrderDetail.tsx`, and `bulkAdd.ts`'s
 * `newBulkSection` (a fresh section's blank `config`). Both pass an
 * all-empty `BlindDraftDefaults` — real hardware defaults are not guessed
 * here, they arrive later from `applyTypeDefaults` the instant a type is
 * picked. A blind added the ordinary way and a bulk-add section's blank
 * config therefore start from this identical shape — duplicating it per
 * call site would let the two paths drift into seeding different
 * defaults.
 */
export function newBlindDraft(key: string, defaults: BlindDraftDefaults): BlindDraft {
  return {
    key,
    // No uid yet: the Worker mints one the first time this is saved. A
    // new item is visible — hiding one is always a deliberate act.
    uid: null,
    hidden: false,
    item_type: 'blind',
    room_name: '',
    blinds_type: '',
    panels: [''],
    height_cm: '',
    material_id: '',
    cassette_id: defaults.cassette_id,
    bottom_rail_id: defaults.bottom_rail_id,
    control_id: defaults.control_id,
    installation_id: '',
    color: '',
    note: '',
    attributes: {},
    quantity: '1',
    ...NO_ADJUSTMENTS,
  };
}

/** Catalog data needed to price and render blind forms. */
export interface Catalogs {
  materials: Material[];
  cassettes: CassetteOption[];
  bottomRails: BottomRailOption[];
  controls: ControlOption[];
  blindTypes: BlindType[];
  /** Curtains fullness ratios — see `lib/blindTypes/curtains.ts`. */
  pleatTypes: PleatType[];
  /** Curtains rod/track charges — a fixed amount per curtain. */
  installationOptions: InstallationOption[];
  /**
   * Saved per-blind-type default option picks, at most one row per
   * blind type (see `BlindTypeDefaults`). Required rather than optional
   * so every `Catalogs` construction site — production and test alike —
   * must decide what to pass; a later `applyTypeDefaults` helper reads
   * this to seed a fresh line-item draft when its blind type changes.
   */
  defaults: BlindTypeDefaults[];
}

/**
 * Materials available for a given blind type name. Materials are scoped
 * per type (managed under Settings → Materials → <type>): only those
 * LINKED to the selected type are offered. When no type is selected yet
 * (or the name is unknown/legacy free-text), an empty list is returned
 * so the user must pick a blind type first.
 */
export function materialsForType(catalogs: Catalogs, blindsType: string): Material[] {
  const typeId = catalogs.blindTypes.find((t) => t.name === blindsType)?.id;
  if (!typeId) return [];
  return catalogs.materials.filter((m) => m.blind_type_ids.includes(typeId));
}

/**
 * The options of one hardware catalog offered for a blind-type NAME:
 * active, and scoped to that type in Settings.
 *
 * Empty for an unselected or unknown type name, and empty for an option
 * scoped to nothing — that convention (unlike Materials, where no links
 * means every type) is what lets a whole slot be switched off for a type.
 *
 * Mirrors the server's rule in `apps/api/src/lib/optionScoping.ts`. The
 * two MUST agree: this decides what the form offers, that decides what
 * the save accepts, and a divergence is a form that cannot be saved.
 */
export function optionsForType<T extends { active: boolean; blind_type_ids: string[] }>(
  options: T[],
  blindTypes: BlindType[],
  blindsType: string
): T[] {
  const typeId = blindTypes.find((t) => t.name === blindsType)?.id;
  if (!typeId) return [];
  return options.filter((o) => o.active && o.blind_type_ids.includes(typeId));
}

/**
 * The hardware slots a blind type uses: those with at least one active
 * scoped option. Drives which dropdowns the form renders, which ids a
 * draft must carry before it can be priced, and which ids are cleared
 * when the blind type changes.
 */
export function slotsForType(catalogs: Catalogs, blindsType: string): Set<CatalogSlot> {
  const out = new Set<CatalogSlot>();
  const has = (list: { active: boolean; blind_type_ids: string[] }[]) =>
    optionsForType(list, catalogs.blindTypes, blindsType).length > 0;
  if (has(catalogs.cassettes)) out.add('cassette');
  if (has(catalogs.bottomRails)) out.add('bottom_rail');
  if (has(catalogs.controls)) out.add('control');
  if (has(catalogs.installationOptions)) out.add('installation');
  return out;
}

/**
 * Applies a blind-type change to a draft: sets the type, resets every
 * hardware slot and the material to that type's SAVED defaults
 * (Settings → Default Options), clears slots the type does not use, and
 * seeds `attributes` from the type registry. Measurements, room, colour,
 * note, quantity and price adjustments are untouched.
 *
 * `keepValid: true` (single-item type dropdown) preserves a current pick
 * still offered for the new type instead of overwriting it with the
 * default; bulk edit and bulk add omit it for true "reset" semantics.
 *
 * A slot the type does not use is always `''`. A default id no longer
 * scoped+active for the type — retired or unlinked since it was saved —
 * is ignored and falls through to `''`, same as no default at all;
 * `BlindTypeDefaults` validates on write and keeps this rare, but this
 * function does not assume it holds.
 *
 * Single source of truth: the type dropdown, bulk edit and bulk add all
 * route through here so the three flows cannot drift.
 */
export function applyTypeDefaults(
  draft: BlindDraft,
  blindsType: string,
  catalogs: Catalogs,
  opts: { keepValid?: boolean } = {}
): BlindDraft {
  const typeId = catalogs.blindTypes.find((t) => t.name === blindsType)?.id;
  const row = catalogs.defaults.find((d) => d.blind_type_id === typeId);
  const uses = slotsForType(catalogs, blindsType);
  const materials = materialsForType(catalogs, blindsType);

  /** Resolves one hardware slot: '' when unused; else current (keepValid) → default → ''. */
  type ScopedOption = { id: string; active: boolean; blind_type_ids: string[] };
  const pick = (slot: CatalogSlot, current: string, def: string | null | undefined, options: ScopedOption[]): string => {
    if (!uses.has(slot)) return '';
    const scoped = optionsForType(options, catalogs.blindTypes, blindsType);
    if (opts.keepValid && current && scoped.some((o) => o.id === current)) return current;
    if (def && scoped.some((o) => o.id === def)) return def;
    return '';
  };

  const materialValid = (id: string | null | undefined): id is string =>
    !!id && materials.some((m) => m.id === id);

  return {
    ...draft,
    blinds_type: blindsType,
    material_id:
      opts.keepValid && materialValid(draft.material_id)
        ? draft.material_id
        : materialValid(row?.material_id)
          ? row.material_id
          : '',
    cassette_id: pick('cassette', draft.cassette_id, row?.cassette_id, catalogs.cassettes),
    bottom_rail_id: pick('bottom_rail', draft.bottom_rail_id, row?.bottom_rail_id, catalogs.bottomRails),
    control_id: pick('control', draft.control_id, row?.control_id, catalogs.controls),
    installation_id: pick('installation', draft.installation_id, row?.installation_id, catalogs.installationOptions),
    attributes: Object.fromEntries(
      Object.entries(getBlindType(blindsType).defaultAttributes()).map(([k, v]) => [k, String(v)])
    ),
  };
}

/**
 * Why a selection cannot be bulk-edited, in the order the check applies:
 *
 * - `empty` — nothing is ticked.
 * - `non_blind` — a preset or custom row is in the selection; those have
 *   no material or hardware slots at all.
 *
 * A disagreement about the blind TYPE is deliberately NOT a blocker: the
 * form resolves it instead by asking for one type up front (see
 * `BulkEditSelection.mixed`), which is how a mixed selection — or a set
 * of still-typeless rows — gets unified in a single pass.
 */
export type BulkEditBlocker = 'empty' | 'non_blind';

/**
 * The outcome of inspecting a bulk selection: the blind type context the
 * form must open in, or the reason the selection is unusable.
 *
 * - `blindsType` — the ONE type every selected blind already shares, and
 *   therefore the scope the option dropdowns open in. It is `''` when the
 *   rows do not agree on a type (`mixed`) AND when they agree on having
 *   none yet (every row still on "Select"); both mean "no scope until a
 *   type is chosen in the form", so both render the same way.
 * - `mixed` — the selection spans two or more distinct type values (a
 *   blank type counts as one of them). Purely a wording/affordance flag:
 *   the popup tells the consultant the rows differ and that picking a
 *   type here is what unifies them. `false` for a single shared type and
 *   for an all-blank selection alike.
 * - `keys` — the selected blind rows, in item order.
 */
export type BulkEditSelection =
  | { ok: true; blindsType: string; mixed: boolean; keys: string[] }
  | { ok: false; reason: BulkEditBlocker };

/**
 * Resolves what a bulk selection may edit.
 *
 * Every catalog — materials and all four hardware slots — is scoped per
 * blind type in Settings (`materialsForType` / `optionsForType`), and
 * which slots exist at all differs per type (`slotsForType`). So there is
 * exactly one thing a selection needs before options can be offered: a
 * single blind type. This function reports whether the selection already
 * carries one.
 *
 * When it does not — the rows are of different types, or none has a type
 * yet — the selection is still `ok`: the popup drops back to offering the
 * Blind type dropdown (and colour, which is never scoped) alone, and
 * choosing a type there both unifies the rows and unlocks that type's
 * options. Leaving the type on "No change" in that state keeps each row's
 * own type and limits the run to colour.
 *
 * Unknown/legacy free-text type names are NOT special-cased — they are a
 * type like any other for grouping; the form simply finds no options
 * scoped to them and offers nothing.
 *
 * Pure and UI-free so the toolbar's enablement, the popup's heading and
 * the apply step all read the same verdict.
 */
export function bulkEditSelection(items: ItemDraft[], selected: Set<string>): BulkEditSelection {
  const picked = items.filter((it) => selected.has(it.key));
  if (picked.length === 0) return { ok: false, reason: 'empty' };
  if (picked.some((it) => it.item_type !== 'blind')) return { ok: false, reason: 'non_blind' };
  const blinds = picked as BlindDraft[];
  const types = new Set(blinds.map((it) => it.blinds_type));
  const mixed = types.size > 1;
  return {
    ok: true,
    // A mixed selection has no scope to render options from; an all-blank
    // one has none either, and both are reported the same way (`''`).
    blindsType: mixed ? '' : blinds[0].blinds_type,
    mixed,
    keys: blinds.map((it) => it.key),
  };
}

/**
 * Drops any key from `selected` that no longer names a row in `items`.
 *
 * Exists because a selection Set is state SIBLING to the item list, not
 * derived from it, so nothing keeps the two in sync automatically —
 * removing an item (`OrderDetail.tsx`'s `removeItem`) without this leaves
 * a deleted item's key in `selected` forever: the toolbar's "N selected"
 * count goes stale and a later bulk-delete counts and tries to delete a
 * row that is already gone. Mirrors `LineItemList.tsx`'s own pruning of
 * its `expanded` detail-panel Set on the identical membership change.
 *
 * Returns `selected` itself, unchanged, when nothing was pruned, so a
 * caller feeding this through `setState` never triggers an extra render
 * for a no-op prune.
 */
export function pruneSelection(selected: Set<string>, items: { key: string }[]): Set<string> {
  const valid = new Set(items.map((it) => it.key));
  let changed = false;
  const next = new Set<string>();
  for (const key of selected) {
    if (valid.has(key)) next.add(key);
    else changed = true;
  }
  return changed ? next : selected;
}

/** Parses a positive number from a draft string; null when invalid. */
export function parsePositive(value: string): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The result of reading an override input; `valid: false` blocks the preview. */
export type OverrideParse = { valid: true; value: number | null } | { valid: false };

/**
 * Reads an override input. Empty (or whitespace) means "no override" —
 * NOT zero, which is a real, deliberate override of a line given away.
 * Anything else must be a finite figure of at least zero, because the
 * server's schema would reject the rest and the preview must never quote
 * a price the save is about to refuse.
 */
export function parseOverride(raw: string): OverrideParse {
  if (raw.trim() === '') return { valid: true, value: null };
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return { valid: false };
  return { valid: true, value: n };
}

/**
 * Converts add-on drafts into the payload shape. A row with no label is
 * dropped (an unnamed extra is one the user started and abandoned); an
 * unparsable or blank price counts as 0 rather than blocking, so typing
 * a label before its price never blanks the whole price readout.
 */
export function parseAddons(addons: DraftAddon[]): { label: string; price: number }[] {
  return addons
    .filter((a) => a.label.trim() !== '')
    .map((a) => {
      const n = Number(a.price);
      return { label: a.label.trim(), price: Number.isFinite(n) && n > 0 ? n : 0 };
    });
}

/**
 * Whether this draft's price may be overridden — true for every blind,
 * and for a preset that carries catalog provenance. A custom item's price
 * is already typed by hand, and a legacy preset has no calculated price
 * to return to, so both would be offering two names for one number.
 *
 * Mirrors the identical rule in the Worker's `resolveLineItems`.
 */
export function canOverridePrice(draft: ItemDraft): boolean {
  if (draft.item_type === 'blind') return true;
  return draft.item_type === 'preset' && draft.preset_id !== null;
}

/**
 * Converts a draft's raw string attributes into the typed blob the API
 * and the blind-type modules expect, validated by that type's own
 * schema. Returns null when the values do not satisfy it — the same
 * "not ready yet" signal a missing height gives.
 *
 * Blank strings are DROPPED rather than coerced. A field the user has
 * not filled must look absent to the schema (so its default applies),
 * not present-and-empty, which a numeric field would read as NaN.
 *
 * This is one of exactly two conversion points; the other is the payload
 * builder in OrderDetail, which calls this same function. Form
 * components read and write draft strings only and never parse.
 */
export function parseDraftAttributes(draft: BlindDraft): BlindAttributes | null {
  const blindType = getBlindType(draft.blinds_type);
  // Keep ONLY the keys the type accepts from a client. A re-opened order
  // carries the Worker's snapshot keys (pleat_name, pleat_multiplier, …)
  // in its draft, and the strict schema would reject the whole blob — the
  // item would silently lose its options on the second save. Filtering
  // here is also what stops a resolved PRICE from being echoed back.
  const inputs = new Set(blindType.inputKeys());
  const filled: Record<string, string> = {};
  for (const [k, v] of Object.entries(draft.attributes)) {
    if (inputs.has(k) && v.trim() !== '') filled[k] = v.trim();
  }
  const result = blindType.attributeSchema.safeParse(filled);
  return result.success ? (result.data as BlindAttributes) : null;
}

/**
 * Backs `resolveCatalogRefs` with the catalog lists already in the React
 * Query cache, so the keystroke preview resolves the same ids the Worker
 * will resolve against Postgres on save.
 *
 * This is the ONLY place the web maps a catalog table name to a list. It
 * lives here rather than in a blind-type module because the modules are
 * api/web twins and must not know how either side stores its catalogs.
 *
 * Pleat types are the only entry: they are the last catalog still
 * referenced from `attributes`. Installation used to be here too, until
 * migration 35 promoted it to a real hardware slot resolved from a column.
 */
function catalogResolver(catalogs: Catalogs): CatalogResolver {
  return (table, id) => {
    if (table === 'pleat_types') {
      const hit = catalogs.pleatTypes.find((p) => p.id === id);
      return hit ? { name: hit.name, value: Number(hit.multiplier) } : undefined;
    }
    return undefined;
  };
}

/**
 * Re-derives one draft's pricing inputs in the shape the Worker
 * fingerprints, or null while the draft is too incomplete to describe.
 *
 * MUST match `buildPayload` in `OrderDetail.tsx` field for field — the
 * same trimming, the same `|| null` on every optional id — because the
 * Worker fingerprints the payload that function produces. A difference
 * here would show a frozen price the save then quietly replaced, or the
 * reverse.
 */
function lockInputFromDraft(draft: ItemDraft): PriceLockInput | null {
  if (draft.item_type !== 'blind') {
    const presetId = draft.item_type === 'preset' ? draft.preset_id : null;
    const typed = Number(draft.unit_price);
    return {
      item_type: draft.item_type,
      preset_id: presetId,
      // A preset with provenance is priced from its catalog row, and its
      // typed figure never travels — so it is not an input.
      unit_price: presetId ? null : Number.isFinite(typed) ? typed : null,
    };
  }
  const panels = draft.panels.map(parsePositive);
  const height = parsePositive(draft.height_cm);
  const attributes = parseDraftAttributes(draft);
  if (panels.some((p) => p === null) || panels.length === 0) return null;
  if (!height || attributes === null) return null;
  return {
    item_type: 'blind',
    blinds_type: draft.blinds_type.trim(),
    panels: panels as number[],
    height_cm: height,
    material_id: draft.material_id || null,
    cassette_id: draft.cassette_id || null,
    bottom_rail_id: draft.bottom_rail_id || null,
    control_id: draft.control_id || null,
    installation_id: draft.installation_id || null,
    attributes,
  };
}

/**
 * The frozen price still in force for a draft, or null when the item is
 * live-priced — because the order is still a draft, or because this
 * item's pricing inputs have been edited since it was quoted.
 */
function lockedBase(draft: ItemDraft): number | null {
  if (!draft.lock) return null;
  const input = lockInputFromDraft(draft);
  return input && lockApplies(draft.lock, input) ? draft.lock.base : null;
}

/**
 * Whether this draft is currently showing its quoted, frozen price —
 * what the editor's lock badge renders from. Turns false the moment a
 * pricing input is edited, which is also the moment the price on screen
 * starts moving again.
 */
export function isPriceLocked(draft: ItemDraft): boolean {
  return lockedBase(draft) !== null;
}

/**
 * Whether this item is EXEMPT from the hardware requirements of its blind
 * type — because it is not being quoted now, it already was.
 *
 * Adding an installation (or cassette, bottom rail, control) option to a
 * blind type makes that slot required for the type from that moment on
 * (`slotsForType`). Without this exemption the new rule would reach back
 * into every estimate already quoted on that type: those items carry no
 * id for the slot, so the form would refuse to build a payload and
 * `Present to customer` — which saves first — would be unreachable.
 *
 * True when the item was already on a price-locked order AND either:
 *   - its lock still holds, so nothing about its pricing has been
 *     touched; or
 *   - it never had a lock, which means a row saved before migration 39.
 *
 * An item whose lock BROKE is excluded on purpose: editing its pricing
 * inputs re-quotes it, so it has to satisfy today's requirements. This is
 * the exact rule `resolveLineItems` enforces on the Worker (`prior` +
 * the locked branch's early return), and the two MUST agree — the form
 * decides what it will send, the Worker decides what it will accept.
 */
export function isAlreadyQuoted(draft: ItemDraft): boolean {
  // The uid is checked as well as the flag, exactly as the Worker checks
  // `prior.uids`: a DUPLICATED line inherits the flag from the row it was
  // copied from but is given no uid, and it is a new line being quoted
  // now — one the Worker will hold to today's requirements.
  if (!draft.previously_quoted || draft.uid === null) return false;
  return draft.lock === null || isPriceLocked(draft);
}

/**
 * The four figures a price readout shows.
 *
 * `base` is what the formula or catalog produced and is displayed even
 * while an override is in effect — a consultant discounting a line has to
 * be able to see what they are discounting from. `unit` is what will be
 * charged. `total` already includes the add-ons.
 */
export interface DraftPrice {
  base: number;
  unit: number;
  addonsTotal: number;
  total: number;
}

/**
 * Assembles a `DraftPrice` from a calculated base, mirroring the Worker.
 * Shared by both draft kinds so the override and add-on rules cannot
 * differ between a blind and a preset.
 */
function adjustedDraftPrice(
  base: number,
  quantity: number,
  draft: PriceAdjustmentDraft,
  canOverride: boolean
): DraftPrice | null {
  const override = parseOverride(draft.unit_price_override);
  if (!override.valid) return null;
  const adjusted = applyPriceAdjustments({
    base,
    quantity,
    override: canOverride ? override.value : null,
    addons: parseAddons(draft.addons),
  });
  const unitLeg = Math.round(adjusted.unit_price * quantity * 100) / 100;
  return {
    base: Math.round(base * 100) / 100,
    unit: adjusted.unit_price,
    addonsTotal: Math.round((adjusted.line_total - unitLeg) * 100) / 100,
    total: adjusted.line_total,
  };
}

/**
 * Resolves a blind draft to the priced inputs its type's module expects,
 * or null when the draft is not yet complete enough to price.
 *
 * Split out of {@link blindDraftPrice} so the Material usage report can
 * ask a draft the same question the price preview asks — what does this
 * blind resolve to — without a second, looser copy of the completeness
 * gating. A row the editor refuses to price must not appear in the usage
 * report with a confident area figure, and sharing this function is what
 * guarantees that.
 *
 * Which hardware slots are REQUIRED comes from `slotsForType`, the same
 * scoping the form renders from and the Worker validates against: a slot
 * the selected type does not use contributes nothing rather than
 * blocking, because Curtains has neither a cassette nor a bottom rail
 * scoped to it and would otherwise never resolve.
 *
 * An ALREADY-QUOTED item ({@link isAlreadyQuoted}) is exempt from those
 * requirements, and is charged for whatever hardware ids it does carry —
 * both halves mirroring what the Worker does with such a row, so the
 * preview and the save cannot disagree.
 */
export function blindDraftInputs(draft: BlindDraft, catalogs: Catalogs): BlindInputs | null {
  const blindType = getBlindType(draft.blinds_type);
  const uses = slotsForType(catalogs, draft.blinds_type);
  const quoted = isAlreadyQuoted(draft);
  const panels = draft.panels.map(parsePositive);
  const height = parsePositive(draft.height_cm);
  const qty = parsePositive(draft.quantity);
  const material = catalogs.materials.find((m) => m.id === draft.material_id);
  const control = catalogs.controls.find((x) => x.id === draft.control_id);
  const cassette = catalogs.cassettes.find((x) => x.id === draft.cassette_id);
  const bottomRail = catalogs.bottomRails.find((x) => x.id === draft.bottom_rail_id);
  const installation = catalogs.installationOptions.find((x) => x.id === draft.installation_id);
  if (panels.some((p) => p === null) || panels.length === 0) return null;
  if (!height || !qty || !material) return null;
  // An already-quoted item is exempt from a slot its type has only
  // required since it was quoted (`isAlreadyQuoted`), so it must still
  // RESOLVE here or the editor would show no price and the Material usage
  // report would drop the row — while the Worker saves it quite happily.
  const needs = (slot: CatalogSlot) => !quoted && uses.has(slot);
  if (needs('cassette') && !cassette) return null;
  if (needs('bottom_rail') && !bottomRail) return null;
  if (needs('control') && !control) return null;
  if (needs('installation') && !installation) return null;

  // The type's own inputs must parse too, or the preview would show a
  // price the server is about to reject.
  const attributes = parseDraftAttributes(draft);
  if (attributes === null) return null;

  // The charges this blind carries, each on the basis its own catalog row
  // declares. A slot with no chosen option is ABSENT rather than zeroed —
  // exactly as the Worker builds it, so the preview and the save agree.
  //
  // Gated on `uses` as well as on the id, because a draft keeps whatever
  // id the PREVIOUS blind type left behind. The Worker rejects an id for a
  // slot the type does not use, so a preview that charged one would quote
  // a price the save refuses.
  //
  // That rejection is exactly what an already-quoted item is exempt from,
  // and the Worker then charges whatever ids the row carries. So the
  // exemption drops the `uses` half here too: anything else would preview
  // one price and save another.
  const charges = (slot: CatalogSlot) => quoted || uses.has(slot);
  const hardware: Partial<Record<CatalogSlot, HardwareCharge>> = {};
  if (charges('cassette') && cassette) {
    hardware.cassette = { price: Number(cassette.price), basis: cassette.price_basis };
  }
  if (charges('bottom_rail') && bottomRail) {
    hardware.bottom_rail = { price: Number(bottomRail.price), basis: bottomRail.price_basis };
  }
  if (charges('control') && control) {
    hardware.control = { price: Number(control.price), basis: control.price_basis };
  }
  if (charges('installation') && installation) {
    hardware.installation = { price: Number(installation.price), basis: installation.price_basis };
  }

  // Mirrors the Worker: ids in, snapshot name/value out. A chosen row
  // that is not in the cache throws, which here means "not ready yet".
  let resolved: BlindAttributes;
  try {
    resolved = blindType.resolveCatalogRefs(attributes, catalogResolver(catalogs));
  } catch {
    return null;
  }

  return {
    panels: panels as number[],
    height_cm: height,
    material_price_per_sqm: Number(material.price_per_sqm),
    hardware,
    quantity: qty,
    attributes: resolved,
  };
}

/**
 * Live price preview for a blind draft. Returns null until every field
 * the SELECTED TYPE requires is filled — see {@link blindDraftInputs},
 * which owns that completeness rule and the input assembly. This function
 * adds only the type dispatch and the override/add-on adjustment, so the
 * preview and the Material usage report can never disagree about which
 * drafts are ready.
 */
export function blindDraftPrice(draft: BlindDraft, catalogs: Catalogs): DraftPrice | null {
  // The frozen price wins before any catalog is consulted: a locked item
  // must preview at its quoted figure even when the material it names
  // has since been deleted from Settings, which is exactly the case the
  // formula path below refuses to price at all.
  const frozen = lockedBase(draft);
  if (frozen !== null) {
    const qty = parsePositive(draft.quantity);
    return qty ? adjustedDraftPrice(frozen, qty, draft, true) : null;
  }

  const inputs = blindDraftInputs(draft, catalogs);
  if (!inputs) return null;

  // Dispatch to the selected blind type's module (default fallback).
  const base = calculateBlindUnitPriceForType(draft.blinds_type, inputs);
  return adjustedDraftPrice(base, inputs.quantity, draft, true);
}

/**
 * Live price preview for a preset/custom draft; null until valid.
 *
 * A preset with provenance is priced by the SERVER from the catalog, and
 * the draft's `unit_price` carries that catalog figure for display —
 * which is why it is still the base here. An override applies only where
 * `canOverridePrice` allows it, mirroring the Worker exactly.
 */
export function flatDraftPrice(draft: FlatDraft): DraftPrice | null {
  const qty = parsePositive(draft.quantity);
  const frozen = lockedBase(draft);
  const base = frozen ?? Number(draft.unit_price);
  if (!qty || !Number.isFinite(base) || base < 0) return null;
  return adjustedDraftPrice(base, qty, draft, canOverridePrice(draft));
}

/** A price that has moved since the last send, oldest figure first. */
export interface QuotedPriceChange {
  /** The calculated base the customer was last sent. */
  from: number;
  /** The calculated base in force now. */
  to: number;
}

/**
 * How this item's calculated base price has moved since the estimate was
 * last SENT, or null when it has not moved — or when there is nothing to
 * compare against.
 *
 * What the line-item details form's price-update notice renders. The
 * comparison is `quoted_base` (written only by a send, migration 48)
 * against the figure in force now, which is the frozen one while the lock
 * holds and a live calculation once it has been broken. So the notice
 * appears the moment a pricing input is edited, SURVIVES the save that
 * re-locks the item at its new price, and disappears when the estimate
 * goes out again and the stamp moves.
 *
 * Deliberately blind to quantity, add-ons and the manual override: none
 * of them is part of the quoted base, they apply live on top of whichever
 * figure is in force, and reporting them as a price update would cry wolf
 * on every ordinary edit.
 *
 * Null while the draft is not priceable, so a half-typed measurement
 * shows nothing rather than flickering a bogus figure.
 */
export function quotedPriceChange(
  draft: ItemDraft,
  catalogs: Catalogs
): QuotedPriceChange | null {
  // `isFinite` as well as the null check: an API that predates migration
  // 48 sends no such column at all, and a NaN would render as a `$NaN`
  // price update rather than as the "nothing to report" it is.
  if (draft.quoted_base === null || !Number.isFinite(draft.quoted_base)) return null;
  const price = draft.item_type === 'blind' ? blindDraftPrice(draft, catalogs) : flatDraftPrice(draft);
  if (!price) return null;
  const from = Math.round(draft.quoted_base * 100) / 100;
  if (from === price.base) return null;
  // Dismissed — but only for the figure that was dismissed. A further
  // move puts a price on screen nobody has acknowledged, so it speaks.
  if (draft.notice_ack_base !== null && Math.round(draft.notice_ack_base * 100) / 100 === price.base) {
    return null;
  }
  return { from, to: price.base };
}
