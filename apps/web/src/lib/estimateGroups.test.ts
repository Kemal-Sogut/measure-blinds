// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins the one-line status summary on a collapsed customer group, e.g.
 * "2 active · 1 order". Counts only; no money.
 */

import { describe, it, expect } from 'vitest';
import { groupSummary } from './estimateGroups';

const o = (status: string) => ({ status }) as never;

describe('groupSummary', () => {
  it('counts active (draft + sent), confirmed and expired', () => {
    expect(groupSummary([o('draft'), o('sent'), o('awaiting_payment'), o('expired')])).toBe(
      '2 active · 1 order · 1 expired'
    );
  });
  it('pluralises orders and omits zero parts', () => {
    expect(groupSummary([o('ready'), o('installed')])).toBe('2 orders');
    expect(groupSummary([o('sent')])).toBe('1 active');
  });
  it('is empty for no estimates', () => {
    expect(groupSummary([])).toBe('');
  });
});
