// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * The staff banner that says which revision of the estimate the customer
 * holds and whether the saved order has moved on since (migration 50).
 *
 * It sits above the line items, beside the order-total `PriceUpdateNotice`,
 * and is the SAVED, order-level signal: it covers everything the customer
 * can see (items, sizes, options, notes, title, expiry, discount, total),
 * not just price, and dismissing a price notice never hides it. Its state
 * comes from {@link bannerState}; this component only renders it:
 *
 * - `in_sync`   neutral chip, "Customer has Rev n · sent <date>";
 * - `unsent`    amber, "k changes not sent to the customer", the first five
 *               change lines, and a Send update button;
 * - `legacy`    muted, sent before revision tracking, so the next send
 *               creates Rev 1;
 * - `accepted_differs` amber, the customer confirmed Rev n and the
 *               current estimate differs.
 *
 * A collapsible revision history (Rev n, date, how it was sent, total)
 * follows whenever the order has revisions, drafts included, since a
 * revert to draft keeps its history. While the order is an estimate, each
 * revision but the latest offers Restore (Design decision 8); once one is
 * loaded into the editor a strip says so until it is saved.
 *
 * (This file is `RevisionBannerCard.tsx` because `revisionBanner.ts` sits
 * beside it: two names differing only in case and extension resolve
 * ambiguously on case-insensitive file systems.)
 *
 * Send update is a callback, not a second dialog: the host owns the one
 * `SendEstimatesDialog`. Every container carries `min-w-0` for the reason
 * documented in `blindForms/fields.tsx`: this is used at 375px, and one
 * long change line must wrap or clip rather than widen the page.
 */

import type { Order, OrderRevisionSummary } from '../../types';
import { bannerState } from './revisionBanner';
import { formatViewedAt } from './customerViewed';

/** How many change lines the banner lists before "and N more". */
const MAX_LISTED = 5;

/** Staff-facing wording of `source_kind` for the history rows. */
const SOURCE_LABEL = { email: 'Emailed', manual: 'Marked sent', stage: 'Status change' } as const;

/** "$1,234.00", the same shape the change lines use. */
function money(n: number): string {
  return n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' });
}

/** The change list: first {@link MAX_LISTED} lines, then "and N more". */
function ChangeList({ changes }: { changes: string[] }) {
  const more = changes.length - MAX_LISTED;
  return (
    <ul className="mt-1.5 flex min-w-0 list-disc flex-col gap-0.5 pl-4 text-[12px] text-warning">
      {changes.slice(0, MAX_LISTED).map((line, i) => (
        <li key={i} className="min-w-0 break-words">
          {line}
        </li>
      ))}
      {more > 0 && <li className="list-none text-[11px] text-warning/80">and {more} more</li>}
    </ul>
  );
}

/**
 * The collapsible revision history, newest first. With `onRestore`, every
 * revision except the latest gets a Restore button (restoring the one the
 * customer already holds would change nothing); `restoringId` disables
 * them all while that revision's copy loads.
 */
function History({
  revisions,
  onRestore,
  restoringId,
}: {
  revisions: NonNullable<Order['revisions']>;
  onRestore?: (revision: OrderRevisionSummary) => void;
  restoringId?: string | null;
}) {
  const latest = Math.max(...revisions.map((r) => r.rev_no));
  return (
    <details className="min-w-0 text-[12px] text-text-secondary">
      <summary className="cursor-pointer select-none py-1 text-[11px] font-semibold text-text-muted">
        Revision history ({revisions.length})
      </summary>
      <ul className="flex min-w-0 flex-col divide-y divide-border-light rounded-lg border border-border-light bg-surface">
        {revisions.map((r) => (
          <li
            key={r.id}
            className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 px-3 py-2"
          >
            <span className="font-semibold text-text-primary">Rev {r.rev_no}</span>
            <span className="min-w-0 text-text-muted">{formatViewedAt(r.sent_at)}</span>
            <span className="min-w-0 text-text-muted">{SOURCE_LABEL[r.source_kind]}</span>
            <span className="ml-auto font-mono text-text-primary">{money(r.total)}</span>
            {onRestore && r.rev_no !== latest && (
              <button
                type="button"
                onClick={() => onRestore(r)}
                disabled={Boolean(restoringId)}
                className="shrink-0 rounded-md border border-border-light px-2 py-0.5 text-[11px] font-semibold text-text-secondary hover:bg-surface-sunken disabled:opacity-50"
              >
                {restoringId === r.id ? 'Loading…' : 'Restore'}
              </button>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * The strip shown once a revision has been loaded into the editor: it is
 * unsaved and, even once saved, not yet seen by the customer.
 */
function RestoredStrip({ revNo, onDismiss }: { revNo: number; onDismiss?: () => void }) {
  return (
    <div
      className="flex min-w-0 items-start gap-2 rounded-xl border border-info/30 bg-info-tint px-3 py-2 text-[12px] text-info"
      role="status"
    >
      <span className="min-w-0 flex-1 break-words">
        Rev {revNo} loaded — review and Save. Not sent to the customer.
      </span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded px-1 font-semibold leading-none hover:opacity-80"
        >
          ×
        </button>
      )}
    </div>
  );
}

/**
 * Renders the revision banner and history for one order, or nothing when
 * there is nothing to say (a draft without history, or an unknown read).
 *
 * @param props.order The order from the detail read.
 * @param props.onSendUpdate Opens the host's send dialog from the amber
 *   banner's Send update button.
 * @param props.onRestore Starts a restore of an earlier revision (the
 *   host confirms, loads it and owns the editor state).
 * @param props.restoringId The revision whose copy is loading, if any.
 * @param props.restoredRev The revision loaded into the editor and not
 *   yet saved, which shows the "loaded — review and Save" strip.
 * @param props.onDismissRestored Hides that strip (the restore stays
 *   pending until saved or discarded).
 */
export function RevisionBanner({
  order,
  onSendUpdate,
  onRestore,
  restoringId,
  restoredRev,
  onDismissRestored,
}: {
  /** The order as returned by the detail read. */
  order: Order;
  /**
   * Opens the host's send dialog. Omitted where sending is not possible
   * and the Send update button is then not rendered.
   */
  onSendUpdate?: () => void;
  /**
   * Restores a revision into the editor. Omitted where restoring is not
   * allowed (a confirmed order), and the Restore buttons are then not
   * rendered.
   */
  onRestore?: (revision: OrderRevisionSummary) => void;
  /** Id of the revision being loaded; disables every Restore meanwhile. */
  restoringId?: string | null;
  /** `rev_no` of a restored revision awaiting Save, or null for none. */
  restoredRev?: number | null;
  /** Dismisses the restored strip. */
  onDismissRestored?: () => void;
}) {
  const state = bannerState(order);
  if (state.kind === 'hidden' && !order.revisions?.length) return null;
  const history = order.revisions?.length ? (
    <History revisions={order.revisions} onRestore={onRestore} restoringId={restoringId} />
  ) : null;
  const strip =
    restoredRev != null ? <RestoredStrip revNo={restoredRev} onDismiss={onDismissRestored} /> : null;

  let main = null;
  if (state.kind === 'in_sync') {
    main = (
      <div
        className="inline-flex min-w-0 max-w-full self-start rounded-full bg-surface-sunken px-3 py-1 text-[12px] text-text-secondary"
        role="status"
      >
        <span className="min-w-0 break-words">
          Customer has Rev {state.rev} · sent {formatViewedAt(state.sentAt)}
        </span>
      </div>
    );
  } else if (state.kind === 'legacy') {
    main = (
      <div
        className="min-w-0 rounded-xl bg-surface-sunken px-3 py-2 text-[12px] text-text-muted"
        role="status"
      >
        Sent before revision tracking — next send creates Rev 1
      </div>
    );
  } else if (state.kind === 'unsent' || state.kind === 'accepted_differs') {
    const n = state.changes.length;
    main = (
      <div
        className="min-w-0 rounded-xl border border-warning/30 bg-warning-tint px-3 py-2.5 text-left"
        role="status"
      >
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="min-w-0 break-words text-xs font-semibold text-warning">
            {state.kind === 'unsent'
              ? `⚠ ${n} ${n === 1 ? 'change' : 'changes'} not sent to the customer`
              : `⚠ Customer confirmed Rev ${state.rev} — current estimate differs`}
          </span>
          {state.kind === 'unsent' && onSendUpdate && (
            <button
              type="button"
              onClick={onSendUpdate}
              className="ml-auto shrink-0 rounded-md bg-warning px-2.5 py-1 text-[11px] font-semibold text-white hover:opacity-90"
            >
              Send update
            </button>
          )}
        </div>
        <ChangeList changes={state.changes} />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {strip}
      {main}
      {history}
    </div>
  );
}
