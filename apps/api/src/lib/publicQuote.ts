// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * The customer-visible QUOTE — the part of the public estimate payload
 * that describes what is being sold and for how much — as a pure
 * function of an `orders` row with its `line_items(*)` embedded.
 *
 * Extracted from `GET /public/estimate/:token` so the very same shape
 * can be (a) served to the customer, (b) frozen into an estimate
 * revision snapshot at send time, and (c) diffed between revisions.
 * Because all three read ONE builder, "what the customer sees", "what
 * we recorded as sent" and "what changed since" cannot drift apart.
 *
 * SERVER-AUTHORITATIVE (AI_GUIDELINES rule 1): every figure here is
 * either a stored, server-computed column or derived from one on the
 * Worker. Nothing is accepted from a client.
 *
 * PUBLIC-SAFETY (AI_GUIDELINES rule 2): the public route is
 * unauthenticated, so this builder never spreads a row. Each output
 * field is named explicitly; raw `attributes`, `base_unit_price`, rate
 * columns and hidden items never appear. The line `uid` is carried on
 * {@link PublicQuoteLine} for diffing but must be removed with
 * {@link toPublicLines} before anything goes to a customer; a whole quote
 * goes out only through {@link toPublicQuoteFields}.
 */

import { getBlindType } from './blindTypes';
import { originalLineTotal } from './lineItemAdjustments';
import { optionLineAmounts, type OptionPricedItem } from './optionBreakdown';

/**
 * One customer-visible line of the quote.
 *
 * Mirrors the `line_items` entries of the public estimate payload, plus
 * `uid` (the line's stable identity, used to match lines across
 * revisions when diffing). `uid` is staff/diff-only: strip it with
 * {@link toPublicLines} before serving a customer. Pass-through text and
 * dimension fields are typed `unknown` because they are copied verbatim
 * from the loosely typed PostgREST row; the money and quantity fields
 * are coerced to real numbers (Postgres `numeric` can arrive as a
 * string).
 */
export interface PublicQuoteLine {
  /** Stable line identity for revision diffing; never sent to customers. */
  uid: string | null;
  item_type: unknown;
  room_name: unknown;
  blinds_type: unknown;
  panels: unknown;
  height_cm: unknown;
  material_name: unknown;
  cassette_name: unknown;
  bottom_rail_name: unknown;
  control_name: unknown;
  installation_name: unknown;
  color: unknown;
  title: unknown;
  description: unknown;
  note: unknown;
  /** Priced extras on the line, label + per-unit price. */
  addons: { label: string; price: number }[];
  /** Struck-through "was" figure; `null` prints nothing. */
  original_line_total: number | null;
  /** Server-formatted `Label: value` strings for the blind-type attributes. */
  attribute_lines: string[];
  /** Per-hardware-option line amounts the customer is shown. */
  option_prices: ReturnType<typeof optionLineAmounts>;
  quantity: number;
  unit_price: number;
  line_total: number;
}

/**
 * The customer-visible quote: header dates, the money block and the
 * visible (non-hidden) lines. Excludes everything that is not part of
 * "what was quoted" — status, payments, customer address and company
 * details stay live in the route. All money fields are numbers.
 */
export interface PublicQuote {
  /** Consultant's label for this option; `null` renders nothing. */
  title: string | null;
  order_date: string;
  expiry_date: string;
  subtotal: number;
  discount_amount: number;
  taxable_amount: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  /** The terms snapshot taken when the order was created; `''` when none. */
  terms: string;
  line_items: PublicQuoteLine[];
}

/**
 * Builds the customer-visible quote from an `orders` row.
 *
 * @param order An `orders` row with `line_items(*)` embedded and ordered
 *   by position (as `loadByToken` and the revision writer select it).
 *   Typed loosely because it comes straight out of PostgREST.
 * @returns The sanitized {@link PublicQuote}. Hidden items are dropped
 *   (they are absent from the total the customer is quoted, so printing
 *   one would show a line nothing adds up to). Money, quantity and rate
 *   fields are coerced with `Number()`. Lines still carry `uid`; run
 *   them through {@link toPublicLines} for the public response.
 */
export function buildPublicQuote(order: Record<string, unknown>): PublicQuote {
  return {
    // Consultant's label for this option; null renders nothing.
    title: (order.title ?? null) as string | null,
    order_date: order.order_date as string,
    expiry_date: order.expiry_date as string,
    subtotal: Number(order.subtotal),
    discount_amount: Number(order.discount_amount),
    taxable_amount: Number(order.taxable_amount),
    tax_rate: Number(order.tax_rate),
    tax_amount: Number(order.tax_amount),
    total: Number(order.total),
    terms: (order.terms_snapshot as string | null | undefined) ?? '',
    // A hidden item is absent from the total the customer is quoted, so
    // printing it here would show a line that nothing adds up to.
    line_items: ((order.line_items ?? []) as Record<string, unknown>[])
      .filter((li) => !li.hidden)
      .map((li) => ({
        uid: (li.uid ?? null) as string | null,
        item_type: li.item_type,
        room_name: li.room_name,
        blinds_type: li.blinds_type,
        panels: li.panels,
        height_cm: li.height_cm,
        material_name: li.material_name,
        cassette_name: li.cassette_name,
        bottom_rail_name: li.bottom_rail_name,
        control_name: li.control_name,
        installation_name: li.installation_name,
        color: li.color,
        title: li.title,
        description: li.description,
        note: li.note,
        addons: ((li.addons ?? []) as Record<string, unknown>[]).map((a) => ({
          label: String(a.label),
          price: Number(a.price),
        })),
        /**
         * The struck-through "was" figure, ALREADY computed here and sent
         * only when the consultant chose to show it.
         *
         * Both decisions are made server-side on purpose: this route is
         * unauthenticated, so a `base_unit_price` sent for the page to
         * hide with CSS would be public the moment it left the Worker.
         * `null` means print nothing.
         */
        original_line_total: li.show_original_price
          ? originalLineTotal({
            base_unit_price:
              li.base_unit_price === null || li.base_unit_price === undefined
                ? null
                : Number(li.base_unit_price),
            quantity: Number(li.quantity),
            addons: ((li.addons ?? []) as Record<string, unknown>[]).map((a) => ({
              label: String(a.label),
              price: Number(a.price),
            })),
          })
          : null,
        /**
         * Per-type attributes are formatted HERE, server-side, and the raw
         * blob is deliberately NOT forwarded.
         *
         * This endpoint is unauthenticated — the capability token is the
         * only gate — so anything spread into this object is public the
         * moment it exists. Sending `attributes` wholesale would publish
         * every future internal-only field automatically and silently,
         * including retroactively for orders already sent. Forwarding the
         * rendered label/value pairs instead means a new field reaches the
         * customer only if its type's `describeAttributes` chose to return
         * it.
         *
         * Do NOT replace this with a spread.
         */
        attribute_lines: getBlindType(String(li.blinds_type ?? ''))
          .describeAttributes(
            (li.attributes ?? {}) as Record<string, string | number | boolean>
          )
          .map((a) => `${a.label}: ${a.value}`),
        /**
         * What each hardware option added to this LINE, computed HERE for
         * the same reason the money above is: the page has no catalog and
         * may not derive money of its own (AI_GUIDELINES rule 1). Only the
         * slots the blind actually carries appear; the page prints a name
         * alone for anything absent or zero. The rate columns and the
         * price bases behind these figures stay on the server — a customer
         * is shown what a choice cost them, not the shop's price list.
         */
        option_prices: optionLineAmounts(li as OptionPricedItem),
        quantity: Number(li.quantity),
        unit_price: Number(li.unit_price),
        line_total: Number(li.line_total),
      })),
  };
}

/**
 * Picks the customer-visible fields of quote lines so the result is safe
 * to serve on the unauthenticated public route.
 *
 * Every field is NAMED, never spread: a line may come from a stored
 * revision snapshot (jsonb), and whatever extra key a past or future
 * writer left there must not reach a customer just because it was stored.
 * The staff/diff-only `uid` is dropped, and each add-on is reduced to its
 * `label` and `price`.
 *
 * @param lines Lines from {@link buildPublicQuote} (or a stored snapshot).
 * @returns New line objects without `uid` or any unknown key; the input is
 *   not mutated.
 */
export function toPublicLines(lines: PublicQuoteLine[]): Omit<PublicQuoteLine, 'uid'>[] {
  return lines.map((l) => ({
    item_type: l.item_type,
    room_name: l.room_name,
    blinds_type: l.blinds_type,
    panels: l.panels,
    height_cm: l.height_cm,
    material_name: l.material_name,
    cassette_name: l.cassette_name,
    bottom_rail_name: l.bottom_rail_name,
    control_name: l.control_name,
    installation_name: l.installation_name,
    color: l.color,
    title: l.title,
    description: l.description,
    note: l.note,
    addons: l.addons.map((a) => ({ label: a.label, price: a.price })),
    original_line_total: l.original_line_total,
    attribute_lines: l.attribute_lines,
    option_prices: l.option_prices,
    quantity: l.quantity,
    unit_price: l.unit_price,
    line_total: l.line_total,
  }));
}

/** The public-safe shape of a {@link PublicQuote}: its lines carry no `uid`. */
export type PublicQuoteFields = Omit<PublicQuote, 'line_items'> & {
  line_items: Omit<PublicQuoteLine, 'uid'>[];
};

/**
 * Picks the customer-visible quote fields for a public response — the
 * only way a quote (live, or a stored revision snapshot) may be put into
 * a `/public/*` body.
 *
 * Explicit by design (AI_GUIDELINES §2): spreading a snapshot read back
 * from jsonb would publish any key stored in it, so each order-level field
 * is named here and the lines go through {@link toPublicLines}. Used by
 * `GET /public/estimate/:token` and the read-only earlier-version route.
 * Also the canonical form `quoteDiff` compares, so "what differs" and
 * "what the customer is served" are the same set of fields.
 *
 * @param q A quote from {@link buildPublicQuote} or a revision snapshot.
 * @returns A new object with exactly the {@link PublicQuoteFields} keys.
 */
export function toPublicQuoteFields(q: PublicQuote): PublicQuoteFields {
  return {
    title: q.title,
    order_date: q.order_date,
    expiry_date: q.expiry_date,
    subtotal: q.subtotal,
    discount_amount: q.discount_amount,
    taxable_amount: q.taxable_amount,
    tax_rate: q.tax_rate,
    tax_amount: q.tax_amount,
    total: q.total,
    terms: q.terms,
    line_items: toPublicLines(q.line_items),
  };
}
