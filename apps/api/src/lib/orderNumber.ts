// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Server-side order number generation (IMPLEMENTATION.md §4).
 *
 * Format: {DayInitial}{DD}{MM}-{N}{YY}, e.g. "T0408-126" = Tuesday
 * Aug 4, 1st estimate of that day, 2026. N is the 1-based count of
 * estimates sharing the same estimate_date.
 *
 * Generation counts existing rows and can therefore race under
 * concurrent creates — the `estimates_order_number_key` UNIQUE index
 * is the hard guarantee, and the POST route retries with an
 * incremented N when the insert hits a duplicate (Postgres 23505).
 */

/** Maps JS getDay() index (0=Sunday) to the day initial. */
const DAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

/**
 * Formats an order number for the given date and daily sequence count.
 *
 * @param date - The estimate date (parsed as local server date)
 * @param countOfDay - 1-based sequence number within that date
 */
export function generateOrderNumber(date: Date, countOfDay: number): string {
  const dayInitial = DAY_INITIALS[date.getDay()];
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yy = String(date.getFullYear()).slice(-2);
  return `${dayInitial}${dd}${mm}-${countOfDay}${yy}`;
}

/**
 * Parses a YYYY-MM-DD date string as a timezone-neutral local Date
 * (avoids the UTC-midnight shift of `new Date('YYYY-MM-DD')`).
 */
export function parseDateOnly(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}
