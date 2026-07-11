// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * AppointmentsList — the calendar's "See All" page (`/appointments`),
 * reached from the "See All" button at the top of the Calendar tab.
 * Lists every appointment (both kinds) newest-first, 20 per page, with
 * a kind filter (All / Estimates / Installations) and bottom
 * pagination. Tapping a row opens that appointment's details page.
 *
 * Unlike the calendar grid (which is scoped to a single visible month)
 * this is a flat, chronological history across all dates — the place
 * to find a past or far-future visit without paging month by month.
 * Data + paging come from `useAppointmentsList`, which returns the
 * events plus `total_pages`; switching the filter resets to page 1.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import PageHeader from '../../components/PageHeader';
import { ListSkeleton } from '../../components/Skeleton';
import {
  useAppointmentsList,
  type AppointmentKindFilter,
} from '../../hooks/useCalendar';
import type { CalendarEvent } from '../../types';

/** Schedule-status → display label + Tailwind ink class. */
const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  proposed: { text: 'Awaiting customer', cls: 'text-warning' },
  confirmed: { text: 'Confirmed', cls: 'text-success' },
  change_requested: { text: 'Change requested', cls: 'text-danger' },
};

/** The three filter chips and the kind they request from the API. */
const FILTERS: { value: AppointmentKindFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'estimate', label: 'Estimates' },
  { value: 'installation', label: 'Installations' },
];

/** Formats "HH:MM[:SS]" (24h) as a 12-hour label, e.g. "2:00 PM". */
function to12Hour(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const hour12 = ((h + 11) % 12) + 1;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

/** "date + time" → "Thu, Jul 16, 2026 · 2:00 PM". */
function whenLabel(dateIso: string, time: string): string {
  const [y, mo, d] = dateIso.split('-').map(Number);
  return `${format(new Date(y, mo - 1, d), 'EEE, MMM d, yyyy')} · ${to12Hour(time)}`;
}

/** One appointment row — the whole card is a button into the details page. */
function Row({ event, onOpen }: { event: CalendarEvent; onOpen: () => void }) {
  const customerName = `${event.customer.first_name} ${event.customer.last_name}`.trim();
  const status = STATUS_LABEL[event.schedule_status];
  const isInstall = event.kind === 'installation';
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-col gap-1 rounded-sm border border-border-light bg-surface p-3 text-left hover:bg-surface-muted"
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-medium text-text-primary">
          {customerName || event.order_number || 'Customer'}
        </span>
        <span className={`shrink-0 text-[12px] font-semibold ${status?.cls ?? ''}`}>
          {status?.text ?? event.schedule_status}
        </span>
      </span>
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] text-text-secondary">
          {whenLabel(event.date, event.time)}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span
            className={`rounded-sm px-1.5 py-0.5 text-[11px] font-medium ${
              isInstall ? 'bg-brand-100 text-brand-600' : 'bg-success-tint text-success'
            }`}
          >
            {isInstall ? 'Installation' : 'Estimate'}
          </span>
          {event.order_number && (
            <span className="font-mono text-[12px] text-text-muted">{event.order_number}</span>
          )}
        </span>
      </span>
    </button>
  );
}

export default function AppointmentsList() {
  const navigate = useNavigate();
  const [kind, setKind] = useState<AppointmentKindFilter>('all');
  const [page, setPage] = useState(1);

  const { data, isLoading, error, isPlaceholderData } = useAppointmentsList(kind, page);

  /** Switch filter and jump back to the first page. */
  function selectKind(next: AppointmentKindFilter) {
    setKind(next);
    setPage(1);
  }

  const totalPages = data?.total_pages ?? 1;
  const events = data?.data ?? [];

  return (
    <div className="min-h-screen bg-surface-muted pb-16">
      <PageHeader title="All Appointments" backTo="/calendar" />

      <div className="mx-auto flex max-w-lg flex-col gap-4 p-4 lg:max-w-3xl lg:p-8">
        {/* Filter chips */}
        <div className="flex gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => selectKind(f.value)}
              className={`h-9 rounded-sm border px-3 text-[13px] font-medium ${
                kind === f.value
                  ? 'border-brand-600 bg-brand-100 text-brand-600'
                  : 'border-border-input bg-surface text-text-secondary hover:bg-surface-muted'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {isLoading && <ListSkeleton />}
        {error && <p className="text-danger">{error.message}</p>}

        {!isLoading && !error && (
          <>
            {events.length === 0 ? (
              <p className="rounded-sm border border-border bg-surface p-6 text-center text-[13px] text-text-muted">
                No appointments{kind === 'all' ? '' : ` of this type`} yet.
              </p>
            ) : (
              <div
                className={`flex flex-col gap-2 transition-opacity ${
                  isPlaceholderData ? 'opacity-60' : ''
                }`}
              >
                {events.map((ev) => (
                  <Row
                    key={ev.id}
                    event={ev}
                    onOpen={() => navigate(`/appointments/${ev.id}`)}
                  />
                ))}
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-2 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="h-9 rounded-sm border border-border-input bg-surface px-3 text-[13px] font-medium text-text-secondary hover:bg-surface-muted disabled:opacity-40"
                >
                  ‹ Previous
                </button>
                <span className="text-[13px] text-text-secondary">
                  Page {page} of {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="h-9 rounded-sm border border-border-input bg-surface px-3 text-[13px] font-medium text-text-secondary hover:bg-surface-muted disabled:opacity-40"
                >
                  Next ›
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
