// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Proves `itemContent` actually renders a blind type's attributes.
 *
 * No real type declares any yet, so `pdf.test.ts` can only assert the
 * empty case — which would still pass if the wiring were deleted. This
 * file mocks the blind-type registry to return a type that HAS diverged
 * and checks the lines land, in order, in the right place.
 *
 * Kept apart from `pdf.test.ts` because the mock is module-wide: applying
 * it there would blind every other assertion in that file to the real
 * registry.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('./blindTypes', () => ({
  getBlindType: () => ({
    blindType: 'Shutter',
    describeAttributes: (attrs: Record<string, unknown>) =>
      attrs.louvre_mm
        ? [
            { label: 'Louvre', value: `${String(attrs.louvre_mm)} mm` },
            { label: 'Frame', value: String(attrs.frame ?? 'None') },
          ]
        : [],
  }),
}));

const { itemContent } = await import('./pdf');
type PdfItem = Parameters<typeof itemContent>[0];

/** A fully-populated blind, matching the fixture in `pdf.test.ts`. */
const blind = {
  item_type: 'blind',
  room_name: 'Living Room',
  blinds_type: 'Shutter',
  panels: [70, 70],
  height_cm: 200,
  material_name: 'Blackout White',
  cassette_name: 'Standard Cassette',
  bottom_rail_name: 'Regular Rail',
  control_name: 'Chain Control',
  color: 'White 02',
  note: 'Inside mount',
  description: '',
  quantity: 1,
  unit_price: 0,
  line_total: 0,
} as unknown as PdfItem;

describe('itemContent attributes', () => {
  it('renders each attribute as its own "Label: value" line', () => {
    const { attrs } = itemContent({
      ...blind,
      attributes: { louvre_mm: 63, frame: 'L-frame' },
    } as PdfItem);
    expect(attrs).toContain('Louvre: 63 mm');
    expect(attrs).toContain('Frame: L-frame');
  });

  it('puts them after Control and before Note', () => {
    const { attrs } = itemContent({
      ...blind,
      attributes: { louvre_mm: 63, frame: 'L-frame' },
    } as PdfItem);
    const control = attrs.findIndex((a) => a.startsWith('Control:'));
    const louvre = attrs.findIndex((a) => a.startsWith('Louvre:'));
    const note = attrs.findIndex((a) => a.startsWith('Note:'));
    expect(louvre).toBeGreaterThan(control);
    expect(note).toBeGreaterThan(louvre);
    expect(note).toBe(attrs.length - 1);
  });

  it('preserves the order describeAttributes returned', () => {
    const { attrs } = itemContent({
      ...blind,
      attributes: { louvre_mm: 63, frame: 'L-frame' },
    } as PdfItem);
    expect(attrs.findIndex((a) => a.startsWith('Frame:'))).toBe(
      attrs.findIndex((a) => a.startsWith('Louvre:')) + 1
    );
  });

  it('adds nothing when the type returns no pairs', () => {
    const { attrs } = itemContent({ ...blind, attributes: {} } as PdfItem);
    expect(attrs.some((a) => a.startsWith('Louvre:'))).toBe(false);
    expect(attrs).toHaveLength(7);
  });
});
