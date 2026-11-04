// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * LeadCard: one website lead on the Leads page, collapsed to a summary
 * and expandable to its full details and actions.
 *
 * Collapsed: the name, when it arrived, what they want (coverings and window
 * count), the proposed visit when there is one, and a meta line with the
 * city, the status pill and "New customer" when this lead created the
 * customer. Expanded: tap-to-call and tap-to-email links, the address, the
 * visitor's message, the page they were on, the proposed visit and the
 * customer's answer, the linked customer, and Propose visit / Handled.
 *
 * Quick actions at the right edge, always visible (`RowIconButton`):
 * Propose visit (calendar → `ProposeVisitModal`), Handled (tick; on a
 * handled lead it is green and moves the lead back to New), and Delete
 * (bin; asks first, the customer stays).
 *
 * Layout (AI_GUIDELINES §11): inside the expand button, the only element
 * beside the text column is the 8px status dot; the pills sit INSIDE the
 * column on a wrapping meta line. The icon group is a sibling of the expand
 * button (a button cannot nest in a button) and is a FIXED 3 × 36px, so the
 * `min-w-0 flex-1` text column keeps ~180px on a 343px phone card. Every
 * visitor-typed string (`wrap-anywhere`) can break, because a 60-character
 * email or an unbroken message must not widen the card.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { Button, Pill, useConfirm } from '../../components/ui';
import RowIconButton, { BinIcon, CalendarIcon, TickCircleIcon } from '../../components/RowIconButton';
import { useDeleteLead, useUpdateLeadStatus } from '../../hooks/useLeads';
import type { Lead, LeadStatus } from '../../types';
import type { PillTone } from '../../lib/statusStyles';
import ProposeVisitModal from './ProposeVisitModal';
import {
  LEAD_STATUS_LABELS,
  VISIT_STATUS_TEXT,
  customerNote,
  emailMissing,
  leadAddress,
  leadName,
  leadWants,
  sourceLabel,
  visitLine,
} from './leadText';

/** Status → dot colour and pill tone. Amber "new" asks for work, as on the Notifications page. */
const STATUS_STYLE: Record<LeadStatus, { dot: string; tone: PillTone }> = {
  new: { dot: 'bg-warning', tone: 'warning' },
  handled: { dot: 'bg-success', tone: 'success' },
};

/** One labelled detail row in the expanded view. */
function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{label}</dt>
      <dd className="text-[13px] text-text-primary wrap-anywhere">{children}</dd>
    </div>
  );
}

/** One lead. `defaultOpen` expands it on first render (used for the only lead on a page). */
export default function LeadCard({ lead, defaultOpen = false }: { lead: Lead; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [proposing, setProposing] = useState(false);
  const update = useUpdateLeadStatus();
  const remove = useDeleteLead();
  const askConfirm = useConfirm();
  const style = STATUS_STYLE[lead.status];
  const name = leadName(lead);
  const address = leadAddress(lead);
  const wants = leadWants(lead);
  const source = sourceLabel(lead.source_url);
  const detailsId = `lead-${lead.id}`;
  const visit = visitLine(lead);
  const handled = lead.status === 'handled';
  const busy = update.isPending || remove.isPending;
  // A visit needs a customer to belong to; the Worker 409s without one.
  const canPropose = Boolean(lead.customer && !lead.customer.deleted_at);

  function move(to: LeadStatus) {
    update.mutate(
      { id: lead.id, status: to },
      {
        onSuccess: () => toast.success(`${name}: ${LEAD_STATUS_LABELS[to]}`),
        onError: (e) => toast.error(e.message),
      },
    );
  }

  /** Deletes the lead after a confirm; says what stays behind. */
  async function handleDelete() {
    const keeps = [
      lead.customer && !lead.customer.deleted_at ? 'the customer stays in Customers' : '',
      lead.appointment ? 'the proposed visit stays on the calendar' : '',
    ].filter(Boolean);
    const ok = await askConfirm({
      title: 'Delete this lead?',
      message: `${name}'s request is removed from Leads${keeps.length ? `; ${keeps.join(' and ')}` : ''}. This cannot be undone.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    remove.mutate(lead.id, {
      onSuccess: () => toast.success(`${name}: deleted`),
      onError: (e) => toast.error(e.message),
    });
  }

  return (
    <article className="rounded-xl border border-border-light bg-surface shadow-sm">
      <div className="flex items-start">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={detailsId}
          className="flex min-w-0 flex-1 items-start gap-3 rounded-l-xl p-3 pr-1 text-left hover:bg-surface-muted"
        >
          <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-pill ${style.dot}`} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            {/* Wraps rather than truncating: on a phone the date drops under the name. */}
            <span className="flex flex-wrap items-baseline justify-between gap-x-2">
              <span className="min-w-0 text-sm font-semibold text-text-primary wrap-anywhere">{name}</span>
              <time dateTime={lead.created_at} className="text-[12px] text-text-muted">
                {format(new Date(lead.created_at), 'MMM d, yyyy · h:mm a')}
              </time>
            </span>
            {wants && <span className="text-[13px] text-text-secondary wrap-anywhere">{wants}</span>}
            {visit && lead.appointment && (
              <span className="text-[12px] text-text-secondary">
                <span className="font-semibold text-brand-700">Visit proposed:</span> {visit} ·{' '}
                {VISIT_STATUS_TEXT[lead.appointment.status]}
              </span>
            )}
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5 text-[12px] text-text-muted">
              <Pill tone={style.tone}>{LEAD_STATUS_LABELS[lead.status]}</Pill>
              {lead.customer_match === 'created' && <Pill tone="brand">New customer</Pill>}
              {lead.city && <span className="min-w-0 wrap-anywhere">{lead.city}</span>}
            </span>
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-0.5 py-2 pr-2">
          <RowIconButton
            label={
              !canPropose
                ? 'The linked customer was removed'
                : lead.appointment
                  ? 'Propose a new time'
                  : 'Propose estimate visit'
            }
            tone="brand"
            disabled={!canPropose}
            onClick={() => setProposing(true)}
          >
            <CalendarIcon />
          </RowIconButton>
          <RowIconButton
            label={handled ? 'Move back to New' : 'Mark handled'}
            tone="success"
            active={handled}
            disabled={busy}
            onClick={() => move(handled ? 'new' : 'handled')}
          >
            <TickCircleIcon />
          </RowIconButton>
          <RowIconButton label="Delete lead" tone="danger" disabled={busy} onClick={() => void handleDelete()}>
            <BinIcon />
          </RowIconButton>
        </div>
      </div>

      {open && (
        <div id={detailsId} className="flex flex-col gap-3 border-t border-border-light px-3 pb-3 pt-3 sm:pl-8">
          <dl className="grid gap-3 sm:grid-cols-2">
            <Detail label="Phone">
              {lead.phone ? (
                <a
                  className="font-medium text-brand-700 underline-offset-2 hover:underline"
                  href={`tel:${lead.phone.replace(/[^\d+]/g, '')}`}
                >
                  {lead.phone}
                </a>
              ) : (
                '—'
              )}
            </Detail>
            <Detail label="Email">
              <a
                className="font-medium text-brand-700 underline-offset-2 hover:underline"
                href={`mailto:${lead.email}`}
              >
                {lead.email}
              </a>
            </Detail>
            <Detail label="Address">{address || '—'}</Detail>
            {source && <Detail label="Submitted from">{source}</Detail>}
          </dl>

          {lead.message && (
            <Detail label="Message">
              <span className="block whitespace-pre-wrap border-l-2 border-border-light pl-2.5">{lead.message}</span>
            </Detail>
          )}

          {lead.appointment && (
            <div className="flex flex-col gap-0.5 rounded-lg bg-brand-100 p-2.5 text-[13px]">
              <span className="font-semibold text-text-primary">Estimate visit: {visit}</span>
              <span className="text-text-secondary">{VISIT_STATUS_TEXT[lead.appointment.status]}</span>
              <Link
                to={`/appointments/${lead.appointment.id}`}
                className="font-semibold text-brand-700 underline-offset-2 hover:underline"
              >
                Open visit ›
              </Link>
            </div>
          )}

          <div className="flex flex-col gap-0.5 rounded-lg bg-surface-sunken p-2.5 text-[13px]">
            {lead.customer && !lead.customer.deleted_at ? (
              <Link
                to={`/customers/${lead.customer.id}`}
                className="font-semibold text-brand-700 underline-offset-2 hover:underline"
              >
                Open customer ›
              </Link>
            ) : null}
            <span className="text-text-secondary">{customerNote(lead)}</span>
          </div>

          {emailMissing(lead) && (
            <p className="text-[12px] text-warning">
              The shop email for this lead did not go out. The lead is saved; check the email settings.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" disabled={!canPropose} onClick={() => setProposing(true)}>
              {lead.appointment ? 'Propose a new time' : 'Propose estimate visit'}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              loading={update.isPending}
              disabled={busy}
              onClick={() => move(handled ? 'new' : 'handled')}
            >
              {handled ? 'Move back to New' : 'Mark handled'}
            </Button>
          </div>
        </div>
      )}

      {proposing && <ProposeVisitModal lead={lead} onClose={() => setProposing(false)} />}
    </article>
  );
}
