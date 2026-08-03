// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Unit tests for the warranty term rules.
 *
 * Two things are pinned here because a mistake in either prints a wrong
 * date on a legal document: the calendar arithmetic (including the leap
 * clamp that must never roll February into March), and the motorised
 * classification that decides whether a row also carries the two-year
 * motor term on top of its ten-year product term.
 */

import { describe, it, expect } from 'vitest';
import {
  addYears,
  buildWarrantyCoverage,
  isMotorised,
  type WarrantyItemSource,
} from './warranty';

/** A motorised blind as the DB snapshots it. */
const MOTOR_BLIND: WarrantyItemSource = {
  item_type: 'blind',
  room_name: 'Living Room',
  blinds_type: 'Roller',
  control_name: 'Motorized (Bluetooth)',
  quantity: 2,
};

/** A chain-controlled blind — products term only. */
const MANUAL_BLIND: WarrantyItemSource = {
  item_type: 'blind',
  room_name: 'Bedroom',
  blinds_type: 'Zebra',
  control_name: 'Chain Control',
  quantity: 1,
};

describe('addYears', () => {
  it('adds ten years to an ordinary date', () => {
    expect(addYears('2026-08-01', 10)).toBe('2036-08-01');
  });

  it('adds two years to an ordinary date', () => {
    expect(addYears('2026-08-01', 2)).toBe('2028-08-01');
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

describe('isMotorised', () => {
  it('flags a Bluetooth motorised control', () => {
    expect(isMotorised(MOTOR_BLIND)).toBe(true);
  });

  it('flags a non-Bluetooth motorised control', () => {
    expect(isMotorised({ ...MOTOR_BLIND, control_name: 'Motorized (Non-Bluetooth)' })).toBe(true);
  });

  it('does not flag manual controls', () => {
    for (const control of ['Chain Control', 'Cordless', 'Safety Wand']) {
      expect(isMotorised({ ...MANUAL_BLIND, control_name: control })).toBe(false);
    }
  });

  it('flags a custom row sold as a motor part', () => {
    expect(
      isMotorised({ item_type: 'custom', description: 'Motor kit replacement', quantity: 1 })
    ).toBe(true);
  });
});

describe('buildWarrantyCoverage', () => {
  it('covers a motorised blind under BOTH terms', () => {
    const coverage = buildWarrantyCoverage([MOTOR_BLIND], '2026-08-01');
    expect(coverage.hasMotorised).toBe(true);
    expect(coverage.standardItems).toHaveLength(1);
    expect(coverage.standardItems[0].expiry).toBe('2036-08-01');
    expect(coverage.motorItems).toHaveLength(1);
    expect(coverage.motorItems[0].expiry).toBe('2028-08-01');
    expect(coverage.motorItems[0].label).toContain('motor & moving parts');
  });

  it('reports no motorised section for an order without motors', () => {
    const coverage = buildWarrantyCoverage(
      [MANUAL_BLIND, { item_type: 'preset', description: 'Installation', quantity: 1 }],
      '2026-08-01'
    );
    expect(coverage.hasMotorised).toBe(false);
    expect(coverage.motorItems).toHaveLength(0);
    expect(coverage.standardItems.map((i) => i.label)).toEqual([
      'Bedroom — Zebra',
      'Installation',
    ]);
  });
});
