// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * CalendarPage — thin composition root for the Calendar tab (plan
 * §4.4). Owns only the visible month and the wizard's open/closed
 * state + preselected day; all grid rendering is delegated to
 * `MonthGrid` and the proposal flow to `InstallProposalWizard`.
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
import InstallProposalWizard from './InstallProposalWizard';

/** "YYYY-MM-DD" for a local Date, matching the API's date-only convention. */
function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function CalendarPage() {
  const [month, setMonth] = useState(() => new Date());
  const [wizardDay, setWizardDay] = useState<Date | null>(null);

  // Fetch the full visible grid range (leading/trailing days included)
  // so chips near month boundaries render correctly.
  const { from, to } = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(month));
    const gridEnd = endOfWeek(endOfMonth(month));
    return { from: toIsoDate(gridStart), to: toIsoDate(gridEnd) };
  }, [month]);

  const eventsQ = useCalendarEvents(from, to);

  return (
    <div className="min-h-screen bg-surface-muted pb-24 lg:pb-8">
      <div className="lg:hidden">
        <PageHeader title="Calendar" backTo="/" />
      </div>

      <div className="mx-auto max-w-lg p-4 lg:max-w-5xl lg:p-8">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="hidden text-[22px] font-semibold text-text-primary lg:block">Calendar</h1>
          <div className="flex flex-1 items-center justify-between gap-2 lg:flex-none lg:justify-end">
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

        {eventsQ.isLoading && <ListSkeleton />}
        {eventsQ.error && <p className="text-danger">{eventsQ.error.message}</p>}
        {!eventsQ.isLoading && !eventsQ.error && (
          <MonthGrid month={month} events={eventsQ.data ?? []} onDayTap={setWizardDay} />
        )}
      </div>

      {wizardDay && (
        <InstallProposalWizard initialDay={wizardDay} onClose={() => setWizardDay(null)} />
      )}
    </div>
  );
}
