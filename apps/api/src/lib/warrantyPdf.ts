// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * PDF generation — the Warranty Certificate issued once an order is paid
 * in full.
 *
 * Layout, top to bottom: company header with the certificate title and
 * order number, a buyer-information block, a coverage summary (start
 * date, both expiry dates, and the parts-only banner), the ten-year
 * product list, a two-year motorised-parts section that appears only
 * when the order contains a motor, the warranty terms, and how to claim.
 *
 * SCOPE: this is a PARTS warranty. The shop replaces defective
 * components free within the stated periods; workmanship and labour are
 * excluded and the standard service fee applies to every visit. Nothing
 * on this document may imply otherwise.
 *
 * It deliberately prints NO money — the service fee is stated as a fact,
 * never as a figure, because it is a live price the certificate must not
 * freeze years in advance. Order prices, payments and balances belong on
 * the invoice.
 *
 * Built on the shared primitives exported by `pdf.ts` (page geometry,
 * palette, `Cursor`, `drawRight`, `addressLines`) so the certificate and
 * the invoice look like the same company produced them, and on the
 * policy rules in `warranty.ts` so terms are never restated here.
 *
 * ENGINE NOTE: `pdf-lib` only — @react-pdf/renderer compiles WASM at
 * runtime, which workerd forbids (see the note in `pdf.ts`).
 */

import { PDFDocument, PDFFont, StandardFonts } from 'pdf-lib';
import { displayName } from './customerName';
import {
  CONTENT_W,
  Cursor,
  INK,
  MARGIN,
  MUTED,
  PAGE_W,
  SOFT,
  addressLines,
  drawRight,
} from './pdf';
import { WARRANTY_YEARS_MOTOR, WARRANTY_YEARS_STANDARD, type WarrantyCoverage } from './warranty';

/**
 * The certificate's standing terms.
 *
 * PARTS ONLY. Within the stated periods the shop supplies the defective
 * component or a replacement free of charge; workmanship and labour are
 * NOT covered, and the standard service fee is payable on every visit —
 * including a visit where the part itself is free under this warranty.
 *
 * That limit is stated three times on the certificate (the banner under
 * the coverage summary, the first term here, and again in the
 * exclusions) because it is the single most likely thing a customer will
 * dispute at the door, and "my warranty covers this" is much harder to
 * argue against a document they were emailed the day they paid.
 *
 * Held as a constant rather than a `company_settings` field for now:
 * this is legal wording the shop changes rarely and should review before
 * it changes, so a deploy is an acceptable gate. Making it editable in
 * Settings is a deliberate follow-up, not an oversight.
 */
export const WARRANTY_TERMS = [
  'This warranty covers PARTS ONLY. Within the periods stated above, measured from the coverage start date, we supply the defective component or its replacement free of charge.',
  'Workmanship and labour are NOT covered. Our standard service fee applies to every call-out, inspection, removal, refitting and re-installation visit — including visits where the part itself is supplied free under this warranty.',
  'It does not cover accidental damage, misuse, improper cleaning, alterations or repairs not carried out by us, normal fading or wear of fabric, damage caused by exceeding the recommended operating conditions, or installations in commercial premises.',
  'The warranty applies to the original purchaser at the installation address shown above and is not transferable.',
].join('\n');

/**
 * One-line statement of the parts-only limit, printed directly under the
 * coverage summary so it is read before the expiry dates rather than
 * discovered in the small print after a service call.
 */
export const PARTS_ONLY_BANNER =
  'Parts and replacements only — workmanship and labour are not covered, and our standard service fee applies to every visit.';

/** Everything the certificate needs, pre-fetched by the caller. */
export interface WarrantyPdfData {
  order: {
    order_number: string;
    /** Order date, YYYY-MM-DD — printed for reference only. */
    order_date: string;
  };
  /** Coverage terms and dates, built by `buildWarrantyCoverage`. */
  coverage: WarrantyCoverage;
  customer: {
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    shipping_address_line1: string;
    shipping_address_line2: string;
    shipping_city: string;
    shipping_province: string;
    shipping_postal_code: string;
  };
  company: {
    company_name: string;
    logo_url: string | null;
    email: string;
    phone: string;
    address: string;
  };
  /** Date this copy of the certificate was generated, YYYY-MM-DD. */
  issuedOn: string;
  /** Pre-fetched logo bytes (see `fetchLogo`), or null to omit the logo. */
  logo: Uint8Array | null;
}

/**
 * Draws one "Label   Value" row inside a block, right-aligning the value
 * to the content edge. Values that are empty are skipped by the caller,
 * never printed as a dangling label.
 */
function labelledRow(
  cur: Cursor,
  label: string,
  value: string,
  font: PDFFont,
  bold: PDFFont,
  rightEdge: number
): void {
  cur.ensure(15);
  cur.page.drawText(label, { x: MARGIN, y: cur.y - 10, size: 10, font, color: MUTED });
  drawRight(cur.page, value, rightEdge, cur.y, bold, 10, INK);
  cur.y -= 15;
}

/**
 * Draws a section heading with a rule under it, keeping the heading and
 * at least one following row on the same page.
 */
function sectionHeading(cur: Cursor, text: string, bold: PDFFont, minBodyHeight: number): void {
  cur.gap(10);
  cur.ensure(20 + minBodyHeight);
  cur.line(text, MARGIN, bold, 11, INK, 15);
  cur.rule();
}

/**
 * Renders the warranty certificate and returns its bytes.
 *
 * @throws Error if pdf-lib fails structurally (corrupt logo bytes are
 *         caught internally and the logo simply omitted)
 */
export async function buildWarrantyPdf(data: WarrantyPdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const cur = new Cursor(doc);
  const rightEdge = PAGE_W - MARGIN;

  /* ── Header: logo + company identity (left) vs meta (right) ──── */
  const headerTop = cur.y;
  if (data.logo) {
    try {
      // PNG magic: 0x89 'P' 'N' 'G'
      const isPng = data.logo[0] === 0x89 && data.logo[1] === 0x50;
      const img = isPng ? await doc.embedPng(data.logo) : await doc.embedJpg(data.logo);
      const dims = img.scaleToFit(64, 64);
      cur.page.drawImage(img, {
        x: MARGIN,
        y: cur.y - dims.height,
        width: dims.width,
        height: dims.height,
      });
      cur.y -= dims.height + 6;
    } catch {
      // Corrupt/unsupported image bytes — render without a logo.
    }
  }
  cur.line(data.company.company_name, MARGIN, bold, 16, INK, 20);
  for (const l of [data.company.address, data.company.phone, data.company.email]) {
    if (l) cur.wrapped(l, MARGIN, 280, font, 9, MUTED);
  }

  let metaY = headerTop;
  drawRight(cur.page, 'WARRANTY', rightEdge, metaY, bold, 20);
  metaY -= 22;
  drawRight(cur.page, 'CERTIFICATE', rightEdge, metaY, bold, 20);
  metaY -= 24;
  drawRight(cur.page, data.order.order_number, rightEdge, metaY, font, 11);
  metaY -= 15;
  drawRight(cur.page, `Issued: ${data.issuedOn}`, rightEdge, metaY, font, 9, MUTED);
  metaY -= 12;
  drawRight(cur.page, `Order date: ${data.order.order_date}`, rightEdge, metaY, font, 9, MUTED);
  metaY -= 12;
  cur.y = Math.min(cur.y, metaY);
  cur.gap(12);

  /* ── Buyer information ────────────────────────────────────────── */
  sectionHeading(cur, 'BUYER INFORMATION', bold, 40);
  cur.line(displayName(data.customer), MARGIN, bold, 11, INK, 15);
  const contact = [data.customer.email, data.customer.phone].filter(Boolean).join('  ·  ');
  if (contact) cur.line(contact, MARGIN, font, 9, SOFT, 13);
  const installed = addressLines({
    line1: data.customer.shipping_address_line1,
    line2: data.customer.shipping_address_line2,
    city: data.customer.shipping_city,
    province: data.customer.shipping_province,
    postal: data.customer.shipping_postal_code,
  });
  if (installed.length) {
    cur.gap(4);
    cur.line('Installation address', MARGIN, bold, 9, MUTED, 12);
    for (const l of installed) cur.line(l, MARGIN, font, 9, SOFT, 12);
  }

  /* ── Coverage summary ─────────────────────────────────────────── */
  sectionHeading(cur, 'COVERAGE', bold, 50);
  labelledRow(cur, 'Order number', data.order.order_number, font, bold, rightEdge);
  labelledRow(cur, 'Coverage starts', data.coverage.startsOn, font, bold, rightEdge);
  labelledRow(
    cur,
    `Products covered until (${WARRANTY_YEARS_STANDARD} years)`,
    data.coverage.standardExpiry,
    font,
    bold,
    rightEdge
  );
  if (data.coverage.hasMotorised) {
    labelledRow(
      cur,
      `Motorised parts covered until (${WARRANTY_YEARS_MOTOR} years)`,
      data.coverage.motorExpiry,
      font,
      bold,
      rightEdge
    );
  }

  // The parts-only limit sits with the dates, not in the small print:
  // a customer who reads only the coverage block must still learn that a
  // service fee is coming before they call.
  cur.gap(6);
  cur.wrapped(PARTS_ONLY_BANNER, MARGIN, CONTENT_W, bold, 9, INK);

  /* ── Ten-year product list ────────────────────────────────────── */
  sectionHeading(cur, `COVERED PRODUCTS — ${WARRANTY_YEARS_STANDARD} YEARS`, bold, 16);
  for (const item of data.coverage.standardItems) {
    cur.ensure(14);
    const rowTop = cur.y;
    drawRight(cur.page, item.expiry, rightEdge, rowTop, font, 9, SOFT);
    drawRight(cur.page, `x ${item.quantity}`, rightEdge - 80, rowTop, font, 9, SOFT);
    cur.wrapped(item.label, MARGIN, CONTENT_W - 150, font, 10);
    cur.gap(2);
  }

  /* ── Two-year motorised section (omitted when there is no motor) ─ */
  if (data.coverage.hasMotorised) {
    sectionHeading(cur, `MOTORISED PARTS — ${WARRANTY_YEARS_MOTOR} YEARS`, bold, 30);
    cur.wrapped(
      `Motorised blinds — the motor and its moving parts — are covered for ${WARRANTY_YEARS_MOTOR} years from the coverage start date. The blind itself remains covered for ${WARRANTY_YEARS_STANDARD} years.`,
      MARGIN,
      CONTENT_W,
      font,
      9,
      SOFT
    );
    cur.gap(4);
    for (const item of data.coverage.motorItems) {
      cur.ensure(14);
      const rowTop = cur.y;
      drawRight(cur.page, item.expiry, rightEdge, rowTop, font, 9, SOFT);
      drawRight(cur.page, `x ${item.quantity}`, rightEdge - 80, rowTop, font, 9, SOFT);
      cur.wrapped(item.label, MARGIN, CONTENT_W - 150, font, 10);
      cur.gap(2);
    }
  }

  /* ── Terms ────────────────────────────────────────────────────── */
  sectionHeading(cur, 'WHAT THIS WARRANTY COVERS — AND WHAT IT DOES NOT', bold, 30);
  cur.wrapped(WARRANTY_TERMS, MARGIN, CONTENT_W, font, 9, SOFT);

  /* ── How to claim ─────────────────────────────────────────────── */
  sectionHeading(cur, 'HOW TO CLAIM', bold, 20);
  const claimContact = [data.company.email, data.company.phone].filter(Boolean).join(' or ');
  cur.wrapped(
    claimContact
      ? `Contact ${data.company.company_name} at ${claimContact}, quoting order ${data.order.order_number}. Please keep this certificate — it is your proof of cover.`
      : `Contact ${data.company.company_name}, quoting order ${data.order.order_number}. Please keep this certificate — it is your proof of cover.`,
    MARGIN,
    CONTENT_W,
    font,
    9,
    SOFT
  );

  return doc.save();
}
