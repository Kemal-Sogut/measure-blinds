// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Types, pure helpers and the one fetch behind the customer page's
 * revision UI: the "Updated … · version N" chip, the collapsible "what
 * changed" list, the earlier-version picker, and the read-only overlay
 * that swaps an old version's quote into the page.
 *
 * Lives beside `CustomerView` rather than in `lib/portal.ts`, which is the
 * multi-estimate portal's data layer, not this page's. Nothing here derives
 * money: every figure comes from the Worker's revision snapshot
 * (AI_GUIDELINES rule 1).
 */

import { maintenanceMessage } from '../../lib/maintenance';

/** Most "what changed" lines shown before the "Show N more" toggle. */
export const CHANGES_PREVIEW_LIMIT = 5;

/** One entry in the order's revision list (`revision` / `revisions` on the public payload). */
export interface RevisionStamp {
  /** 1-based version number; the latest is the highest. */
  rev_no: number;
  /** ISO timestamp of the send that cut this version. */
  sent_at: string;
}

/**
 * Body of `GET /public/estimate/:token/revisions/:rev`: the quote part of
 * an earlier send. It carries NO status, payments, customer, company or
 * balance — those stay live, so the page keeps them from the current
 * payload and only swaps these fields.
 *
 * @typeParam L - The page's public line-item shape (the Worker serves the
 *                same sanitized lines as the main payload).
 */
export interface RevisionPayload<L> extends RevisionStamp {
  title: string | null;
  order_date: string;
  expiry_date: string;
  subtotal: number;
  discount_amount: number;
  taxable_amount: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  terms: string;
  line_items: L[];
  /** Always true: an earlier version can be read, never acted on. */
  read_only: true;
}

/** Result of loading an earlier version; failures never throw into the page. */
export type RevisionFetchResult<L> =
  | { kind: 'ok'; revision: RevisionPayload<L> }
  | { kind: 'maintenance'; message: string }
  | { kind: 'error'; message: string };

/**
 * `Mon D` in en-CA, pinned to Toronto so the label cannot shift a day with
 * the viewer's own timezone (and tests stay deterministic).
 */
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    timeZone: 'America/Toronto',
  });
}

/**
 * Text of the version chip under the header, e.g. `Updated Oct 26 · version 2`.
 *
 * The chip tells a returning customer the quote changed since they last
 * looked, so a first version (nothing to be "updated" from) and an order
 * with no revision at all (sent before revision tracking) get no chip.
 *
 * @param revision - The revision the customer is being shown, or null
 * @returns The chip text, or null when no chip should render
 */
export function chipLabel(revision: RevisionStamp | null): string | null {
  if (!revision || revision.rev_no < 2) return null;
  return `Updated ${shortDate(revision.sent_at)} · version ${revision.rev_no}`;
}

/**
 * The versions a customer can step back to: every revision except the
 * latest, which is already what the page shows. Order is preserved
 * (newest first, as the Worker sends it).
 *
 * @param revisions - The full revision list, newest first
 * @returns The same list without its first (latest) entry
 */
export function previousVersions(revisions: RevisionStamp[]): RevisionStamp[] {
  return revisions.slice(1);
}

/**
 * Label for one option in the earlier-versions picker: `Version 1 · Oct 26`.
 *
 * @param revision - The revision the option stands for
 * @returns The visible option text
 */
export function versionOptionLabel(revision: RevisionStamp): string {
  return `Version ${revision.rev_no} · ${shortDate(revision.sent_at)}`;
}

/**
 * Splits the "what changed" lines into what to render now and how many are
 * tucked behind "Show more".
 *
 * @param changes - Human-readable change lines from the Worker
 * @param expanded - Whether the customer has asked for the full list
 * @returns The lines to show and the count still hidden (0 when expanded
 *          or when the list already fits)
 */
export function visibleChanges(
  changes: string[],
  expanded: boolean
): { shown: string[]; hiddenCount: number } {
  if (expanded || changes.length <= CHANGES_PREVIEW_LIMIT) {
    return { shown: changes, hiddenCount: 0 };
  }
  return {
    shown: changes.slice(0, CHANGES_PREVIEW_LIMIT),
    hiddenCount: changes.length - CHANGES_PREVIEW_LIMIT,
  };
}

/**
 * Whether the page may render live money: the how-to-pay box, receipts,
 * balance due and "paid in full".
 *
 * Those figures belong to the CURRENT total. While an earlier version is
 * open its superseded totals are on screen, and a customer reading a
 * deposit or balance beside them could e-Transfer the wrong amount, so
 * every live-money block is withheld until they return to the current one.
 *
 * @param viewingOld - True while an earlier version is open
 * @returns False when payment and balance blocks must be hidden
 */
export function showsLiveMoney(viewingOld: boolean): boolean {
  return !viewingOld;
}

/**
 * Builds the payload the page renders while an earlier version is open:
 * the revision's quote fields laid over the live payload, which keeps its
 * status, customer, company, balance and the rest.
 *
 * `rev_no`, `sent_at` and `read_only` are dropped rather than copied, so
 * the result is still the page's own payload shape.
 *
 * @param live - The current public payload
 * @param revision - The earlier version's quote fields
 * @returns A copy of `live` carrying the revision's quote
 */
export function overlayRevision<T extends { line_items: unknown[] }>(
  live: T,
  revision: RevisionPayload<T['line_items'][number]>
): T {
  const { rev_no: _rev, sent_at: _sent, read_only: _ro, ...quote } = revision;
  return { ...live, ...quote };
}

/**
 * Loads one earlier version from `GET /public/estimate/:token/revisions/:rev`.
 *
 * Never rejects: a 404, a network fault and the maintenance 503 each come
 * back as a result the page can show, because the picker must not be able
 * to break a customer's page.
 *
 * @param apiUrl - Worker origin (the page's `API_URL`)
 * @param token - The order's public token
 * @param revNo - Which version to load
 * @returns The revision, or a maintenance / error outcome
 */
export async function fetchRevision<L>(
  apiUrl: string,
  token: string,
  revNo: number
): Promise<RevisionFetchResult<L>> {
  try {
    const res = await fetch(`${apiUrl}/public/estimate/${token}/revisions/${revNo}`);
    const body = (await res.json().catch(() => null)) as {
      data?: RevisionPayload<L>;
      error?: string;
    } | null;
    const closed = maintenanceMessage(res, body);
    if (closed) return { kind: 'maintenance', message: closed };
    if (!res.ok || !body?.data) {
      return { kind: 'error', message: body?.error ?? 'Could not load that version.' };
    }
    return { kind: 'ok', revision: body.data };
  } catch {
    return { kind: 'error', message: 'Could not load that version. Please try again.' };
  }
}
