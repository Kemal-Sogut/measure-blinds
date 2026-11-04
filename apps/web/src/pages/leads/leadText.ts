// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pure presentation rules for website leads on the Leads page: status
 * labels, the one-line address, the "what they want" summary, and how the
 * linked customer is described.
 *
 * Display helpers only. Nothing here decides data, and the Worker
 * (`apps/api/src/lib/leadAlerts.ts`) keeps its own copy of the address and
 * covering wording for the shop email. Kept out of the page components so
 * the wording is testable in this workspace's DOM-less vitest
 * (`leadText.test.ts`) and the component modules keep their Fast Refresh
 * boundary.
 */

import { format } from 'date-fns';
import type { AppointmentStatus, Lead, LeadStatus } from '../../types';
import type { LeadFilter } from '../../hooks/useLeads';
import { fromIsoDate, visitWindow } from './visitTime';

/** Pill / chip label per status. Same words as the Inbox. */
export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  handled: 'Handled',
};

/** Filter chips in display order. "New" comes first because it is the page's default. */
export const LEAD_FILTERS: LeadFilter[] = ['new', 'handled', 'all'];

/** The customer's answer to a proposed visit, as the lead card says it. */
export const VISIT_STATUS_TEXT: Record<AppointmentStatus, string> = {
  proposed: 'Waiting for their reply',
  confirmed: 'Confirmed by the customer',
  change_requested: 'They asked for another time',
};

/** Covering ids → labels, matching `COVERS` in `public/embed/lead-form.js`. Unknown ids pass through. */
export const COVERING_LABELS: Record<string, string> = {
  zebra: 'Zebra',
  roller: 'Roller',
  solar: 'Solar',
  honeycomb: 'Honeycomb',
  roman: 'Roman',
  shutters: 'Shutters',
  drapery: 'Drapery',
  smart: 'Smart / Motorized',
  unsure: 'Not sure yet',
};

/** Reads `?status=` as a filter, defaulting to `new` (the work queue). */
export function filterFromParam(value: string | null): LeadFilter {
  return LEAD_FILTERS.includes(value as LeadFilter) ? (value as LeadFilter) : 'new';
}

/** "Jane Doe", or the email when both names are blank (the Worker requires both, but old rows may differ). */
export function leadName(lead: Pick<Lead, 'first_name' | 'last_name' | 'email'>): string {
  return `${lead.first_name} ${lead.last_name}`.trim() || lead.email;
}

/** "12 Elm St, Unit 4, Ottawa, ON K1A 0B1", skipping blank parts. '' when there is no address. */
export function leadAddress(lead: Pick<Lead, 'street' | 'unit' | 'city' | 'province' | 'postal_code'>): string {
  const street = [lead.street, lead.unit ? `Unit ${lead.unit}` : ''].filter(Boolean).join(', ');
  const region = [lead.province, lead.postal_code].filter(Boolean).join(' ');
  return [street, lead.city, region].filter(Boolean).join(', ');
}

/** "Zebra, Roller · 5–15 windows". Either half drops out when blank. */
export function leadWants(lead: Pick<Lead, 'coverings' | 'window_count'>): string {
  const covers = lead.coverings.map((c) => COVERING_LABELS[c] ?? c).join(', ');
  const windows = lead.window_count ? `${lead.window_count.replace('-', '–')} windows` : '';
  return [covers, windows].filter(Boolean).join(' · ');
}

/**
 * The sentence under a lead's customer link. It covers a new customer, an
 * email match, or a customer that has since been removed (soft-deleted, or
 * hard-deleted so the FK went null).
 */
export function customerNote(lead: Pick<Lead, 'customer' | 'customer_match'>): string {
  if (!lead.customer) return 'The linked customer was removed.';
  if (lead.customer.deleted_at) return 'The linked customer has been deleted.';
  return lead.customer_match === 'created'
    ? 'New customer, created from this request.'
    : 'Existing customer. The email matched, and only blank details were filled in.';
}

/**
 * True when the shop email should have gone out by now but has not. A lead
 * younger than two minutes is still "sending", so it is not flagged.
 */
export function emailMissing(lead: Pick<Lead, 'email_sent_at' | 'created_at'>, now = Date.now()): boolean {
  return !lead.email_sent_at && now - new Date(lead.created_at).getTime() > 2 * 60_000;
}

/**
 * "Fri, Nov 6 · 10:00 AM – 11:00 AM" for the visit proposed from a lead, or
 * '' when there is none (never proposed, or removed from the calendar).
 */
export function visitLine(lead: Pick<Lead, 'appointment'>): string {
  const a = lead.appointment;
  if (!a) return '';
  return `${format(fromIsoDate(a.appointment_date), 'EEE, MMM d')} · ${visitWindow(a.appointment_time.slice(0, 5))}`;
}

/** The page the form was on, shown without the protocol or a trailing slash. '' when unknown. */
export function sourceLabel(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}
