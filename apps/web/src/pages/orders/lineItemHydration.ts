// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Line-item hydration: turning STORED line items (as the Worker returns
 * them) into the order editor's drafts, and keeping the server-owned half
 * of those drafts in step afterwards. No JSX, no fetching.
 *
 * Two callers hydrate through {@link draftsFromLineItems}: `OrderDetail`
 * on the loaded order, and a revision restore (`restoreRevision.ts`) on
 * the rows that revision stored — so a restored item is edited exactly
 * like a loaded one. {@link applyServerFields} then refreshes the four
 * server-owned fields ({@link ServerItemFields}) whenever the order
 * changes underneath an editor that must not be rebuilt.
 *
 * Split out of `lineItemDrafts.ts` (the draft models and the pure price
 * preview), which it depends on for types only.
 */

import type { PriceLock } from '../../lib/priceLock';
import type { LineItem } from '../../types';
import { nextKey } from './draftKeys';
import type { BlindDraft, FlatDraft, ItemDraft, PriceAdjustmentDraft } from './lineItemDrafts';

/**
 * The draft fields a line item takes from the SERVER and never edits
 * locally: its price lock, whether it was already quoted, the figure it
 * was last sent at, and any dismissal of that figure's notice.
 *
 * Split out because they have to be refreshed WITHOUT rebuilding the
 * draft — see {@link applyServerFields}.
 */
export interface ServerItemFields {
  lock: PriceLock | null;
  previously_quoted: boolean;
  quoted_base: number | null;
  notice_ack_base: number | null;
}

/** Whether two locks say the same thing; both absent counts as equal. */
function sameLock(a: PriceLock | null, b: PriceLock | null): boolean {
  if (a === null || b === null) return a === b;
  return a.base === b.base && a.fingerprint === b.fingerprint;
}

/**
 * Refreshes the server-owned fields of each draft from the order as it
 * now stands, matched by `uid`, leaving every typed field alone.
 *
 * Line-item drafts hydrate ONCE: rebuilding them whenever the order
 * refetches would throw away whatever the consultant is in the middle of
 * typing. But four of their fields are the server's answer, not the
 * consultant's, and one event moves them without touching the editor —
 * SENDING the estimate again, which re-stamps `quoted_base_price` and
 * clears any dismissal. Without this the per-item price-update notice
 * would go on comparing against the figure of the PREVIOUS send until
 * the page was reloaded, even though the customer now holds a document
 * quoting today's price.
 *
 * Returns the SAME array when nothing differs, so the common refetch
 * (a window refocus, say) costs no re-render. An item with no uid, or
 * one the order does not have, is left exactly as it is: it has no
 * server answer to take.
 */
export function applyServerFields(
  items: ItemDraft[],
  byUid: Map<string, ServerItemFields>
): ItemDraft[] {
  let changed = false;
  const next = items.map((it) => {
    const fields = it.uid === null ? undefined : byUid.get(it.uid);
    if (!fields) return it;
    if (
      it.previously_quoted === fields.previously_quoted &&
      it.quoted_base === fields.quoted_base &&
      it.notice_ack_base === fields.notice_ack_base &&
      sameLock(it.lock, fields.lock)
    ) {
      return it;
    }
    changed = true;
    // Cast because TypeScript widens a spread over the draft union; every
    // key in `fields` is declared on both members, so the shape is exact.
    return { ...it, ...fields } as ItemDraft;
  });
  return changed ? next : items;
}

/**
 * A nullable PostgREST numeric as a usable number, or null.
 *
 * `null` for an ABSENT column as well as a null one: an API that
 * predates migration 48 sends neither figure, and `Number(undefined)` is
 * `NaN`, which would render as a `$NaN` price update rather than as the
 * "nothing to report" it is.
 */
export function finiteOrNull(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * The four fields a line item takes from the server: the price it was
 * frozen at (both lock columns move together — half a lock is no lock),
 * whether its order's prices are frozen at all, the figure it was last
 * SENT at, and any dismissal of that figure's notice.
 *
 * Read in two places, which is why it is not inline: once when the
 * drafts hydrate ({@link draftsFromLineItems}), and again whenever the
 * order changes underneath them ({@link applyServerFields}, from the
 * order editor) — a re-send moves the stamp without the editor being
 * touched.
 *
 * @param li A stored line item as the detail read returns it.
 * @param pricesFrozen The order's `holdsPriceLock(status)`, shared by
 *   every item of the order; it is what makes a row "previously quoted".
 */
export function serverFieldsOf(li: LineItem, pricesFrozen: boolean): ServerItemFields {
  return {
    lock:
      li.locked_base_price !== null && li.locked_inputs_fingerprint
        ? { base: Number(li.locked_base_price), fingerprint: li.locked_inputs_fingerprint }
        : null,
    previously_quoted: pricesFrozen,
    quoted_base: finiteOrNull(li.quoted_base_price),
    notice_ack_base: finiteOrNull(li.quoted_notice_ack_base),
  };
}

/**
 * The three adjustment fields of a persisted item, as draft strings.
 *
 * An item is overridden exactly when `base_unit_price` is set, and the
 * charged `unit_price` is then what the consultant typed — so that is
 * what goes back into the override box.
 */
function toAdjustmentDraft(li: LineItem, pricesFrozen: boolean): PriceAdjustmentDraft {
  return {
    unit_price_override: li.base_unit_price === null ? '' : String(li.unit_price),
    show_original_price: li.show_original_price,
    addons: (li.addons ?? []).map((a) => ({
      key: nextKey(),
      label: a.label,
      price: String(a.price),
    })),
    ...serverFieldsOf(li, pricesFrozen),
  };
}

/**
 * Converts stored line items into editable drafts, in the order given.
 *
 * The one hydration path for the order editor: `OrderDetail` runs it on
 * the loaded order, and a revision restore (`restoreRevision.ts`) runs it
 * on the rows that revision stored, so a restored item is edited exactly
 * like a loaded one. Every draft gets a fresh React `key`; `uid` and
 * `hidden` round-trip verbatim; numbers become the editor's strings; and
 * only the explicitly mapped fields survive, so no server-written money
 * column (line totals, catalog rates, lock columns) can leak into a save
 * payload, which the Worker's `.strict()` schema would refuse.
 *
 * @param items Stored rows, as the detail read (or a revision's
 *   `source.line_items`) returns them.
 * @param pricesFrozen The order's `holdsPriceLock(status)` — read once by
 *   the caller, since every row belongs to the same order and this is the
 *   half of `isAlreadyQuoted` the row itself cannot answer.
 */
export function draftsFromLineItems(items: LineItem[], pricesFrozen: boolean): ItemDraft[] {
  return items.map((li) => {
    if (li.item_type === 'blind') {
      return {
        key: nextKey(),
        uid: li.uid,
        hidden: li.hidden,
        item_type: 'blind',
        room_name: li.room_name,
        blinds_type: li.blinds_type,
        panels: li.panels.map(String),
        height_cm: String(li.height_cm ?? ''),
        material_id: li.material_id ?? '',
        cassette_id: li.cassette_id ?? '',
        bottom_rail_id: li.bottom_rail_id ?? '',
        control_id: li.control_id ?? '',
        installation_id: li.installation_id ?? '',
        color: li.color ?? '',
        note: li.note ?? '',
        // The persisted blob is typed; the draft holds strings.
        attributes: Object.fromEntries(
          Object.entries(li.attributes ?? {}).map(([k, v]) => [k, String(v)])
        ),
        quantity: String(li.quantity),
        ...toAdjustmentDraft(li, pricesFrozen),
      } satisfies BlindDraft;
    }
    return {
      key: nextKey(),
      uid: li.uid,
      hidden: li.hidden,
      item_type: li.item_type,
      title: li.title,
      description: li.description,
      preset_id: li.preset_id,
      quantity: String(li.quantity),
      // `unit_price` is the price CHARGED, so an overridden item's draft
      // must show the CALCULATED figure here and the charged one in the
      // override box. Reading `unit_price` into the base would silently
      // promote the override on every reopen and lose the original.
      unit_price: String(li.base_unit_price ?? li.unit_price),
      ...toAdjustmentDraft(li, pricesFrozen),
    } satisfies FlatDraft;
  });
}
