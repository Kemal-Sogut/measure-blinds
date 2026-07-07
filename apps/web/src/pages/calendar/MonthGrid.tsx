// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * MonthGrid — pure presentational monthly calendar grid (v1 is
 * monthly-only per plan §9.4). Renders a weekday header followed by a
 * fixed 6×7 cell grid (`date-fns` `startOfMonth`/`endOfMonth`/
 * `eachDayOfInterval`, already a project dependency) so the layout
 * never reflows between months. Days outside the current month are
 * dimmed but still tappable (useful near month boundaries).
 *
 * Each cell shows up to `MAX_CHIPS_PER_DAY` `EventChip`s then a
 * "+k more" affordance; tapping empty cell space opens the
 * install-proposal wizard pre-set to that day (owned by the parent
 * `CalendarPage`), while tapping a chip navigates straight to the
 * order (handled inside `EventChip`).
 */

import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isToday,
  format,
} from 'date-fns';
import EventChip from './EventChip';
import type { CalendarEvent } from '../../types';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Cap on chips rendered directly in a day cell before "+k more". */
const MAX_CHIPS_PER_DAY = 3;

/** "YYYY-MM-DD" for a local Date, matching the API's date-only convention. */
function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function MonthGrid({
  month,
  events,
  onDayTap,
}: {
  /** Any date within the month to display. */
  month: Date;
  events: CalendarEvent[];
  /** Called when the consultant taps a day cell to start a proposal. */
  onDayTap: (day: Date) => void;
}) {
  const gridStart = startOfWeek(startOfMonth(month));
  const gridEnd = endOfWeek(endOfMonth(month));
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  // Group events by install_date for O(1) lookup per cell.
  const byDate = new Map<string, CalendarEvent[]>();
  for (const ev of events) {
    const list = byDate.get(ev.install_date) ?? [];
    list.push(ev);
    byDate.set(ev.install_date, list);
  }

  return (
    <div className="overflow-hidden rounded-sm border border-border bg-surface">
      <div className="grid grid-cols-7 border-b border-border bg-surface-muted">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="px-1 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-text-muted"
          >
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const iso = toIsoDate(day);
          const dayEvents = byDate.get(iso) ?? [];
          const inMonth = isSameMonth(day, month);
          const today = isToday(day);
          return (
            <div
              key={iso}
              role="button"
              tabIndex={0}
              onClick={() => onDayTap(day)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onDayTap(day);
                }
              }}
              className={`flex min-h-[64px] cursor-pointer flex-col items-stretch gap-0.5 border-b border-r border-border-light p-1 text-left last:border-r-0 sm:min-h-[88px] ${
                inMonth ? 'bg-surface' : 'bg-surface-muted'
              }`}
            >
              <span
                className={`self-start rounded-sm px-1 text-[11px] font-medium ${
                  today
                    ? 'bg-brand-600 text-white'
                    : inMonth
                      ? 'text-text-primary'
                      : 'text-text-muted'
                }`}
              >
                {format(day, 'd')}
              </span>
              <div className="flex flex-col gap-0.5">
                {dayEvents.slice(0, MAX_CHIPS_PER_DAY).map((ev) => (
                  <EventChip key={ev.id} event={ev} />
                ))}
                {dayEvents.length > MAX_CHIPS_PER_DAY && (
                  <span className="px-1 text-[10px] font-medium text-text-muted">
                    +{dayEvents.length - MAX_CHIPS_PER_DAY} more
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
