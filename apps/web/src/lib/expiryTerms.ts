// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Expiry terms for the order editor: the shortcut list rendered as chips
 * in `OrderDatesCard` and the date arithmetic that resolves a term
 * against an order date.
 *
 * A term is a UI-only convenience — only the resolved `expiry_date` is
 * persisted with the order — but it stays selected while the editor is
 * open so that moving the order date moves the expiry with it.
 */

/**
 * Identifier of an expiry term shortcut. `on_receipt` means the estimate
 * expires the same day it is dated (acceptance due immediately); the
 * rest are offsets added to the order date.
 */
export type ExpiryPresetId = 'on_receipt' | 'd1' | 'd3' | 'd7' | 'd15' | 'm1';

/**
 * The expiry terms offered as chips, in display order. Kept as data (not
 * hard-coded JSX) so the chip row and `expiryFromPreset` cannot drift
 * apart, and so a new term is a one-line addition here plus one case.
 */
export const EXPIRY_PRESETS: ReadonlyArray<{ id: ExpiryPresetId; label: string }> = [
  { id: 'on_receipt', label: 'On receipt' },
  { id: 'd1', label: '1 day' },
  { id: 'd3', label: '3 days' },
  { id: 'd7', label: '7 days' },
  { id: 'd15', label: '15 days' },
  { id: 'm1', label: '1 month' },
];

/**
 * Resolves an expiry term against an order date, returning a NEW `Date`
 * (the input is never mutated — it is React state in the caller).
 *
 * `m1` adds a calendar month with an end-of-month clamp: `setMonth`
 * alone rolls Jan 31 over into Mar 3, so an overflowing day is pulled
 * back to the last day of the target month (Jan 31 → Feb 28/29).
 */
export function expiryFromPreset(orderDate: Date, preset: ExpiryPresetId): Date {
  const d = new Date(orderDate);
  switch (preset) {
    case 'on_receipt':
      return d;
    case 'd1':
      d.setDate(d.getDate() + 1);
      return d;
    case 'd3':
      d.setDate(d.getDate() + 3);
      return d;
    case 'd7':
      d.setDate(d.getDate() + 7);
      return d;
    case 'd15':
      d.setDate(d.getDate() + 15);
      return d;
    case 'm1': {
      const day = d.getDate();
      d.setMonth(d.getMonth() + 1);
      // Overflowed into the following month — step back to its last day.
      if (d.getDate() < day) d.setDate(0);
      return d;
    }
  }
}
