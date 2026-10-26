// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Locks which state the staff revision banner takes for each order
 * shape the detail read can produce: hidden (draft, or a failed history
 * read), legacy (sent before revision tracking), in sync, unsent changes,
 * and a confirmed revision that the current estimate no longer matches.
 */

import { describe, expect, it } from 'vitest';
import type { Order, OrderRevisionSummary } from '../../types';
import { bannerState } from './revisionBanner';

const rev = (rev_no: number): OrderRevisionSummary => ({
  id: `rev-${rev_no}`,
  rev_no,
  sent_at: `2026-10-0${rev_no}T14:00:00Z`,
  source_kind: 'email',
  total: 1000 + rev_no,
});

/** The slice of Order the picker reads, cast whole. */
const order = (o: Partial<Order>): Order => o as Order;

const TWO_REVS = [rev(2), rev(1)];

describe('bannerState', () => {
  it('is hidden on a draft', () => {
    expect(bannerState(order({ status: 'draft', revisions: [], unsent_changes: null }))).toEqual({
      kind: 'hidden',
    });
  });

  it('is hidden on a draft that keeps revision history', () => {
    expect(
      bannerState(order({ status: 'draft', revisions: TWO_REVS, unsent_changes: null })),
    ).toEqual({ kind: 'hidden' });
  });

  it('is hidden when the history could not be read', () => {
    expect(bannerState(order({ status: 'sent', revisions: null, unsent_changes: null }))).toEqual({
      kind: 'hidden',
    });
  });

  it('is hidden when the response carries no revision fields at all', () => {
    expect(bannerState(order({ status: 'sent' }))).toEqual({ kind: 'hidden' });
  });

  it('is legacy for a sent order with no revisions', () => {
    expect(bannerState(order({ status: 'sent', revisions: [], unsent_changes: null }))).toEqual({
      kind: 'legacy',
    });
  });

  it('is in_sync with the latest revision when nothing is unsent', () => {
    expect(
      bannerState(order({ status: 'sent', revisions: TWO_REVS, unsent_changes: [] })),
    ).toEqual({ kind: 'in_sync', rev: 2, sentAt: '2026-10-02T14:00:00Z' });
  });

  it('is unsent with the changes in order', () => {
    const changes = ['Kitchen: Height 150 cm → 180 cm', 'Added: Hall', 'Terms updated'];
    expect(
      bannerState(order({ status: 'sent', revisions: TWO_REVS, unsent_changes: changes })),
    ).toEqual({ kind: 'unsent', rev: 2, sentAt: '2026-10-02T14:00:00Z', changes });
  });

  it('is accepted_differs when the confirmed revision no longer matches', () => {
    const changes = ['Kitchen: Height 150 cm → 180 cm'];
    expect(
      bannerState(
        order({
          status: 'awaiting_payment',
          revisions: TWO_REVS,
          accepted_revision_id: 'rev-2',
          unsent_changes: changes,
        }),
      ),
    ).toEqual({ kind: 'accepted_differs', rev: 2, changes });
  });

  it('names the accepted revision, not the latest, when they differ', () => {
    const state = bannerState(
      order({
        status: 'in_progress',
        revisions: TWO_REVS,
        accepted_revision_id: 'rev-1',
        unsent_changes: ['Added: Hall'],
      }),
    );
    expect(state).toEqual({ kind: 'accepted_differs', rev: 1, changes: ['Added: Hall'] });
  });

  it('stays in_sync for a confirmed order that still matches', () => {
    expect(
      bannerState(
        order({
          status: 'awaiting_payment',
          revisions: TWO_REVS,
          accepted_revision_id: 'rev-2',
          unsent_changes: [],
        }),
      ),
    ).toEqual({ kind: 'in_sync', rev: 2, sentAt: '2026-10-02T14:00:00Z' });
  });
});
