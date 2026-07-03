// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * PDF generation — @react-pdf/renderer layout per IMPLEMENTATION.md §10:
 * company header (logo + contact info), estimate meta (order number,
 * dates), bill-to/ship-to blocks, line items (title + qty + total on
 * one line, attributes indented below), totals with the HST number in
 * small print, and the terms & conditions snapshot.
 *
 * Written with `React.createElement` (aliased `h`) instead of JSX so
 * the module keeps the exact `pdf.ts` filename from the plan without
 * a build-config change. Runs in the Worker via the `nodejs_compat`
 * flag (Buffer/stream shims) and in vitest under Node for unit tests.
 *
 * Remote logos are pre-fetched into a buffer here — @react-pdf's own
 * URL loader is unreliable under workerd; a failed logo fetch (or an
 * SVG logo, which react-pdf cannot rasterize) simply omits the logo
 * rather than failing the document.
 */

import { createElement as h, type ReactElement } from 'react';
import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
  renderToBuffer,
  type DocumentProps,
} from '@react-pdf/renderer';

/** Everything the PDF needs, pre-fetched by the route. */
export interface PdfEstimateData {
  estimate: {
    order_number: string;
    estimate_date: string;
    expiry_date: string;
    subtotal: number;
    discount_amount: number;
    taxable_amount: number;
    tax_amount: number;
    total: number;
  };
  line_items: Array<{
    item_type: string;
    room_name: string | null;
    blinds_type: string | null;
    panels: number[] | null;
    height_cm: number | null;
    fabric_name: string | null;
    cassette_name: string | null;
    control_name: string | null;
    description: string | null;
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

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: 'Helvetica', color: '#212529' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24 },
  logo: { width: 64, height: 64, objectFit: 'contain' },
  companyName: { fontSize: 16, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  muted: { color: '#868e96' },
  h1: { fontSize: 20, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  metaBlock: { alignItems: 'flex-end' },
  addressRow: { flexDirection: 'row', gap: 24, marginBottom: 20 },
  addressCol: { flex: 1 },
  addressTitle: { fontFamily: 'Helvetica-Bold', marginBottom: 4, fontSize: 9, color: '#868e96' },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  itemTitle: { fontFamily: 'Helvetica-Bold', flex: 1 },
  itemAttrs: { marginLeft: 12, marginTop: 2, color: '#495057' },
  divider: { borderBottomWidth: 1, borderBottomColor: '#dee2e6', marginVertical: 10 },
  totalsBox: { alignSelf: 'flex-end', width: 220, marginTop: 12 },
  totalsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  totalsFinal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#212529',
    paddingTop: 4,
    marginTop: 4,
    fontFamily: 'Helvetica-Bold',
    fontSize: 12,
  },
  hstNote: { fontSize: 7, color: '#868e96' },
  terms: { marginTop: 24, fontSize: 8, color: '#495057' },
  termsTitle: { fontFamily: 'Helvetica-Bold', fontSize: 9, marginBottom: 4 },
});

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
function itemContent(li: PdfEstimateData['line_items'][number]): {
  title: string;
  attrs: string[];
} {
  if (li.item_type === 'blind') {
    const title = [li.room_name || 'Blind', li.blinds_type].filter(Boolean).join(' — ');
    const attrs = [
      li.panels?.length
        ? `Panels: ${li.panels.join(' + ')} cm (total ${li.panels.reduce((a, b) => a + b, 0)} cm) × H ${li.height_cm} cm`
        : null,
      li.fabric_name ? `Fabric: ${li.fabric_name}` : null,
      li.cassette_name ? `Cassette: ${li.cassette_name}` : null,
      li.control_name ? `Control: ${li.control_name}` : null,
    ].filter((x): x is string => Boolean(x));
    return { title, attrs };
  }
  return { title: li.description || 'Item', attrs: [] };
}

/** Assembles the full react-pdf document tree. */
function buildDocument(d: PdfEstimateData): ReactElement<DocumentProps> {
  const ship = addressLines({
    line1: d.customer.shipping_address_line1,
    line2: d.customer.shipping_address_line2,
    city: d.customer.shipping_city,
    province: d.customer.shipping_province,
    postal: d.customer.shipping_postal_code,
  });
  const bill = d.customer.billing_same_as_shipping
    ? ship
    : addressLines({
        line1: d.customer.billing_address_line1,
        line2: d.customer.billing_address_line2,
        city: d.customer.billing_city,
        province: d.customer.billing_province,
        postal: d.customer.billing_postal_code,
      });
  const customerName = `${d.customer.first_name} ${d.customer.last_name}`;

  return h(
    Document,
    { title: `Estimate ${d.estimate.order_number}` } as DocumentProps,
    h(
      Page,
      { size: 'LETTER', style: styles.page },
      // Header: company identity vs. estimate meta
      h(
        View,
        { style: styles.headerRow },
        h(
          View,
          {},
          d.logo ? h(Image, { src: { data: Buffer.from(d.logo), format: 'png' }, style: styles.logo }) : null,
          h(Text, { style: styles.companyName }, d.company.company_name),
          d.company.address ? h(Text, { style: styles.muted }, d.company.address) : null,
          d.company.phone ? h(Text, { style: styles.muted }, d.company.phone) : null,
          d.company.email ? h(Text, { style: styles.muted }, d.company.email) : null
        ),
        h(
          View,
          { style: styles.metaBlock },
          h(Text, { style: styles.h1 }, 'ESTIMATE'),
          h(Text, {}, d.estimate.order_number),
          h(Text, { style: styles.muted }, `Date: ${d.estimate.estimate_date}`),
          h(Text, { style: styles.muted }, `Valid until: ${d.estimate.expiry_date}`)
        )
      ),
      // Bill-to / Ship-to
      h(
        View,
        { style: styles.addressRow },
        h(
          View,
          { style: styles.addressCol },
          h(Text, { style: styles.addressTitle }, 'BILL TO'),
          h(Text, {}, customerName),
          ...bill.map((line, i) => h(Text, { key: `b${i}`, style: styles.muted }, line))
        ),
        h(
          View,
          { style: styles.addressCol },
          h(Text, { style: styles.addressTitle }, 'SHIP TO'),
          h(Text, {}, customerName),
          ...ship.map((line, i) => h(Text, { key: `s${i}`, style: styles.muted }, line))
        )
      ),
      h(View, { style: styles.divider }),
      // Line items
      ...d.line_items.map((li, idx) => {
        const { title, attrs } = itemContent(li);
        return h(
          View,
          { key: `li${idx}`, wrap: false },
          h(
            View,
            { style: styles.itemRow },
            h(Text, { style: styles.itemTitle }, title),
            h(Text, {}, `× ${li.quantity}`),
            h(Text, { style: { width: 70, textAlign: 'right' } }, money(li.line_total))
          ),
          ...attrs.map((a, i) => h(Text, { key: `a${i}`, style: styles.itemAttrs }, a))
        );
      }),
      // Totals
      h(
        View,
        { style: styles.totalsBox },
        h(
          View,
          { style: styles.totalsRow },
          h(Text, { style: styles.muted }, 'Subtotal'),
          h(Text, {}, money(d.estimate.subtotal))
        ),
        d.estimate.discount_amount > 0
          ? h(
              View,
              { style: styles.totalsRow },
              h(Text, { style: styles.muted }, 'Discount'),
              h(Text, {}, `-${money(d.estimate.discount_amount)}`)
            )
          : null,
        d.estimate.discount_amount > 0
          ? h(
              View,
              { style: styles.totalsRow },
              h(Text, { style: styles.muted }, 'Taxable amount'),
              h(Text, {}, money(d.estimate.taxable_amount))
            )
          : null,
        h(
          View,
          { style: styles.totalsRow },
          h(
            View,
            {},
            h(Text, { style: styles.muted }, 'HST 13%'),
            d.company.hst_number
              ? h(Text, { style: styles.hstNote }, `HST# ${d.company.hst_number}`)
              : null
          ),
          h(Text, {}, money(d.estimate.tax_amount))
        ),
        h(
          View,
          { style: styles.totalsFinal },
          h(Text, {}, 'Total'),
          h(Text, {}, money(d.estimate.total))
        )
      ),
      // Terms
      d.terms
        ? h(
            View,
            { style: styles.terms },
            h(Text, { style: styles.termsTitle }, 'Terms & Conditions'),
            h(Text, {}, d.terms)
          )
        : null
    )
  );
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
 * Renders the estimate PDF and returns its bytes.
 *
 * @throws Error if @react-pdf fails to render (malformed inputs)
 */
export async function buildEstimatePdf(data: PdfEstimateData): Promise<Uint8Array> {
  const buffer = await renderToBuffer(buildDocument(data));
  return new Uint8Array(buffer);
}
