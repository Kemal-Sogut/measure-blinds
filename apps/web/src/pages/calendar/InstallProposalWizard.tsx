// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * InstallProposalWizard — strict 3-step, one-selection-per-step flow
 * for creating an installation proposal directly from the Calendar
 * (plan §5):
 *   1. Day    — a `DatePicker`, preselected from the tapped grid cell.
 *   2. Time   — one 30-minute slot, 08:00–18:00 (plan §9.2, LOCKED).
 *   3. Order  — one `ready` order, reusing `useOrderList('ready', '')`
 *               rather than a redundant query hook (plan §10).
 *
 * Submits through the existing `useProposeInstallation` mutation —
 * the SAME emailing endpoint (`POST /:id/install/propose`) used from
 * `OrderDetail.tsx`. There is no "quiet" calendar-only path (plan §9.1,
 * LOCKED): creating a proposal here emails the customer exactly as it
 * does from the order detail page.
 *
 * Presentation mirrors `DatePicker.tsx`'s overlay pattern: a bottom
 * sheet on mobile, a centered dialog on `sm:` and up.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import DatePicker from '../../components/DatePicker';
import { useOrderList, useProposeInstallation } from '../../hooks/useOrders';
import type { Order } from '../../types';

/** Builds "08:00".."17:30" in 30-minute increments (plan §9.2, LOCKED). */
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

/** One-hour derived arrival window label for the helper text. */
function windowLabel(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const end = `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return `${to12Hour(time)} – ${to12Hour(end)}`;
}

type Step = 1 | 2 | 3;

export default function InstallProposalWizard({
  initialDay,
  onClose,
}: {
  /** Day pre-selected from the calendar cell that opened the wizard. */
  initialDay: Date;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>(1);
  const [day, setDay] = useState<Date>(initialDay);
  const [time, setTime] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);

  const readyOrdersQ = useOrderList('ready', '');
  const proposeMut = useProposeInstallation();
  const qc = useQueryClient();
  const navigate = useNavigate();

  // Re-sync the preselected day if the wizard is re-opened for a
  // different cell without fully unmounting (defensive; CalendarPage
  // currently keys/unmounts per-open, but this keeps the component safe).
  useEffect(() => setDay(initialDay), [initialDay]);

  const selectedOrder: Order | undefined = readyOrdersQ.data?.find((o) => o.id === orderId);

  function next() {
    setStep((s) => (s < 3 ? ((s + 1) as Step) : s));
  }
  function back() {
    setStep((s) => (s > 1 ? ((s - 1) as Step) : s));
  }

  async function submit() {
    if (!time || !orderId) return;
    const install_date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    try {
      await proposeMut.mutateAsync({ id: orderId, input: { install_date, install_time: time } });
      toast.success('Installation proposed — customer emailed');
      void qc.invalidateQueries({ queryKey: ['orders', 'calendar'] });
      void qc.invalidateQueries({ queryKey: ['orders', 'list'] });
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not propose the installation.');
    }
  }

  const stepValid = step === 1 ? Boolean(day) : step === 2 ? Boolean(time) : Boolean(orderId);

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={onClose}
      role="dialog"
      aria-label="Propose installation time"
    >
      <div
        className="max-h-[85vh] w-full overflow-y-auto rounded-t-sm bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:max-w-md sm:rounded-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-primary">
            Propose installation — Step {step} of 3
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
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className={`h-1 flex-1 rounded-full ${n <= step ? 'bg-brand-600' : 'bg-surface-sunken'}`}
            />
          ))}
        </div>

        {step === 1 && (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-text-muted">Pick the installation day.</p>
            <DatePicker label="Day" value={day} onChange={setDay} />
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-text-muted">
              Pick the arrival start time (30-minute slots, 8 AM – 6 PM). The customer sees the
              derived one-hour arrival window.
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

        {step === 3 && (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-text-muted">Pick one ready order to propose to.</p>
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
          {step > 1 && (
            <button
              type="button"
              onClick={back}
              className="h-11 flex-1 rounded-sm border border-border-input bg-surface text-[13px] font-medium text-text-secondary"
            >
              Back
            </button>
          )}
          {step < 3 ? (
            <button
              type="button"
              onClick={next}
              disabled={!stepValid}
              className="h-11 flex-[2] rounded-sm bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!stepValid || proposeMut.isPending}
              className="h-11 flex-[2] rounded-sm bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
            >
              {proposeMut.isPending ? 'Sending…' : 'Propose'}
            </button>
          )}
        </div>

        {selectedOrder && step === 3 && (
          <button
            type="button"
            onClick={() => navigate(`/orders/${selectedOrder.id}`)}
            className="mt-2 w-full text-center text-[12px] text-text-muted underline"
          >
            View order details first
          </button>
        )}
      </div>
    </div>
  );
}
