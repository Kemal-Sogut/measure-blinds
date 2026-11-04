// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins the website lead payload rules (`leadSchema.ts`). These must keep
 * agreeing with the embed's client-side RULES, so a payload the form
 * accepts is never refused here: the first test is exactly what
 * `lead-form.js` posts.
 */

import { describe, it, expect } from 'vitest';
import { leadInputSchema, looksLikeBot, phoneDigits, MIN_FILL_MS } from './leadSchema';
import { FORM_PAYLOAD } from './leadFixture';


describe('leadInputSchema', () => {
  it('accepts the form payload and normalises it', () => {
    const r = leadInputSchema.parse(FORM_PAYLOAD);
    expect(r.first_name).toBe('Jane');
    expect(r.email).toBe('jane.doe@example.com');
    expect(r.postal_code).toBe('K1A 0B1');
  });

  it('defaults the optional fields an older embed did not send', () => {
    const { message: _m, fill_ms: _f, unit: _u, ...older } = FORM_PAYLOAD;
    const r = leadInputSchema.parse(older);
    expect(r.message).toBe('');
    expect(r.unit).toBe('');
    expect(r.fill_ms).toBeUndefined();
  });

  it.each([
    ['unknown key', { extra: 1 }],
    ['money-like key', { total: 0 }],
    ['blank first name', { first_name: '  ' }],
    ['short phone', { phone: '555-0123' }],
    ['bad email', { email: 'jane@' }],
    ['US zip', { postal_code: '90210' }],
    ['unknown province', { province: 'XX' }],
    ['no coverings', { coverings: [] }],
    ['unknown covering', { coverings: ['venetian'] }],
    ['duplicate covering', { coverings: ['zebra', 'zebra'] }],
    ['unknown window count', { window_count: '100' }],
    ['no consent', { consent: false }],
    ['message too long', { message: 'x'.repeat(1001) }],
  ])('rejects %s', (_label, patch) => {
    expect(leadInputSchema.safeParse({ ...FORM_PAYLOAD, ...patch }).success).toBe(false);
  });

  it('accepts an 11-digit number with a leading 1', () => {
    expect(leadInputSchema.safeParse({ ...FORM_PAYLOAD, phone: '+1 613 555 0123' }).success).toBe(true);
    expect(phoneDigits('+1 613 555 0123')).toBe('6135550123');
  });
});

describe('looksLikeBot', () => {
  it('flags a filled honeypot', () => {
    expect(looksLikeBot({ website: 'http://spam.example', fill_ms: 60_000 })).toBe(true);
  });
  it('flags a submit faster than a person can fill four steps', () => {
    expect(looksLikeBot({ website: '', fill_ms: MIN_FILL_MS - 1 })).toBe(true);
  });
  it('passes a normal submit, and one from an embed that does not report fill time', () => {
    expect(looksLikeBot({ website: '', fill_ms: MIN_FILL_MS })).toBe(false);
    expect(looksLikeBot({ website: '', fill_ms: undefined })).toBe(false);
  });
});
