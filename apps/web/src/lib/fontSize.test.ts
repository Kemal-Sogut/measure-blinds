// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Tests for the text size preference's stored-value rule. Only the pure
 * parser is covered: this workspace runs vitest in node with no DOM, and
 * the rest of `fontSize.ts` is a one-line attribute write plus a
 * guarded localStorage call.
 */

import { describe, it, expect } from 'vitest';
import { FONT_SIZES, parseFontSize } from './fontSize';

describe('parseFontSize', () => {
  it('returns every known size unchanged', () => {
    for (const size of FONT_SIZES) expect(parseFontSize(size)).toBe(size);
  });

  it('falls back to default when nothing is stored', () => {
    expect(parseFontSize(null)).toBe('default');
  });

  it('falls back to default for an unknown or stale value', () => {
    // An attribute value the CSS has no rule for would leave the scale
    // at 1 anyway, but the control would then show no option selected.
    expect(parseFontSize('huge')).toBe('default');
    expect(parseFontSize('')).toBe('default');
  });
});
