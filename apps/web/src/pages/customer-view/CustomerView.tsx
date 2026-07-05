// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Public customer estimate view — token-gated, NO authentication.
 *
 * Fetches `/public/estimate/:token` with a plain fetch (no Supabase
 * session exists here) and renders one of four states:
 *   expired    → "contact us for a new quote" message
 *   confirmed  → "already confirmed" message (or the fresh
 *                post-confirmation screen with deposit instructions)
 *   sent       → full estimate (same layout as the PDF: company
 *                header, meta, line items with indented attributes,
 *                totals with HST#, terms) + big Confirm button
 *   not found  → generic error
 *
 * The confirm POST is rate-limited server-side and succeeds exactly
 * once; a 409 flips the UI into the already-confirmed state.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import PaymentSection from '../../components/PaymentSection';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787';

/** Public line item shape returned by the Worker. */
interface PublicLineItem {
  item_type: string;
  room_name: string | null;
  blinds_type: string | null;
  panels: number[] | null;
  height_cm: number | null;
  fabric_name: string | null;
  cassette_name: string | null;
  control_name: string | null;
  description: string | null;
  note: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
}

/** Full public estimate payload rendered by this page. */
interface PublicEstimate {
  status: string;
  order_number: string;
  order_date: string;
  expiry_date: string;
  subtotal: number;
  discount_amount: number;
  taxable_amount: number;
  tax_amount: number;
  total: number;
  terms: string;
  install_status: 'unscheduled' | 'proposed' | 'confirmed' | 'change_requested';
  install_date: string | null;
  install_time: string | null;
  customer: {
    first_name: string;
    last_name: string;
    shipping_address_line1: string;
    shipping_address_line2: string;
    shipping_city: string;
    shipping_province: string;
    shipping_postal_code: string;
  };
  company: {
    company_name: string;
    logo_url: string | null;
    email: string;
    phone: string;
    address: string;
    hst_number: string;
  } | null;
  line_items: PublicLineItem[];
}

/** Title + attribute lines for one item (mirrors the PDF layout). */
function itemContent(li: PublicLineItem): { title: string; attrs: string[] } {
  if (li.item_type === 'blind') {
    return {
      title: [li.room_name || 'Blind', li.blinds_type].filter(Boolean).join(' — '),
      attrs: [
        li.panels?.length
          ? `Panels: ${li.panels.join(' + ')} cm × H ${li.height_cm} cm`
          : '',
        li.fabric_name ? `Fabric: ${li.fabric_name}` : '',
        li.cassette_name ? `Cassette: ${li.cassette_name}` : '',
        li.control_name ? `Control: ${li.control_name}` : '',
        li.note?.trim() ? `Note: ${li.note.trim()}` : '',
      ].filter(Boolean),
    };
  }
  return { title: li.description || 'Item', attrs: [] };
}

/** Formats "HH:MM[:SS]" (24h) as a 12-hour clock string, e.g. "2:00 PM". */
function to12Hour(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const hour12 = ((h + 11) % 12) + 1;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

/**
 * Human phrase for the proposed installation window, e.g.
 * "between 2:00 PM and 3:00 PM on Friday, August 7, 2026".
 */
function installWindow(dateIso: string, time: string): string {
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

export default function CustomerView() {
  const { token } = useParams<{ token: string }>();
  const [estimate, setEstimate] = useState<PublicEstimate | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [justConfirmed, setJustConfirmed] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  // Installation-time proposal response state.
  const [installBusy, setInstallBusy] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [requestNote, setRequestNote] = useState('');

  // Load the public estimate once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/public/estimate/${token}`);
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) setLoadError((body as { error?: string })?.error ?? 'Estimate not found.');
        else setEstimate((body as { data: PublicEstimate }).data);
      } catch {
        if (!cancelled) setLoadError('Could not load the estimate. Please try again.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  /** POSTs the one-shot confirm; 409 flips to already-confirmed. */
  async function handleConfirm() {
    setConfirming(true);
    setConfirmError(null);
    try {
      const res = await fetch(`${API_URL}/public/estimate/${token}/confirm`, { method: 'POST' });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (res.ok) {
        setJustConfirmed(true);
        setEstimate((e) => (e ? { ...e, status: 'awaiting_payment' } : e));
      } else if (res.status === 409) {
        setEstimate((e) => (e ? { ...e, status: 'awaiting_payment' } : e));
      } else {
        setConfirmError(body?.error ?? 'Confirmation failed. Please try again.');
      }
    } catch {
      setConfirmError('Network problem — please try again.');
    } finally {
      setConfirming(false);
    }
  }

  /** Customer confirms the proposed installation window. */
  async function handleInstallConfirm() {
    setInstallBusy(true);
    setInstallError(null);
    try {
      const res = await fetch(`${API_URL}/public/estimate/${token}/install/confirm`, {
        method: 'POST',
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (res.ok) setEstimate((e) => (e ? { ...e, install_status: 'confirmed' } : e));
      else setInstallError(body?.error ?? 'Could not confirm. Please try again.');
    } catch {
      setInstallError('Network problem — please try again.');
    } finally {
      setInstallBusy(false);
    }
  }

  /** Customer requests a different installation time (optional note). */
  async function handleInstallRequest() {
    setInstallBusy(true);
    setInstallError(null);
    try {
      const res = await fetch(`${API_URL}/public/estimate/${token}/install/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: requestNote }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (res.ok) setEstimate((e) => (e ? { ...e, install_status: 'change_requested' } : e));
      else setInstallError(body?.error ?? 'Could not send your request. Please try again.');
    } catch {
      setInstallError('Network problem — please try again.');
    } finally {
      setInstallBusy(false);
    }
  }

  if (loadError) return <Message icon="🔍" title="Estimate not found" body={loadError} />;
  if (!estimate) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-muted">
        <p className="text-text-muted">Loading your estimate…</p>
      </div>
    );
  }

  if (estimate.status === 'expired') {
    return (
      <Message
        icon="⏳"
        title="This estimate has expired"
        body="Please contact us for a new quote — we'd be happy to help."
      />
    );
  }

  // Post-confirmation screen (fresh confirm) with deposit instructions.
  if (justConfirmed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-muted px-4 py-8">
        <div className="w-full max-w-md rounded-2xl bg-surface-elevated p-8 text-center shadow-md">
          <div className="mb-3 text-4xl">✅</div>
          <h1 className="mb-2 text-xl font-semibold text-text-primary">Estimate Confirmed!</h1>
          <p className="mb-6 text-text-secondary">
            Thank you — we&apos;ve been notified and will be in touch shortly.
          </p>
          <PaymentSection
            depositAmount={estimate.total / 2}
            payToEmail="blindsnisa@gmail.com"
          />
        </div>
      </div>
    );
  }

  // Installation-time proposal flow (order is ready and a time was
  // proposed). Takes precedence over the generic "already confirmed"
  // screen since the order is no longer in 'sent'.
  if (estimate.install_status !== 'unscheduled') {
    const windowText =
      estimate.install_date && estimate.install_time
        ? installWindow(estimate.install_date, estimate.install_time)
        : null;

    if (estimate.install_status === 'confirmed') {
      return (
        <Message
          icon="🗓️"
          title="Installation time confirmed"
          body={
            windowText
              ? `Thanks! We'll see you ${windowText}.`
              : "Thanks! Your installation time is confirmed."
          }
        />
      );
    }
    if (estimate.install_status === 'change_requested') {
      return (
        <Message
          icon="🕑"
          title="Request received"
          body="Thanks — we've received your request for a different time and will be in touch to arrange it."
        />
      );
    }

    // install_status === 'proposed' → let the customer confirm or ask for another time.
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-muted px-4 py-8">
        <div className="w-full max-w-md rounded-2xl bg-surface-elevated p-8 text-center shadow-md">
          <div className="mb-3 text-4xl">🗓️</div>
          <h1 className="mb-2 text-xl font-semibold text-text-primary">Installation Time</h1>
          <p className="mb-6 text-text-secondary">
            {windowText
              ? `We will be there ${windowText} if that works for you.`
              : 'We have a proposed installation time for you.'}
          </p>

          {installError && <p className="mb-3 text-sm text-danger">{installError}</p>}

          {!requesting ? (
            <div className="flex flex-col gap-2.5">
              <button
                onClick={handleInstallConfirm}
                disabled={installBusy}
                className="h-12 w-full rounded-xl bg-brand-600 text-base font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {installBusy ? 'Confirming…' : 'Confirm this time'}
              </button>
              <button
                onClick={() => setRequesting(true)}
                disabled={installBusy}
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
                value={requestNote}
                onChange={(e) => setRequestNote(e.target.value)}
                rows={3}
                placeholder="e.g. Any weekday morning, or after 3pm on Fridays"
                className="w-full rounded-xl border border-border bg-surface p-3 text-sm"
              />
              <button
                onClick={handleInstallRequest}
                disabled={installBusy}
                className="h-12 w-full rounded-xl bg-brand-600 text-base font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {installBusy ? 'Sending…' : 'Send request'}
              </button>
              <button
                onClick={() => setRequesting(false)}
                disabled={installBusy}
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

  // Anything past 'sent' (awaiting_payment / in_progress / ready / installed)
  // with no active installation proposal has already been confirmed.
  if (estimate.status !== 'sent') {
    return (
      <Message
        icon="✅"
        title="You've already confirmed this estimate"
        body="We'll be in touch! If you have any questions, just reply to our email."
      />
    );
  }

  const c = estimate.company;
  const cust = estimate.customer;

  return (
    <div className="min-h-screen bg-surface-muted pb-28">
      <div className="mx-auto max-w-lg p-4">
        {/* Company header */}
        <header className="mb-4 flex items-center gap-3 rounded-2xl bg-surface-elevated p-4">
          {c?.logo_url && (
            <img src={c.logo_url} alt="" className="h-12 w-12 rounded-lg object-contain" />
          )}
          <div>
            <h1 className="text-lg font-bold text-text-primary">{c?.company_name || 'Estimate'}</h1>
            <p className="text-xs text-text-muted">
              {[c?.phone, c?.email].filter(Boolean).join(' · ')}
            </p>
          </div>
        </header>

        {/* Estimate meta */}
        <section className="mb-4 rounded-2xl bg-surface-elevated p-4 text-sm">
          <div className="flex justify-between">
            <span className="font-semibold text-text-primary">
              Estimate <span className="font-mono">{estimate.order_number}</span>
            </span>
            <span className="text-text-muted">{estimate.order_date}</span>
          </div>
          <p className="mt-1 text-text-secondary">
            For {cust.first_name} {cust.last_name}
            {cust.shipping_address_line1 &&
              ` · ${cust.shipping_address_line1}, ${cust.shipping_city}`}
          </p>
          <p className="mt-1 text-xs text-warning">Valid until {estimate.expiry_date}</p>
        </section>

        {/* Line items — same structure as the PDF */}
        <section className="mb-4 rounded-2xl bg-surface-elevated p-4">
          {estimate.line_items.map((li, i) => {
            const { title, attrs } = itemContent(li);
            return (
              <div key={i} className={i > 0 ? 'mt-3 border-t border-border-light pt-3' : ''}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium text-text-primary">{title}</span>
                  <span className="whitespace-nowrap text-text-muted">× {li.quantity}</span>
                  <span className="w-20 text-right font-mono font-medium text-text-primary">
                    ${Number(li.line_total).toFixed(2)}
                  </span>
                </div>
                {attrs.map((a, j) => (
                  <p key={j} className="ml-3 text-xs text-text-muted">
                    {a}
                  </p>
                ))}
              </div>
            );
          })}
        </section>

        {/* Totals */}
        <section className="mb-4 rounded-2xl bg-surface-elevated p-4 text-sm">
          <div className="flex justify-between">
            <span className="text-text-secondary">Subtotal</span>
            <span>${Number(estimate.subtotal).toFixed(2)}</span>
          </div>
          {Number(estimate.discount_amount) > 0 && (
            <>
              <div className="flex justify-between text-text-muted">
                <span>Discount</span>
                <span>−${Number(estimate.discount_amount).toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">Taxable amount</span>
                <span>${Number(estimate.taxable_amount).toFixed(2)}</span>
              </div>
            </>
          )}
          <div className="flex justify-between">
            <span className="text-text-secondary">
              HST 13%
              {c?.hst_number && (
                <span className="ml-1 text-[10px] text-text-muted">HST# {c.hst_number}</span>
              )}
            </span>
            <span>${Number(estimate.tax_amount).toFixed(2)}</span>
          </div>
          <div className="mt-2 flex justify-between border-t border-border-light pt-2 text-base font-semibold text-text-primary">
            <span>Total</span>
            <span className="font-mono">${Number(estimate.total).toFixed(2)}</span>
          </div>
        </section>

        {/* Terms */}
        {estimate.terms && (
          <section className="mb-4 rounded-2xl bg-surface-elevated p-4">
            <h2 className="mb-1 text-xs font-semibold text-text-muted">TERMS & CONDITIONS</h2>
            <p className="whitespace-pre-wrap text-xs text-text-secondary">{estimate.terms}</p>
          </section>
        )}

        {confirmError && <p className="mb-2 text-center text-sm text-danger">{confirmError}</p>}
      </div>

      {/* Big confirm button */}
      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-surface-elevated p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <button
          onClick={handleConfirm}
          disabled={confirming}
          className="mx-auto flex h-14 w-full max-w-lg items-center justify-center rounded-xl bg-brand-600 text-lg font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {confirming ? 'Confirming…' : 'Confirm Estimate'}
        </button>
      </div>
    </div>
  );
}
