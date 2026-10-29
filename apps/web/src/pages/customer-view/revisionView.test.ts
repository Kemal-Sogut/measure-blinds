// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins the pure helper behind the customer page's version chip.
 */

import { describe, it, expect } from 'vitest';
import { chipLabel } from './revisionView';

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
