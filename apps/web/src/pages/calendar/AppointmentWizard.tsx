// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * AppointmentWizard — the single booking flow for BOTH kinds of home
 * visit, opened from the Calendar's "+ New Appointment" button or a
 * day tap:
 *   1. Kind   — Estimate visit or Installation.
 *   2. Day    — a `DatePicker`, preselected from the tapped grid cell.
 *   3. Time   — one 30-minute slot, 08:00–18:00.
 *   4. Target — Estimate: one CUSTOMER (never an order — estimate
 *               visits are customer-only by design). Installation: one
 *               `ready` order (its customer is derived server-side).
 *
 * When `repropose` is provided (the "Change" action in the section
 * lists), the kind/target steps are skipped and the wizard submits a
 * new time for that same appointment through `POST /:id/propose` —
 * the customer keeps the same public link.
 *
 * Every submit EMAILS the customer a proposal with a confirm /
 * request-another-time link; there is no quiet calendar-only path.
 */

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import DatePicker from '../../components/DatePicker';
import CustomerCreateModal from '../../components/CustomerCreateModal';
import {
  useCreateAppointment,
  useReproposeAppointment,
} from '../../hooks/useCalendar';
import { useOrderList } from '../../hooks/useOrders';
import { useCustomerSearch } from '../../hooks/useCustomers';
import type { AppointmentKind, Customer } from '../../types';

/** Builds "08:00".."17:30" in 30-minute increments. */
function buildTimeSlots(): string[] {
  const slots: string[] = [];
  for (let h = 8; h < 18; h++) {
    slots.push(`${String(h).padStart(2, '0')}:00`);
    slots.push(`${String(h).padStart(2, '0')}:30`);
  }
  return slots;
}
const TIME_SLOTS = buildTimeSlots();

/** Formats "HH:MM" (24h) as a 12-hour label, e.g. "2:00 PM". */
function to12Hour(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const hour12 = ((h + 11) % 12) + 1;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

/** One-hour derived visit window label for the helper text. */
function windowLabel(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const end = `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return `${to12Hour(time)} – ${to12Hour(end)}`;
}

type StepId = 'kind' | 'day' | 'time' | 'target';

export default function AppointmentWizard({
  initialDay,
  repropose,
  onClose,
}: {
  /** Day pre-selected from the calendar cell / section row. */
  initialDay: Date;
  /** Re-propose a new time on this existing appointment. */
  repropose?: { id: string; kind: AppointmentKind; label: string; time?: string };
  onClose: () => void;
}) {
  const steps: StepId[] = repropose ? ['day', 'time'] : ['kind', 'day', 'time', 'target'];
  const [stepIdx, setStepIdx] = useState(0);
  const [kind, setKind] = useState<AppointmentKind | null>(repropose?.kind ?? null);
  const [day, setDay] = useState<Date>(initialDay);
  const [time, setTime] = useState<string | null>(repropose?.time ?? null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [term, setTerm] = useState('');
  const [addingCustomer, setAddingCustomer] = useState(false);

  const customersQ = useCustomerSearch(term);
  const readyOrdersQ = useOrderList('ready', '');
  const createMut = useCreateAppointment();
  const reproposeMut = useReproposeAppointment();
  const qc = useQueryClient();

  useEffect(() => setDay(initialDay), [initialDay]);

  const step = steps[stepIdx];
  const busy = createMut.isPending || reproposeMut.isPending;

  const stepValid =
    step === 'kind'
      ? Boolean(kind)
      : step === 'day'
        ? Boolean(day)
        : step === 'time'
          ? Boolean(time)
          : kind === 'estimate'
            ? Boolean(customer)
            : Boolean(orderId);

  async function submit() {
    if (!time) return;
    const appointment_date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    try {
      if (repropose) {
        await reproposeMut.mutateAsync({
          id: repropose.id,
          input: { appointment_date, appointment_time: time },
        });
      } else if (kind === 'estimate') {
        if (!customer) return;
        await createMut.mutateAsync({
          kind: 'estimate',
          customer_id: customer.id,
          appointment_date,
          appointment_time: time,
        });
      } else {
        if (!orderId) return;
        await createMut.mutateAsync({
          kind: 'installation',
          order_id: orderId,
          appointment_date,
          appointment_time: time,
        });
      }
      toast.success(
        `${kind === 'installation' ? 'Installation' : 'Estimate appointment'} proposed — customer emailed`
      );
      void qc.invalidateQueries({ queryKey: ['orders', 'list'] });
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not propose the appointment.');
    }
  }

  const title = repropose
    ? `Change time — ${repropose.label}`
    : 'New appointment';

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={onClose}
      role="dialog"
      aria-label={title}
    >
      <div
        className="max-h-[85vh] w-full overflow-y-auto rounded-t-sm bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:max-w-md sm:rounded-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-primary">
            {title} — Step {stepIdx + 1} of {steps.length}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-sm text-text-muted hover:bg-surface-muted"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Step indicator */}
        <div className="mb-4 flex gap-1.5">
          {steps.map((s, i) => (
            <div
              key={s}
              className={`h-1 flex-1 rounded-full ${i <= stepIdx ? 'bg-brand-600' : 'bg-surface-sunken'}`}
            />
          ))}
        </div>

        {step === 'kind' && (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-text-muted">What kind of visit is this?</p>
            {(
              [
                {
                  value: 'estimate' as const,
                  title: 'Estimate appointment',
                  body: 'Free in-home visit to measure and quote — booked for a customer, no order involved.',
                },
                {
                  value: 'installation' as const,
                  title: 'Installation',
                  body: 'Install a ready order — the email references the order number.',
                },
              ]
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setKind(opt.value)}
                className={`rounded-sm border p-3 text-left ${
                  kind === opt.value
                    ? 'border-brand-600 bg-brand-100'
                    : 'border-border-input bg-surface hover:bg-surface-muted'
                }`}
              >
                <span className="block text-sm font-semibold text-text-primary">{opt.title}</span>
                <span className="mt-0.5 block text-[13px] text-text-secondary">{opt.body}</span>
              </button>
            ))}
          </div>
        )}

        {step === 'day' && (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-text-muted">Pick the day of the visit.</p>
            <DatePicker label="Day" value={day} onChange={setDay} />
          </div>
        )}

        {step === 'time' && (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-text-muted">
              Pick the arrival start time (30-minute slots, 8 AM – 6 PM). The customer sees the
              derived one-hour visit window.
            </p>
            <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto">
              {TIME_SLOTS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTime(t)}
                  className={`h-11 rounded-sm border text-[13px] font-medium ${
                    time === t
                      ? 'border-brand-600 bg-brand-100 text-brand-600'
                      : 'border-border-input bg-surface text-text-secondary hover:bg-surface-muted'
                  }`}
                >
                  {to12Hour(t)}
                </button>
              ))}
            </div>
            {time && (
              <p className="text-[13px] text-text-secondary">
                Customer will see: <span className="font-medium">{windowLabel(time)}</span> on{' '}
                {format(day, 'EEEE, MMMM d, yyyy')}.
              </p>
            )}
          </div>
        )}

        {step === 'target' && kind === 'estimate' && (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-text-muted">Pick the customer to visit.</p>
            <div className="flex gap-2">
              <input
                type="search"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="Search customers…"
                className="h-11 min-w-0 flex-1 rounded-sm border border-border-input bg-surface px-3 text-sm"
              />
              <button
                type="button"
                onClick={() => setAddingCustomer(true)}
                className="h-11 shrink-0 rounded-sm border border-border-input bg-surface px-3 text-[13px] font-medium text-brand-600 hover:bg-surface-muted"
              >
                + Add customer
              </button>
            </div>
            {customersQ.isLoading && <p className="text-[13px] text-text-muted">Loading…</p>}
            {customersQ.data && customersQ.data.length === 0 && (
              <p className="text-[13px] text-text-muted">
                No customers found — use “+ Add customer” to create one.
              </p>
            )}
            <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
              {(customersQ.data ?? []).map((cust) => {
                const hasEmail = Boolean(cust.email);
                return (
                  <button
                    key={cust.id}
                    type="button"
                    disabled={!hasEmail}
                    onClick={() => setCustomer(cust)}
                    title={hasEmail ? undefined : 'This customer has no email address.'}
                    className={`rounded-sm border p-3 text-left disabled:opacity-40 ${
                      customer?.id === cust.id
                        ? 'border-brand-600 bg-brand-100'
                        : 'border-border-input bg-surface hover:bg-surface-muted'
                    }`}
                  >
                    <span className="block text-sm font-semibold text-text-primary">
                      {cust.first_name} {cust.last_name}
                    </span>
                    <span className="mt-0.5 block text-[13px] text-text-secondary">
                      {hasEmail ? cust.email : 'No email — cannot be emailed a proposal'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {step === 'target' && kind === 'installation' && (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-text-muted">Pick one ready order to install.</p>
            {readyOrdersQ.isLoading && <p className="text-[13px] text-text-muted">Loading…</p>}
            {readyOrdersQ.data && readyOrdersQ.data.length === 0 && (
              <p className="text-[13px] text-text-muted">
                No orders are currently in Ready status.
              </p>
            )}
            <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
              {(readyOrdersQ.data ?? []).map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setOrderId(o.id)}
                  className={`rounded-sm border p-3 text-left ${
                    orderId === o.id
                      ? 'border-brand-600 bg-brand-100'
                      : 'border-border-input bg-surface hover:bg-surface-muted'
                  }`}
                >
                  <span className="flex items-center justify-between">
                    <span className="font-mono text-sm font-semibold text-text-primary">
                      {o.order_number}
                    </span>
                    <span className="font-mono text-sm font-semibold text-text-primary">
                      ${Number(o.total).toFixed(2)}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[13px] text-text-secondary">
                    {o.customer ? `${o.customer.first_name} ${o.customer.last_name}` : '—'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 flex gap-2">
          {stepIdx > 0 && (
            <button
              type="button"
              onClick={() => setStepIdx((i) => i - 1)}
              className="h-11 flex-1 rounded-sm border border-border-input bg-surface text-[13px] font-medium text-text-secondary"
            >
              Back
            </button>
          )}
          {stepIdx < steps.length - 1 ? (
            <button
              type="button"
              onClick={() => setStepIdx((i) => i + 1)}
              disabled={!stepValid}
              className="h-11 flex-[2] rounded-sm bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!stepValid || busy}
              className="h-11 flex-[2] rounded-sm bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
            >
              {busy ? 'Sending…' : 'Propose'}
            </button>
          )}
        </div>

        {/* Quick add-customer pop-up; the new customer is auto-selected. */}
        {addingCustomer && (
          <CustomerCreateModal
            requireEmail
            onClose={() => setAddingCustomer(false)}
            onCreated={(created) => {
              setCustomer(created);
              setTerm(`${created.first_name} ${created.last_name}`);
              setAddingCustomer(false);
            }}
          />
        )}
      </div>
    </div>
  );
}
