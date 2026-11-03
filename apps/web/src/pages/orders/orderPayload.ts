// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Turns the order editor's state into the `POST /api/orders` / `PUT
 * /api/orders/:id` payload, or a user-facing message when it cannot be
 * sent as is. Moved out of `OrderDetail.tsx` so it can be tested.
 *
 * Spec 2026-11-02 (incomplete draft items): a BLANK blind type, width,
 * height, material or hardware slot no longer blocks a draft's save — it
 * travels as null/'' and the Worker stores the item at $0. TYPED garbage
 * ("12a", "-5", an unparseable override) is still refused here, because
 * it would otherwise become a measurement nobody entered. On a non-draft
 * order the completeness rule runs too, returning the same message the
 * Worker would.
 */

import {
  canOverridePrice,
  firstIncompleteDraftMessage,
  isAlreadyQuoted,
  parseAddons,
  parseDraftAttributes,
  parseOverride,
  parsePositive,
  slotsForType,
  type Catalogs,
  type ItemDraft,
} from './lineItemDrafts';
import type { CatalogSlot } from '../../lib/blindTypes/base';
import type {
  AdjustmentInputFields,
  ItemIdentityFields,
  LineItemInput,
  OrderInput,
} from '../../hooks/useOrders';
import type { Customer, DiscountType, OrderStatus } from '../../types';

/**
 * Formats a Date as the API's YYYY-MM-DD (local date, no UTC shift).
 * Used for the order and expiry dates in the payload and for `paid_on`
 * when recording a payment.
 */
export function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Everything the payload is built from — the editor's state at save
 * time. Passed as one object so the builder is a pure function the
 * editor and the tests call identically.
 */
export interface OrderPayloadState {
  customer: Customer | null;
  orderDate: Date;
  expiryDate: Date | null;
  title: string;
  discountType: DiscountType;
  discountValue: string;
  items: ItemDraft[];
  catalogs: Catalogs;
  /** The stored status; `'draft'` for an order never saved. */
  status: OrderStatus;
}

/** A typed value that does not parse — distinct from a blank one. */
const typedButInvalid = (raw: string): boolean => raw.trim() !== '' && parsePositive(raw) === null;

/**
 * Validates the editor state and builds the API payload, or returns the
 * first problem as a message (the editor toasts it and does not save).
 *
 * A draft may hold blank measurements, material, hardware and blind type;
 * those go out as null/'' for the Worker to store at $0. Typed values
 * that do not parse are refused. A non-draft order is additionally held
 * to completeness via `firstIncompleteDraftMessage`, so the user sees the
 * Worker's own wording without a round trip.
 */
export function buildOrderPayload(state: OrderPayloadState): OrderInput | string {
  const { customer, expiryDate, items } = state;
  if (!customer) return 'Select a customer first.';
  if (!expiryDate) return 'Pick an expiry date.';
  if (state.status !== 'draft') {
    const incomplete = firstIncompleteDraftMessage(items, state.catalogs);
    if (incomplete) return incomplete;
  }
  const line_items: LineItemInput[] = [];

  /**
   * The three adjustment fields, validated once for any item type.
   * Returns a message string when the override does not parse, matching
   * this function's error convention.
   *
   * `unit_price_override` is left OFF the payload where the item cannot
   * be overridden — the Worker rejects the field on a custom item.
   */
  function adjustmentsFor(it: ItemDraft, index: number): AdjustmentInputFields | string {
    const override = parseOverride(it.unit_price_override);
    if (!override.valid) return `Item ${index + 1}: enter a valid override price.`;
    return {
      ...(canOverridePrice(it) ? { unit_price_override: override.value } : {}),
      show_original_price: it.show_original_price,
      addons: parseAddons(it.addons),
    };
  }
  /**
   * Identity and visibility, as the API expects them.
   *
   * `uid` is OMITTED for an item that has never been saved — the
   * Worker mints one then — and round-tripped verbatim otherwise, since
   * it is what the Worker diffs visibility against on a confirmed
   * order.
   */
  function identityFor(it: ItemDraft): ItemIdentityFields {
    return { ...(it.uid ? { uid: it.uid } : {}), hidden: it.hidden };
  }

  for (const [i, it] of items.entries()) {
    if (it.item_type === 'blind') {
      if (it.panels.some(typedButInvalid)) return `Item ${i + 1}: enter every panel width.`;
      if (typedButInvalid(it.height_cm)) return `Item ${i + 1}: enter a height.`;
      const qty = parsePositive(it.quantity);
      if (!qty) return `Item ${i + 1}: enter a quantity.`;
      // Convert once, here. Failing now gives a readable message instead
      // of a 400 from the server's own re-parse.
      const attributes = parseDraftAttributes(it);
      if (attributes === null) return `Item ${i + 1}: check the ${it.blinds_type || 'blind'} options.`;
      const adj = adjustmentsFor(it, i);
      if (typeof adj === 'string') return adj;
      // An ALREADY-QUOTED item keeps whatever hardware ids it carries
      // (the Worker charges them); any other item drops an id for a slot
      // its type no longer uses — see the hardware ids below.
      const uses = slotsForType(state.catalogs, it.blinds_type);
      const quoted = isAlreadyQuoted(it);
      const sendable = (slot: CatalogSlot, id: string) => ((quoted || uses.has(slot)) && id ? id : null);
      line_items.push({
        item_type: 'blind',
        room_name: it.room_name.trim(),
        blinds_type: it.blinds_type.trim(),
        // Blank → null: a draft may hold a blind not measured yet.
        panels: it.panels.map(parsePositive),
        height_cm: parsePositive(it.height_cm),
        material_id: it.material_id || null,
        // Null, not '' — the API accepts a uuid or null for a slot the
        // type does not use, and rejects an id for one it does not.
        //
        // An id for a slot the type no longer uses is DROPPED, unless the
        // item is already quoted (whose Worker branch keeps and charges
        // whatever it carries). That happens when Settings deletes —
        // archives, migration 49 — or deactivates a type's last option of
        // a slot: the dropdown disappears, so the consultant could never
        // clear the stale id, and the Worker would refuse every save of
        // the draft. The preview already ignores it (`blindDraftInputs`),
        // so dropping it here makes the save match what is on screen.
        cassette_id: sendable('cassette', it.cassette_id),
        bottom_rail_id: sendable('bottom_rail', it.bottom_rail_id),
        control_id: sendable('control', it.control_id),
        installation_id: sendable('installation', it.installation_id),
        color: it.color.trim(),
        note: it.note.trim(),
        attributes,
        quantity: Math.round(qty),
        ...adj,
        ...identityFor(it),
      });
    } else {
      const qty = parsePositive(it.quantity);
      const unit = Number(it.unit_price);
      if (!it.title.trim() && !it.description.trim())
        return `Item ${i + 1}: enter a title or a description.`;
      if (!qty) return `Item ${i + 1}: enter a quantity.`;
      const adj = adjustmentsFor(it, i);
      if (typeof adj === 'string') return adj;
      if (it.item_type === 'preset' && it.preset_id) {
        // Priced by the Worker from the catalog. Sending a figure would
        // be ignored, and sending one that disagreed would be a lie the
        // consultant could read on screen.
        line_items.push({
          item_type: 'preset',
          preset_id: it.preset_id,
          title: it.title.trim(),
          description: it.description.trim(),
          quantity: Math.round(qty),
          ...adj,
          ...identityFor(it),
        });
      } else if (it.item_type === 'preset') {
        // Legacy preset: no provenance, so its stored price still
        // travels and the Worker keeps honouring it.
        if (!Number.isFinite(unit) || unit < 0) return `Item ${i + 1}: enter a unit price.`;
        line_items.push({
          item_type: 'preset',
          preset_id: null,
          title: it.title.trim(),
          description: it.description.trim(),
          quantity: Math.round(qty),
          unit_price: unit,
          ...adj,
          ...identityFor(it),
        });
      } else {
        if (!Number.isFinite(unit) || unit < 0) return `Item ${i + 1}: enter a unit price.`;
        line_items.push({
          item_type: 'custom',
          title: it.title.trim(),
          description: it.description.trim(),
          quantity: Math.round(qty),
          unit_price: unit,
          ...adj,
          ...identityFor(it),
        });
      }
    }
  }
  return {
    customer_id: customer.id,
    order_date: toIso(state.orderDate),
    expiry_date: toIso(expiryDate),
    title: state.title.trim() === '' ? null : state.title.trim(),
    discount_type: state.discountType,
    discount_value: Number(state.discountValue) || 0,
    line_items,
  };
}
