// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * EventChip — a single schedule marker rendered inside a `MonthGrid`
 * day cell, covering both event kinds.
 *
 * Visual language (plan §6, no new Tailwind tokens):
 *   - Installations: `confirmed` → solid brand (`brand-600`);
 *     `proposed` / `change_requested` → the `warning` tint/ink pair.
 *   - Estimate appointments: `confirmed` → solid `success`;
 *     `proposed` / `change_requested` → the `success` tint/ink pair,
 *     so the two schedules are distinguishable at a glance.
 *
 * Tapping ANY chip (either kind) navigates to that appointment's
 * details page (`/appointments/:id`), where the customer block, the
 * Google-Maps-linked address, and the linked order (installations) are
 * shown. Scheduling changes still happen from the under-grid section
 * rows and the order page.
 */

import { useNavigate } from 'react-router-dom';
import type { CalendarEvent } from '../../types';

/** Formats "HH:MM" (24h) as a compact "9:00a" style label for chips. */
function shortTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const period = h < 12 ? 'a' : 'p';
  const hour12 = ((h + 11) % 12) + 1;
  return m === 0 ? `${hour12}${period}` : `${hour12}:${String(m).padStart(2, '0')}${period}`;
}

export default function EventChip({ event }: { event: CalendarEvent }) {
  const navigate = useNavigate();
  const isConfirmed = event.schedule_status === 'confirmed';
  const isEstimate = event.kind === 'estimate';
  const customerName = `${event.customer.first_name} ${event.customer.last_name}`.trim();
  const kindLabel = isEstimate ? 'estimate' : 'installation';

  const cls = isEstimate
    ? isConfirmed
      ? 'bg-success text-white'
      : 'border border-success bg-success-tint text-success'
    : isConfirmed
      ? 'bg-brand-600 text-white'
      : 'border border-warning bg-warning-tint text-warning';

  return (
    <button
      type="button"
      onClick={(e) => {
        // Stop the day-cell tap (which opens the booking wizard) from
        // also firing, then open this appointment's details page.
        e.stopPropagation();
        navigate(`/appointments/${event.id}`);
      }}
      title={`${event.order_number || customerName || 'Customer'} — ${customerName || 'Customer'} (${kindLabel}, ${event.schedule_status})`}
      className={`block w-full truncate rounded-sm px-1 py-0.5 text-left text-[10px] font-medium leading-tight ${cls}`}
    >
      {shortTime(event.time)} {customerName || event.order_number}
    </button>
  );
}
