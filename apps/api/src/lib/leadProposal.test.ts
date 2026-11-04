// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins the lead "Propose visit" flow in `leadProposal.ts`:
 *   - the email thanks the visitor, shows the proposed window, escapes every
 *     visitor string, and points both buttons at the public appointment page
 *   - email FIRST: a failed send writes nothing (502)
 *   - a first proposal inserts a `proposed` ESTIMATE visit for the linked
 *     customer; a second one re-times the same visit and keeps its token
 *   - a missing lead is 404, a deleted customer is 409, and neither sends
 *
 * Resend is reached through a stubbed `fetch`; Supabase is a scripted fake.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildLeadProposalHtml, leadProposalSubject, sendLeadProposal } from './leadProposal';
import type { Env } from '../index';

const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
  RESEND_API_KEY: 'x',
  APP_URL: 'https://app.example',
  ENVIRONMENT: 'test',
} as unknown as Env;

const LEAD_ID = '11111111-2222-4333-8444-555555555555';
const TOKEN = '99999999-8888-4777-8666-555555555555';
const INPUT = { appointment_date: '2026-11-06', appointment_time: '10:00' };

/** Scripted rows plus every chain call per table. */
const db = {
  lead: null as Record<string, unknown> | null,
  existing: null as Record<string, unknown> | null,
  ops: [] as Array<{ table: string; calls: Array<[string, unknown[]]> }>,
};

function fakeSb() {
  return {
    from(table: string) {
      const op = { table, calls: [] as Array<[string, unknown[]]> };
      db.ops.push(op);
      const b: Record<string, unknown> = {};
      for (const n of ['select', 'eq', 'insert', 'update']) {
        b[n] = (...a: unknown[]) => {
          op.calls.push([n, a]);
          return b;
        };
      }
      const wrote = () => op.calls.some(([n]) => n === 'insert' || n === 'update');
      b.maybeSingle = () =>
        Promise.resolve({ data: table === 'leads' ? db.lead : db.existing, error: null });
      b.single = () =>
        Promise.resolve({
          data: table === 'company_settings' ? { id: 1, company_name: 'Blinds Nisa' } : wrote() ? { id: 'appt-1' } : null,
          error: null,
        });
      return b;
    },
  } as never;
}

const fetchMock = vi.fn();

beforeEach(() => {
  db.ops = [];
  db.existing = null;
  db.lead = {
    id: LEAD_ID,
    first_name: 'Jane',
    last_name: 'Doe',
    email: 'jane@example.com',
    street: '12 Elm St',
    unit: '',
    city: 'Ottawa',
    province: 'ON',
    postal_code: 'K1A 0B1',
    appointment_id: null,
    customer: { id: 'cust-1', deleted_at: null },
  };
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

/** The JSON body sent to Resend. */
const sentEmail = () => JSON.parse(fetchMock.mock.calls[0][1].body as string);
/** Every write against `appointments`. */
const apptWrites = () =>
  db.ops.filter((o) => o.table === 'appointments' && o.calls.some(([n]) => n === 'insert' || n === 'update'));

describe('buildLeadProposalHtml', () => {
  const base = {
    company: { name: 'Blinds Nisa' },
    firstName: 'Jane',
    fullName: 'Jane Doe',
    locationText: '12 Elm St, Ottawa, ON K1A 0B1',
    dateText: 'Friday, November 6, 2026',
    startText: '10:00 AM',
    endText: '11:00 AM',
    viewUrl: 'https://app.example/appointment/abc',
  };

  it('thanks the visitor and proposes the window with confirm / another-time buttons', () => {
    const html = buildLeadProposalHtml(base);
    expect(html).toContain('Thank you for your request');
    expect(html).toContain('Proposed estimate visit');
    expect(html).toContain('<strong>10:00 AM</strong> and <strong>11:00 AM</strong>');
    expect(html).toContain('Confirm this time');
    expect(html).toContain('Request another time');
    expect(html.match(/href="https:\/\/app\.example\/appointment\/abc"/g)).toHaveLength(2);
    expect(html).toContain('12 Elm St, Ottawa');
  });

  it('puts the time on its own unbreakable line and stacks the buttons', () => {
    const html = buildLeadProposalHtml(base);
    const nw = (t: string) => `<span style="white-space:nowrap;">${t}</span>`;
    expect(html).toContain(`${nw('Friday,')} ${nw('November 6, 2026')}<br>${nw('10:00 AM &ndash; 11:00 AM')}`);
    // One button per row: two separate blocks, no side-by-side table cells.
    expect(html).not.toContain('width="50%"');
    expect(html.indexOf('Confirm this time')).toBeLessThan(html.indexOf('Request another time'));
  });

  it('tightens the side padding on phones', () => {
    const html = buildLeadProposalHtml(base);
    expect(html).toContain('@media only screen and (max-width:600px)');
    expect(html).toContain('class="bn-pad"');
    expect(html).toContain('class="bn-card"');
  });

  it('escapes visitor text and drops a blank location row', () => {
    const html = buildLeadProposalHtml({
      ...base,
      firstName: '<b>Jane</b>',
      fullName: '<img src=x>',
      locationText: '  ',
      message: '<script>alert(1)</script>',
    });
    expect(html).not.toContain('<b>Jane</b>');
    expect(html).not.toContain('<img src=x>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('>Location<');
  });

  it('names the day in the subject', () => {
    expect(leadProposalSubject('Friday, November 6, 2026')).toBe(
      'Thank you! Your free in-home estimate: proposed for Friday, November 6, 2026'
    );
  });
});

describe('sendLeadProposal', () => {
  it('emails the visitor, then books a proposed estimate visit for the linked customer', async () => {
    const res = await sendLeadProposal(ENV, fakeSb(), LEAD_ID, { ...INPUT, message: 'Hi!' });
    expect(res).toEqual({ ok: true, appointmentId: 'appt-1', email: 'jane@example.com' });

    const mail = sentEmail();
    expect(mail.to).toEqual(['jane@example.com']);
    expect(mail.subject).toContain('Friday, November 6, 2026');
    expect(mail.html).toContain('Hi!');

    const [write] = apptWrites();
    const row = write.calls.find(([n]) => n === 'insert')![1][0] as Record<string, unknown>;
    expect(row).toMatchObject({
      kind: 'estimate',
      customer_id: 'cust-1',
      status: 'proposed',
      appointment_date: '2026-11-06',
      appointment_time: '10:00',
      confirmed_at: null,
    });
    // The emailed link carries the token the row was saved with.
    expect(mail.html).toContain(`https://app.example/appointment/${row.public_token as string}`);
  });

  it('re-times the existing visit and keeps its public token', async () => {
    db.lead = { ...db.lead, appointment_id: 'appt-1' };
    db.existing = { id: 'appt-1', public_token: TOKEN };
    const res = await sendLeadProposal(ENV, fakeSb(), LEAD_ID, INPUT);
    expect(res.ok).toBe(true);
    expect(sentEmail().html).toContain(`/appointment/${TOKEN}`);
    const [write] = apptWrites();
    expect(write.calls.some(([n]) => n === 'insert')).toBe(false);
    expect(write.calls).toContainEqual(['eq', ['id', 'appt-1']]);
    expect(write.calls.find(([n]) => n === 'update')![1][0]).toMatchObject({ status: 'proposed', reminder_sent_at: null });
  });

  it('writes nothing when the email fails', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ message: 'Resend down' }), { status: 500 }));
    const res = await sendLeadProposal(ENV, fakeSb(), LEAD_ID, INPUT);
    expect(res).toMatchObject({ ok: false, status: 502 });
    expect(apptWrites()).toHaveLength(0);
  });

  it('404s a missing lead and 409s a deleted customer, without sending', async () => {
    db.lead = null;
    expect(await sendLeadProposal(ENV, fakeSb(), LEAD_ID, INPUT)).toMatchObject({ ok: false, status: 404 });
    db.lead = { id: LEAD_ID, customer: { id: 'cust-1', deleted_at: '2026-11-01' } };
    expect(await sendLeadProposal(ENV, fakeSb(), LEAD_ID, INPUT)).toMatchObject({ ok: false, status: 409 });
    db.lead = { id: LEAD_ID, customer: null };
    expect(await sendLeadProposal(ENV, fakeSb(), LEAD_ID, INPUT)).toMatchObject({ ok: false, status: 409 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
