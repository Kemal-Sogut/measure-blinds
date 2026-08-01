// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * EventChip — a single schedule marker rendered inside a `MonthGrid`
 * day cell, covering both event kinds.
 *
 * Visual language, following the redesign's rule that hue encodes
 * state. Kind picks the hue; confirmation picks fill vs tint:
 *   - Installations: `confirmed` → solid `scheduled` (violet, the same
 *     hue the order page's Installation section carries);
 *     `proposed` / `change_requested` → the `warning` tint/ink pair,
 *     because an unanswered proposal is something someone must act on.
 *   - Estimate appointments: `confirmed` → solid `success`;
 *     `proposed` / `change_requested` → the `success` tint/ink pair,
 *     so the two schedules are distinguishable at a glance.
 *
 * It is deliberately NOT built on the `Pill` primitive: a pill is a
 * non-interactive span, while a chip is a full-width navigating button
 * that must truncate inside a day cell.
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
      ? 'bg-success-strong text-white'
      : 'border border-success/40 bg-success-tint text-success'
    : isConfirmed
      ? 'bg-scheduled text-white'
      : 'border border-warning/40 bg-warning-tint text-warning';

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
      className={`block w-full truncate rounded-md px-1.5 py-0.5 text-left text-[10px] font-semibold leading-tight ${cls}`}
    >
      {shortTime(event.time)} {customerName || event.order_number}
    </button>
  );
}
