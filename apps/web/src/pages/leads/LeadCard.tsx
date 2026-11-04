// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * LeadCard: one website lead on the Leads page, collapsed to a summary
 * and expandable to its full details and actions.
 *
 * Collapsed: the name, when it arrived, what they want (coverings and window
 * count), and a meta line with the city, the status pill and "New customer"
 * when this lead created the customer. Expanded: tap-to-call and tap-to-email
 * links, the address, the visitor's message, the page they were on, the
 * linked customer, and the status actions.
 *
 * Layout (AI_GUIDELINES §11): the only element beside the text column is
 * the 8px status dot. The status pill sits INSIDE the column on its own
 * wrapping meta line, never as a non-shrinking sibling of the name. Every
 * visitor-typed string (`wrap-anywhere`) can break, because a 60-character
 * email or an unbroken message must not widen the card on a 343px phone
 * card.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { Button, Pill } from '../../components/ui';
import { useUpdateLeadStatus } from '../../hooks/useLeads';
import type { Lead, LeadStatus } from '../../types';
import type { PillTone } from '../../lib/statusStyles';
import {
  LEAD_STATUS_LABELS,
  customerNote,
  emailMissing,
  leadAddress,
  leadName,
  leadWants,
  sourceLabel,
} from './leadText';

/** Status → dot colour and pill tone. Amber "new" asks for work, as on the Notifications page. */
const STATUS_STYLE: Record<LeadStatus, { dot: string; tone: PillTone }> = {
  new: { dot: 'bg-warning', tone: 'warning' },
  contacted: { dot: 'bg-success', tone: 'success' },
  archived: { dot: 'bg-text-muted', tone: 'neutral' },
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

/** The action buttons for a status: the moves that make sense from where the lead is now. */
function actionsFor(status: LeadStatus): Array<{ to: LeadStatus; label: string; variant: 'primary' | 'secondary' | 'ghost' }> {
  switch (status) {
    case 'new':
      return [
        { to: 'contacted', label: 'Mark contacted', variant: 'primary' },
        { to: 'archived', label: 'Archive', variant: 'ghost' },
      ];
    case 'contacted':
      return [
        { to: 'archived', label: 'Archive', variant: 'secondary' },
        { to: 'new', label: 'Move back to New', variant: 'ghost' },
      ];
    case 'archived':
      return [{ to: 'new', label: 'Move back to New', variant: 'secondary' }];
  }
}

/** One lead. `defaultOpen` expands it on first render (used for the only lead on a page). */
export default function LeadCard({ lead, defaultOpen = false }: { lead: Lead; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const update = useUpdateLeadStatus();
  const style = STATUS_STYLE[lead.status];
  const name = leadName(lead);
  const address = leadAddress(lead);
  const wants = leadWants(lead);
  const source = sourceLabel(lead.source_url);
  const detailsId = `lead-${lead.id}`;

  function move(to: LeadStatus) {
    update.mutate(
      { id: lead.id, status: to },
      {
        onSuccess: () => toast.success(`${name}: ${LEAD_STATUS_LABELS[to]}`),
        onError: (e) => toast.error(e.message),
      }
    );
  }

  return (
    <article className="rounded-xl border border-border-light bg-surface shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={detailsId}
        className="flex w-full items-start gap-3 rounded-xl p-3 text-left hover:bg-surface-muted"
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
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5 text-[12px] text-text-muted">
            <Pill tone={style.tone}>{LEAD_STATUS_LABELS[lead.status]}</Pill>
            {lead.customer_match === 'created' && <Pill tone="brand">New customer</Pill>}
            {lead.city && <span className="min-w-0 wrap-anywhere">{lead.city}</span>}
          </span>
        </span>
      </button>

      {open && (
        <div id={detailsId} className="flex flex-col gap-3 border-t border-border-light px-3 pb-3 pt-3 sm:pl-8">
          <dl className="grid gap-3 sm:grid-cols-2">
            <Detail label="Phone">
              {lead.phone ? (
                <a className="font-medium text-brand-700 underline-offset-2 hover:underline" href={`tel:${lead.phone.replace(/[^\d+]/g, '')}`}>
                  {lead.phone}
                </a>
              ) : (
                '—'
              )}
            </Detail>
            <Detail label="Email">
              <a className="font-medium text-brand-700 underline-offset-2 hover:underline" href={`mailto:${lead.email}`}>
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

          <div className="flex flex-col gap-0.5 rounded-lg bg-surface-sunken p-2.5 text-[13px]">
            {lead.customer && !lead.customer.deleted_at ? (
              <Link to={`/customers/${lead.customer.id}`} className="font-semibold text-brand-700 underline-offset-2 hover:underline">
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
            {actionsFor(lead.status).map((a) => (
              <Button
                key={a.to}
                size="sm"
                variant={a.variant}
                loading={update.isPending && update.variables?.status === a.to}
                disabled={update.isPending}
                onClick={() => move(a.to)}
              >
                {a.label}
              </Button>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}
