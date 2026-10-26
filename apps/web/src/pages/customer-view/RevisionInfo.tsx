// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Revision strip for the public customer page, mounted under the company
 * header.
 *
 * When staff re-send an estimate after changing it, the customer opens the
 * same link and needs three things: to see that this is a newer version
 * (the chip), to see what moved without comparing two quotes by eye (the
 * collapsible "What changed" list), and a way back to what they were
 * originally sent (the earlier-versions picker). While an earlier version
 * is open a banner says so and offers "back to current".
 *
 * This component is presentational. `CustomerView` owns the data, the
 * "viewing version N" state and the fetch, and hides Confirm / Request
 * Edit / Cancel while an old version is on screen. It renders nothing at
 * all for an order with a single (or no) revision and no changes, so a
 * first-send estimate looks exactly as it did before revisions existed.
 */

import { useState } from 'react';
import {
  chipLabel,
  previousVersions,
  versionOptionLabel,
  visibleChanges,
  type RevisionStamp,
} from './revisionView';

/**
 * Chevron + label row that opens the "What changed" list. Same shape as
 * the line-item and terms disclosures so all three read as one control.
 */
function ChangesList({ changes }: { changes: string[] }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const { shown, hiddenCount } = visibleChanges(changes, expanded);

  return (
    <div className="mt-3 border-t border-border-light pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="revision-changes"
        className="flex min-h-11 w-full items-center gap-2 text-left"
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
        <span className="text-sm font-semibold text-text-primary">
          What changed{' '}
          <span className="font-normal text-text-muted">({changes.length})</span>
        </span>
      </button>
      <div id="revision-changes" hidden={!open} className="ml-[26px]">
        <ul className="flex flex-col gap-1.5 text-sm text-text-secondary">
          {shown.map((line, i) => (
            <li key={i} className="break-words">
              {line}
            </li>
          ))}
        </ul>
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-brand-600"
          >
            Show {hiddenCount} more
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Version chip, "What changed" disclosure, earlier-versions picker and the
 * "you're viewing an earlier version" banner, in one card.
 *
 * Fully controlled: the parent holds which version is open and performs the
 * fetch; this only reports the customer's choice through `onViewRevision`
 * and `onBackToCurrent`. Renders nothing when there is nothing to say.
 */
export default function RevisionInfo({
  revision,
  revisions,
  changes,
  viewing,
  loading,
  error,
  onViewRevision,
  onBackToCurrent,
}: {
  /** The version the customer is currently being shown as "current"; null when none was recorded. */
  revision: RevisionStamp | null;
  /** Every revision, newest first. */
  revisions: RevisionStamp[];
  /** Server-written change lines between the current and previous version. */
  changes: string[];
  /** Version number of the earlier version on screen, or null when viewing the current one. */
  viewing: number | null;
  /** True while an earlier version is being fetched. */
  loading: boolean;
  /** Why the last load of an earlier version failed, or null. */
  error: string | null;
  /** Called with the chosen version number to open it read-only. */
  onViewRevision: (revNo: number) => void;
  /** Called to return to the current version. */
  onBackToCurrent: () => void;
}) {
  // The banner already states which version is open; a second "version N"
  // statement would compete with it.
  const chip = viewing === null ? chipLabel(revision) : null;
  const earlier = previousVersions(revisions);
  // The change lines describe current-vs-previous; while an old version is
  // open they would describe the wrong page.
  const showChanges = viewing === null && changes.length > 0;
  if (!chip && !showChanges && earlier.length === 0 && viewing === null) return null;

  return (
    <section className="mb-4 rounded-2xl bg-surface-elevated p-4 text-sm">
      {chip && (
        <p className="inline-flex max-w-full items-center rounded-full bg-info-tint px-2.5 py-1 text-xs font-semibold text-info">
          <span className="truncate">{chip}</span>
        </p>
      )}

      {viewing !== null && (
        <div
          role="status"
          className="mt-3 flex flex-wrap items-center gap-x-2 rounded-xl bg-warning-tint px-3 py-2 text-warning first:mt-0"
        >
          <span className="font-medium">You&apos;re viewing an earlier version —</span>
          <button
            type="button"
            onClick={onBackToCurrent}
            className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2"
          >
            back to current
          </button>
        </div>
      )}

      {showChanges && <ChangesList changes={changes} />}

      {earlier.length > 0 && (
        <div className={chip || showChanges || viewing !== null ? 'mt-3 border-t border-border-light pt-3' : ''}>
          <label htmlFor="revision-select" className="mb-1 block text-xs font-semibold text-text-muted">
            PREVIOUS VERSIONS
          </label>
          <select
            id="revision-select"
            value={viewing ?? ''}
            disabled={loading}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '') onBackToCurrent();
              else onViewRevision(Number(v));
            }}
            className="h-11 w-full min-w-0 rounded-lg border border-border-input bg-surface px-3 text-sm text-text-primary disabled:opacity-60"
          >
            <option value="">
              {revision ? `Current version (${revision.rev_no})` : 'Current version'}
            </option>
            {earlier.map((r) => (
              <option key={r.rev_no} value={r.rev_no}>
                {versionOptionLabel(r)}
              </option>
            ))}
          </select>
          {loading && <p className="mt-1 text-xs text-text-muted">Loading that version…</p>}
          {error && <p className="mt-1 text-xs text-danger">{error}</p>}
        </div>
      )}
    </section>
  );
}
