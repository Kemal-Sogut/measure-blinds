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
import { getBlindType } from '../../lib/blindTypes';
import type { BlindAttributes, CatalogResolver } from '../../lib/blindTypes/base';
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

/** Editable state of one blind line item (strings for free typing). */
export interface BlindDraft {
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
export interface FlatDraft {
  key: string;
  item_type: 'preset' | 'custom';
  description: string;
  quantity: string;
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

/** Parses a positive number from a draft string; null when invalid. */
export function parsePositive(value: string): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
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
 * Live price preview for a blind draft. Returns null until every field
 * the SELECTED TYPE requires is filled — which hardware options those
 * are is the type's own call (`requiredCatalogs`), because Curtains has
 * neither a cassette nor a bottom rail and would otherwise never price.
 */
export function blindDraftPrice(
  draft: BlindDraft,
  catalogs: Catalogs
): { unit: number; total: number } | null {
  const blindType = getBlindType(draft.blinds_type);
  const uses = new Set<string>(blindType.requiredCatalogs);
  const panels = draft.panels.map(parsePositive);
  const height = parsePositive(draft.height_cm);
  const qty = parsePositive(draft.quantity);
  const material = catalogs.materials.find((m) => m.id === draft.material_id);
  const control = catalogs.controls.find((x) => x.id === draft.control_id);
  const cassette = catalogs.cassettes.find((x) => x.id === draft.cassette_id);
  const bottomRail = catalogs.bottomRails.find((x) => x.id === draft.bottom_rail_id);
  if (panels.some((p) => p === null) || panels.length === 0) return null;
  if (!height || !qty || !material || !control) return null;
  if (uses.has('cassette') && !cassette) return null;
  if (uses.has('bottom_rail') && !bottomRail) return null;

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
  const unit = calculateBlindUnitPriceForType(draft.blinds_type, {
    panels: panels as number[],
    height_cm: height,
    material_price_per_sqm: Number(material.price_per_sqm),
    cassette_price_per_m: Number(cassette?.price_per_m ?? 0),
    bottom_rail_price_per_m: Number(bottomRail?.price_per_m ?? 0),
    control_price_per_item: Number(control.price_per_item),
    quantity: qty,
    attributes: resolved,
  });
  return { unit, total: Math.round(unit * qty * 100) / 100 };
}

/** Live price preview for a preset/custom draft; null until valid. */
export function flatDraftPrice(draft: FlatDraft): { unit: number; total: number } | null {
  const qty = parsePositive(draft.quantity);
  const unit = Number(draft.unit_price);
  if (!qty || !Number.isFinite(unit) || unit < 0) return null;
  const rounded = Math.round(unit * 100) / 100;
  return { unit: rounded, total: Math.round(rounded * qty * 100) / 100 };
}
