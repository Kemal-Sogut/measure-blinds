// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Version chip for the public customer page, mounted under the company
 * header.
 *
 * When staff re-send an estimate after changing it, the customer opens the
 * same link and sees only the latest sent version. This chip tells them it
 * is a newer version and when it was sent ("Updated Oct 26 · version 2").
 * Nothing about earlier versions is shown — no picker, no "what changed"
 * list — and the public payload carries no data to build either from.
 *
 * Presentational: `CustomerView` passes the payload's `revision` straight
 * in. It renders nothing for a first (or untracked) version, so a
 * first-send estimate looks exactly as it did before revisions existed.
 */

import { chipLabel, type RevisionStamp } from './revisionView';

/**
 * The "Updated <date> · version N" chip in its own card, or nothing when
 * the customer is looking at a first or untracked version.
 */
export default function RevisionInfo({
  revision,
}: {
  /** The latest sent version the customer is shown; null when none was recorded. */
  revision: RevisionStamp | null;
}) {
  const chip = chipLabel(revision);
  if (!chip) return null;

  return (
    <section className="mb-4 rounded-2xl bg-surface-elevated p-4 text-sm">
      <p className="inline-flex max-w-full items-center rounded-full bg-info-tint px-2.5 py-1 text-xs font-semibold text-info">
        <span className="truncate">{chip}</span>
      </p>
    </section>
  );
}
