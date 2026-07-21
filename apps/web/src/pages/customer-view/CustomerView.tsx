// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Public customer order summary — token-gated, NO authentication.
 *
 * Fetches `/public/estimate/:token` with a plain fetch (no Supabase
 * session exists here). This page used to be an estimate that dead-ended
 * into a one-line "already confirmed" card; it is now a PERMANENT order
 * summary that the same emailed link keeps opening for the life of the
 * order:
 *
 *   not found / draft → generic error card
 *   expired           → "contact us for a new quote" card
 *   sent              → summary + Confirm button (the estimate)
 *   confirmed         → summary + progress tracker + e-Transfer details
 *                       + cancellation-request block
 *
 * Because the tracker is always live here, the app sends customers NO
 * status-update emails.
 *
 * The confirm POST is rate-limited server-side and succeeds exactly
 * once; a 409 flips the UI into the confirmed state. A confirmation can
 * NEVER be undone from this page — the most a customer can do is REQUEST
 * cancellation, which raises a flag for staff and changes no status.
 *
 * This module owns fetching, state and the summary markup. The two new
 * concerns are delegated: `OrderProgress` (tracker) and
 * `CancellationRequest` (request/withdraw), both pure and stateless
 * apart from their own local form drafts.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import PaymentSection from '../../components/PaymentSection';
import OrderProgress from './OrderProgress';
import CancellationRequest from './CancellationRequest';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787';

/** Statuses in which the customer's confirmation already exists. */
const CONFIRMED_STATUSES = ['awaiting_payment', 'in_progress', 'ready', 'installed'];

/** Public line item shape returned by the Worker. */
interface PublicLineItem {
  item_type: string;
  room_name: string | null;
  blinds_type: string | null;
  panels: number[] | null;
  height_cm: number | null;
  material_name: string | null;
  cassette_name: string | null;
  control_name: string | null;
  color: string | null;
  description: string | null;
  note: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
}

/** Full public order payload rendered by this page. */
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
  /** Server-computed sum of the payments ledger. */
  amount_paid: number;
  /** Server-computed `total − amount_paid`. */
  balance: number;
  terms: string;
  /** Set while the customer has an open cancellation request. */
  cancel_requested_at: string | null;
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
    etransfer_email: string;
    etransfer_instructions: string;
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
        li.material_name ? `Material: ${li.material_name}` : '',
        li.color?.trim() ? `Color: ${li.color.trim()}` : '',
        li.cassette_name ? `Cassette: ${li.cassette_name}` : '',
        li.control_name ? `Control: ${li.control_name}` : '',
        li.note?.trim() ? `Note: ${li.note.trim()}` : '',
      ].filter(Boolean),
    };
  }
  return { title: li.description || 'Item', attrs: [] };
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
  const [cancelBusy, setCancelBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  /**
   * (Re)loads the public payload. Called on mount and after every
   * mutation, so server-computed figures (balance, request flag) are
   * always the server's, never patched client-side.
   */
  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`${API_URL}/public/estimate/${token}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) setLoadError((body as { error?: string })?.error ?? 'Order not found.');
      else setEstimate((body as { data: PublicEstimate }).data);
    } catch {
      setLoadError('Could not load your order. Please try again.');
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  /** POSTs the one-shot confirm; 409 means someone already did it. */
  async function handleConfirm() {
    setConfirming(true);
    setActionError(null);
    try {
      const res = await fetch(`${API_URL}/public/estimate/${token}/confirm`, { method: 'POST' });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (res.ok) {
        setJustConfirmed(true);
        await load();
      } else if (res.status === 409) {
        await load();
      } else {
        setActionError(body?.error ?? 'Confirmation failed. Please try again.');
      }
    } catch {
      setActionError('Network problem — please try again.');
    } finally {
      setConfirming(false);
    }
  }

  /**
   * Opens or withdraws a cancellation request. Both endpoints share this
   * handler because they behave identically from the page's point of
   * view: POST, then re-read the server's version of the truth.
   */
  async function handleCancelAction(path: 'cancel-request' | 'cancel-withdraw', note?: string) {
    setCancelBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`${API_URL}/public/estimate/${token}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(note !== undefined ? { note } : {}),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) setActionError(body?.error ?? 'Something went wrong. Please try again.');
      await load();
    } catch {
      setActionError('Network problem — please try again.');
    } finally {
      setCancelBusy(false);
    }
  }

  if (loadError) return <Message icon="🔍" title="Order not found" body={loadError} />;
  if (!estimate) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-muted">
        <p className="text-text-muted">Loading your order…</p>
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

  // A draft was never sent to anyone; if a token somehow resolves to one
  // (a receipt send can mint a token without sending an estimate), say
  // nothing about it.
  if (estimate.status === 'draft') {
    return (
      <Message
        icon="🔍"
        title="Order not found"
        body="This link isn't ready yet. Please contact us if you were expecting an estimate."
      />
    );
  }

  const confirmed = CONFIRMED_STATUSES.includes(estimate.status);
  // A cancellation can only be granted before any money is recorded, so
  // it is only offered in exactly that window — never shown when the
  // server would refuse it.
  const canRequestCancel = estimate.status === 'awaiting_payment' && estimate.amount_paid === 0;
  const c = estimate.company;
  const cust = estimate.customer;

  return (
    <div className={`min-h-screen bg-surface-muted ${confirmed ? 'pb-8' : 'pb-28'}`}>
      <div className="mx-auto max-w-lg p-4">
        {/* Company header */}
        <header className="mb-4 flex items-center gap-3 rounded-2xl bg-surface-elevated p-4">
          {c?.logo_url && (
            <img src={c.logo_url} alt="" className="h-12 w-12 rounded-lg object-contain" />
          )}
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-text-primary">{c?.company_name || 'Order'}</h1>
            <p className="truncate text-xs text-text-muted">
              {[c?.phone, c?.email].filter(Boolean).join(' · ')}
            </p>
          </div>
        </header>

        {/* One-time success banner, shown only on the confirming visit */}
        {justConfirmed && (
          <div className="mb-4 rounded-2xl bg-success/10 p-4 text-center">
            <div className="mb-1 text-3xl">✅</div>
            <h2 className="mb-1 font-semibold text-text-primary">Order confirmed!</h2>
            <p className="text-sm text-text-secondary">
              Thank you — we&apos;ve been notified and will be in touch shortly.
            </p>
          </div>
        )}

        {/* Live status — only meaningful once confirmed */}
        {confirmed && <OrderProgress status={estimate.status} />}

        {/* Order meta */}
        <section className="mb-4 rounded-2xl bg-surface-elevated p-4 text-sm">
          <div className="flex justify-between gap-2">
            <span className="font-semibold text-text-primary">
              {confirmed ? 'Order' : 'Estimate'}{' '}
              <span className="font-mono">{estimate.order_number}</span>
            </span>
            <span className="whitespace-nowrap text-text-muted">{estimate.order_date}</span>
          </div>
          <p className="mt-1 text-text-secondary">
            For {cust.first_name} {cust.last_name}
            {cust.shipping_address_line1 &&
              ` · ${cust.shipping_address_line1}, ${cust.shipping_city}`}
          </p>
          {!confirmed && (
            <p className="mt-1 text-xs text-warning">Valid until {estimate.expiry_date}</p>
          )}
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

        {/* How to pay — only once something is actually owed */}
        {confirmed && estimate.balance > 0 && (
          <PaymentSection
            balance={Number(estimate.balance)}
            amountPaid={Number(estimate.amount_paid)}
            payToEmail={c?.etransfer_email ?? ''}
            instructions={c?.etransfer_instructions}
            orderNumber={estimate.order_number}
          />
        )}

        {confirmed && estimate.balance <= 0 && (
          <section className="mb-4 rounded-2xl bg-surface-elevated p-4 text-center text-sm font-medium text-success">
            Paid in full — thank you!
          </section>
        )}

        {/* Terms */}
        {estimate.terms && (
          <section className="mb-4 rounded-2xl bg-surface-elevated p-4">
            <h2 className="mb-1 text-xs font-semibold text-text-muted">TERMS & CONDITIONS</h2>
            <p className="whitespace-pre-wrap text-xs text-text-secondary">{estimate.terms}</p>
          </section>
        )}

        {actionError && <p className="mb-2 text-center text-sm text-danger">{actionError}</p>}

        {/* Cancellation — pending notice, or the request form */}
        {(estimate.cancel_requested_at || canRequestCancel) && (
          <CancellationRequest
            pending={Boolean(estimate.cancel_requested_at)}
            busy={cancelBusy}
            onRequest={(note) => void handleCancelAction('cancel-request', note)}
            onWithdraw={() => void handleCancelAction('cancel-withdraw')}
          />
        )}
      </div>

      {/* Big confirm button — pre-confirmation only */}
      {!confirmed && (
        <div className="fixed inset-x-0 bottom-0 border-t border-border bg-surface-elevated p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            onClick={handleConfirm}
            disabled={confirming}
            className="mx-auto flex h-14 w-full max-w-lg items-center justify-center rounded-xl bg-brand-600 text-lg font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {confirming ? 'Confirming…' : 'Confirm Estimate'}
          </button>
        </div>
      )}
    </div>
  );
}
