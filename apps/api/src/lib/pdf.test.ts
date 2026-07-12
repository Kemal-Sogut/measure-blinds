// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Unit test for PDF generation — renders a representative order
 * document (blind + preset items, discount, HST number, terms) through
 * the real pdf-lib pipeline and asserts we get a non-trivial,
 * well-formed PDF byte stream, for both the Estimate and Invoice
 * variants. This catches layout mistakes without visual inspection.
 */

import { describe, it, expect } from 'vitest';
import { buildDocumentPdf, itemContent, type PdfDocumentData } from './pdf';

const SAMPLE: PdfDocumentData = {
  docType: 'estimate',
  order: {
    order_number: 'T0408-126',
    order_date: '2026-08-04',
    expiry_date: '2026-08-18',
    subtotal: 465,
    discount_amount: 46.5,
    taxable_amount: 418.5,
    tax_amount: 54.41,
    total: 472.91,
    amount_paid: 0,
    balance: 472.91,
  },
  payments: [],
  line_items: [
    {
      item_type: 'blind',
      room_name: 'Living Room',
      blinds_type: 'Roller',
      panels: [70, 70],
      height_cm: 200,
      fabric_name: 'Blackout White',
      cassette_name: 'Standard Cassette',
      control_name: 'Chain Control',
      description: '',
      quantity: 2,
      unit_price: 220,
      line_total: 440,
    },
    {
      item_type: 'preset',
      room_name: null,
      blinds_type: null,
      panels: null,
      height_cm: null,
      fabric_name: null,
      cassette_name: null,
      control_name: null,
      description: 'Installation — Professional installation per blind',
      quantity: 1,
      unit_price: 25,
      line_total: 25,
    },
  ],
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
    billing_same_as_shipping: false,
    billing_address_line1: '99 Billing Ave',
    billing_address_line2: 'Suite 4',
    billing_city: 'Toronto',
    billing_province: 'ON',
    billing_postal_code: 'M2M 2M2',
  },
  company: {
    company_name: 'Blinds Nisa',
    logo_url: null,
    email: 'blindsnisa@gmail.com',
    phone: '555-0199',
    address: '1 Shop Rd, Toronto, ON',
    hst_number: '123456789 RT0001',
  },
  terms: 'A 50% deposit is required on confirmation. Final measurements taken on site.',
  logo: null,
};

describe('buildDocumentPdf', () => {
  it('renders a well-formed estimate PDF byte stream', async () => {
    const bytes = await buildDocumentPdf(SAMPLE);
    // %PDF- magic header and EOF marker
    const head = new TextDecoder().decode(bytes.slice(0, 5));
    const tail = new TextDecoder().decode(bytes.slice(-32));
    expect(head).toBe('%PDF-');
    expect(tail).toContain('%%EOF');
    // A real one-page estimate is comfortably above a few KB
    expect(bytes.length).toBeGreaterThan(2000);
  });

  it('renders an invoice variant with payments + balance', async () => {
    const invoice: PdfDocumentData = {
      ...SAMPLE,
      docType: 'invoice',
      order: { ...SAMPLE.order, amount_paid: 200, balance: 272.91 },
      payments: [
        { amount: 200, paid_on: '2026-08-05', note: 'e-Transfer deposit' },
      ],
    };
    const bytes = await buildDocumentPdf(invoice);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(2000);
  });

  it('renders without optional content (no discount, no terms, no items)', async () => {
    const minimal: PdfDocumentData = {
      ...SAMPLE,
      order: { ...SAMPLE.order, discount_amount: 0 },
      line_items: [],
      terms: '',
      company: { ...SAMPLE.company, hst_number: '' },
    };
    const bytes = await buildDocumentPdf(minimal);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  });
});

describe('itemContent color', () => {
  const blind: PdfDocumentData['line_items'][number] = {
    item_type: 'blind',
    room_name: 'Living Room',
    blinds_type: 'Roller',
    panels: [70, 70],
    height_cm: 200,
    fabric_name: 'Blackout White',
    cassette_name: 'Standard Cassette',
    control_name: 'Chain Control',
    color: 'White 02',
    note: 'Inside mount',
    description: '',
    quantity: 1,
    unit_price: 0,
    line_total: 0,
  };

  it('places the Color line after Control and before Note when set', () => {
    const { attrs } = itemContent(blind);
    const controlIdx = attrs.findIndex((a) => a.startsWith('Control:'));
    const colorIdx = attrs.findIndex((a) => a === 'Color: White 02');
    const noteIdx = attrs.findIndex((a) => a.startsWith('Note:'));
    expect(colorIdx).toBeGreaterThan(controlIdx);
    expect(noteIdx).toBeGreaterThan(colorIdx);
  });

  it('omits the Color line when empty or whitespace', () => {
    expect(itemContent({ ...blind, color: '' }).attrs.some((a) => a.startsWith('Color:'))).toBe(false);
    expect(itemContent({ ...blind, color: '   ' }).attrs.some((a) => a.startsWith('Color:'))).toBe(false);
  });
});
