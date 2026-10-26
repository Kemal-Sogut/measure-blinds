// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins the pure helpers behind the customer page's version chip,
 * "what changed" list, earlier-version picker and old-version overlay.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  chipLabel,
  previousVersions,
  versionOptionLabel,
  visibleChanges,
  overlayRevision,
  fetchRevision,
  CHANGES_PREVIEW_LIMIT,
  type RevisionPayload,
} from './revisionView';

// Midday UTC so the Toronto calendar date is the same day all year.
const SENT = '2026-10-26T12:00:00.000Z';

describe('chipLabel', () => {
  it('names the date and version for a revision after the first', () => {
    expect(chipLabel({ rev_no: 2, sent_at: SENT })).toBe('Updated Oct 26 · version 2');
  });
  it('has no chip for a first version or for no revision', () => {
    expect(chipLabel({ rev_no: 1, sent_at: SENT })).toBeNull();
    expect(chipLabel(null)).toBeNull();
  });
});

describe('previousVersions', () => {
  const revs = [
    { rev_no: 3, sent_at: SENT },
    { rev_no: 2, sent_at: SENT },
    { rev_no: 1, sent_at: SENT },
  ];
  it('excludes the latest, keeping newest-first order', () => {
    expect(previousVersions(revs).map((r) => r.rev_no)).toEqual([2, 1]);
  });
  it('is empty with one revision or none', () => {
    expect(previousVersions(revs.slice(2))).toEqual([]);
    expect(previousVersions([])).toEqual([]);
  });
});

describe('versionOptionLabel', () => {
  it('reads "Version n · date"', () => {
    expect(versionOptionLabel({ rev_no: 1, sent_at: SENT })).toBe('Version 1 · Oct 26');
  });
});

describe('visibleChanges', () => {
  const many = Array.from({ length: CHANGES_PREVIEW_LIMIT + 3 }, (_, i) => `change ${i}`);
  it('caps a long list and reports how many are hidden', () => {
    const r = visibleChanges(many, false);
    expect(r.shown).toHaveLength(CHANGES_PREVIEW_LIMIT);
    expect(r.hiddenCount).toBe(3);
  });
  it('shows everything once expanded', () => {
    expect(visibleChanges(many, true)).toEqual({ shown: many, hiddenCount: 0 });
  });
  it('never hides a short list', () => {
    expect(visibleChanges(['a'], false)).toEqual({ shown: ['a'], hiddenCount: 0 });
  });
});

describe('overlayRevision', () => {
  const live = {
    status: 'sent',
    order_number: 'E-1',
    title: 'Live title',
    total: 200,
    terms: 'live terms',
    balance: 200,
    customer: { first_name: 'Ana' },
    line_items: ['live'],
  };
  const rev: RevisionPayload<string> = {
    rev_no: 1,
    sent_at: SENT,
    title: 'Old title',
    order_date: '2026-10-01',
    expiry_date: '2026-10-15',
    subtotal: 100,
    discount_amount: 0,
    taxable_amount: 100,
    tax_rate: 0.13,
    tax_amount: 13,
    total: 113,
    terms: 'old terms',
    line_items: ['old'],
    read_only: true,
  };
  it('swaps the quote fields and keeps the live status, header and balance', () => {
    const out = overlayRevision(live, rev);
    expect(out.total).toBe(113);
    expect(out.title).toBe('Old title');
    expect(out.line_items).toEqual(['old']);
    expect(out.status).toBe('sent');
    expect(out.balance).toBe(200);
    expect(out.customer).toBe(live.customer);
  });
  it('does not leak revision-only fields into the page payload', () => {
    expect(overlayRevision(live, rev)).not.toHaveProperty('rev_no');
    expect(overlayRevision(live, rev)).not.toHaveProperty('read_only');
  });
});

describe('fetchRevision', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('GETs the revision endpoint and unwraps data', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { rev_no: 1 } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const r = await fetchRevision('http://api', 'tok', 1);
    expect(fetchMock).toHaveBeenCalledWith('http://api/public/estimate/tok/revisions/1');
    expect(r).toEqual({ kind: 'ok', revision: { rev_no: 1 } });
  });
  it('reports the server error text on a 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Revision not found' }),
      })
    );
    expect(await fetchRevision('http://api', 'tok', 9)).toEqual({
      kind: 'error',
      message: 'Revision not found',
    });
  });
  it('reports a network failure without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const r = await fetchRevision('http://api', 'tok', 1);
    expect(r.kind).toBe('error');
  });
});
