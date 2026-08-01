// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * ScheduleSections — the two lists under the Calendar grid, split
 * left/right on desktop (stacked on mobile):
 *   left  — Estimate appointments (customer-only visits).
 *   right — Installation appointments (each tied to an order).
 *
 * Tapping a row's summary opens that appointment's details page
 * (`/appointments/:id`). Every row also offers "Change" (re-opens the
 * wizard on the same appointment and re-emails the proposal) and
 * "Remove"; rows that are not yet confirmed also offer "Confirm"
 * (staff-side — the customer agreed through another channel; no email).
 * Installation rows additionally link to their order, where the same
 * schedule can also be managed from the order page's Installation
 * panel.
 */

import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { useConfirmAppointment, useDeleteAppointment } from '../../hooks/useCalendar';
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
  const confirmMut = useConfirmAppointment();

  const estimates = events.filter((e) => e.kind === 'estimate');
  const installs = events.filter((e) => e.kind === 'installation');

  /** Staff confirm — the customer agreed through another channel. */
  async function confirm(event: CalendarEvent) {
    try {
      await confirmMut.mutateAsync(event.id);
      toast.success('Appointment confirmed.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not confirm the appointment.');
    }
  }

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
            className="h-9 flex-1 rounded-md border border-border-input bg-surface text-[13px] font-medium text-text-secondary hover:bg-surface-muted"
          >
            View order
          </button>
        )}
        {event.schedule_status !== 'confirmed' && (
          <button
            type="button"
            onClick={() => confirm(event)}
            disabled={confirmMut.isPending}
            className="h-9 flex-1 rounded-md border border-border-input bg-surface text-[13px] font-medium text-success hover:bg-surface-muted disabled:opacity-40"
          >
            Confirm
          </button>
        )}
        <button
          type="button"
          onClick={() => onChange(event)}
          className="h-9 flex-1 rounded-md border border-border-input bg-surface text-[13px] font-medium text-text-secondary hover:bg-surface-muted"
        >
          Change
        </button>
        <button
          type="button"
          onClick={() => remove(event)}
          disabled={deleteMut.isPending}
          className="h-9 flex-1 rounded-md border border-border-input bg-surface text-[13px] font-medium text-danger hover:bg-surface-muted disabled:opacity-40"
        >
          Remove
        </button>
      </div>
    );
  }

  const sectionCls = 'rounded-xl border border-border-light bg-surface p-4 shadow-md';
  const emptyCls = 'text-[13px] text-text-muted';

  /**
   * Heading badge for the two schedule sections. The hue matches what
   * the kind means everywhere else — emerald for estimate visits,
   * violet for installations — so the section header, its rows, and the
   * chips in the grid above never disagree about what colour a kind is.
   */
  const heading = (title: string, tone: 'success' | 'scheduled', d: string) => (
    <div className="mb-3 flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
          tone === 'success' ? 'bg-success-tint text-success' : 'bg-scheduled-tint text-scheduled'
        }`}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
          <path
            d={d}
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <h2 className="text-[15px] font-bold text-text-primary">{title}</h2>
    </div>
  );

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      {/* Estimate appointments (left) */}
      <section className={sectionCls} aria-label="Estimate appointments">
        {heading(
          'Estimate appointments',
          'success',
          'M9 11l3 3L22 4 M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11'
        )}
        {estimates.length === 0 && <p className={emptyCls}>No estimate appointments this month.</p>}
        <div className="flex flex-col gap-2">
          {estimates.map((ev) => (
            <div key={ev.id} className="rounded-xl border border-border-light bg-surface p-3 shadow-sm">
              <button
                type="button"
                onClick={() => navigate(`/appointments/${ev.id}`)}
                className="block w-full text-left"
                aria-label="View appointment details"
              >
                <EventMeta event={ev} />
              </button>
              {actionRow(ev)}
            </div>
          ))}
        </div>
      </section>

      {/* Installation appointments (right) */}
      <section className={sectionCls} aria-label="Installation appointments">
        {heading(
          'Installation appointments',
          'scheduled',
          'M3 10h18M8 2v4M16 2v4M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z'
        )}
        {installs.length === 0 && <p className={emptyCls}>No installations this month.</p>}
        <div className="flex flex-col gap-2">
          {installs.map((ev) => (
            <div key={ev.id} className="rounded-xl border border-border-light bg-surface p-3 shadow-sm">
              <button
                type="button"
                onClick={() => navigate(`/appointments/${ev.id}`)}
                className="block w-full text-left"
                aria-label="View appointment details"
              >
                <EventMeta event={ev} />
              </button>
              {actionRow(ev)}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
