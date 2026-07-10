// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Public appointment view — token-gated, NO authentication.
 *
 * Fetches `/public/appointment/:token` with a plain fetch and lets the
 * customer respond to a home visit of either kind (estimate visit or
 * installation):
 *   proposed          → confirm the window, or request another time
 *                       (installations only — estimate visits are
 *                       booked as confirmed, no approval step)
 *   confirmed         → "see you then" card, with the option to
 *                       request another time
 *   change_requested  → "request received" message
 *   not found         → generic error
 *
 * Installation visits show the order number; estimate visits are
 * customer-only and never reference an order.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787';

/** Public appointment payload rendered by this page. */
interface PublicAppointment {
  kind: 'estimate' | 'installation';
  status: 'proposed' | 'confirmed' | 'change_requested';
  appointment_date: string;
  appointment_time: string;
  /** Installations only — null for estimate visits. */
  order_number: string | null;
  customer_first_name: string;
  company: {
    company_name: string;
    logo_url: string | null;
    email: string;
    phone: string;
  } | null;
}

/** Formats "HH:MM[:SS]" (24h) as a 12-hour clock string, e.g. "2:00 PM". */
function to12Hour(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const hour12 = ((h + 11) % 12) + 1;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

/**
 * Human phrase for the proposed visit window, e.g.
 * "between 2:00 PM and 3:00 PM on Friday, August 7, 2026".
 */
function visitWindow(dateIso: string, time: string): string {
  const [h, m] = time.split(':').map(Number);
  const end = `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const [y, mo, d] = dateIso.split('-').map(Number);
  const dateText = new Date(y, mo - 1, d).toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  return `between ${to12Hour(time)} and ${to12Hour(end)} on ${dateText}`;
}

/** Centered message card used by the terminal states. */
function Message({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-muted px-4">
      <div className="w-full max-w-md rounded-2xl bg-surface-elevated p-8 text-center shadow-md">
        <div className="mb-3 text-4xl">{icon}</div>
        <h1 className="mb-2 text-xl font-semibold text-text-primary">{title}</h1>
        <p className="text-text-secondary">{body}</p>
      </div>
    </div>
  );
}

export default function AppointmentView() {
  const { token } = useParams<{ token: string }>();
  const [appt, setAppt] = useState<PublicAppointment | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [note, setNote] = useState('');

  // Load the public appointment once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/public/appointment/${token}`);
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) setLoadError((body as { error?: string })?.error ?? 'Appointment not found.');
        else setAppt((body as { data: PublicAppointment }).data);
      } catch {
        if (!cancelled) setLoadError('Could not load the appointment. Please try again.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  /** Customer confirms the proposed visit window. */
  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/public/appointment/${token}/confirm`, {
        method: 'POST',
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (res.ok) setAppt((a) => (a ? { ...a, status: 'confirmed' } : a));
      else setError(body?.error ?? 'Could not confirm. Please try again.');
    } catch {
      setError('Network problem — please try again.');
    } finally {
      setBusy(false);
    }
  }

  /** Customer requests a different visit time (optional note). */
  async function handleRequest() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/public/appointment/${token}/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (res.ok) setAppt((a) => (a ? { ...a, status: 'change_requested' } : a));
      else setError(body?.error ?? 'Could not send your request. Please try again.');
    } catch {
      setError('Network problem — please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (loadError) return <Message icon="🔍" title="Appointment not found" body={loadError} />;
  if (!appt) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-muted">
        <p className="text-text-muted">Loading your appointment…</p>
      </div>
    );
  }

  const isInstall = appt.kind === 'installation';
  const isConfirmed = appt.status === 'confirmed';
  const kindTitle = isConfirmed
    ? isInstall
      ? 'Installation time confirmed'
      : 'Appointment confirmed'
    : isInstall
      ? 'Installation Time'
      : 'Your Estimate Appointment';
  const windowText = visitWindow(appt.appointment_date, appt.appointment_time);

  if (appt.status === 'change_requested') {
    return (
      <Message
        icon="🕑"
        title="Request received"
        body="Thanks — we've received your request for a different time and will be in touch to arrange it."
      />
    );
  }

  // proposed → confirm or request another time;
  // confirmed → "see you then" plus request another time.
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-muted px-4 py-8">
      <div className="w-full max-w-md rounded-2xl bg-surface-elevated p-8 text-center shadow-md">
        {appt.company?.logo_url && (
          <img
            src={appt.company.logo_url}
            alt={appt.company.company_name || ''}
            className="mx-auto mb-3 h-12 w-12 rounded-lg object-contain"
          />
        )}
        <div className="mb-3 text-4xl">🗓️</div>
        <h1 className="mb-2 text-xl font-semibold text-text-primary">{kindTitle}</h1>
        <p className="mb-2 text-text-secondary">
          {isConfirmed
            ? `Thanks! We'll see you ${windowText}.`
            : isInstall
              ? `We will be there ${windowText} to install your blinds, if that works for you.`
              : `We will visit ${windowText} for your free in-home estimate, if that works for you.`}
        </p>
        {isInstall && appt.order_number && (
          <p className="mb-6 text-sm text-text-muted">
            Order <span className="font-mono">{appt.order_number}</span>
          </p>
        )}
        {!isInstall && <div className="mb-4" />}

        {error && <p className="mb-3 text-sm text-danger">{error}</p>}

        {!requesting ? (
          <div className="flex flex-col gap-2.5">
            {!isConfirmed && (
              <button
                onClick={handleConfirm}
                disabled={busy}
                className="h-12 w-full rounded-xl bg-brand-600 text-base font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {busy ? 'Confirming…' : 'Confirm this time'}
              </button>
            )}
            <button
              onClick={() => setRequesting(true)}
              disabled={busy}
              className="h-11 w-full rounded-xl border border-border bg-surface text-sm font-medium text-text-secondary disabled:opacity-50"
            >
              Request another time
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5 text-left">
            <label className="text-sm font-medium text-text-secondary" htmlFor="note">
              What time would suit you better?
            </label>
            <textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="e.g. Any weekday morning, or after 3pm on Fridays"
              className="w-full rounded-xl border border-border bg-surface p-3 text-sm"
            />
            <button
              onClick={handleRequest}
              disabled={busy}
              className="h-12 w-full rounded-xl bg-brand-600 text-base font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {busy ? 'Sending…' : 'Send request'}
            </button>
            <button
              onClick={() => setRequesting(false)}
              disabled={busy}
              className="h-10 w-full text-sm font-medium text-text-muted disabled:opacity-50"
            >
              Back
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
