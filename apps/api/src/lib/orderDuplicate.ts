// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Maps a STORED order back into the payload shape `POST /orders`
 * accepts, so an order can be duplicated by running the ordinary,
 * server-authoritative create path rather than by copying rows.
 *
 * Nothing here touches the database or `c.env`: it is a pure
 * transformation, which is what makes its two awkward parts — snapshot
 * stripping and override reconstruction — testable on their own
 * (`orderDuplicate.test.ts`).
 *
 * Two rules shape every mapping decision:
 *
 *  1. No money crosses over. A stored row carries `unit_price`,
 *     `line_total` and snapshotted catalog prices; the duplicate sends
 *     ids and lets the Worker price them from TODAY's catalog. The
 *     exceptions are the ones the create path already accepts from a
 *     client: a hand-entered override, the add-on list, and a custom or
 *     legacy-preset item's own typed price — figures no formula can
 *     reproduce.
 *  2. No identity crosses over. A duplicate's items are new rows, so
 *     `uid` is dropped and the Worker mints fresh ones.
 *
 * @see apps/api/src/routes/orders.ts — `POST /:id/duplicate`, the only
 *      caller, which parses this output through `orderSchema` before
 *      anything reaches the database.
 */

import { getBlindType } from './blindTypes';

/**
 * Removes the catalog SNAPSHOT keys a blind type writes into its
 * `attributes` blob (each `CatalogRef`'s `nameKey` and `valueKey`).
 *
 * Those keys are written by `resolveCatalogRefs` AFTER validation and
 * are deliberately absent from `attributeSchema`, which is `.strict()`
 * — so feeding a stored blob straight back into the create path is a
 * 400. The id key is kept: it is what the Worker re-resolves the
 * current name and price from, which is also why a duplicate reflects a
 * catalog that has moved since the original was written.
 *
 * An unknown or legacy blind type resolves to the default type, which
 * declares no refs, so its attributes pass through untouched.
 *
 * @param blindsType The row's `blinds_type` (free text on old rows).
 * @param attrs      The stored attribute blob.
 * @returns A copy carrying only the client-supplied keys.
 */
export function stripCatalogSnapshots(
  blindsType: string,
  attrs: Record<string, unknown>
): Record<string, unknown> {
  const out = { ...attrs };
  for (const ref of getBlindType(blindsType).catalogRefs) {
    delete out[ref.nameKey];
    delete out[ref.valueKey];
  }
  return out;
}

/**
 * Builds the create payload for a duplicate of `order`.
 *
 * The result is UNVALIDATED on purpose — the caller parses it through
 * `orderSchema`, so a row written under an older schema surfaces as the
 * same readable 400 any bad payload would, rather than slipping past
 * validation on age alone.
 *
 * Items keep their order (by `position`), their text, their
 * measurements, their `hidden` flag and their price adjustments.
 * Everything else — dates, status, order number, payments, logs, the
 * appointment, warranty state, the public token — belongs to the source
 * order's own history and is not copied.
 *
 * @param order An order row joined with its `line_items`.
 * @returns An object shaped like the `POST /orders` payload.
 */
export function toDuplicateInput(order: Record<string, unknown>): unknown {
  const rows = ((order.line_items ?? []) as Record<string, any>[])
    .slice()
    .sort((a, b) => Number(a.position) - Number(b.position));

  return {
    customer_id: order.customer_id,
    discount_type: order.discount_type,
    discount_value: Number(order.discount_value ?? 0),
    line_items: rows.map((li) => {
      /**
       * An item is overridden exactly when `base_unit_price` is set: the
       * charged `unit_price` is then the figure a consultant typed, and
       * it is the only price on the row no formula can reproduce.
       */
      const overridden = li.base_unit_price !== null && li.base_unit_price !== undefined;
      const shared = {
        show_original_price: Boolean(li.show_original_price),
        addons: ((li.addons ?? []) as Record<string, unknown>[]).map((a) => ({
          label: String(a.label),
          price: Number(a.price),
        })),
        hidden: Boolean(li.hidden),
      };

      if (li.item_type === 'blind') {
        return {
          item_type: 'blind',
          room_name: String(li.room_name ?? ''),
          blinds_type: String(li.blinds_type ?? ''),
          panels: ((li.panels ?? []) as unknown[]).map(Number),
          height_cm: Number(li.height_cm),
          material_id: li.material_id,
          cassette_id: li.cassette_id ?? null,
          bottom_rail_id: li.bottom_rail_id ?? null,
          control_id: li.control_id ?? null,
          installation_id: li.installation_id ?? null,
          color: String(li.color ?? ''),
          note: String(li.note ?? ''),
          attributes: stripCatalogSnapshots(
            String(li.blinds_type ?? ''),
            (li.attributes ?? {}) as Record<string, unknown>
          ),
          quantity: Number(li.quantity),
          ...(overridden ? { unit_price_override: Number(li.unit_price) } : {}),
          ...shared,
        };
      }

      if (li.item_type === 'preset') {
        return {
          item_type: 'preset',
          preset_id: li.preset_id ?? null,
          title: String(li.title ?? ''),
          description: String(li.description ?? ''),
          quantity: Number(li.quantity),
          // A preset WITH provenance is re-priced from the catalog. A
          // legacy one has no catalog row to return to, so its stored
          // price is the only price it has — and the BASE price, not the
          // charged one, or an override would be promoted into it.
          ...(li.preset_id
            ? {}
            : { unit_price: Number(li.base_unit_price ?? li.unit_price) }),
          ...(overridden ? { unit_price_override: Number(li.unit_price) } : {}),
          ...shared,
        };
      }

      return {
        item_type: 'custom',
        title: String(li.title ?? ''),
        description: String(li.description ?? ''),
        quantity: Number(li.quantity),
        // A custom item's price is already freely typed, so the create
        // path rejects an override on it outright — the base price is
        // the whole story, and sending both would be a 400.
        unit_price: Number(li.base_unit_price ?? li.unit_price),
        ...shared,
      };
    }),
  };
}
