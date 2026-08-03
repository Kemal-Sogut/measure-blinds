// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Unit tests for warranty certificate generation — renders through the
 * real pdf-lib pipeline and asserts a non-trivial, well-formed byte
 * stream. The rendered bytes are opaque, so these tests exist to catch
 * layout and cursor mistakes (a section that overruns a page, a missing
 * field that throws) rather than to assert wording; the wording rules
 * live in `warranty.test.ts`, which asserts on strings.
 *
 * Kept separate from `pdf.test.ts` because it exercises a different
 * module: `pdf.ts` renders the estimate/invoice, `warrantyPdf.ts` the
 * certificate.
 */

import { describe, it, expect } from 'vitest';
import { buildWarrantyCoverage, type WarrantyItemSource } from './warranty';
import { buildWarrantyPdf, type WarrantyPdfData } from './warrantyPdf';

const MOTOR_BLIND: WarrantyItemSource = {
  item_type: 'blind',
  room_name: 'Living Room',
  blinds_type: 'Roller',
  control_name: 'Motorized (Bluetooth)',
  quantity: 2,
};

const MANUAL_BLIND: WarrantyItemSource = {
  item_type: 'blind',
  room_name: 'Bedroom',
  blinds_type: 'Zebra',
  control_name: 'Chain Control',
  quantity: 1,
};

const INSTALLATION: WarrantyItemSource = {
  item_type: 'preset',
  description: 'Installation — Professional installation per blind',
  quantity: 3,
};

/** A certificate for a mixed order, motorised section included. */
const SAMPLE: WarrantyPdfData = {
  order: { order_number: 'T0408-126', order_date: '2026-08-04' },
  coverage: buildWarrantyCoverage([MOTOR_BLIND, MANUAL_BLIND, INSTALLATION], '2026-08-20'),
  customer: {
    first_name: 'Test',
    last_name: 'Customer',
    email: 'test@example.com',
    phone: '555-0100',
    shipping_address_line1: '123 Main St',
    shipping_address_line2: '',
    shipping_city: 'Toronto',
    shipping_province: 'ON',
    shipping_postal_code: 'M1M 1M1',
  },
  company: {
    company_name: 'Blinds Nisa',
    logo_url: null,
    email: 'blindsnisa@gmail.com',
    phone: '555-0199',
    address: '1 Shop Rd, Toronto, ON',
  },
  issuedOn: '2026-08-20',
  logo: null,
};

describe('buildWarrantyPdf', () => {
  it('renders a well-formed certificate byte stream', async () => {
    const bytes = await buildWarrantyPdf(SAMPLE);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(new TextDecoder().decode(bytes.slice(-32))).toContain('%%EOF');
    expect(bytes.length).toBeGreaterThan(2000);
  });

  it('renders an order with no motorised item (section skipped)', async () => {
    const bytes = await buildWarrantyPdf({
      ...SAMPLE,
      coverage: buildWarrantyCoverage([MANUAL_BLIND, INSTALLATION], '2026-08-20'),
    });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(2000);
  });

  it('renders for a customer with no name and no address', async () => {
    const bytes = await buildWarrantyPdf({
      ...SAMPLE,
      customer: {
        first_name: '',
        last_name: '',
        email: '',
        phone: '',
        shipping_address_line1: '',
        shipping_address_line2: '',
        shipping_city: '',
        shipping_province: '',
        shipping_postal_code: '',
      },
      company: { ...SAMPLE.company, email: '', phone: '', address: '' },
    });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  });

  it('spans multiple pages for a long order without throwing', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      ...MOTOR_BLIND,
      room_name: `Room ${i + 1}`,
    }));
    const bytes = await buildWarrantyPdf({
      ...SAMPLE,
      coverage: buildWarrantyCoverage(many, '2026-08-20'),
    });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(4000);
  });
});
