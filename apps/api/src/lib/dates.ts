// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Business-timezone date helpers.
 *
 * The business operates in Ontario (America/Toronto). "Today" for
 * business purposes — default order dates, estimate expiry checks,
 * payment paid_on defaults, the daily expiry cron — must be computed in
 * that timezone, NOT in UTC. A bare `new Date().toISOString()` is 4–5
 * hours ahead of Toronto, which made evening reads treat estimates as
 * expired hours early (and the 6:00 UTC cron run on the "wrong" date).
 *
 * `Intl.DateTimeFormat` with the `en-CA` locale formats dates as
 * YYYY-MM-DD directly, and IANA timezone data is available in both
 * workerd and Node, so these helpers behave identically in production
 * and under vitest.
 */

/** IANA timezone the business operates in. */
export const BUSINESS_TZ = 'America/Toronto';

/** Cached formatter — construction is expensive; reuse per isolate. */
const isoDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Returns the calendar date (YYYY-MM-DD) of the given instant as seen
 * in the business timezone.
 *
 * @param instant - Any absolute point in time
 */
export function businessDateOf(instant: Date): string {
  return isoDateFormatter.format(instant);
}

/**
 * Returns today's date (YYYY-MM-DD) in the business timezone. Use this
 * for every "today" comparison against DATE columns (order_date,
 * expiry_date, paid_on) instead of `new Date().toISOString().slice(0,10)`.
 */
export function todayBusiness(): string {
  return businessDateOf(new Date());
}
