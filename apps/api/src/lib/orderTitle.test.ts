// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins the estimate-title rules: blank means "no title" (null, rendered
 * nowhere), whitespace is collapsed so a pasted line break cannot reach
 * an email subject, and an absent field on PUT leaves the stored title alone.
 */

import { describe, it, expect } from 'vitest';
import { normalizeOrderTitle, titlePatch, ORDER_TITLE_MAX } from './orderTitle';

describe('normalizeOrderTitle', () => {
  it('keeps undefined as undefined (field not sent)', () => {
    expect(normalizeOrderTitle(undefined)).toBeUndefined();
  });
  it('turns null, empty and whitespace-only into null', () => {
    expect(normalizeOrderTitle(null)).toBeNull();
    expect(normalizeOrderTitle('')).toBeNull();
    expect(normalizeOrderTitle('   \n ')).toBeNull();
  });
  it('trims and collapses inner whitespace', () => {
    expect(normalizeOrderTitle('  Option A \n – Roller  ')).toBe('Option A – Roller');
  });
  it('exposes the 120-char cap', () => {
    expect(ORDER_TITLE_MAX).toBe(120);
  });
});

describe('titlePatch', () => {
  it('is empty when the field was not sent', () => {
    expect(titlePatch(undefined)).toEqual({});
  });
  it('carries the normalised value otherwise', () => {
    expect(titlePatch(' Option B ')).toEqual({ title: 'Option B' });
    expect(titlePatch('')).toEqual({ title: null });
  });
});
