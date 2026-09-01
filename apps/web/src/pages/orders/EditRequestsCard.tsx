// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Open change requests on the staff order page.
 *
 * The customer raises these from their token'd public page before
 * confirming (`POST /public/estimate/:token/edit-request`) as free text.
 * A request mutates nothing — no status, no line item, no money — so
 * acting on one means a person reading it, editing the order by hand,
 * and then marking it resolved here.
 *
 * Only UNRESOLVED requests are rendered, and the card disappears
 * entirely once the last one is closed: it is a to-do list, not an
 * archive. The permanent record lives in two places that already exist —
 * the order's activity trail (one entry per request and per resolution)
 * and the `order_edit_requests` rows themselves, which are never deleted.
 *
 * Amber, not red. Red is spoken for on this page by the cancellation
 * banner, which is the one thing that must be answered before anything
 * else proceeds; a change request is important but not blocking, and two
 * red cards competing would flatten that distinction.
 *
 * Purely presentational: the parent owns the query, the mutation and any
 * error reporting. It mounts this OUTSIDE the read-only fieldset that
 * wraps the order form, because resolving a request is not an edit to
 * the order and stays available at every lifecycle stage.
 */

import type { OrderEditRequest } from '../../types';

/** Presentational contract — the parent owns every side effect. */
interface EditRequestsCardProps {
  /**
   * The order's requests, resolved ones included. Filtering happens here
   * so the parent can hand over one cache entry without slicing it, and
   * so "which of these still needs work" is decided in exactly one place.
   */
  requests: OrderEditRequest[];
  /** Marks one request handled. */
  onResolve: (requestId: string) => void;
  /**
   * Id of the request whose resolve call is in flight, or null. Tracked
   * per row rather than as one boolean so resolving the third request
   * does not blank the buttons on the other two.
   */
  resolvingId: string | null;
}

export default function EditRequestsCard({
  requests,
  onResolve,
  resolvingId,
}: EditRequestsCardProps) {
  const open = requests.filter((r) => !r.resolved_at);
  if (open.length === 0) return null;

  return (
    <section className="rounded-xl border border-warning/30 bg-warning-tint p-4 shadow-md">
      <div className="mb-1 flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-warning-tint text-warning"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
            <path
              d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <h2 className="text-[15px] font-bold text-warning">
          {open.length === 1 ? 'Change requested' : `${open.length} change requests`}
        </h2>
      </div>
      <p className="text-[13px] text-text-secondary">
        Sent by the customer from their estimate page. Edit the order, then mark each one
        resolved.
      </p>

      {/*
        Newest first — the list arrives in that order from the Worker and
        the most recent ask is the one most likely being acted on. Each
        message keeps the customer's own line breaks and wraps rather
        than truncating: an abbreviated instruction is worse than none.
      */}
      <ul className="mt-3 flex flex-col gap-3">
        {open.map((req) => (
          <li key={req.id} className="rounded-sm bg-surface p-3">
            <p className="mb-1.5 text-[11px] text-text-muted">
              {new Date(req.created_at).toLocaleString()}
            </p>
            <p className="text-[13px] break-words whitespace-pre-wrap text-text-secondary">
              {req.message}
            </p>
            <button
              type="button"
              onClick={() => onResolve(req.id)}
              disabled={resolvingId !== null}
              className="mt-2.5 h-9 rounded-md border border-border-input bg-surface px-3 text-[13px] font-medium text-text-secondary hover:bg-surface-sunken disabled:opacity-40"
            >
              {resolvingId === req.id ? 'Resolving…' : 'Mark resolved'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
