// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins the browser-side display-name fallback chain. A customer may now
 * have no first or last name at all, so every list, picker, calendar
 * chip and printed label depends on these cases to render something
 * identifying instead of an empty string.
 *
 * Deliberately duplicates the Worker twin's suite rather than importing
 * it: the two modules are independent copies (like `pricing.ts` /
 * `totals.ts`) and each must be able to fail on its own.
 */

import { describe, it, expect } from 'vitest';
import { displayName } from './customerName';

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
