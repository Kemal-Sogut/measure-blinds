// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Filter model for the Order Presentation page.
 *
 * A consultant standing with a customer narrows the blind list by the
 * choices already made in THIS order — "show me the cordless ones", "the
 * fabric-wrapped rails in the bedroom". Every value offered is therefore
 * harvested from the order's own line items rather than from the catalog:
 * a filter can never be built that matches nothing.
 *
 * Deliberately free of React so the combination rule can be tested
 * directly. The page owns the filter array; this module only answers
 * questions about it.
 */

import type { LineItem } from '../../types';

/**
 * A field a blind can be filtered on: the two identity fields plus every
 * option type.
 *
 * A superset of `OptionColumn` in `lib/optionBreakdown.ts` — room and
 * blind type are filterable but are not option columns, so the two lists
 * stay separate rather than one leaking into the other.
 */
export type FilterField =
  | 'room_name'
  | 'blinds_type'
  | 'material'
  | 'color'
  | 'cassette'
  | 'bottom_rail'
  | 'control'
  | 'installation';

/** Field order in the filter-row dropdown. */
export const FILTER_FIELDS: readonly FilterField[] = [
  'room_name',
  'blinds_type',
  'material',
  'color',
  'cassette',
  'bottom_rail',
  'control',
  'installation',
];

/** Customer-facing label for each filter field. */
export const FILTER_FIELD_LABELS: Record<FilterField, string> = {
  room_name: 'Room',
  blinds_type: 'Blind type',
  material: 'Material',
  color: 'Colour',
  cassette: 'Cassette',
  bottom_rail: 'Bottom rail',
  control: 'Control',
  installation: 'Installation',
};

/**
 * One filter row. `value === ''` means the consultant has added the row
 * but not yet chosen — it matches everything, so a half-built filter never
 * blanks the table mid-gesture.
 *
 * `id` is UI identity only (React keys, removal), never compared.
 */
export interface PresentationFilter {
  id: string;
  field: FilterField;
  value: string;
}

/** One field's available values, with how many blinds carry each. */
export interface Facet {
  field: FilterField;
  values: { value: string; count: number }[];
}

/** Fields that describe a CHOICE rather than a blind's identity. */
const OPTION_FIELDS: readonly FilterField[] = [
  'material',
  'color',
  'cassette',
  'bottom_rail',
  'control',
  'installation',
];

/**
 * The value a blind carries for one filter field, or `''` when it carries
 * none. Reads the SNAPSHOT columns, so filtering agrees with the money the
 * table shows beside it.
 */
export function fieldValue(item: LineItem, field: FilterField): string {
  switch (field) {
    case 'room_name':
      return item.room_name || '';
    case 'blinds_type':
      return item.blinds_type || '';
    case 'material':
      return item.material_name || '';
    case 'color':
      return item.color || '';
    case 'cassette':
      return item.cassette_name || '';
    case 'bottom_rail':
      return item.bottom_rail_name || '';
    case 'control':
      return item.control_name || '';
    case 'installation':
      return item.installation_name || '';
  }
}

/**
 * The filterable values present in this order, first-seen order preserved
 * so a dropdown reads in the order the consultant entered the blinds.
 *
 * Counts are over ALL the blinds passed in, NOT over the currently
 * filtered set: they describe the order ("3 of these are cordless"), which
 * is what gets read aloud, and recomputing them against live filters would
 * make the numbers jump while a filter is being built and show `(0)`
 * beside the value the consultant is reaching for.
 *
 * A field no blind carries a value for is omitted entirely, which is what
 * keeps an order of plain rollers from offering four empty dropdowns.
 * Preset and custom lines are skipped — they have no options.
 */
export function buildFacets(items: LineItem[]): Facet[] {
  const blinds = items.filter((item) => item.item_type === 'blind');
  const facets: Facet[] = [];
  for (const field of FILTER_FIELDS) {
    const counts = new Map<string, number>();
    for (const item of blinds) {
      const value = fieldValue(item, field);
      if (!value) continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    if (counts.size === 0) continue;
    facets.push({
      field,
      values: [...counts.entries()].map(([value, count]) => ({ value, count })),
    });
  }
  return facets;
}

/**
 * Whether a blind survives the active filters.
 *
 * AND across fields, OR within one: a blind must satisfy every field that
 * has at least one valued filter, and within a field matching any chosen
 * value is enough. That is what makes "cordless AND fabric-wrapped" narrow
 * while "cordless OR motorised" widens — ANDing everywhere would make two
 * values of one field a guaranteed empty table.
 *
 * Valueless rows are ignored rather than matching nothing.
 */
export function matchesFilters(item: LineItem, filters: PresentationFilter[]): boolean {
  const byField = new Map<FilterField, string[]>();
  for (const filter of filters) {
    if (!filter.value) continue;
    const values = byField.get(filter.field);
    if (values) values.push(filter.value);
    else byField.set(filter.field, [filter.value]);
  }
  for (const [field, values] of byField) {
    if (!values.includes(fieldValue(item, field))) return false;
  }
  return true;
}

/**
 * Whether the view has been narrowed to particular OPTIONS, as opposed to
 * not filtered at all or filtered only by room / blind type.
 *
 * The page uses this to decide whether preset and custom lines still
 * belong on screen: "the blinds in the bedroom" can reasonably include the
 * call-out fee, but "the cordless ones" cannot.
 */
export function hasOptionFilter(filters: PresentationFilter[]): boolean {
  return filters.some((filter) => Boolean(filter.value) && OPTION_FIELDS.includes(filter.field));
}
