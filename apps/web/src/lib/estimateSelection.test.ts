// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins the pure logic behind the send-estimates picker dialog: default
 * selection, order-preserving toggling, the button label, and the toast
 * shown when the server answers 200 but some rows were not fully marked.
 */

import { describe, it, expect } from 'vitest';
import {
  initialSelection,
  toggleSelection,
  sendButtonLabel,
  partialFailureMessage,
  type SendableEstimate,
} from './estimateSelection';

function row(id: string, order_number: string): SendableEstimate {
  return {
    id,
    order_number,
    title: null,
    status: 'draft',
    order_date: '2026-10-01',
    expiry_date: '2026-11-01',
    total: 100,
  };
}

const rows = [row('a1', 'M2010-1'), row('a2', 'M2010-2'), row('a3', 'M2010-3')];

describe('initialSelection', () => {
  it('ticks every row on open', () => {
    expect(initialSelection(rows)).toEqual(['a1', 'a2', 'a3']);
  });
  it('is empty for no rows', () => {
    expect(initialSelection([])).toEqual([]);
  });
});

describe('toggleSelection', () => {
  it('unticks and re-ticks one id, keeping row order', () => {
    const all = initialSelection(rows);
    const without = toggleSelection(all, 'a2', rows);
    expect(without).toEqual(['a1', 'a3']);
    expect(toggleSelection(without, 'a2', rows)).toEqual(['a1', 'a2', 'a3']);
  });
  it('orders by rows, not by click order', () => {
    expect(toggleSelection(['a3'], 'a1', rows)).toEqual(['a1', 'a3']);
  });
  it('drops an id that is not in rows', () => {
    expect(toggleSelection(['a1', 'stale'], 'a3', rows)).toEqual(['a1', 'a3']);
    expect(toggleSelection(['a1'], 'stale', rows)).toEqual(['a1']);
  });
  it('does not mutate its input', () => {
    const selected = ['a1', 'a2'];
    toggleSelection(selected, 'a3', rows);
    expect(selected).toEqual(['a1', 'a2']);
  });
});

describe('sendButtonLabel', () => {
  it('labels the button with the count', () => {
    expect(sendButtonLabel(0)).toBe('Send estimates');
    expect(sendButtonLabel(1)).toBe('Send estimate');
    expect(sendButtonLabel(2)).toBe('Send 2 estimates');
    expect(sendButtonLabel(5)).toBe('Send 5 estimates');
  });
});

describe('partialFailureMessage', () => {
  it('pins the copy for a single failed estimate', () => {
    expect(partialFailureMessage([{ id: 'a2', error: 'db down' }], rows)).toBe(
      'The email was sent, but M2010-2 could not be fully recorded. Open the estimate and check its status before sending it again.'
    );
  });
  it('pins the copy for several failed estimates, in the plural', () => {
    expect(
      partialFailureMessage(
        [
          { id: 'a1', error: 'x' },
          { id: 'a3', error: 'y' },
        ],
        rows
      )
    ).toBe(
      'The email was sent, but M2010-1, M2010-3 could not be fully recorded. Open each estimate and check its status before sending it again.'
    );
  });
  it('names the estimates that were not marked, and says the email went out', () => {
    const msg = partialFailureMessage([{ id: 'a2', error: 'db down' }], rows);
    expect(msg).toContain('M2010-2');
    expect(msg).toContain('email was sent');
  });
  it('lists every affected estimate', () => {
    const msg = partialFailureMessage(
      [
        { id: 'a1', error: 'x' },
        { id: 'a3', error: 'y' },
      ],
      rows
    );
    expect(msg).toContain('M2010-1');
    expect(msg).toContain('M2010-3');
    expect(msg).not.toContain('M2010-2');
  });
  it('falls back to the id when the failed row is not in rows', () => {
    const msg = partialFailureMessage([{ id: 'gone-id', error: 'x' }], rows);
    expect(msg).toContain('gone-id');
    expect(msg).toContain('email was sent');
  });
  it('never claims the estimate was not sent (an id can be in both sent and failed)', () => {
    const msg = partialFailureMessage([{ id: 'a1', error: 'freeze failed' }], rows);
    expect(msg).not.toMatch(/not sent/i);
    expect(msg).not.toMatch(/was not|were not/i);
    expect(msg).toContain('email was sent');
  });
});
