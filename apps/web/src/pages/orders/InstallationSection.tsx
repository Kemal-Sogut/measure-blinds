// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * InstallationSection — the Installation panel + propose/change sheet
 * on the order page, backed by the standalone appointments API (the
 * schedule itself lives in the `appointments` table, one row per
 * order).
 *
 * Rendered for ready/installed orders only. Shows the scheduled
 * one-hour window and the customer's response status, and (on ready
 * orders) offers:
 *   Change time     — re-opens the sheet prefilled; re-emails the
 *                     proposal on the SAME public link
 *   Mark Confirmed  — staff-side confirm for when the customer agreed
 *                     by phone/text/in person (no email is sent)
 *   Delete time     — removes the appointment entirely
 *
 * The sheet is also the CREATION path: the "Propose Installation"
 * action on a ready order opens it (`sheetOpen` is lifted to
 * OrderDetail so the actions panel can open it too), and submitting
 * emails the customer then books the visit.
 */

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import DatePicker from '../../components/DatePicker';
import {
  useOrderAppointment,
  useCreateAppointment,
  useReproposeAppointment,
  useConfirmAppointment,
  useDeleteAppointment,
} from '../../hooks/useCalendar';
import type { OrderStatus } from '../../types';

/** Formats a Date as the API's YYYY-MM-DD. */
function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Parses YYYY-MM-DD as a local Date (no UTC shift). */
function fromIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Formats "HH:MM" (24h) as "2:00 PM". */
function to12Hour(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const hour12 = ((h + 11) % 12) + 1;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

/** "HH:MM:SS" or "HH:MM" → the one-hour window "2:00 PM – 3:00 PM". */
function installWindowText(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const end = `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return `${to12Hour(`${h}:${m}`)} – ${to12Hour(end)}`;
}

const RESPONSE_LABEL: Record<string, { text: string; cls: string }> = {
  proposed: { text: 'Awaiting customer', cls: 'text-warning' },
  confirmed: { text: 'Confirmed', cls: 'text-success' },
  change_requested: { text: 'Change requested', cls: 'text-danger' },
};

export default function InstallationSection({
  orderId,
  orderStatus,
  customerEmail,
  sheetOpen,
  onOpenSheet,
  onCloseSheet,
}: {
  orderId: string;
  orderStatus: OrderStatus;
  customerEmail: string | null | undefined;
  /** Lifted so OrderDetail's actions panel can open the sheet too. */
  sheetOpen: boolean;
  onOpenSheet: () => void;
  onCloseSheet: () => void;
}) {
  const apptQ = useOrderAppointment(orderId);
  const appt = apptQ.data ?? null;
  const createMut = useCreateAppointment();
  const reproposeMut = useReproposeAppointment();
  const confirmMut = useConfirmAppointment();
  const deleteMut = useDeleteAppointment();

  // Sheet form state — prefilled from the existing schedule on open.
  const [date, setDate] = useState<Date>(new Date());
  const [time, setTime] = useState('09:00');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!sheetOpen) return;
    if (appt) {
      setDate(fromIso(appt.appointment_date));
      setTime(appt.appointment_time.slice(0, 5));
    }
    setMessage('');
    // `appt` is intentionally sampled only when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetOpen]);

  const submitting = createMut.isPending || reproposeMut.isPending;

  /** Emails the (re-)proposal, then books/updates the visit. */
  async function submit() {
    try {
      const input = {
        appointment_date: toIso(date),
        appointment_time: time,
        message: message.trim() || undefined,
      };
      if (appt) {
        await reproposeMut.mutateAsync({ id: appt.id, input });
      } else {
        await createMut.mutateAsync({ kind: 'installation', order_id: orderId, ...input });
      }
      toast.success(`Installation time emailed to ${customerEmail ?? 'the customer'}.`);
      onCloseSheet();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not propose the installation.');
    }
  }

  /** Staff confirm — the customer agreed through another channel. */
  async function handleConfirmTime() {
    if (!appt) return;
    try {
      await confirmMut.mutateAsync(appt.id);
      toast.success('Installation time confirmed.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not confirm the time.');
    }
  }

  async function handleDelete() {
    if (!appt) return;
    if (!window.confirm('Remove the set installation time?')) return;
    try {
      await deleteMut.mutateAsync(appt.id);
      toast.success('Installation time removed.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not remove the time.');
    }
  }

  if (orderStatus !== 'ready' && orderStatus !== 'installed') return null;

  const response = appt ? RESPONSE_LABEL[appt.status] : undefined;
  const smallBtn =
    'h-10 flex-1 rounded-sm border border-border-input bg-surface text-[13px] font-medium disabled:opacity-40';

  const panel = (
    <section className="flex flex-col gap-2 rounded-sm border border-border bg-surface p-4">
      <h2 className="mb-1 text-sm font-semibold text-text-primary">Installation</h2>
      {!appt && (
        <>
          <p className="text-[13px] text-text-muted">
            {orderStatus === 'ready'
              ? 'No installation scheduled yet.'
              : 'No installation time was recorded.'}
          </p>
          {orderStatus === 'ready' && (
            <button
              onClick={onOpenSheet}
              className="mt-1 h-10 rounded-sm border border-border-input bg-surface text-[13px] font-medium text-brand-600 hover:bg-surface-muted"
            >
              Propose Installation
            </button>
          )}
        </>
      )}
      {appt && (
        <>
          <div className="flex justify-between gap-2">
            <span className="text-[13px] text-text-secondary">Scheduled time</span>
            <span className="text-right font-mono text-[13px] text-text-primary">
              {appt.appointment_date} · {installWindowText(appt.appointment_time)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[13px] text-text-secondary">Status</span>
            <span className={`text-[13px] font-semibold ${response?.cls ?? ''}`}>
              {response?.text ?? appt.status}
            </span>
          </div>
          {appt.status === 'change_requested' && appt.response_note && (
            <p className="rounded-sm bg-surface-sunken p-2 text-[13px] text-text-secondary">
              &ldquo;{appt.response_note}&rdquo;
            </p>
          )}
          {orderStatus === 'ready' && (
            <div className="mt-1 flex gap-2">
              {appt.status !== 'confirmed' && (
                <button
                  onClick={handleConfirmTime}
                  disabled={confirmMut.isPending}
                  className={`${smallBtn} text-success`}
                >
                  {confirmMut.isPending ? 'Confirming…' : 'Mark Confirmed'}
                </button>
              )}
              <button onClick={onOpenSheet} disabled={submitting} className={`${smallBtn} text-text-secondary`}>
                Change time
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteMut.isPending}
                className={`${smallBtn} text-danger`}
              >
                {deleteMut.isPending ? 'Removing…' : 'Delete time'}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );

  const sheet = sheetOpen && (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 lg:items-center"
      onClick={onCloseSheet}
      role="dialog"
      aria-label="Propose installation time"
    >
      <div
        className="w-full rounded-t-sm bg-surface p-4 lg:max-w-md lg:rounded-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-sm font-semibold text-text-primary">
          {appt ? 'Change installation time' : 'Propose installation time'}
        </h2>
        <p className="mb-3 text-[13px] text-text-muted">
          We&apos;ll email {customerEmail ?? 'the customer'} a one-hour arrival window and a link
          to confirm or request another time.
        </p>
        <div className="flex flex-col gap-3">
          <DatePicker label="Installation date" value={date} onChange={(d) => d && setDate(d)} />
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-text-secondary">
              Arrival time (start of the 1-hour window)
            </span>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="h-11 w-full rounded-sm border border-border-input bg-surface px-3 font-mono text-sm"
            />
          </label>
          <p className="text-[13px] text-text-secondary">
            Customer will see: <span className="font-medium">between {installWindowText(time)}</span> on{' '}
            {format(date, 'EEEE, MMMM d, yyyy')}.
          </p>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-text-secondary">
              Message to include (optional)
            </span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={1000}
              rows={3}
              placeholder="e.g. Please clear the window areas before we arrive. Call if the time doesn't work."
              className="w-full rounded-sm border border-border-input bg-surface px-3 py-2 text-sm"
            />
          </label>
          <div className="mt-1 flex gap-2">
            <button
              onClick={onCloseSheet}
              className="h-11 flex-1 rounded-sm border border-border-input bg-surface text-[13px] font-medium text-text-secondary"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={submitting}
              className="h-11 flex-[2] rounded-sm bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
            >
              {submitting ? 'Sending…' : 'Send Proposal'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {panel}
      {sheet}
    </>
  );
}
