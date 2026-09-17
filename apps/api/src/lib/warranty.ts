// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Warranty term rules — the single source of truth for what is covered,
 * for how long, until when, and what is excluded.
 *
 * ONE TEMPLATE FOR EVERY ORDER. Products carry a single ten-year term.
 * Motorization-related products (motors, solar panels, remotes and the
 * like) are NOT covered by this certificate at all — they carry their own
 * shorter warranty — and that exclusion is stated as a standing footer
 * note on every certificate and email ({@link MOTORIZATION_EXCLUSION_NOTE}).
 *
 * Why no per-order motor section: whether a line item is motorised cannot
 * be told reliably from the order. Custom and preset rows are free text,
 * and a newly added catalog component carries no motor flag, so any
 * keyword guess would sooner or later print the wrong term on a legal
 * document. A fixed exclusion that holds for every order cannot be wrong
 * in that way.
 *
 * Coverage is measured from the date the order was paid in full
 * (`orders.warranty_starts_on`), never from "today": the certificate is
 * regenerated on every resend and staff download, and a start date
 * derived at render time would silently move a customer's coverage
 * window each time.
 *
 * Deliberately pure — no Supabase, no env, no I/O — so the policy can be
 * unit-tested exhaustively and reused by the PDF, the email, and any
 * future customer-facing view without dragging a client along.
 */

/** Years of coverage on products (fabric, cassette, rail, manual controls). */
export const WARRANTY_YEARS_STANDARD = 10;

/**
 * The standing exclusion printed in the footer of the certificate and the
 * warranty email, identically on every order. Plain text (no markup, no
 * entities) so the PDF can draw it directly and the email can escape it.
 */
export const MOTORIZATION_EXCLUSION_NOTE =
  'Note: Motorization-related products — such as motors, solar panels, remotes, chargers and other motorization accessories — are excluded from this warranty.';

/**
 * The minimal line-item shape the warranty rules read. Deliberately
 * narrower than the `line_items` row so callers can pass a DB row, a PDF
 * item, or a test fixture without adapting any of them.
 */
export interface WarrantyItemSource {
  /** 'blind' | 'preset' | 'custom' — decides which field names the product. */
  item_type: string;
  room_name?: string | null;
  blinds_type?: string | null;
  description?: string | null;
  quantity: number;
}

/** One printable warranty row: what is covered, how many, and until when. */
export interface WarrantyItem {
  /** Human label, e.g. "Living Room — Roller" or a custom description. */
  label: string;
  quantity: number;
  /** Last day of cover, YYYY-MM-DD. */
  expiry: string;
}

/**
 * Everything the certificate and the email need to state coverage,
 * derived entirely from the order's line items and its paid-in-full date.
 */
export interface WarrantyCoverage {
  /** Paid-in-full date coverage runs from, YYYY-MM-DD. */
  startsOn: string;
  /** `startsOn` + 10 years — the product term. */
  expiry: string;
  /** Every line item, on the ten-year product term, in order. */
  items: WarrantyItem[];
}

/** Zero-pads a month or day to two digits. */
function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Days in a given month, leap years included.
 *
 * @param year Full year, e.g. 2038
 * @param month 1-based month (1 = January)
 */
function daysInMonth(year: number, month: number): number {
  // Day 0 of the FOLLOWING month is the last day of this one. UTC is used
  // so the result never depends on the Worker's local timezone.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Adds whole calendar years to a YYYY-MM-DD date, clamping the day to
 * the target month rather than rolling over: 2028-02-29 + 10 years is
 * 2038-02-28, never 2038-03-01. Coverage must end inside the month the
 * customer expects it to.
 *
 * Pure string/number arithmetic — no local-timezone `Date` round-trip,
 * which is what shifts date-only values by a day either side of UTC.
 *
 * @param startIso Coverage start, YYYY-MM-DD
 * @param years Whole years to add
 * @returns The expiry date, YYYY-MM-DD
 * @throws Error when `startIso` is not a well-formed YYYY-MM-DD date —
 *         a malformed expiry must never reach a legal document
 */
export function addYears(startIso: string, years: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startIso);
  if (!match) throw new Error(`Invalid warranty start date: ${startIso}`);
  const [year, month, day] = match.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new Error(`Invalid warranty start date: ${startIso}`);
  }
  const targetYear = year + years;
  return `${targetYear}-${pad(month)}-${pad(Math.min(day, daysInMonth(targetYear, month)))}`;
}

/**
 * Names a line item for the certificate. Blinds read "{room} — {type}",
 * degrading to whichever half exists so a row with no room still prints
 * something a customer can identify; preset and custom rows use their
 * description.
 */
function itemLabel(item: WarrantyItemSource): string {
  if (item.item_type === 'blind') {
    const room = (item.room_name ?? '').trim();
    const type = (item.blinds_type ?? '').trim();
    if (room && type) return `${room} — ${type}`;
    return room || type || 'Blind';
  }
  return (item.description ?? '').trim() || 'Item';
}

/**
 * Builds the full coverage picture for one order: every line item on the
 * ten-year product term. No item is classified or singled out — the
 * motorization exclusion is a fixed footer note, not a per-item decision
 * (see the module header for why).
 *
 * @param lineItems The order's line items (any order; sequence is preserved)
 * @param startsOn Paid-in-full date, YYYY-MM-DD
 * @throws Error when `startsOn` is malformed (see {@link addYears})
 */
export function buildWarrantyCoverage(
  lineItems: WarrantyItemSource[],
  startsOn: string
): WarrantyCoverage {
  const expiry = addYears(startsOn, WARRANTY_YEARS_STANDARD);
  return {
    startsOn,
    expiry,
    items: lineItems.map((item) => ({
      label: itemLabel(item),
      quantity: Number(item.quantity),
      expiry,
    })),
  };
}
