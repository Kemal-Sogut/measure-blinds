// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Unit test for PDF generation — renders a representative order
 * document (blind + preset items, discount, HST number, terms) through
 * the real pdf-lib pipeline and asserts we get a non-trivial,
 * well-formed PDF byte stream, for both the Estimate and Invoice
 * variants. This catches layout mistakes without visual inspection.
 *
 * The second suite covers `itemContent` directly: the rendered bytes
 * are opaque, so the attribute order and the omission rules for a
 * blind's indented lines are asserted on the string array instead.
 */

import { describe, it, expect } from 'vitest';
import { PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { buildDocumentPdf, itemContent, type PdfDocumentData } from './pdf';

/**
 * Reads back a rendered document and returns the destination URL of
 * every `/Link` annotation on it, in page order.
 *
 * The bytes cannot be string-searched for the URL: `doc.save()` packs
 * the annotation dictionaries into a Flate-compressed object stream. So
 * the document is re-parsed with pdf-lib and the annotation objects are
 * inspected — which also proves the link is a real URI action a viewer
 * will follow, not merely text that looks like one.
 */
async function linkUris(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  const uris: string[] = [];
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    for (let i = 0; i < (annots?.size() ?? 0); i++) {
      const annot = annots!.lookup(i, PDFDict);
      if (annot.lookup(PDFName.of('Subtype')) !== PDFName.of('Link')) continue;
      const action = annot.lookup(PDFName.of('A'), PDFDict);
      uris.push(action.lookup(PDFName.of('URI'), PDFString).decodeText());
    }
  }
  return uris;
}

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
      material_name: 'Blackout White',
      cassette_name: 'Standard Cassette',
      bottom_rail_name: 'Regular Rail',
      control_name: 'Chain Control',
      color: 'White',
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
      material_name: null,
      cassette_name: null,
      bottom_rail_name: null,
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

  it('embeds the customer order page as a clickable link annotation', async () => {
    const url = 'https://app.example.com/customer/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    expect(await linkUris(await buildDocumentPdf({ ...SAMPLE, viewUrl: url }))).toEqual([url]);
  });

  it('carries the link on the invoice variant too', async () => {
    const url = 'https://app.example.com/customer/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const invoice: PdfDocumentData = { ...SAMPLE, docType: 'invoice', viewUrl: url };
    expect(await linkUris(await buildDocumentPdf(invoice))).toEqual([url]);
  });

  it('omits the link block when no customer page URL is supplied', async () => {
    expect(await linkUris(await buildDocumentPdf(SAMPLE))).toEqual([]);
    expect(await linkUris(await buildDocumentPdf({ ...SAMPLE, viewUrl: null }))).toEqual([]);
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
  };

  it('places the Color line after Material and before Cassette when set', () => {
    const { attrs } = itemContent(blind);
    const materialIdx = attrs.findIndex((a) => a.startsWith('Material:'));
    const colorIdx = attrs.findIndex((a) => a === 'Color: White 02');
    const cassetteIdx = attrs.findIndex((a) => a.startsWith('Cassette:'));
    expect(colorIdx).toBeGreaterThan(materialIdx);
    expect(cassetteIdx).toBeGreaterThan(colorIdx);
  });

  it('prints the full blind attribute block in order', () => {
    expect(itemContent(blind).attrs).toEqual([
      'Panels: 70 + 70 cm (total 140 cm) x H 200 cm',
      'Material: Blackout White',
      'Color: White 02',
      'Cassette: Standard Cassette',
      'Bottom rail: Regular Rail',
      'Control: Chain Control',
      'Note: Inside mount',
    ]);
  });

  it('places the Bottom rail line between Cassette and Control', () => {
    const { attrs } = itemContent(blind);
    const cassetteIdx = attrs.findIndex((a) => a.startsWith('Cassette:'));
    const railIdx = attrs.findIndex((a) => a === 'Bottom rail: Regular Rail');
    const controlIdx = attrs.findIndex((a) => a.startsWith('Control:'));
    expect(railIdx).toBeGreaterThan(cassetteIdx);
    expect(controlIdx).toBeGreaterThan(railIdx);
  });

  it('omits the Bottom rail line when null, so a legacy row prints clean', () => {
    const { attrs } = itemContent({ ...blind, bottom_rail_name: null });
    expect(attrs.some((a) => a.startsWith('Bottom rail:'))).toBe(false);
    // The neighbouring lines must still be present and adjacent.
    expect(attrs).toContain('Cassette: Standard Cassette');
    expect(attrs).toContain('Control: Chain Control');
  });

  it('trims surrounding whitespace from the color', () => {
    const { attrs } = itemContent({ ...blind, color: '  Beige 07  ' });
    expect(attrs).toContain('Color: Beige 07');
  });

  it('omits the Color line when empty, whitespace, null or absent', () => {
    const hasColor = (li: PdfDocumentData['line_items'][number]) =>
      itemContent(li).attrs.some((a) => a.startsWith('Color:'));
    expect(hasColor({ ...blind, color: '' })).toBe(false);
    expect(hasColor({ ...blind, color: '   ' })).toBe(false);
    expect(hasColor({ ...blind, color: null })).toBe(false);
    expect(hasColor({ ...blind, color: undefined })).toBe(false);
  });

  it('leaves non-blind items without attribute lines', () => {
    const preset: PdfDocumentData['line_items'][number] = {
      ...blind,
      item_type: 'preset',
      description: 'Installation — Professional installation per blind',
    };
    expect(itemContent(preset)).toEqual({
      title: 'Installation — Professional installation per blind',
      attrs: [],
    });
  });
});
