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
 *   sent              → summary + terms tick + Confirm button (estimate)
 *   confirmed         → e-Transfer details FIRST (quoting the 50% deposit
 *                       while the order awaits its first payment, and the
 *                       remaining balance once it is installed and still
 *                       owed) + progress tracker + summary + cancellation
 *                       block
 *
 * The e-Transfer details are shown only while the customer has a transfer
 * to make: the deposit is still due, or the order is installed and a
 * balance remains. Once the 50% deposit is in and production is under way
 * they are hidden — nothing is expected — and they reappear at
 * installation if a final balance is owed (`showHowToPay`). The figure the
 * box quotes follows the same split: the server's `deposit_due` up front,
 * the server's `balance` (total − paid) at installation.
 *
 * Confirming shows NO success banner. The banner used to sit directly
 * under the header and say "thank you"; that slot now holds the payment
 * instructions, because the confirmation itself is already evident from
 * the page (tracker, "Order" wording, no Confirm button) while the
 * amount and the address are the only things the customer still needs.
 * Confirming also scrolls the page back to the top, since Confirm is
 * tapped from the fixed bar at the bottom.
 *
 * Because the tracker is always live here, the app sends customers NO
 * status-update emails.
 *
 * Confirm is gated on an explicit "I have read and agree to the Terms &
 * Conditions" tick whenever the payload carries terms — the tick sits in
 * the fixed confirm bar and links to the (collapsed) terms section. Shops
 * with no terms configured keep the ungated button; the gate is UI-side,
 * so the acceptance is not recorded on the order row.
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

import { useCallback, useEffect, useRef, useState } from 'react';
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
  /** Rod/track slot; null for a type with none scoped to it. */
  installation_name: string | null;
  /**
   * Per-blind-type attributes, ALREADY formatted as "Label: value" by the
   * Worker. The raw blob is never sent to this page — `public.ts` decides
   * what a customer may see, because this route is unauthenticated.
   * Optional so a page served by an older Worker still renders.
   */
  attribute_lines?: string[] | null;
  /**
   * What each hardware option added to THIS line (leg × quantity),
   * already computed by the Worker — this page holds no catalog and may
   * not derive money of its own (AI_GUIDELINES rule 1). A slot is absent
   * when the blind carries no such option, or when the row predates the
   * stored price basis; the whole object is absent on a payload served by
   * an older Worker, which simply renders the option names bare.
   */
  option_prices?: Partial<Record<'cassette' | 'bottom_rail' | 'control' | 'installation', number>> | null;
  color: string | null;
  /** Headline for a flat item; `''` on blinds and pre-title rows. */
  title?: string | null;
  description: string | null;
  note: string | null;
  /** Consultant-added extras, each shown with its own price. */
  addons?: Array<{ label: string; price: number }> | null;
  /**
   * What this line would have cost before the consultant reduced it, or
   * null to print nothing. The Worker decides whether this exists at all
   * — a hidden original never reaches this page, so there is nothing here
   * to reveal by inspecting the markup.
   */
  original_line_total?: number | null;
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
  // Add-ons come last on both kinds of item, matching the PDF, so the two
  // documents a customer may hold side by side read the same way.
  const addonLines = (li.addons ?? []).map((a) => `${a.label} — $${a.price.toFixed(2)}`);
  if (li.item_type === 'blind') {
    // Hardware options carry what they added to this line, matching the
    // PDF. An option that added nothing prints its name alone — "$0.00"
    // beside a choice tells the customer nothing — and material, colour
    // and the type's own attributes never carry a figure at all.
    const prices = li.option_prices ?? {};
    const priced = (
      label: string,
      name: string,
      slot: 'cassette' | 'bottom_rail' | 'control' | 'installation'
    ): string => {
      const amount = prices[slot];
      return amount ? `${label}: ${name} — $${amount.toFixed(2)}` : `${label}: ${name}`;
    };
    return {
      title: [li.room_name || 'Blind', li.blinds_type].filter(Boolean).join(' — '),
      attrs: [
        li.panels?.length
          ? `Panels: ${li.panels.join(' + ')} cm × H ${li.height_cm} cm`
          : '',
        li.material_name ? `Material: ${li.material_name}` : '',
        li.color?.trim() ? `Color: ${li.color.trim()}` : '',
        li.cassette_name ? priced('Cassette', li.cassette_name, 'cassette') : '',
        li.bottom_rail_name ? priced('Bottom rail', li.bottom_rail_name, 'bottom_rail') : '',
        li.control_name ? priced('Control', li.control_name, 'control') : '',
        li.installation_name ? priced('Installation', li.installation_name, 'installation') : '',
        // Already formatted server-side; same position as on the PDF.
        ...(li.attribute_lines ?? []),
        li.note?.trim() ? `Note: ${li.note.trim()}` : '',
        ...addonLines,
      ].filter(Boolean),
    };
  }
  // Title heads the row; the description hangs beneath it. A row saved
  // before titles existed has only a description, which takes the heading
  // so historical orders still name their items.
  const titled = li.title?.trim();
  const body = titled ? (li.description ?? '') : '';
  return {
    title: titled || li.description || 'Item',
    attrs: [...body.split('\n').map((l) => l.trim()).filter(Boolean), ...addonLines],
  };
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
      {/*
        Wider than the other columns' 20 because it may carry two figures:
        the original struck through, then the price actually charged.
      */}
      <span className="w-28 text-right font-mono font-medium text-text-primary">
        {item.original_line_total != null && (
          <span className="mr-1.5 font-normal text-text-muted line-through">
            ${item.original_line_total.toFixed(2)}
          </span>
        )}
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
 * Terms & conditions, fully collapsed behind a disclosure arrow.
 *
 * The shop's terms run to several paragraphs (~6,200 characters), which
 * on a phone pushed the cancellation block and the confirm button off
 * the bottom of the page — fine print crowding out the things the
 * customer actually came to act on. Collapsed by default: nothing but
 * the heading row shows until the customer asks for it.
 *
 * Deliberately NOT a partial preview. A few visible lines of legal text
 * are no more useful than none, and a clamped preview still costs the
 * vertical space this exists to reclaim.
 *
 * The chevron, its `rotate-90` open state and the row's shape mirror
 * `LineItemRow` above, so both disclosures on this page read as the same
 * control rather than two different ideas about expanding.
 *
 * Open/closed is OWNED BY THE PARENT: the acceptance checkbox in the
 * confirm bar links here, and a customer who follows that link must land
 * on expanded text, not on a heading they have to tap again.
 */
function TermsSection({
  terms,
  open,
  onToggle,
}: {
  terms: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <section id="terms" className="mb-4 scroll-mt-4 rounded-2xl bg-surface-elevated p-4">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="terms-body"
        className="flex w-full items-center gap-2 text-left"
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
        <h2 className="text-xs font-semibold text-text-muted">TERMS &amp; CONDITIONS</h2>
      </button>
      {/*
        `hidden` rather than unmounting, matching LineItemRow: the panel
        keeps its identity so `aria-controls` always points at a real
        element, whichever state the disclosure is in.
      */}
      <p
        id="terms-body"
        hidden={!open}
        className="ml-[26px] mt-2 whitespace-pre-wrap text-xs text-text-secondary"
      >
        {terms}
      </p>
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
  // Terms disclosure + the acceptance tick that gates Confirm. Both are
  // page state: the checkbox's "Terms & Conditions" link opens the
  // section, and neither survives a reload — a confirmation must be a
  // deliberate act on the page the customer is looking at.
  const [termsOpen, setTermsOpen] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
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
    // Belt-and-braces with the disabled button: the terms tick is the
    // customer's assent, so nothing may POST without it.
    if (estimate?.terms && !termsAccepted) return;
    setConfirming(true);
    setActionError(null);
    try {
      const res = await fetch(`${API_URL}/public/estimate/${token}/confirm`, { method: 'POST' });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (res.ok || res.status === 409) {
        await load();
        // Confirm is tapped from the fixed bar at the bottom of the page,
        // so the customer is scrolled down; the confirmed layout puts the
        // payment instructions and tracker up top. Return them there so
        // the first thing they see is what to do next, not the middle of
        // the order they were already looking at. Guarded because the
        // helper is absent in non-browser test environments.
        window.scrollTo?.({ top: 0, behavior: 'smooth' });
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
  // Acceptance is only demanded when there is something to accept: a shop
  // with no terms configured (or a payload from an older Worker) must not
  // end up with an un-confirmable estimate.
  const requiresTerms = Boolean(estimate.terms);
  const canConfirm = !preview && !confirming && (!requiresTerms || termsAccepted);
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
  // Has the customer covered the 50% deposit? Compared against the
  // server's `deposit_due` (never derived here — AI_GUIDELINES rule 1),
  // with the same half-cent tolerance the server uses so an exact deposit
  // still counts. If a Worker predating `deposit_due` served the payload,
  // fall back to "any payment recorded" rather than crash.
  const depositPaid =
    estimate.deposit_due !== undefined
      ? estimate.amount_paid + 0.005 >= estimate.deposit_due
      : estimate.amount_paid > 0;
  // Whether "How to pay" is mounted at all. The customer has a transfer to
  // make in exactly two windows: while the deposit is still outstanding,
  // and — once production is done — when the order is installed with a
  // balance still owing. Between them (deposit in, order in production or
  // ready) nothing is expected, so the box is hidden. Balance > 0 is the
  // outer guard: a settled order never shows it.
  const showHowToPay =
    confirmed &&
    estimate.balance > 0 &&
    (!depositPaid || estimate.status === 'installed');
  // The single figure the "How to pay" box quotes, with its label — or
  // none. Both amounts are the server's (`deposit_due`, `balance` =
  // total − amount_paid), never derived here (AI_GUIDELINES rule 1). The
  // 50% deposit is quoted while the order awaits its first payment; once
  // it is installed with a balance still owing, the SAME box quotes that
  // remaining balance so the amount sits beside the e-Transfer address.
  // A partial deposit not yet at 50% falls through to no headline figure.
  let amountDue: { amount: number; caption: string; instruction: string } | undefined;
  if (showDeposit && estimate.deposit_due !== undefined) {
    amountDue = {
      amount: estimate.deposit_due,
      caption: 'Deposit due now (50% of total)',
      instruction: 'Please send this deposit by Interac e-Transfer to:',
    };
  } else if (estimate.status === 'installed' && estimate.balance > 0) {
    amountDue = {
      amount: estimate.balance,
      caption: 'Final Balance',
      instruction: 'Please send your balance by Interac e-Transfer to:',
    };
  }
  const c = estimate.company;
  const cust = estimate.customer;

  // Bottom padding clears the fixed confirm bar, which is one row taller
  // when it carries the terms checkbox — otherwise the last card ends up
  // underneath it.
  return (
    <div
      className={`min-h-screen bg-surface-muted ${
        confirmed ? 'pb-8' : requiresTerms ? 'pb-40' : 'pb-28'
      }`}
    >
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
          Mounted only when the customer actually has a transfer to make
          now (`showHowToPay`): the deposit is still due, or the order is
          installed with a balance remaining. Hidden once the deposit is in
          and production is under way.
        */}
        {showHowToPay && (
          <PaymentSection
            payToEmail={c?.etransfer_email ?? ''}
            instructions={c?.etransfer_instructions}
            orderNumber={estimate.order_number}
            amountDue={amountDue}
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
        {estimate.terms && (
          <TermsSection
            terms={estimate.terms}
            open={termsOpen}
            onToggle={() => setTermsOpen((v) => !v)}
          />
        )}

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

      {/* Terms tick + big confirm button — pre-confirmation only */}
      {!confirmed && (
        <div className="fixed inset-x-0 bottom-0 border-t border-border bg-surface-elevated p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto flex w-full max-w-lg flex-col gap-2.5">
            {/*
              The tick lives WITH the button, not up in the terms card:
              the terms are collapsed by default and can sit a full screen
              above, and an acceptance the customer never scrolls to is no
              acceptance at all. Tapping the link expands the section and
              scrolls to it, so agreeing without being able to read is not
              a state this page can be in.
            */}
            {requiresTerms && (
              <label className="flex items-start gap-2.5 text-sm text-text-secondary">
                <input
                  type="checkbox"
                  checked={termsAccepted}
                  disabled={preview}
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600 disabled:opacity-50"
                />
                <span>
                  I have read and agree to the{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setTermsOpen(true);
                      document.getElementById('terms')?.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start',
                      });
                    }}
                    className="font-medium text-brand-600 underline underline-offset-2"
                  >
                    Terms &amp; Conditions
                  </button>
                  .
                </span>
              </label>
            )}
            <button
              onClick={handleConfirm}
              disabled={!canConfirm}
              className="flex h-14 w-full items-center justify-center rounded-xl bg-brand-600 text-lg font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {/*
                The label never says "Confirming…" in preview: nothing is
                in flight, the button is simply inert.
              */}
              {!preview && confirming ? 'Confirming…' : 'Confirm Estimate'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
