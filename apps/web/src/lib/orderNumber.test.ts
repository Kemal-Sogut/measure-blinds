// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Unit tests for order number generation (`orderNumber.ts`).
 *
 * Locks down the {DayInitial}{DD}{MM}-{N}{YY} format from
 * IMPLEMENTATION.md §4, including zero-padding of day/month and
 * the day-initial mapping, so the format cannot drift silently —
 * order numbers appear on customer-facing PDFs and emails.
 */

import { describe, it, expect } from 'vitest';
import { generateOrderNumber } from './orderNumber';

describe('generateOrderNumber', () => {
  it('matches the documented example: Tuesday Aug 4 2026, 1st of day → T0408-126', () => {
    // 2026-08-04 is a Tuesday
    expect(generateOrderNumber(new Date(2026, 7, 4), 1)).toBe('T0408-126');
  });

  it('zero-pads single-digit day and month', () => {
    // 2026-01-05 is a Monday
    expect(generateOrderNumber(new Date(2026, 0, 5), 2)).toBe('M0501-226');
  });

  it('uses the correct initial for every weekday', () => {
    // 2026-06-21 (Sun) through 2026-06-27 (Sat)
    const initials = [...Array(7)].map(
      (_, i) => generateOrderNumber(new Date(2026, 5, 21 + i), 1)[0]
    );
    expect(initials).toEqual(['S', 'M', 'T', 'W', 'T', 'F', 'S']);
  });

  it('appends multi-digit daily counts without padding', () => {
    // 2026-06-26 is a Friday
    expect(generateOrderNumber(new Date(2026, 5, 26), 12)).toBe('F2606-1226');
  });
});
