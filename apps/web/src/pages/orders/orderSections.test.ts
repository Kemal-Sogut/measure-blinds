// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Locks the order page's section routing: which `?view=` values resolve
 * to which section, and that an unsaved order can never land on a
 * section that needs an order id.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ORDER_SECTION,
  ORDER_SECTIONS,
  isSectionAvailable,
  parseCollapsedFlag,
  resolveOrderSection,
} from './orderSections';

describe('resolveOrderSection', () => {
  it('defaults to details when the param is absent', () => {
    expect(resolveOrderSection(null, true)).toBe('details');
    expect(DEFAULT_ORDER_SECTION).toBe('details');
  });

  it('returns every known section for a saved order', () => {
    for (const s of ORDER_SECTIONS) expect(resolveOrderSection(s.id, true)).toBe(s.id);
  });

  it('falls back to details for an unknown value', () => {
    expect(resolveOrderSection('overview', true)).toBe('details');
    expect(resolveOrderSection('', true)).toBe('details');
  });

  it('keeps details and items open for an unsaved order', () => {
    expect(resolveOrderSection('items', false)).toBe('items');
    expect(resolveOrderSection('details', false)).toBe('details');
  });

  it('refuses saved-only sections on an unsaved order', () => {
    for (const id of ['payments', 'appointments', 'manufacturer', 'logs'] as const) {
      expect(isSectionAvailable(id, false)).toBe(false);
      expect(resolveOrderSection(id, false)).toBe('details');
    }
  });
});

describe('parseCollapsedFlag', () => {
  it('collapses only on the exact stored string', () => {
    expect(parseCollapsedFlag('true')).toBe(true);
    expect(parseCollapsedFlag('false')).toBe(false);
    expect(parseCollapsedFlag(null)).toBe(false);
    expect(parseCollapsedFlag('yes')).toBe(false);
  });
});
