// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/** Pins the Leads page wording helpers in `leadText.ts`. */

import { describe, it, expect } from 'vitest';
import type { Lead } from '../../types';
import {
  customerNote,
  emailMissing,
  filterFromParam,
  leadAddress,
  leadName,
  leadWants,
  sourceLabel,
} from './leadText';

const base: Pick<Lead, 'street' | 'unit' | 'city' | 'province' | 'postal_code'> = {
  street: '12 Elm St',
  unit: '',
  city: 'Ottawa',
  province: 'ON',
  postal_code: 'K1A 0B1',
};

describe('filterFromParam', () => {
  it('defaults to new and accepts every chip', () => {
    expect(filterFromParam(null)).toBe('new');
    expect(filterFromParam('bogus')).toBe('new');
    expect(filterFromParam('all')).toBe('all');
    expect(filterFromParam('archived')).toBe('archived');
  });
});

describe('leadName', () => {
  it('falls back to the email', () => {
    expect(leadName({ first_name: 'Jane', last_name: 'Doe', email: 'j@x.ca' })).toBe('Jane Doe');
    expect(leadName({ first_name: '', last_name: ' ', email: 'j@x.ca' })).toBe('j@x.ca');
  });
});

describe('leadAddress', () => {
  it('joins parts and skips blanks', () => {
    expect(leadAddress(base)).toBe('12 Elm St, Ottawa, ON K1A 0B1');
    expect(leadAddress({ ...base, unit: '4' })).toBe('12 Elm St, Unit 4, Ottawa, ON K1A 0B1');
    expect(leadAddress({ street: '', unit: '', city: '', province: '', postal_code: '' })).toBe('');
  });
});

describe('leadWants', () => {
  it('labels coverings and the window bucket', () => {
    expect(leadWants({ coverings: ['zebra', 'smart'], window_count: '5-15' })).toBe(
      'Zebra, Smart / Motorized · 5–15 windows'
    );
    expect(leadWants({ coverings: [], window_count: '15+' })).toBe('15+ windows');
    expect(leadWants({ coverings: ['venetian'], window_count: '' })).toBe('venetian');
  });
});

describe('customerNote', () => {
  const customer = { id: 'c1', first_name: 'Jane', last_name: 'Doe', deleted_at: null };
  it('describes each link state', () => {
    expect(customerNote({ customer, customer_match: 'created' })).toMatch(/^New customer/);
    expect(customerNote({ customer, customer_match: 'matched' })).toMatch(/^Existing customer/);
    expect(customerNote({ customer: { ...customer, deleted_at: '2026-11-01' }, customer_match: 'matched' })).toMatch(/deleted/);
    expect(customerNote({ customer: null, customer_match: 'created' })).toMatch(/removed/);
  });
});

describe('emailMissing', () => {
  const now = Date.parse('2026-11-04T12:00:00Z');
  it('flags only an unsent email older than two minutes', () => {
    expect(emailMissing({ email_sent_at: null, created_at: '2026-11-04T11:59:00Z' }, now)).toBe(false);
    expect(emailMissing({ email_sent_at: null, created_at: '2026-11-04T11:50:00Z' }, now)).toBe(true);
    expect(emailMissing({ email_sent_at: '2026-11-04T11:50:01Z', created_at: '2026-11-04T11:50:00Z' }, now)).toBe(false);
  });
});

describe('sourceLabel', () => {
  it('drops the protocol and trailing slash', () => {
    expect(sourceLabel('https://blindsnisa.com/free-estimate/')).toBe('blindsnisa.com/free-estimate');
    expect(sourceLabel('')).toBe('');
  });
});
