// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Human-readable date/time formatting shared by the order routes and
 * the scheduled reminder job, plus the America/Toronto calendar-date
 * helpers the cron uses to decide "today" and "tomorrow".
 */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Formats "HH:MM" (24h) as a 12-hour clock string, e.g. "2:00 PM". */
export function to12Hour(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const hour12 = ((h + 11) % 12) + 1;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

/**
 * Builds the human-readable visit window from a stored date + start
 * time: the date as "Friday, August 7, 2026" and the one-hour arrival
 * window [start, start + 1h]. Formatting is done by hand (no `Intl`
 * locale data) so it is identical under workerd and Node.
 */
export function scheduleWindow(dateIso: string, time: string): {
  dateText: string;
  startText: string;
  endText: string;
} {
  const [y, mo, d] = dateIso.split('-').map(Number);
  const dow = new Date(y, mo - 1, d).getDay();
  const dateText = `${WEEKDAYS[dow]}, ${MONTHS[mo - 1]} ${d}, ${y}`;
  const [h, m] = time.split(':').map(Number);
  const endTime = `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return { dateText, startText: to12Hour(time), endText: to12Hour(endTime) };
}

/**
 * The calendar date in America/Toronto, shifted by `offsetDays`, as
 * "YYYY-MM-DD" (en-CA locale formats exactly that way). Appointment and
 * installation dates are Ontario-local, so reminder matching must use
 * the Toronto calendar, not UTC.
 */
export function torontoDateISO(offsetDays = 0, now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + offsetDays * 86_400_000);
  return shifted.toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
}

/** One-line visit address built from a customer's shipping fields. */
export function customerLocation(customer: {
  shipping_address_line1?: string | null;
  shipping_address_line2?: string | null;
  shipping_city?: string | null;
  shipping_province?: string | null;
} | null | undefined): string {
  if (!customer) return '';
  const street = [customer.shipping_address_line1, customer.shipping_address_line2]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(', ');
  const city = [customer.shipping_city, customer.shipping_province]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(' ');
  return [street, city].filter(Boolean).join(', ');
}
