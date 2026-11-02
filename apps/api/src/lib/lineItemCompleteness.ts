// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Which product decisions and measurements are still OPEN on a line item.
 *
 * Spec 2026-11-02 (incomplete draft items): a draft may be saved with a
 * blind whose type, widths, height, material, scoped hardware or a
 * type's required attribute are not decided yet. Such an item is
 * INCOMPLETE — stored at $0, and the invariant is that it can exist only
 * on a `draft`: every route that takes an order out of draft refuses
 * while this rule reports anything.
 *
 * TWIN of the other workspace's `lib/lineItemCompleteness.ts`, which
 * must stay byte-identical: the editor's chips and pre-checks run this
 * against live drafts, and the Worker's save and send gates run it
 * against payloads and stored rows. If the two disagreed, the editor
 * would offer a Send the Worker refuses, or the reverse.
 *
 * Pure: the caller supplies the blind-type scoping (`SlotScoping` from
 * `optionScoping.ts` on the Worker, `scopeFromCatalogs` in the editor),
 * so the rule is judged against TODAY's Settings — a type that gains a
 * slot makes its open drafts incomplete, which is intended.
 */

import { getBlindType } from './blindTypes';
import type { CatalogSlot } from './blindTypes/base';

/**
 * The fields the rule reads. Loose on purpose (every field optional and
 * nullable) so a stored row, a parsed payload item and an editor draft
 * converted by `draftCompletenessInput` all satisfy it without mapping.
 */
export interface CompletenessInput {
  item_type: 'blind' | 'preset' | 'custom';
  room_name?: string | null;
  blinds_type?: string | null;
  /** A blank panel width is `null`; `0` reads as blank too. */
  panels?: readonly (number | null)[] | null;
  height_cm?: number | null;
  material_id?: string | null;
  cassette_id?: string | null;
  bottom_rail_id?: string | null;
  control_id?: string | null;
  installation_id?: string | null;
  attributes?: Record<string, unknown> | null;
}

/**
 * Blind-type scoping as the rule needs it. `requiredAttributes` is
 * optional and defaults to the registry's `getBlindType(name)
 * .requiredAttributes`; tests inject it.
 */
export interface CompletenessScope {
  /** True when the name resolves to a configured blind type. */
  isKnownType(name: string): boolean;
  /** True when the type uses that hardware slot (an active option is scoped to it). */
  usesSlot(name: string, slot: CatalogSlot): boolean;
  requiredAttributes?(name: string): readonly { key: string; noun: string }[];
}

/** The noun each hardware slot is reported as — also the message noun. */
export const SLOT_NOUNS: Record<CatalogSlot, string> = {
  cassette: 'cassette',
  bottom_rail: 'bottom rail',
  control: 'control option',
  installation: 'installation option',
};

/** Slot, its id column, in the order the form and the messages list them. */
const SLOT_FIELDS = [
  ['cassette', 'cassette_id'],
  ['bottom_rail', 'bottom_rail_id'],
  ['control', 'control_id'],
  ['installation', 'installation_id'],
] as const;

/** Nouns whose message is "enter …" rather than "choose a …". */
const MEASUREMENT_ACTIONS: Record<string, string> = {
  width: 'enter every panel width',
  height: 'enter a height',
};

const isPositive = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v > 0;
const isBlank = (v: unknown): boolean =>
  v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

/**
 * Every open field of one item, in message order: blind type, width,
 * height, material, each scoped slot, each required attribute. `[]` for
 * a complete blind and ALWAYS `[]` for a preset/custom item (their own
 * title/price rules run at parse time, unchanged).
 *
 * A blank type uses no slot, and an UNKNOWN non-blank type (legacy free
 * text, a deleted type) is unconstrained on hardware — the same rule the
 * Worker's slot gate has always applied.
 */
export function missingFields(item: CompletenessInput, scope: CompletenessScope): string[] {
  if (item.item_type !== 'blind') return [];
  const out: string[] = [];
  const type = (item.blinds_type ?? '').trim();
  if (type === '') out.push('blind type');
  const panels = item.panels ?? [];
  if (panels.length === 0 || panels.some((p) => !isPositive(p))) out.push('width');
  if (!isPositive(item.height_cm)) out.push('height');
  if (isBlank(item.material_id)) out.push('material');
  if (type !== '' && scope.isKnownType(type)) {
    for (const [slot, key] of SLOT_FIELDS) {
      if (scope.usesSlot(type, slot) && isBlank(item[key])) out.push(SLOT_NOUNS[slot]);
    }
  }
  if (type !== '') {
    const required = scope.requiredAttributes?.(type) ?? getBlindType(type).requiredAttributes;
    const attrs = item.attributes ?? {};
    for (const r of required) if (isBlank(attrs[r.key])) out.push(r.noun);
  }
  return out;
}

/**
 * The user-facing message for one incomplete item, naming its FIRST open
 * field: `Item 3 (Kitchen): choose a control option.` — the wording the
 * editor's save guard has always used, so nothing reads new.
 *
 * @param index Zero-based position in the order's full item list.
 */
export function incompleteMessage(
  index: number,
  item: CompletenessInput,
  missing: readonly string[]
): string {
  const room = (item.room_name ?? '').trim();
  const noun = missing[0] ?? 'blind type';
  const action = MEASUREMENT_ACTIONS[noun] ?? `choose ${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`;
  return `Item ${index + 1}${room ? ` (${room})` : ''}: ${action}.`;
}

/**
 * The message for the first incomplete item, or null when the whole list
 * is complete. Hidden items count: the invariant is about the ORDER, and
 * a hidden item can be un-hidden on a sent order.
 */
export function firstIncompleteMessage(
  items: readonly CompletenessInput[],
  scope: CompletenessScope
): string | null {
  for (const [index, item] of items.entries()) {
    const missing = missingFields(item, scope);
    if (missing.length > 0) return incompleteMessage(index, item, missing);
  }
  return null;
}

/** How many items are incomplete — the lists' "Incomplete" badge count. */
export function countIncomplete(
  items: readonly CompletenessInput[],
  scope: CompletenessScope
): number {
  return items.filter((item) => missingFields(item, scope).length > 0).length;
}

/**
 * The measured panel widths of a stored blind, dropping blank (`null`)
 * and non-positive entries. Every display that joins or sums widths
 * reads through this, because a draft may hold a blank panel.
 */
export function measuredWidths(panels: readonly (number | null)[] | null | undefined): number[] {
  return (panels ?? []).filter((w): w is number => typeof w === 'number' && w > 0);
}
