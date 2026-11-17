// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Unit tests for the staff-app CORS allow-list: exact origins only, so a
 * hostname that merely CONTAINS an allowed name is refused.
 */

import { describe, it, expect } from 'vitest';
import { allowedStaffOrigin, parseOriginList } from './corsOrigin';

describe('allowedStaffOrigin', () => {
  it('allows the deployed web app', () => {
    const o = 'https://measure-blinds.blindsnisa.workers.dev';
    expect(allowedStaffOrigin(o)).toBe(o);
  });

  it('allows local development on any port', () => {
    expect(allowedStaffOrigin('http://localhost:5173')).toBe('http://localhost:5173');
    expect(allowedStaffOrigin('http://127.0.0.1:4173')).toBe('http://127.0.0.1:4173');
  });

  it('refuses hostnames that only contain an allowed name', () => {
    expect(allowedStaffOrigin('https://localhost.evil.example')).toBe('');
    expect(allowedStaffOrigin('https://evil-localhost.example')).toBe('');
    expect(allowedStaffOrigin('https://127.0.0.1.evil.example')).toBe('');
    expect(allowedStaffOrigin('https://measure-blinds.blindsnisa.workers.dev.evil.example')).toBe('');
  });

  it('refuses a missing or malformed origin', () => {
    expect(allowedStaffOrigin(undefined)).toBe('');
    expect(allowedStaffOrigin('')).toBe('');
    expect(allowedStaffOrigin('not a url')).toBe('');
  });

  it('allows extra origins passed from configuration, by exact match', () => {
    const extra = ['https://app.blindsnisa.com'];
    expect(allowedStaffOrigin('https://app.blindsnisa.com', extra)).toBe('https://app.blindsnisa.com');
    expect(allowedStaffOrigin('https://app.blindsnisa.com.evil.example', extra)).toBe('');
  });
});

describe('parseOriginList', () => {
  it('splits, trims and drops blanks', () => {
    expect(parseOriginList(' https://a.example , ,https://b.example ')).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });

  it('returns an empty list when unset', () => {
    expect(parseOriginList(undefined)).toEqual([]);
  });
});
