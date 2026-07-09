// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * CalendarPage — composition root for the Calendar tab. Owns the
 * visible month and the wizard state; grid rendering is delegated to
 * `MonthGrid`, booking to the unified `AppointmentWizard` (kind → day →
 * time → target), and the under-grid lists to `ScheduleSections`.
 *
 * The calendar shows BOTH kinds of appointment: estimate visits
 * (green) and installations (brand/amber). The "+ New Appointment"
 * button and any day tap open the same wizard — its first step picks
 * the kind. All appointment management lives on this tab; the orders
 * page carries no scheduling UI.
 *
 * Monthly view is the only layout for v1 (plan §9.4, LOCKED) — there
 * is no week/day toggle.
 */

import { useMemo, useState } from 'react';
import { startOfMonth, endOfMonth, startOfWeek, endOfWeek, addMonths, format } from 'date-fns';
import PageHeader from '../../components/PageHeader';
import { ListSkeleton } from '../../components/Skeleton';
import { useCalendarEvents } from '../../hooks/useCalendar';
import MonthGrid from './MonthGrid';
import AppointmentWizard from './AppointmentWizard';
import ScheduleSections from './ScheduleSections';
import type { CalendarEvent } from '../../types';

/** "YYYY-MM-DD" for a local Date, matching the API's date-only convention. */
function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "YYYY-MM-DD" → local Date (avoids the UTC shift of `new Date(iso)`). */
function fromIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Wizard overlay state: fresh booking or re-propose on an event. */
type WizardState = {
  day: Date;
  repropose?: { id: string; kind: CalendarEvent['kind']; label: string; time?: string };
} | null;

export default function CalendarPage() {
  const [month, setMonth] = useState(() => new Date());
  const [wizard, setWizard] = useState<WizardState>(null);

  // Fetch the full visible grid range (leading/trailing days included)
  // so chips near month boundaries render correctly.
  const { from, to } = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(month));
    const gridEnd = endOfWeek(endOfMonth(month));
    return { from: toIsoDate(gridStart), to: toIsoDate(gridEnd) };
  }, [month]);

  const eventsQ = useCalendarEvents(from, to);

  /** "Change" on a section row → re-propose a new time, same link. */
  function changeAppointment(event: CalendarEvent) {
    const customerName = `${event.customer.first_name} ${event.customer.last_name}`.trim();
    setWizard({
      day: fromIsoDate(event.date),
      repropose: {
        id: event.id,
        kind: event.kind,
        label: event.kind === 'installation' ? event.order_number : customerName,
        time: event.time.slice(0, 5),
      },
    });
  }

  return (
    <div className="min-h-screen bg-surface-muted pb-24 lg:pb-8">
      <div className="lg:hidden">
        <PageHeader title="Calendar" backTo="/" />
      </div>

      <div className="mx-auto max-w-lg p-4 lg:max-w-5xl lg:p-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h1 className="hidden text-[22px] font-semibold text-text-primary lg:block">Calendar</h1>
          <div className="flex flex-1 flex-wrap items-center justify-between gap-2 lg:flex-none lg:justify-end">
            <button
              type="button"
              onClick={() => setWizard({ day: new Date() })}
              className="h-9 rounded-sm bg-brand-600 px-3 text-[13px] font-semibold text-white hover:bg-brand-700"
            >
              + New Appointment
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMonth((m) => addMonths(m, -1))}
                aria-label="Previous month"
                className="flex h-9 w-9 items-center justify-center rounded-sm border border-border-input text-text-secondary hover:bg-surface-muted"
              >
                ‹
              </button>
              <span className="min-w-[9rem] text-center text-sm font-semibold text-text-primary">
                {format(month, 'MMMM yyyy')}
              </span>
              <button
                type="button"
                onClick={() => setMonth((m) => addMonths(m, 1))}
                aria-label="Next month"
                className="flex h-9 w-9 items-center justify-center rounded-sm border border-border-input text-text-secondary hover:bg-surface-muted"
              >
                ›
              </button>
              <button
                type="button"
                onClick={() => setMonth(new Date())}
                className="ml-1 h-9 rounded-sm border border-border-input px-3 text-[13px] font-medium text-text-secondary hover:bg-surface-muted"
              >
                Today
              </button>
            </div>
          </div>
        </div>

        {eventsQ.isLoading && <ListSkeleton />}
        {eventsQ.error && <p className="text-danger">{eventsQ.error.message}</p>}
        {!eventsQ.isLoading && !eventsQ.error && (
          <>
            <MonthGrid
              month={month}
              events={eventsQ.data ?? []}
              onDayTap={(day) => setWizard({ day })}
            />
            <ScheduleSections events={eventsQ.data ?? []} onChange={changeAppointment} />
          </>
        )}
      </div>

      {wizard && (
        <AppointmentWizard
          initialDay={wizard.day}
          repropose={wizard.repropose}
          onClose={() => setWizard(null)}
        />
      )}
    </div>
  );
}
