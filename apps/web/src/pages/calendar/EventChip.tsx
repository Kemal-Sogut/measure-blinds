// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * EventChip — a single installation marker rendered inside a
 * `MonthGrid` day cell.
 *
 * Visual language (plan §6, no new Tailwind tokens):
 *   - `proposed` / `change_requested` → pending look, the `warning`
 *     tint/ink pair also used by the `awaiting_payment` StatusBadge.
 *   - `confirmed` → solid brand look (`brand-600`), matching the
 *     app's primary-action color.
 *
 * Tapping a chip navigates to the order detail page rather than
 * opening the wizard — the wizard is only for creating NEW proposals
 * from an empty/day-tap gesture on the grid itself.
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
  const isConfirmed = event.install_status === 'confirmed';
  const customerName = `${event.customer.first_name} ${event.customer.last_name}`.trim();

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        navigate(`/orders/${event.id}`);
      }}
      title={`${event.order_number} — ${customerName || 'Customer'} (${event.install_status})`}
      className={`block w-full truncate rounded-sm px-1 py-0.5 text-left text-[10px] font-medium leading-tight ${
        isConfirmed ? 'bg-brand-600 text-white' : 'border border-warning bg-warning-tint text-warning'
      }`}
    >
      {shortTime(event.install_time)} {customerName || event.order_number}
    </button>
  );
}
