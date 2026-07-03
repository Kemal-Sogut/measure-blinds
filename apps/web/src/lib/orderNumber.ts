// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Order number generation logic matching IMPLEMENTATION.md §4.
 *
 * Format: {DayInitial}{DD}{MM}-{N}{YY}
 * Example: T0208-126 = Tuesday, August 2nd, 2026, 1st estimate of the day
 *
 * Day initials map to: S=Sunday, M=Monday, T=Tuesday, W=Wednesday,
 * T=Thursday, F=Friday, S=Saturday (using JavaScript's getDay() index).
 *
 * The count-of-day (N) is determined server-side by counting existing
 * estimates created on the same date in the America/Toronto timezone.
 */

/** Maps JavaScript's getDay() index (0=Sunday) to a single-character day initial. */
const DAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * Generates an order number string from a date and the sequential count
 * of estimates created on that same day.
 *
 * @param date - The estimate date (not necessarily today if back-dated)
 * @param countOfDay - The 1-based sequential number for this estimate on the given day
 * @returns Formatted order number string (e.g., "T0208-126")
 */
export function generateOrderNumber(date: Date, countOfDay: number): string {
  const dayInitial = DAY_INITIALS[date.getDay()];
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yy = String(date.getFullYear()).slice(-2);
  return `${dayInitial}${dd}${mm}-${countOfDay}${yy}`;
}
