// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Shared table primitives for the order view (`/orders/:id/present`).
 *
 * The page renders two tables — blinds and other items — that must agree
 * on cell padding, type scale, alignment and money formatting, because
 * they sit one above the other on the same screen and a customer reads
 * them as one document. Keeping the primitives here rather than in either
 * table is what makes that agreement structural instead of a convention
 * two files are expected to remember.
 *
 * `AddonLines` and `UnitPrice` came from the deleted Order Overview page,
 * whose information this page absorbed. They carry the two pieces of
 * per-line money that are NOT option choices, so neither belongs in
 * `optionBreakdown.ts`.
 *
 * The `money` formatter they share lives in `presentationMoney.ts`, not
 * here: a module that exports components must export ONLY components or
 * it loses its React Fast Refresh boundary.
 */

import type { ReactNode } from 'react';
import { money } from './presentationMoney';
import type { LineItem } from '../../types';

/** Header cell. `right` aligns the column for figures. */
export function Th({ children, right = false }: { children: ReactNode; right?: boolean }) {
  return (
    <th
      className={`whitespace-nowrap px-3 py-2 text-xs font-semibold uppercase tracking-wide text-text-muted ${right ? 'text-right' : 'text-left'}`}
    >
      {children}
    </th>
  );
}

/** Body cell. `mono` marks money and size figures so columns of digits align. */
export function Td({
  children,
  right = false,
  mono = false,
}: {
  children: ReactNode;
  right?: boolean;
  mono?: boolean;
}) {
  return (
    <td
      className={`px-3 py-2 text-[13px] text-text-secondary ${right ? 'text-right' : 'text-left'} ${mono ? 'whitespace-nowrap font-mono' : ''}`}
    >
      {children}
    </td>
  );
}

/** Footer cell — heavier than a body cell, since it carries the totals. */
export function Tf({ children, right = false }: { children: ReactNode; right?: boolean }) {
  return (
    <td
      className={`whitespace-nowrap px-3 py-2 font-mono text-sm font-semibold text-text-primary ${right ? 'text-right' : 'text-left'}`}
    >
      {children}
    </td>
  );
}

/**
 * A line's add-ons as indented sub-lines beneath its descriptive column,
 * or nothing when it has none.
 *
 * Rendered under an existing column rather than as extra rows so the money
 * columns keep lining up one row per line item.
 *
 * The LABEL always prints and the PRICE follows the breakdown toggle: an
 * add-on is a choice the customer made, exactly like an option name, and
 * its price is per-choice money, exactly like an option amount. With the
 * toggle down the add-on's money still reaches the customer — inside the
 * line total, where all per-choice money goes when the breakdown is off.
 */
export function AddonLines({ item, showBreakdown }: { item: LineItem; showBreakdown: boolean }) {
  return (
    <>
      {item.addons.map((addon, i) => (
        <span key={i} className="mt-0.5 block text-xs text-text-muted">
          + {addon.label}
          {showBreakdown && ` ${money(addon.price)}`}
        </span>
      ))}
    </>
  );
}

/**
 * The charged unit price, preceded by the struck-through calculated one on
 * a line whose override the consultant marked shareable.
 *
 * Independent of the breakdown toggle in BOTH directions. `base_unit_price`
 * is only meaningful alongside `show_original_price`, which is a real
 * privacy control rather than a display preference — the public endpoint
 * omits the figure entirely when it is false. A line marked shareable shows
 * its "was" price to the customer; a line not marked shareable never does,
 * whatever the toggle says.
 *
 * The Overview page's amber "price overridden" dot is deliberately absent.
 * It meant "someone typed this price", which was fair on an internal-only
 * screen; on a page that can face a customer it is an unexplained marker
 * on lines whose override was specifically NOT to be shown.
 */
export function UnitPrice({ item }: { item: LineItem }) {
  const showOriginal = item.base_unit_price !== null && item.show_original_price;
  return (
    <>
      {showOriginal && (
        <span className="mr-1.5 text-text-muted line-through">{money(item.base_unit_price!)}</span>
      )}
      {money(item.unit_price)}
    </>
  );
}
