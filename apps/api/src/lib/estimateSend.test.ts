// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins the selection rules for a multi-estimate send: which estimate ids a
 * consultant may email in one link, how a valid selection splits into
 * "flip these drafts to sent" versus "already sent, only name them", and
 * the wording of every rejection (shown verbatim in a 400 response).
 */

import { describe, it, expect } from 'vitest';
import { planSelection, sendLogLine, type SendCandidateRow } from './estimateSend';

const TODAY = '2026-10-24';

const row = (over: Partial<SendCandidateRow> = {}): SendCandidateRow => ({
  id: 'a1',
  order_number: 'M2010-1',
  title: null,
  customer_id: 'c1',
  status: 'draft',
  expiry_date: '2026-12-31',
  item_count: 2,
  public_token: null,
  terms_snapshot: null,
  ...over,
});

describe('planSelection', () => {
  it('puts drafts in toSend and sent rows in toAnnounce, in request order', () => {
    const rows = [row({ id: 'a1' }), row({ id: 'a2', status: 'sent' })];
    const result = planSelection(rows, ['a2', 'a1'], 'c1', TODAY);
    if (!('plan' in result)) throw new Error(`expected a plan, got: ${result.error}`);
    expect(result.plan.toSend.map((r) => r.id)).toEqual(['a1']);
    expect(result.plan.toAnnounce.map((r) => r.id)).toEqual(['a2']);
  });

  it('keeps the consultant order within each group, not the row order', () => {
    const rows = [row({ id: 'a1' }), row({ id: 'a2' }), row({ id: 'a3', status: 'sent' }), row({ id: 'a4', status: 'sent' })];
    const result = planSelection(rows, ['a4', 'a2', 'a3', 'a1'], 'c1', TODAY);
    if (!('plan' in result)) throw new Error(`expected a plan, got: ${result.error}`);
    expect(result.plan.toSend.map((r) => r.id)).toEqual(['a2', 'a1']);
    expect(result.plan.toAnnounce.map((r) => r.id)).toEqual(['a4', 'a3']);
  });

  it('counts a repeated id once', () => {
    const result = planSelection([row({ id: 'a1' })], ['a1', 'a1'], 'c1', TODAY);
    if (!('plan' in result)) throw new Error(`expected a plan, got: ${result.error}`);
    expect(result.plan.toSend).toHaveLength(1);
  });

  it('rejects an id with no row', () => {
    expect(planSelection([row()], ['a1', 'zz'], 'c1', TODAY)).toEqual({
      error: 'One of the selected estimates no longer exists.',
    });
  });

  it('rejects a row of another customer', () => {
    expect(planSelection([row({ customer_id: 'c2' })], ['a1'], 'c1', TODAY)).toEqual({
      error: 'One of the selected estimates belongs to another customer.',
    });
  });

  it('rejects a confirmed row', () => {
    expect(planSelection([row({ status: 'awaiting_payment' })], ['a1'], 'c1', TODAY)).toEqual({
      error: 'One of the selected estimates cannot be sent in its current status.',
    });
  });

  it('rejects an expired status row', () => {
    expect(planSelection([row({ status: 'expired' })], ['a1'], 'c1', TODAY)).toEqual({
      error: 'One of the selected estimates cannot be sent in its current status.',
    });
  });

  it('rejects a row whose expiry is before today', () => {
    const rows = [row({ status: 'sent', expiry_date: '2026-10-23' })];
    expect(planSelection(rows, ['a1'], 'c1', TODAY)).toEqual({
      error: 'One of the selected estimates has expired and cannot be sent.',
    });
  });

  it('rejects a row with no line items', () => {
    expect(planSelection([row({ item_count: 0 })], ['a1'], 'c1', TODAY)).toEqual({
      error: 'One of the selected estimates has no line items and cannot be sent.',
    });
  });

  it('rejects an empty id list', () => {
    expect(planSelection([], [], 'c1', TODAY)).toEqual({
      error: 'Select at least one estimate to send.',
    });
  });

  it('accepts a row whose expiry is exactly today', () => {
    const result = planSelection([row({ expiry_date: TODAY })], ['a1'], 'c1', TODAY);
    expect('plan' in result).toBe(true);
  });

  it('returns the first failure in request order', () => {
    const rows = [row({ id: 'a1', item_count: 0 }), row({ id: 'a2', customer_id: 'c2' })];
    expect(planSelection(rows, ['a2', 'a1'], 'c1', TODAY)).toEqual({
      error: 'One of the selected estimates belongs to another customer.',
    });
  });
});

describe('sendLogLine', () => {
  it('names the email address and the position in the send', () => {
    expect(sendLogLine('a@b.com', 1, 3)).toBe('Estimate emailed to a@b.com (1 of 3 in one send).');
  });
});
