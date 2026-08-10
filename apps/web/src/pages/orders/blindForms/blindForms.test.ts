// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Guards the one failure the two-registry split can produce silently.
 *
 * A blind type that has a pricing module (`lib/blindTypes/`) but no form
 * entry (`pages/orders/blindForms/`) renders the DEFAULT form. Its
 * type-specific inputs are then simply absent from the UI — no error, no
 * type failure, just a quietly incomplete order that prices as if those
 * inputs were never asked for. Nothing else in the codebase would catch
 * that, so it is caught here.
 *
 * Resolution must also agree with the pricing registry on ALIASES and on
 * the legacy "… Blind" suffix, or a name would price as one type and
 * render as another.
 */

import { describe, it, expect } from 'vitest';
import { getBlindForm } from './index';
import DefaultForm from './DefaultForm';

/** The ten canonical type names, as stored in `line_items.blinds_type`. */
const CANONICAL = [
  'Roller',
  'Zebra',
  'Roman',
  'Sunscreen',
  'Honeycomb',
  'Shutter',
  'Vertical Sheer',
  'Vertical Panel',
  'Vertical Roller',
  'Curtains',
] as const;

describe('getBlindForm', () => {
  it('falls back to the default form for unknown and empty names', () => {
    expect(getBlindForm('Something Old')).toBe(DefaultForm);
    expect(getBlindForm('')).toBe(DefaultForm);
    expect(getBlindForm(null)).toBe(DefaultForm);
    expect(getBlindForm(undefined)).toBe(DefaultForm);
  });

  it('resolves legacy "… Blind" names the same way the pricing registry does', () => {
    expect(getBlindForm('Roller Blind')).toBe(getBlindForm('Roller'));
    expect(getBlindForm('  ROLLER ')).toBe(getBlindForm('Roller'));
  });

  it('resolves the aliases the pricing registry answers to', () => {
    // Sunscreen/Solar and Curtains carry aliases in lib/blindTypes; a form
    // registry that missed them would render the default for those names
    // while pricing used the real module.
    expect(getBlindForm('solar')).toBe(getBlindForm('Sunscreen'));
    expect(getBlindForm('Sun-screen/Solar')).toBe(getBlindForm('Sunscreen'));
    expect(getBlindForm('curtain')).toBe(getBlindForm('Curtains'));
  });

  it('gives every canonical type its own form', () => {
    for (const name of CANONICAL) {
      expect(getBlindForm(name), `${name} has no form of its own`).not.toBe(DefaultForm);
    }
  });
});
