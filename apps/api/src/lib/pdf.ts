// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * PDF generation — order documents (Estimate or Invoice):
 * company header (logo + contact info), document meta (order number,
 * dates), bill-to/ship-to blocks, line items (title + qty + total on
 * one line, attributes indented below), totals with the HST number in
 * small print, and the terms & conditions snapshot.
 *
 * DOCUMENT TYPE: `docType` decides the title and the tail. An
 * 'estimate' (no payments yet) prints exactly as before. An 'invoice'
 * (once at least one payment is recorded) adds a payments list plus an
 * "Amount paid" / "Balance due" block after the totals.
 *
 * ENGINE NOTE: built with `pdf-lib` (pure JavaScript). The originally
 * planned @react-pdf/renderer cannot run on Cloudflare Workers — its
 * yoga-layout engine compiles WASM at runtime, which workerd forbids
 * ("Wasm code generation disallowed by embedder"; verified on v3 and
 * v4). pdf-lib needs no WASM, no React, and no nodejs_compat shims,
 * runs identically under workerd and Node (vitest), and cuts the
 * Worker bundle by megabytes. Layout is a simple top-down cursor with
 * word-wrapping and automatic page breaks.
 */

import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';

/** A single recorded payment, printed on invoices. */
export interface PdfPayment {
  amount: number;
  paid_on: string;
  note: string;
}

/** Everything the PDF needs, pre-fetched by the route. */
export interface PdfDocumentData {
  /** 'estimate' (default look) or 'invoice' (adds payments + balance). */
  docType: 'estimate' | 'invoice';
  order: {
    order_number: string;
    order_date: string;
    expiry_date: string;
    subtotal: number;
    discount_amount: number;
    taxable_amount: number;
    tax_amount: number;
    total: number;
    /** Sum of all recorded payments (0 for an estimate). */
    amount_paid: number;
    /** total − amount_paid. */
    balance: number;
  };
  /** Recorded payments, oldest-first (empty for an estimate). */
  payments: PdfPayment[];
  line_items: Array<{
    item_type: string;
    room_name: string | null;
    blinds_type: string | null;
    panels: number[] | null;
    height_cm: number | null;
    fabric_name: string | null;
    cassette_name: string | null;
    control_name: string | null;
    color?: string | null;
    description: string | null;
    note?: string | null;
    quantity: number;
    unit_price: number;
    line_total: number;
  }>;
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
    billing_same_as_shipping: boolean;
    billing_address_line1: string;
    billing_address_line2: string;
    billing_city: string;
    billing_province: string;
    billing_postal_code: string;
  };
  company: {
    company_name: string;
    logo_url: string | null;
    email: string;
    phone: string;
    address: string;
    hst_number: string;
  };
  /** T&C text to print (the snapshot for sent estimates) */
  terms: string;
  /** Pre-fetched logo bytes, or null to omit the logo */
  logo: Uint8Array | null;
}

/* ── Page + palette constants (US Letter, 40pt margins) ─────────── */
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;

const INK = rgb(0.13, 0.145, 0.16); // #212529
const MUTED = rgb(0.53, 0.56, 0.59); // #868e96
const SOFT = rgb(0.29, 0.31, 0.34); // #495057
const LINE = rgb(0.87, 0.89, 0.9); // #dee2e6

/** Formats money for print. */
function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** Builds one address block's lines, skipping empties. */
function addressLines(a: {
  line1: string;
  line2: string;
  city: string;
  province: string;
  postal: string;
}): string[] {
  return [a.line1, a.line2, [a.city, a.province, a.postal].filter(Boolean).join(', ')].filter(
    Boolean
  );
}

/** Human title + indented attribute lines for one line item. */
export function itemContent(li: PdfDocumentData['line_items'][number]): {
  title: string;
  attrs: string[];
} {
  if (li.item_type === 'blind') {
    const title = [li.room_name || 'Blind', li.blinds_type].filter(Boolean).join(' — ');
    const attrs = [
      li.panels?.length
        ? `Panels: ${li.panels.join(' + ')} cm (total ${li.panels.reduce((a, b) => a + b, 0)} cm) x H ${li.height_cm} cm`
        : null,
      li.fabric_name ? `Fabric: ${li.fabric_name}` : null,
      li.cassette_name ? `Cassette: ${li.cassette_name}` : null,
      li.control_name ? `Control: ${li.control_name}` : null,
      li.color?.trim() ? `Color: ${li.color.trim()}` : null,
      li.note?.trim() ? `Note: ${li.note.trim()}` : null,
    ].filter((x): x is string => Boolean(x));
    return { title, attrs };
  }
  return { title: li.description || 'Item', attrs: [] };
}

/**
 * Greedy word-wrap: splits `text` into lines that fit `maxWidth` at
 * the given font/size. Overlong single words are hard-broken.
 */
function wrapText(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let current = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        // hard-break words wider than the column
        let chunk = word;
        while (font.widthOfTextAtSize(chunk, size) > maxWidth && chunk.length > 1) {
          let cut = chunk.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(chunk.slice(0, cut), size) > maxWidth) cut--;
          lines.push(chunk.slice(0, cut));
          chunk = chunk.slice(cut);
        }
        current = chunk;
      }
    }
    lines.push(current);
  }
  return lines.length ? lines : [''];
}

/**
 * Top-down layout cursor: tracks the current page and y position,
 * adds pages automatically when content would cross the bottom margin.
 */
class Cursor {
  page: PDFPage;
  y: number;

  constructor(private doc: PDFDocument) {
    this.page = doc.addPage([PAGE_W, PAGE_H]);
    this.y = PAGE_H - MARGIN;
  }

  /** Ensures `height` points fit on the current page, else adds one. */
  ensure(height: number): void {
    if (this.y - height < MARGIN) {
      this.page = this.doc.addPage([PAGE_W, PAGE_H]);
      this.y = PAGE_H - MARGIN;
    }
  }

  /** Draws one text line at x and advances the cursor. */
  line(
    text: string,
    x: number,
    font: PDFFont,
    size: number,
    color = INK,
    advance = size + 3
  ): void {
    this.ensure(advance);
    this.page.drawText(text, { x, y: this.y - size, size, font, color });
    this.y -= advance;
  }

  /** Draws wrapped text and advances past all lines. */
  wrapped(
    text: string,
    x: number,
    maxWidth: number,
    font: PDFFont,
    size: number,
    color = INK
  ): void {
    for (const l of wrapText(font, text, size, maxWidth)) {
      this.line(l, x, font, size, color);
    }
  }

  /** Horizontal rule across the content width. */
  rule(): void {
    this.ensure(12);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y - 6 },
      end: { x: PAGE_W - MARGIN, y: this.y - 6 },
      thickness: 1,
      color: LINE,
    });
    this.y -= 12;
  }

  /** Extra vertical gap. */
  gap(points: number): void {
    this.ensure(points);
    this.y -= points;
  }
}

/** Right-aligned text at the given baseline-top y. */
function drawRight(
  page: PDFPage,
  text: string,
  rightX: number,
  yTop: number,
  font: PDFFont,
  size: number,
  color = INK
): void {
  page.drawText(text, {
    x: rightX - font.widthOfTextAtSize(text, size),
    y: yTop - size,
    size,
    font,
    color,
  });
}

/**
 * Fetches the company logo into bytes for embedding. Returns null on
 * any failure or non-raster format so the PDF renders without a logo
 * instead of erroring.
 */
export async function fetchLogo(logoUrl: string | null): Promise<Uint8Array | null> {
  if (!logoUrl) return null;
  try {
    const res = await fetch(logoUrl);
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (!/image\/(png|jpe?g)/.test(type)) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Renders the order document (Estimate or Invoice) and returns its
 * bytes.
 *
 * @throws Error if pdf-lib fails (e.g. corrupt logo bytes are caught
 *         internally and skipped; only structural failures propagate)
 */
export async function buildDocumentPdf(data: PdfDocumentData): Promise<Uint8Array> {
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

  // Right-hand meta block, anchored to the header top.
  const isInvoice = data.docType === 'invoice';
  let metaY = headerTop;
  drawRight(cur.page, isInvoice ? 'INVOICE' : 'ESTIMATE', rightEdge, metaY, bold, 20);
  metaY -= 24;
  drawRight(cur.page, data.order.order_number, rightEdge, metaY, font, 11);
  metaY -= 15;
  drawRight(cur.page, `Date: ${data.order.order_date}`, rightEdge, metaY, font, 9, MUTED);
  metaY -= 12;
  // Estimates advertise a validity window; invoices don't expire.
  if (!isInvoice) {
    drawRight(cur.page, `Valid until: ${data.order.expiry_date}`, rightEdge, metaY, font, 9, MUTED);
    metaY -= 12;
  }
  cur.y = Math.min(cur.y, metaY);
  cur.gap(12);

  /* ── Bill-to / Ship-to ────────────────────────────────────────── */
  const ship = addressLines({
    line1: data.customer.shipping_address_line1,
    line2: data.customer.shipping_address_line2,
    city: data.customer.shipping_city,
    province: data.customer.shipping_province,
    postal: data.customer.shipping_postal_code,
  });
  const bill = data.customer.billing_same_as_shipping
    ? ship
    : addressLines({
        line1: data.customer.billing_address_line1,
        line2: data.customer.billing_address_line2,
        city: data.customer.billing_city,
        province: data.customer.billing_province,
        postal: data.customer.billing_postal_code,
      });
  const customerName = `${data.customer.first_name} ${data.customer.last_name}`;
  const colX = [MARGIN, MARGIN + CONTENT_W / 2];
  const blockTop = cur.y;
  for (const [i, [title, lines]] of ([['BILL TO', bill], ['SHIP TO', ship]] as const).entries()) {
    let y = blockTop;
    cur.page.drawText(title, { x: colX[i], y: y - 9, size: 9, font: bold, color: MUTED });
    y -= 13;
    cur.page.drawText(customerName, { x: colX[i], y: y - 10, size: 10, font, color: INK });
    y -= 14;
    for (const l of lines) {
      cur.page.drawText(l, { x: colX[i], y: y - 9, size: 9, font, color: MUTED });
      y -= 12;
    }
    if (i === 1 || bill.length >= ship.length) cur.y = Math.min(cur.y, y);
  }
  cur.gap(8);
  cur.rule();

  /* ── Line items: title + qty + total, attributes indented ─────── */
  for (const li of data.line_items) {
    const { title, attrs } = itemContent(li);
    cur.ensure(16 + attrs.length * 12);
    const rowTop = cur.y;
    drawRight(cur.page, money(li.line_total), rightEdge, rowTop, bold, 10);
    drawRight(cur.page, `x ${li.quantity}`, rightEdge - 70, rowTop, font, 10, SOFT);
    cur.wrapped(title, MARGIN, CONTENT_W - 130, bold, 10);
    for (const a of attrs) cur.wrapped(a, MARGIN + 12, CONTENT_W - 142, font, 9, SOFT);
    cur.gap(6);
  }

  /* ── Totals box (right-aligned column) ────────────────────────── */
  cur.gap(8);
  const labelX = rightEdge - 220;
  const totalsRow = (label: string, value: string, f: PDFFont, size: number, color = INK) => {
    cur.ensure(size + 5);
    cur.page.drawText(label, { x: labelX, y: cur.y - size, size, font: f, color: MUTED });
    drawRight(cur.page, value, rightEdge, cur.y, f, size, color);
    cur.y -= size + 5;
  };
  totalsRow('Subtotal', money(data.order.subtotal), font, 10);
  if (data.order.discount_amount > 0) {
    totalsRow('Discount', `-${money(data.order.discount_amount)}`, font, 10);
    totalsRow('Taxable amount', money(data.order.taxable_amount), font, 10);
  }
  totalsRow('HST 13%', money(data.order.tax_amount), font, 10);
  if (data.company.hst_number) {
    cur.ensure(10);
    cur.page.drawText(`HST# ${data.company.hst_number}`, {
      x: labelX,
      y: cur.y - 7,
      size: 7,
      font,
      color: MUTED,
    });
    cur.y -= 10;
  }
  cur.ensure(20);
  cur.page.drawLine({
    start: { x: labelX, y: cur.y - 2 },
    end: { x: rightEdge, y: cur.y - 2 },
    thickness: 1,
    color: INK,
  });
  cur.y -= 6;
  cur.ensure(16);
  cur.page.drawText('Total', { x: labelX, y: cur.y - 12, size: 12, font: bold, color: INK });
  drawRight(cur.page, money(data.order.total), rightEdge, cur.y, bold, 12);
  cur.y -= 18;

  /* ── Invoice tail: payments + balance due ─────────────────────── */
  if (isInvoice) {
    totalsRow('Amount paid', `-${money(data.order.amount_paid)}`, font, 10);
    cur.ensure(18);
    cur.page.drawText('Balance due', { x: labelX, y: cur.y - 12, size: 12, font: bold, color: INK });
    drawRight(cur.page, money(data.order.balance), rightEdge, cur.y, bold, 12);
    cur.y -= 18;

    if (data.payments.length) {
      cur.gap(10);
      cur.line('Payments received', MARGIN, bold, 9, INK, 13);
      for (const p of data.payments) {
        const label = p.note ? `${p.paid_on} — ${p.note}` : p.paid_on;
        cur.ensure(12);
        cur.page.drawText(label, { x: MARGIN + 12, y: cur.y - 9, size: 9, font, color: SOFT });
        drawRight(cur.page, money(p.amount), rightEdge, cur.y, font, 9, SOFT);
        cur.y -= 12;
      }
    }
  }

  /* ── Terms & conditions ───────────────────────────────────────── */
  if (data.terms) {
    cur.gap(16);
    cur.line('Terms & Conditions', MARGIN, bold, 9, INK, 13);
    cur.wrapped(data.terms, MARGIN, CONTENT_W, font, 8, SOFT);
  }

  return doc.save();
}
