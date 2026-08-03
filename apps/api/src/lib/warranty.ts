// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Warranty term rules — the single source of truth for what is covered,
 * for how long, and until when.
 *
 * The shop's policy has two terms: products carry TEN years, and the
 * motor plus its moving parts on a motorised blind carry TWO. A
 * motorised blind is therefore covered by BOTH — the blind itself for
 * ten years, its motor for two — which is why `buildWarrantyCoverage`
 * returns a motorised item in `standardItems` as well as `motorItems`
 * rather than moving it between them.
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

/** Years of coverage on a motor and its moving parts. */
export const WARRANTY_YEARS_MOTOR = 2;

/**
 * Matches the motorised catalog controls (`Motorized (Bluetooth)` and
 * `Motorized (Non-Bluetooth)`) and any preset/custom row sold as a motor
 * or motor part. Kept as one pattern so both checks can never drift.
 */
const MOTOR_PATTERN = /motor/i;

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
  /** Snapshotted control catalog name; the motorised signal for blinds. */
  control_name?: string | null;
  quantity: number;
}

/** One printable warranty row: what is covered, how many, and until when. */
export interface WarrantyItem {
  /** Human label, e.g. "Living Room — Roller" or a custom description. */
  label: string;
  quantity: number;
  /** Last day of cover for THIS row's term, YYYY-MM-DD. */
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
  standardExpiry: string;
  /** `startsOn` + 2 years — the motor term. */
  motorExpiry: string;
  /** True when the order contains at least one motorised product. */
  hasMotorised: boolean;
  /** Every line item, on the ten-year product term. */
  standardItems: WarrantyItem[];
  /** Only the motorised items, on the two-year motor term. */
  motorItems: WarrantyItem[];
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
 * Whether a line item is motorised, and therefore also carries the
 * two-year motor term.
 *
 * A blind is judged on its snapshotted `control_name` (the catalog ships
 * `Motorized (Bluetooth)` and `Motorized (Non-Bluetooth)`); a preset or
 * custom row is judged on its description, which is how a separately
 * sold motor or replacement part reaches an order.
 */
export function isMotorised(item: WarrantyItemSource): boolean {
  return MOTOR_PATTERN.test(
    (item.item_type === 'blind' ? item.control_name : item.description) ?? ''
  );
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
 * Builds the full coverage picture for one order.
 *
 * Every line item lands in `standardItems` on the ten-year term. The
 * motorised ones ALSO land in `motorItems` on the two-year term, labelled
 * to make clear it is the motor and its moving parts that carry the
 * shorter cover — not the blind, which keeps its ten years. The
 * certificate renders `motorItems` as its own section, and omits that
 * section entirely when `hasMotorised` is false.
 *
 * @param lineItems The order's line items (any order; sequence is preserved)
 * @param startsOn Paid-in-full date, YYYY-MM-DD
 * @throws Error when `startsOn` is malformed (see {@link addYears})
 */
export function buildWarrantyCoverage(
  lineItems: WarrantyItemSource[],
  startsOn: string
): WarrantyCoverage {
  const standardExpiry = addYears(startsOn, WARRANTY_YEARS_STANDARD);
  const motorExpiry = addYears(startsOn, WARRANTY_YEARS_MOTOR);

  const standardItems: WarrantyItem[] = [];
  const motorItems: WarrantyItem[] = [];
  for (const item of lineItems) {
    const label = itemLabel(item);
    const quantity = Number(item.quantity);
    standardItems.push({ label, quantity, expiry: standardExpiry });
    if (isMotorised(item)) {
      // The blind keeps its ten years; only the motor drops to two, so
      // the label has to say which part this shorter row covers.
      const motorLabel = item.item_type === 'blind' ? `${label} — motor & moving parts` : label;
      motorItems.push({ label: motorLabel, quantity, expiry: motorExpiry });
    }
  }

  return {
    startsOn,
    standardExpiry,
    motorExpiry,
    hasMotorised: motorItems.length > 0,
    standardItems,
    motorItems,
  };
}
