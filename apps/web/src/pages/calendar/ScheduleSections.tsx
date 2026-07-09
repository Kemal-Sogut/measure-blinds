// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * ScheduleSections — the two lists under the Calendar grid, split
 * left/right on desktop (stacked on mobile):
 *   left  — Estimate appointments (customer-only visits).
 *   right — Installation appointments (each tied to an order).
 *
 * All scheduling is managed HERE — the orders page carries no
 * appointment UI. Every row offers "Change" (re-opens the wizard on
 * the same appointment and re-emails the proposal) and "Remove";
 * installation rows additionally link to their order.
 */

import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { useDeleteAppointment } from '../../hooks/useCalendar';
import type { CalendarEvent } from '../../types';

/** Formats "HH:MM[:SS]" (24h) as a 12-hour label, e.g. "2:00 PM". */
function to12Hour(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const hour12 = ((h + 11) % 12) + 1;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

/** "date + time" → "Thu, Jul 16 · 2:00 PM – 3:00 PM" (1-hour window). */
function whenLabel(dateIso: string, time: string): string {
  const [y, mo, d] = dateIso.split('-').map(Number);
  const [h, m] = time.split(':').map(Number);
  const end = `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return `${format(new Date(y, mo - 1, d), 'EEE, MMM d')} · ${to12Hour(time)} – ${to12Hour(end)}`;
}

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  proposed: { text: 'Awaiting customer', cls: 'text-warning' },
  confirmed: { text: 'Confirmed', cls: 'text-success' },
  change_requested: { text: 'Change requested', cls: 'text-danger' },
};

function EventMeta({ event }: { event: CalendarEvent }) {
  const customerName = `${event.customer.first_name} ${event.customer.last_name}`.trim();
  const status = STATUS_LABEL[event.schedule_status];
  return (
    <>
      <span className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-medium text-text-primary">
          {customerName || event.order_number || 'Customer'}
        </span>
        <span className={`shrink-0 text-[12px] font-semibold ${status?.cls ?? ''}`}>
          {status?.text ?? event.schedule_status}
        </span>
      </span>
      <span className="mt-0.5 flex items-baseline justify-between gap-2">
        <span className="text-[13px] text-text-secondary">{whenLabel(event.date, event.time)}</span>
        {event.order_number && (
          <span className="font-mono text-[12px] text-text-muted">{event.order_number}</span>
        )}
      </span>
    </>
  );
}

export default function ScheduleSections({
  events,
  onChange,
}: {
  /** All events for the visible calendar range (both kinds). */
  events: CalendarEvent[];
  /** Opens the wizard in re-propose mode for this appointment. */
  onChange: (event: CalendarEvent) => void;
}) {
  const navigate = useNavigate();
  const deleteMut = useDeleteAppointment();

  const estimates = events.filter((e) => e.kind === 'estimate');
  const installs = events.filter((e) => e.kind === 'installation');

  async function remove(event: CalendarEvent) {
    const customerName = `${event.customer.first_name} ${event.customer.last_name}`.trim();
    const label = event.kind === 'installation' ? event.order_number : customerName;
    if (!window.confirm(`Remove the ${event.kind} appointment for ${label || 'this customer'}?`))
      return;
    try {
      await deleteMut.mutateAsync(event.id);
      toast.success('Appointment removed.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not remove the appointment.');
    }
  }

  function actionRow(event: CalendarEvent) {
    return (
      <div className="mt-2 flex gap-2">
        {event.kind === 'installation' && event.order_id && (
          <button
            type="button"
            onClick={() => navigate(`/orders/${event.order_id}`)}
            className="h-9 flex-1 rounded-sm border border-border-input bg-surface text-[13px] font-medium text-text-secondary hover:bg-surface-muted"
          >
            View order
          </button>
        )}
        <button
          type="button"
          onClick={() => onChange(event)}
          className="h-9 flex-1 rounded-sm border border-border-input bg-surface text-[13px] font-medium text-text-secondary hover:bg-surface-muted"
        >
          Change
        </button>
        <button
          type="button"
          onClick={() => remove(event)}
          disabled={deleteMut.isPending}
          className="h-9 flex-1 rounded-sm border border-border-input bg-surface text-[13px] font-medium text-danger hover:bg-surface-muted disabled:opacity-40"
        >
          Remove
        </button>
      </div>
    );
  }

  const sectionCls = 'rounded-sm border border-border bg-surface p-4';
  const emptyCls = 'text-[13px] text-text-muted';

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      {/* Estimate appointments (left) */}
      <section className={sectionCls} aria-label="Estimate appointments">
        <h2 className="mb-3 text-sm font-semibold text-text-primary">Estimate appointments</h2>
        {estimates.length === 0 && <p className={emptyCls}>No estimate appointments this month.</p>}
        <div className="flex flex-col gap-2">
          {estimates.map((ev) => (
            <div key={ev.id} className="rounded-sm border border-border-light bg-surface p-3">
              <EventMeta event={ev} />
              {actionRow(ev)}
            </div>
          ))}
        </div>
      </section>

      {/* Installation appointments (right) */}
      <section className={sectionCls} aria-label="Installation appointments">
        <h2 className="mb-3 text-sm font-semibold text-text-primary">Installation appointments</h2>
        {installs.length === 0 && <p className={emptyCls}>No installations this month.</p>}
        <div className="flex flex-col gap-2">
          {installs.map((ev) => (
            <div key={ev.id} className="rounded-sm border border-border-light bg-surface p-3">
              <EventMeta event={ev} />
              {actionRow(ev)}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
