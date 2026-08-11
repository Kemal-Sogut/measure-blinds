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

import { calculateBlindUnitPriceForType } from '../../lib/pricing';
import { applyPriceAdjustments } from '../../lib/lineItemAdjustments';
import { getBlindType } from '../../lib/blindTypes';
import type { BlindAttributes, CatalogResolver, CatalogSlot } from '../../lib/blindTypes/base';
import type {
  Material,
  CassetteOption,
  BottomRailOption,
  ControlOption,
  BlindType,
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
}

/** Editable state of one blind line item (strings for free typing). */
export interface BlindDraft extends PriceAdjustmentDraft {
  key: string;
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
 */
function catalogResolver(catalogs: Catalogs): CatalogResolver {
  return (table, id) => {
    if (table === 'pleat_types') {
      const hit = catalogs.pleatTypes.find((p) => p.id === id);
      return hit ? { name: hit.name, value: Number(hit.multiplier) } : undefined;
    }
    if (table === 'installation_options') {
      const hit = catalogs.installationOptions.find((o) => o.id === id);
      return hit ? { name: hit.name, value: Number(hit.price_per_item) } : undefined;
    }
    return undefined;
  };
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
 * Live price preview for a blind draft. Returns null until every field
 * the SELECTED TYPE requires is filled — which hardware options those
 * are comes from `slotsForType`, the same scoping the form renders from
 * and the Worker validates against, because Curtains has neither a
 * cassette nor a bottom rail scoped to it and would otherwise never
 * price. A slot the type does not use contributes 0 rather than blocking.
 */
export function blindDraftPrice(draft: BlindDraft, catalogs: Catalogs): DraftPrice | null {
  const blindType = getBlindType(draft.blinds_type);
  const uses = slotsForType(catalogs, draft.blinds_type);
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
  if (uses.has('cassette') && !cassette) return null;
  if (uses.has('bottom_rail') && !bottomRail) return null;
  if (uses.has('control') && !control) return null;
  if (uses.has('installation') && !installation) return null;

  // The type's own inputs must parse too, or the preview would show a
  // price the server is about to reject.
  const attributes = parseDraftAttributes(draft);
  if (attributes === null) return null;

  // Mirrors the Worker: ids in, snapshot name/value out. A chosen row
  // that is not in the cache throws, which here means "not ready yet".
  let resolved: BlindAttributes;
  try {
    resolved = blindType.resolveCatalogRefs(attributes, catalogResolver(catalogs));
  } catch {
    return null;
  }

  // Dispatch to the selected blind type's module (default fallback).
  const base = calculateBlindUnitPriceForType(draft.blinds_type, {
    panels: panels as number[],
    height_cm: height,
    material_price_per_sqm: Number(material.price_per_sqm),
    cassette_price_per_m: Number(cassette?.price_per_m ?? 0),
    bottom_rail_price_per_m: Number(bottomRail?.price_per_m ?? 0),
    control_price_per_item: Number(control?.price_per_item ?? 0),
    installation_price_per_item: Number(installation?.price_per_item ?? 0),
    quantity: qty,
    attributes: resolved,
  });
  return adjustedDraftPrice(base, qty, draft, true);
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
  const base = Number(draft.unit_price);
  if (!qty || !Number.isFinite(base) || base < 0) return null;
  return adjustedDraftPrice(base, qty, draft, canOverridePrice(draft));
}
