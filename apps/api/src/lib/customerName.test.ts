// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins the display-name fallback chain used by every Worker surface that
 * renders a customer (emails, PDFs, internal notifications). A customer
 * may now have no first or last name at all, so the two functions here
 * are the only thing standing between an anonymous row and a document
 * that reads "Hi ," — these cases are the contract.
 */

import { describe, it, expect } from 'vitest';
import { displayName, greetingName } from './customerName';

describe('displayName', () => {
  it('joins both names', () => {
    expect(displayName({ first_name: 'Ada', last_name: 'Lovelace' })).toBe('Ada Lovelace');
  });
  it('uses the first name alone', () => {
    expect(displayName({ first_name: 'Ada', last_name: '' })).toBe('Ada');
  });
  it('uses the last name alone', () => {
    expect(displayName({ first_name: '', last_name: 'Lovelace' })).toBe('Lovelace');
  });
  it('falls back to email', () => {
    expect(displayName({ first_name: '', last_name: '', email: 'a@b.com' })).toBe('a@b.com');
  });
  it('falls back to phone when there is no email', () => {
    expect(displayName({ first_name: '', last_name: '', phone: '416-555-0100' })).toBe(
      '416-555-0100'
    );
  });
  it('prefers email over phone', () => {
    expect(displayName({ email: 'a@b.com', phone: '416-555-0100' })).toBe('a@b.com');
  });
  it('treats whitespace-only names as blank', () => {
    expect(displayName({ first_name: '  ', last_name: ' ', email: 'a@b.com' })).toBe('a@b.com');
  });
  it('handles nulls from the DB', () => {
    expect(displayName({ first_name: null, last_name: null, email: null, phone: null })).toBe(
      'Unnamed customer'
    );
  });
  it('handles a missing customer', () => {
    expect(displayName(null)).toBe('Unnamed customer');
  });
});

describe('greetingName', () => {
  it('prefers the first name', () => {
    expect(greetingName({ first_name: 'Ada', last_name: 'Lovelace' })).toBe('Ada');
  });
  it('uses the last name when there is no first', () => {
    expect(greetingName({ first_name: '', last_name: 'Lovelace' })).toBe('Lovelace');
  });
  it('falls back to a neutral greeting rather than an email address', () => {
    expect(greetingName({ first_name: '', last_name: '', email: 'a@b.com' })).toBe('there');
  });
  it('handles a missing customer', () => {
    expect(greetingName(null)).toBe('there');
  });
});
