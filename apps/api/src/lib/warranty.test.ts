// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Unit tests for the warranty term rules.
 *
 * Pinned here because a mistake prints a wrong date or a wrong promise on
 * a legal document: the calendar arithmetic (including the leap clamp
 * that must never roll February into March), the single ten-year term
 * applied to every line item without any motor classification, and the
 * standing motorization exclusion wording.
 */

import { describe, it, expect } from 'vitest';
import {
  MOTORIZATION_EXCLUSION_NOTE,
  addYears,
  buildWarrantyCoverage,
  type WarrantyItemSource,
} from './warranty';

/** A blind as the DB snapshots it (control deliberately ignored). */
const BLIND: WarrantyItemSource = {
  item_type: 'blind',
  room_name: 'Living Room',
  blinds_type: 'Roller',
  quantity: 2,
};

describe('addYears', () => {
  it('adds ten years to an ordinary date', () => {
    expect(addYears('2026-08-01', 10)).toBe('2036-08-01');
  });

  it('clamps a leap day to the 28th when the target year is not a leap year', () => {
    expect(addYears('2028-02-29', 10)).toBe('2038-02-28');
  });

  it('keeps the leap day when the target year is also a leap year', () => {
    expect(addYears('2028-02-29', 4)).toBe('2032-02-29');
  });

  it('rejects a malformed start date rather than printing NaN', () => {
    expect(() => addYears('2026-8-1', 10)).toThrow(/Invalid warranty start date/);
    expect(() => addYears('2026-02-30', 10)).toThrow(/Invalid warranty start date/);
  });
});

describe('buildWarrantyCoverage', () => {
  it('puts every line item on the ten-year term, in order', () => {
    const coverage = buildWarrantyCoverage(
      [BLIND, { item_type: 'preset', description: 'Installation', quantity: 1 }],
      '2026-08-01'
    );
    expect(coverage.startsOn).toBe('2026-08-01');
    expect(coverage.expiry).toBe('2036-08-01');
    expect(coverage.items).toEqual([
      { label: 'Living Room — Roller', quantity: 2, expiry: '2036-08-01' },
      { label: 'Installation', quantity: 1, expiry: '2036-08-01' },
    ]);
  });

  it('degrades a blind label to whichever half exists', () => {
    const coverage = buildWarrantyCoverage(
      [
        { ...BLIND, room_name: '' },
        { ...BLIND, blinds_type: null },
        { item_type: 'blind', quantity: 1 },
      ],
      '2026-08-01'
    );
    expect(coverage.items.map((i) => i.label)).toEqual(['Roller', 'Living Room', 'Blind']);
  });
});

describe('MOTORIZATION_EXCLUSION_NOTE', () => {
  it('excludes motorization-related products, naming the common ones', () => {
    const note = MOTORIZATION_EXCLUSION_NOTE.toLowerCase();
    expect(note).toContain('excluded from this warranty');
    for (const word of ['motorization', 'motors', 'solar panels', 'remotes']) {
      expect(note).toContain(word);
    }
  });
});
