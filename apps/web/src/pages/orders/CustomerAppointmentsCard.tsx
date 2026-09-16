// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Every visit booked for this order's customer — estimate visits and
 * installations across ALL of their orders — shown in the order page's
 * Appointments section beneath this order's own Installation panel.
 *
 * The Installation panel answers "when do we install THIS order"; this
 * card answers "what else is booked with this person", which is what a
 * consultant checks before proposing a time. Rows reuse the calendar See
 * All list's `AppointmentRow` so a visit reads the same everywhere, and
 * open the appointment's details page. The Open calendar link goes to the
 * calendar, where new visits are booked.
 *
 * Read-only: scheduling changes stay in the Installation panel and on the
 * calendar. Data comes from `useCustomerAppointments` (first 20, newest
 * first).
 */

import { Link, useNavigate } from 'react-router-dom';
import { useCustomerAppointments } from '../../hooks/useCalendar';
import { AppointmentRow } from '../calendar/AppointmentsList';

/** @param customerId The order's customer, or undefined when none is picked yet. */
export default function CustomerAppointmentsCard({ customerId }: { customerId: string | undefined }) {
  const navigate = useNavigate();
  const { data, isLoading, error } = useCustomerAppointments(customerId);

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border-light bg-surface p-4 shadow-md">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-bold text-text-primary">Customer's appointments</h3>
        <Link
          to="/calendar"
          className="flex h-9 items-center rounded-md border border-border-input px-3 text-[13px] font-medium text-text-secondary hover:bg-surface-sunken"
        >
          Open calendar
        </Link>
      </div>
      {!customerId && (
        <p className="text-[13px] text-text-muted">Pick a customer to see their appointments.</p>
      )}
      {isLoading && <p className="text-[13px] text-text-muted">Loading appointments…</p>}
      {error && <p className="text-[13px] text-danger">{error.message}</p>}
      {data && data.length === 0 && (
        <p className="text-[13px] text-text-muted">No appointments booked for this customer.</p>
      )}
      {data && data.length > 0 && (
        <div className="flex flex-col gap-2">
          {data.map((ev) => (
            <AppointmentRow key={ev.id} event={ev} onOpen={() => navigate(`/appointments/${ev.id}`)} />
          ))}
        </div>
      )}
    </section>
  );
}
