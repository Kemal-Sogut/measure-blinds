// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Blind-type scoping for the four shared option catalogs — cassette,
 * bottom rail, control and installation.
 *
 * Which hardware slots a blind type uses is DATA, not code: an option is
 * linked to a blind type in a `<catalog>_blind_types` join table
 * (migration 35), and a type uses a slot exactly when at least one ACTIVE
 * option is linked to it. This module is the Worker's answer to that
 * question, and `slotsForType` in the web line-item editor answers it
 * locally from the catalog lists TanStack Query already holds, on the
 * same rule. The two MUST agree: the editor decides which dropdowns to
 * render and `resolveLineItems` decides what the save requires, so a
 * divergence shows up as a form that cannot be saved.
 *
 * Line items store the blind type as a snapshot NAME, not an id, so the
 * lookup is by name. A name matching no `blind_types` row — free text
 * from before the dropdown existed, or a since-deleted type — is
 * UNCONSTRAINED: `isKnownType` returns false and callers skip enforcement
 * entirely. Any other rule would make every pre-dropdown order
 * permanently unsavable.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CatalogSlot } from './blindTypes/base';

/**
 * Per slot: the join table, its option-side foreign key, and the option
 * catalog itself. Exported so a caller that needs to write links (the
 * settings routes) names the same tables this module reads.
 */
export const SLOT_TABLES: Record<CatalogSlot, { join: string; fk: string; options: string }> = {
  cassette: {
    join: 'cassette_option_blind_types',
    fk: 'cassette_option_id',
    options: 'cassette_options',
  },
  bottom_rail: {
    join: 'bottom_rail_option_blind_types',
    fk: 'bottom_rail_option_id',
    options: 'bottom_rail_options',
  },
  control: {
    join: 'control_option_blind_types',
    fk: 'control_option_id',
    options: 'control_options',
  },
  installation: {
    join: 'installation_option_blind_types',
    fk: 'installation_option_id',
    options: 'installation_options',
  },
};

/** Every slot, in the order the form and the save errors list them. */
const SLOTS = Object.keys(SLOT_TABLES) as CatalogSlot[];

/**
 * Answers slot questions for the blind types of one save. An object
 * rather than raw rows so no caller can reimplement — and get subtly
 * wrong — the "active AND linked" rule.
 */
export interface SlotScoping {
  /** True when the stored type name resolves to a `blind_types` row. */
  isKnownType(blindsType: string): boolean;
  /**
   * True when at least one ACTIVE option of that catalog is linked to the
   * type. Always false for an unknown type — check `isKnownType` first,
   * because "unconstrained" and "uses nothing" are different answers.
   */
  usesSlot(blindsType: string, slot: CatalogSlot): boolean;
}

/**
 * Loads the scoping for a set of blind-type NAMES: one query to resolve
 * the names, then a join table and an option list per slot, all in
 * parallel.
 *
 * The `active` filter is applied in memory rather than in the query. Both
 * lists are small shop catalogs, and keeping the rule in one place here
 * means the module — not Postgres — is what the tests pin it to.
 *
 * Short-circuits to an empty scoping when the list is empty or entirely
 * blank, so an order of nothing but preset and custom items costs no
 * round trips at all.
 */
export async function loadSlotScoping(
  sb: SupabaseClient,
  blindsTypes: string[]
): Promise<SlotScoping> {
  const names = [...new Set(blindsTypes.filter((n) => n !== ''))];
  if (names.length === 0) return emptyScoping();

  const { data: typeRows, error } = await sb.from('blind_types').select('id, name').in('name', names);
  if (error) throw new Error(error.message);

  const idByName = new Map<string, string>(
    ((typeRows ?? []) as Record<string, unknown>[]).map((r) => [String(r.name), String(r.id)])
  );
  if (idByName.size === 0) return emptyScoping();
  const typeIds = [...idByName.values()];

  const perSlot = await Promise.all(
    SLOTS.map(async (slot) => {
      const cfg = SLOT_TABLES[slot];
      const [optionRes, linkRes] = await Promise.all([
        sb.from(cfg.options).select('id, active'),
        sb.from(cfg.join).select(`${cfg.fk}, blind_type_id`).in('blind_type_id', typeIds),
      ]);
      if (optionRes.error) throw new Error(optionRes.error.message);
      if (linkRes.error) throw new Error(linkRes.error.message);
      const activeIds = new Set(
        ((optionRes.data ?? []) as Record<string, unknown>[])
          .filter((r) => r.active === true)
          .map((r) => String(r.id))
      );
      const usedBy = new Set<string>();
      for (const row of (linkRes.data ?? []) as Record<string, unknown>[]) {
        if (activeIds.has(String(row[cfg.fk]))) usedBy.add(String(row.blind_type_id));
      }
      return [slot, usedBy] as const;
    })
  );
  const usedBySlot = new Map<CatalogSlot, Set<string>>(perSlot);

  return {
    isKnownType: (blindsType) => idByName.has(blindsType),
    usesSlot: (blindsType, slot) => {
      const typeId = idByName.get(blindsType);
      return typeId !== undefined && (usedBySlot.get(slot)?.has(typeId) ?? false);
    },
  };
}

/** Scoping that knows no type and claims no slot. */
function emptyScoping(): SlotScoping {
  return { isKnownType: () => false, usesSlot: () => false };
}
