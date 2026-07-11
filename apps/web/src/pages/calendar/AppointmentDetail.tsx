// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * AppointmentDetail — the staff-side, read-oriented details page for a
 * single appointment (`/appointments/:id`), reached by tapping any
 * appointment chip on the calendar grid, any row in the under-grid
 * schedule sections, or any row on the "See All" list.
 *
 * Shows the visit kind, its schedule status, the derived one-hour
 * window, and the full customer block — name, email (mailto), phone
 * (tel), and the shipping address rendered as a link that opens a
 * Google Maps search for that address (so the consultant can get
 * directions in one tap). Installation visits also link through to
 * their order. Loads via `useAppointment`; scheduling changes still
 * happen from the calendar's section rows / the order page, so this
 * page deliberately stays a focused summary.
 */

import { useParams, Link } from 'react-router-dom';
import { format } from 'date-fns';
import PageHeader from '../../components/PageHeader';
import { useAppointment } from '../../hooks/useCalendar';
import type { Customer } from '../../types';

/** Schedule-status → display label + Tailwind ink class (matches the section lists). */
const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  proposed: { text: 'Awaiting customer', cls: 'text-warning' },
  confirmed: { text: 'Confirmed', cls: 'text-success' },
  change_requested: { text: 'Change requested', cls: 'text-danger' },
};

/** Formats "HH:MM[:SS]" (24h) as a 12-hour label, e.g. "2:00 PM". */
function to12Hour(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const hour12 = ((h + 11) % 12) + 1;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

/** "date + time" → "Thursday, July 16, 2026 · 2:00 PM – 3:00 PM" (1-hour window). */
function whenLabel(dateIso: string, time: string): string {
  const [y, mo, d] = dateIso.split('-').map(Number);
  const [h, m] = time.split(':').map(Number);
  const end = `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return `${format(new Date(y, mo - 1, d), 'EEEE, MMMM d, yyyy')} · ${to12Hour(time)} – ${to12Hour(end)}`;
}

/** Joins a customer's shipping address parts into one comma-separated line. */
function shippingAddress(cust: Customer): string {
  return [
    cust.shipping_address_line1,
    cust.shipping_address_line2,
    cust.shipping_city,
    cust.shipping_province,
    cust.shipping_postal_code,
  ]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
    .join(', ');
}

/** Google Maps "search" deep link for an address string (opens directions/place). */
function mapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

/** One label/value row in the customer block. */
function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-t border-border-light py-2.5 first:border-t-0 first:pt-0">
      <span className="text-xs font-medium text-text-muted">{label}</span>
      <span className="text-sm text-text-primary">{children}</span>
    </div>
  );
}

export default function AppointmentDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: appt, isLoading, error } = useAppointment(id);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-surface-muted">
        <PageHeader title="Appointment" backTo="/calendar" />
        <p className="p-4 text-text-muted">Loading…</p>
      </div>
    );
  }
  if (error || !appt) {
    return (
      <div className="min-h-screen bg-surface-muted">
        <PageHeader title="Appointment" backTo="/calendar" />
        <p className="p-4 text-danger">{error?.message ?? 'Appointment not found.'}</p>
      </div>
    );
  }

  const isInstall = appt.kind === 'installation';
  const status = STATUS_LABEL[appt.status];
  const customer = appt.customer;
  const fullName = customer
    ? `${customer.first_name} ${customer.last_name}`.trim()
    : 'Customer';
  const address = customer ? shippingAddress(customer) : '';

  return (
    <div className="min-h-screen bg-surface-muted pb-16">
      <PageHeader
        title={isInstall ? 'Installation' : 'Estimate appointment'}
        backTo="/calendar"
        right={
          <span className={`text-[13px] font-semibold ${status?.cls ?? 'text-text-muted'}`}>
            {status?.text ?? appt.status}
          </span>
        }
      />

      <div className="mx-auto flex max-w-lg flex-col gap-4 p-4 lg:p-8">
        {/* Visit */}
        <section className="flex flex-col gap-1 rounded-sm border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-text-primary">Visit</h2>
          <p className="text-sm text-text-secondary">
            {whenLabel(appt.appointment_date, appt.appointment_time)}
          </p>
          <p className="text-[13px] text-text-muted">
            {isInstall
              ? 'Installation visit — tied to a ready order.'
              : 'Free in-home estimate visit.'}
          </p>
        </section>

        {/* Customer */}
        <section className="flex flex-col rounded-sm border border-border bg-surface p-4">
          <h2 className="mb-2 text-sm font-semibold text-text-primary">Customer</h2>
          <InfoRow label="Name">{fullName}</InfoRow>
          <InfoRow label="Email">
            {customer?.email ? (
              <a className="text-brand-600 hover:underline" href={`mailto:${customer.email}`}>
                {customer.email}
              </a>
            ) : (
              <span className="text-text-muted">—</span>
            )}
          </InfoRow>
          <InfoRow label="Phone">
            {customer?.phone ? (
              <a className="text-brand-600 hover:underline" href={`tel:${customer.phone}`}>
                {customer.phone}
              </a>
            ) : (
              <span className="text-text-muted">—</span>
            )}
          </InfoRow>
          <InfoRow label="Address">
            {address ? (
              <a
                href={mapsUrl(address)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-brand-600 hover:underline"
              >
                {address}
                <span aria-hidden="true">↗</span>
              </a>
            ) : (
              <span className="text-text-muted">No address on file</span>
            )}
          </InfoRow>
          {customer && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                to={`/customers/${customer.id}`}
                className="h-9 rounded-sm border border-border-input bg-surface px-3 text-[13px] font-medium leading-9 text-text-secondary hover:bg-surface-muted"
              >
                View customer
              </Link>
              {address && (
                <a
                  href={mapsUrl(address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="h-9 rounded-sm border border-border-input bg-surface px-3 text-[13px] font-medium leading-9 text-text-secondary hover:bg-surface-muted"
                >
                  Open in Google Maps
                </a>
              )}
            </div>
          )}
        </section>

        {/* Order (installations only) */}
        {isInstall && appt.order && (
          <section className="flex flex-col gap-2 rounded-sm border border-border bg-surface p-4">
            <h2 className="text-sm font-semibold text-text-primary">Order</h2>
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm text-text-primary">{appt.order.order_number}</span>
              <span className="text-[13px] text-text-muted capitalize">{appt.order.status}</span>
            </div>
            <Link
              to={`/orders/${appt.order.id}`}
              className="h-9 rounded-sm border border-border-input bg-surface px-3 text-center text-[13px] font-medium leading-9 text-text-secondary hover:bg-surface-muted"
            >
              View order
            </Link>
          </section>
        )}
      </div>
    </div>
  );
}
