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
 *   confirmed         → e-Transfer details FIRST (with the 50% deposit
 *                       quoted while the order awaits its first payment)
 *                       + progress tracker + summary + cancellation block
 *
 * Confirming shows NO success banner. The banner used to sit directly
 * under the header and say "thank you"; that slot now holds the payment
 * instructions, because the confirmation itself is already evident from
 * the page (tracker, "Order" wording, no Confirm button) while the
 * amount and the address are the only things the customer still needs.
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
 *
 * STAFF PREVIEW (`?preview=1`) — the URL the order page's "Customer
 * View" button opens. The page is otherwise identical to the customer's,
 * which is the point, but four things change:
 *   - a draft renders instead of the "link isn't ready yet" card, since
 *     previewing BEFORE sending is the whole reason the button exists;
 *   - Confirm and the cancellation controls are inert, so a staff member
 *     cannot confirm an order on the customer's behalf just by looking;
 *   - the "customer opened their page" ping never fires, so an office
 *     visit is never mistaken for the customer reading their estimate;
 *   - a banner says so, because none of the above is visible otherwise.
 * The `expired` guard is deliberately NOT skipped: an expired estimate
 * really does show the customer an expiry card, so a preview must too.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import PaymentSection from '../../components/PaymentSection';
import OrderProgress from './OrderProgress';
import CancellationRequest from './CancellationRequest';
import { displayName } from '../../lib/customerName';

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
  bottom_rail_name: string | null;
  control_name: string | null;
  color: string | null;
  description: string | null;
  note: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
}

/** One receipt line in the customer's payment history. */
interface PublicPayment {
  amount: number;
  paid_on: string;
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
  /**
   * Server-computed 50% up-front deposit. Optional because a Worker
   * predating this field still serves the rest of the payload; the page
   * then simply omits the deposit figure rather than deriving money of
   * its own (AI_GUIDELINES rule 1).
   */
  deposit_due?: number;
  /**
   * The customer's own receipt history, oldest-first. Amount + date
   * only — the server withholds the ledger's internal columns. Optional
   * because a Worker predating this field still serves the rest of the
   * payload; this page treats its absence as an empty history.
   */
  payments?: PublicPayment[];
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

/**
 * "July 21, 2026" from a `YYYY-MM-DD` string. The parts are split and
 * fed to the Date constructor rather than parsed from the string, which
 * would be read as UTC and render as the previous day west of Greenwich.
 */
function receiptDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
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
        li.bottom_rail_name ? `Bottom rail: ${li.bottom_rail_name}` : '',
        li.control_name ? `Control: ${li.control_name}` : '',
        li.note?.trim() ? `Note: ${li.note.trim()}` : '',
      ].filter(Boolean),
    };
  }
  return { title: li.description || 'Item', attrs: [] };
}

/**
 * One collapsible line item in the customer's summary.
 *
 * The header row (title, quantity, line total) is always visible; the
 * attribute lines produced by `itemContent` — panels, material, color,
 * note — live behind a disclosure so a long order reads as a scannable
 * price list instead of a wall of specs. The first item is rendered
 * open (`defaultOpen`) so the pattern is self-evident without the
 * customer having to discover the arrow.
 *
 * Rows are independent, not a single-open accordion: customers compare
 * two windows side by side more often than they read one at a time.
 *
 * Items with no attributes (services, `item_type !== 'blind'`) have
 * nothing to disclose, so they render as a plain row with no arrow and
 * no tap target — an arrow that opens an empty panel is worse than no
 * arrow at all.
 *
 * Local state is safe here because the list is never reordered or
 * filtered on this page; it is rendered once per fetched payload.
 */
function LineItemRow({
  item,
  defaultOpen,
  id,
}: {
  item: PublicLineItem;
  defaultOpen: boolean;
  id: string;
}) {
  const { title, attrs } = itemContent(item);
  const [open, setOpen] = useState(defaultOpen);
  const expandable = attrs.length > 0;

  const summary = (
    <>
      <span className="min-w-0 flex-1 text-left font-medium text-text-primary">{title}</span>
      <span className="whitespace-nowrap text-text-muted">× {item.quantity}</span>
      <span className="w-20 text-right font-mono font-medium text-text-primary">
        ${Number(item.line_total).toFixed(2)}
      </span>
    </>
  );

  return (
    <div>
      {expandable ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={id}
          className="flex w-full items-center gap-2 py-1 text-sm"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            className={`shrink-0 text-text-muted transition-transform duration-150 ${
              open ? 'rotate-90' : ''
            }`}
          >
            <path
              d="M9 6l6 6-6 6"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {summary}
        </button>
      ) : (
        // 18px glyph + 8px gap kept as dead space so non-expandable
        // rows keep their titles and totals in the same columns as the rest.
        <div className="flex w-full items-center gap-2 py-1 pl-[26px] text-sm">{summary}</div>
      )}
      {expandable && (
        <div id={id} hidden={!open} className="mt-1">
          {attrs.map((a, j) => (
            // Indented past the chevron column so the details hang under
            // the title rather than under the arrow.
            <p key={j} className="ml-[26px] text-xs text-text-muted">
              {a}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Terms & conditions, clamped to five lines behind a "Show more" toggle.
 *
 * The shop's terms run to several paragraphs, which pushed the
 * cancellation block and the confirm button off the bottom of a phone
 * screen — fine print was crowding out the things the customer came to
 * act on. Clamping keeps the terms present and readable without letting
 * them dominate the page.
 *
 * The toggle is shown only when the text ACTUALLY overflows, measured
 * against the rendered element rather than guessed from a character
 * count: how many lines a given string occupies depends on the viewport
 * width, and a "Show more" that reveals nothing is worse than no toggle.
 * A `ResizeObserver` re-measures on rotation and window resize.
 *
 * Measurement is skipped while expanded (where `scrollHeight` always
 * equals `clientHeight`, which would read as "not overflowing" and hide
 * the control the customer needs to collapse it again); the flag from the
 * last collapsed measurement stands until the text is collapsed anew.
 */
function TermsSection({ terms }: { terms: string }) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const bodyRef = useRef<HTMLParagraphElement>(null);

  // Layout effect, not a passive one: measuring after paint would show a
  // frame of clamped terms with no toggle beneath them.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el || expanded) return;
    const measure = () => setOverflowing(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [terms, expanded]);

  return (
    <section className="mb-4 rounded-2xl bg-surface-elevated p-4">
      <h2 className="mb-1 text-xs font-semibold text-text-muted">TERMS &amp; CONDITIONS</h2>
      <p
        ref={bodyRef}
        id="terms-body"
        // `line-clamp-5` is written out literally, never composed from a
        // constant: Tailwind v4 scans the source for whole class names, so
        // an interpolated one would simply not be emitted.
        className={`whitespace-pre-wrap text-xs text-text-secondary ${
          expanded ? '' : 'line-clamp-5'
        }`}
      >
        {terms}
      </p>
      {(overflowing || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls="terms-body"
          className="mt-1.5 py-1 text-xs font-medium text-brand-600 hover:underline"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </section>
  );
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
  const [searchParams] = useSearchParams();
  // Staff opened this from the order page's "Customer View" button. The
  // page renders identically, but nothing here may mutate the order or
  // pollute the activity trail with an office visit.
  const preview = searchParams.get('preview') === '1';

  // One-shot guard for the view ping. React StrictMode mounts effects
  // twice in development, and the ping must not fire twice.
  const pinged = useRef(false);

  const [estimate, setEstimate] = useState<PublicEstimate | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
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

  /**
   * Tells the Worker the customer opened this page, exactly once.
   *
   * Three independent guards, because a false "customer opened it" entry
   * would mislead staff into thinking the estimate was read:
   *   - `preview` — a staff preview is not a customer open;
   *   - `pinged` — StrictMode's double mount fires one effect twice;
   *   - `localStorage` — a refresh, or the reload after confirming, is
   *     the same visit and must not re-ping. This also keeps the page to
   *     one extra request per device against the /public rate limit.
   * The server refuses a second log regardless (`customer_viewed_at`),
   * so these are courtesy, not correctness.
   *
   * Fire-and-forget: no state, no error surface. Telemetry must never be
   * why a customer sees something break.
   */
  useEffect(() => {
    if (preview || pinged.current || !token) return;
    const key = `viewed:${token}`;
    if (localStorage.getItem(key)) return;
    pinged.current = true;
    localStorage.setItem(key, '1');
    void fetch(`${API_URL}/public/estimate/${token}/view`, { method: 'POST' }).catch(() => {
      // Offline or rate-limited — the next visit records it instead.
    });
  }, [preview, token]);

  /**
   * POSTs the one-shot confirm. Success and 409 ("already confirmed")
   * are treated identically — both mean the confirmation exists, so the
   * page simply re-reads the server's version of the truth and the
   * reload flips it into the confirmed layout. There is no success
   * banner: the payment instructions now occupy that slot, which is
   * what the customer needs next.
   */
  async function handleConfirm() {
    setConfirming(true);
    setActionError(null);
    try {
      const res = await fetch(`${API_URL}/public/estimate/${token}/confirm`, { method: 'POST' });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (res.ok || res.status === 409) {
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
  //
  // A staff preview is the one case that MAY render a draft — previewing
  // before sending is the entire point of the "Customer View" button. The
  // guard stays live for everyone else, so a leaked draft token still
  // says nothing.
  if (estimate.status === 'draft' && !preview) {
    return (
      <Message
        icon="🔍"
        title="Order not found"
        body="This link isn't ready yet. Please contact us if you were expecting an estimate."
      />
    );
  }

  const confirmed = CONFIRMED_STATUSES.includes(estimate.status);
  // Defaulted, not assumed: if the web app ships ahead of the Worker
  // this field is absent, and a public page must degrade to "no receipt
  // history" rather than crash for the customer.
  const payments = estimate.payments ?? [];
  // A cancellation can only be granted before any money is recorded, so
  // it is only offered in exactly that window — never shown when the
  // server would refuse it.
  const canRequestCancel = estimate.status === 'awaiting_payment' && estimate.amount_paid === 0;
  // The deposit is quoted only in the window it means something: the
  // order is on the "Awaiting Payment" step and nothing has arrived yet.
  // Once a payment lands, the amount to send is the balance, which the
  // totals block already states.
  const showDeposit =
    estimate.status === 'awaiting_payment' &&
    estimate.amount_paid === 0 &&
    estimate.deposit_due !== undefined;
  const c = estimate.company;
  const cust = estimate.customer;

  return (
    <div className={`min-h-screen bg-surface-muted ${confirmed ? 'pb-8' : 'pb-28'}`}>
      {/*
        Staff preview marker. This page is otherwise byte-identical to
        the customer's, which is exactly why the banner is required:
        without it a staff member has no way to tell that the Confirm
        button in front of them is inert.
      */}
      {preview && (
        <div className="bg-info-tint px-4 py-2 text-center text-xs font-medium text-info">
          Staff preview — this is the page the customer sees. Actions are disabled.
        </div>
      )}
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

        {/*
          How to pay — first thing after the header, in the slot the
          one-time "Order confirmed!" banner used to occupy. A customer
          arriving straight from the confirm button lands on the amount
          and the e-Transfer address instead of on a thank-you, and a
          customer returning later still finds it without scrolling.
          Only mounted once something is actually owed.
        */}
        {confirmed && estimate.balance > 0 && (
          <PaymentSection
            payToEmail={c?.etransfer_email ?? ''}
            instructions={c?.etransfer_instructions}
            orderNumber={estimate.order_number}
            depositDue={showDeposit ? estimate.deposit_due : undefined}
          />
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
            {/*
              The public payload carries no email or phone by design, so
              a nameless customer falls through to the placeholder rather
              than seeing their own contact details printed as a name.
            */}
            For {displayName(cust)}
            {cust.shipping_address_line1 &&
              ` · ${cust.shipping_address_line1}, ${cust.shipping_city}`}
          </p>
          {!confirmed && (
            <p className="mt-1 text-xs text-warning">Valid until {estimate.expiry_date}</p>
          )}
        </section>

        {/* Line items — collapsible; details behind the arrow */}
        <section className="mb-4 rounded-2xl bg-surface-elevated p-4">
          {estimate.line_items.map((li, i) => (
            <div key={i} className={i > 0 ? 'mt-3 border-t border-border-light pt-3' : ''}>
              <LineItemRow item={li} defaultOpen={i === 0} id={`line-item-${i}`} />
            </div>
          ))}
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

          {/*
            Receipt history + balance. Confirmed orders only: before
            confirmation nothing has been paid, so a "Balance due" equal
            to the total would just restate the line above.
          */}
          {confirmed && (
            <>
              {payments.length > 0 && (
                <div className="mt-3 border-t border-border-light pt-2">
                  <h3 className="mb-1 text-xs font-semibold text-text-muted">PAYMENTS RECEIVED</h3>
                  {payments.map((p, i) => (
                    <div key={i} className="flex justify-between text-text-secondary">
                      <span>{receiptDate(p.paid_on)}</span>
                      <span className="font-mono">−${Number(p.amount).toFixed(2)}</span>
                    </div>
                  ))}
                  <div className="mt-1 flex justify-between border-t border-border-light pt-1 font-medium text-text-primary">
                    <span>Paid to date</span>
                    <span className="font-mono">−${Number(estimate.amount_paid).toFixed(2)}</span>
                  </div>
                </div>
              )}
              <div className="mt-2 flex justify-between border-t border-border-light pt-2 text-base font-semibold">
                <span className="text-text-primary">Balance due</span>
                <span
                  className={`font-mono ${
                    Number(estimate.balance) <= 0 ? 'text-success' : 'text-text-primary'
                  }`}
                >
                  ${Number(estimate.balance).toFixed(2)}
                </span>
              </div>
            </>
          )}
        </section>

        {confirmed && estimate.balance <= 0 && (
          <section className="mb-4 rounded-2xl bg-surface-elevated p-4 text-center text-sm font-medium text-success">
            Paid in full — thank you!
          </section>
        )}

        {/* Terms — clamped to 5 lines behind a "Show more" toggle */}
        {estimate.terms && <TermsSection terms={estimate.terms} />}

        {actionError && <p className="mb-2 text-center text-sm text-danger">{actionError}</p>}

        {/* Cancellation — pending notice, or the request form */}
        {(estimate.cancel_requested_at || canRequestCancel) && (
          <CancellationRequest
            pending={Boolean(estimate.cancel_requested_at)}
            busy={cancelBusy}
            disabled={preview}
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
            disabled={confirming || preview}
            className="mx-auto flex h-14 w-full max-w-lg items-center justify-center rounded-xl bg-brand-600 text-lg font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {/*
              The label never says "Confirming…" in preview: nothing is
              in flight, the button is simply inert.
            */}
            {!preview && confirming ? 'Confirming…' : 'Confirm Estimate'}
          </button>
        </div>
      )}
    </div>
  );
}
