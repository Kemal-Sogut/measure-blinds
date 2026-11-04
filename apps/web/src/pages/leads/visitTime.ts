// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Time rules for the Leads page's "Propose visit" dialog and the visit line
 * on a lead card: the 30-minute start slots, 12-hour labels, the one-hour
 * window the customer is shown, and the default day.
 *
 * The slots (8:00 AM – 5:30 PM starts) and the one-hour window deliberately
 * match the Calendar's booking wizard (`pages/calendar/AppointmentWizard.tsx`,
 * which keeps its own private copies) and the Worker's email wording
 * (`apps/api/src/lib/timeText.ts` `scheduleWindow`), so a visit proposed from
 * a lead reads the same everywhere. Pure functions, pinned in
 * `visitTime.test.ts`.
 */

/** "08:00" … "17:30": every half hour from 8 AM, last start 5:30 PM. */
export const VISIT_SLOTS: string[] = Array.from({ length: 20 }, (_, i) => {
  const h = 8 + Math.floor(i / 2);
  return `${String(h).padStart(2, '0')}:${i % 2 ? '30' : '00'}`;
});

/** "14:30" → "2:30 PM". */
export function to12Hour(time: string): string {
  const [h, m] = time.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "10:00" → "10:00 AM – 11:00 AM", the window the customer is shown. */
export function visitWindow(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const end = `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return `${to12Hour(time)} – ${to12Hour(end)}`;
}

/** A local calendar day as `YYYY-MM-DD` (never via `toISOString`, which shifts to UTC). */
export function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** `YYYY-MM-DD` → a local Date at midnight (the inverse of `toIsoDate`). */
export function fromIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * The day the dialog opens on: tomorrow, or Monday when tomorrow is a
 * Sunday. Staff can pick any day; this only saves a tap in the usual case.
 */
export function defaultVisitDay(now: Date = new Date()): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return d;
}
