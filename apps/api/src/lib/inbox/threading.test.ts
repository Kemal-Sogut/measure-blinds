// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins the pure threading rules: subject normalisation, which side a
 * message is on, who the "other party" is, and how header matches,
 * reverse matches and the subject fallback pick (or merge) a thread.
 */

import { describe, expect, it } from 'vitest';
import {
  chooseThread,
  counterpartOf,
  directionOf,
  isLookupSafeId,
  normalizeSubject,
  subjectFallbackSince,
} from './threading';

const SHOP = 'info@blindsnisa.com';

describe('normalizeSubject', () => {
  it.each([
    ['Re: Quote', 'quote'],
    ['RE: Fwd: re:  Quote  for  kitchen', 'quote for kitchen'],
    ['Re[2]: Quote', 'quote'],
    ['AW: SV: Quote', 'quote'],
    ['[External] Re: Quote', 'quote'],
    ['', ''],
  ])('%s → %s', (input, expected) => {
    expect(normalizeSubject(input)).toBe(expected);
  });
});

describe('directionOf', () => {
  it('is out for the Sent folder or the shop sender, else in', () => {
    expect(directionOf('sent', 'someone@else.com', SHOP)).toBe('out');
    expect(directionOf('inbox', SHOP, SHOP)).toBe('out');
    expect(directionOf('inbox', 'jane@example.com', SHOP)).toBe('in');
  });
});

describe('counterpartOf', () => {
  const jane = { address: 'jane@example.com', name: 'Jane' };
  const shop = { address: SHOP, name: 'Blinds Nisa' };

  it('is the sender for incoming mail', () => {
    expect(counterpartOf('in', jane, [shop], [], SHOP)).toEqual(jane);
  });

  it('is the first non-shop recipient for outgoing mail', () => {
    expect(counterpartOf('out', shop, [shop, jane], [], SHOP)).toEqual(jane);
  });

  it('falls back to CC, then to the shop itself', () => {
    expect(counterpartOf('out', shop, [shop], [jane], SHOP)).toEqual(jane);
    expect(counterpartOf('out', shop, [shop], [], SHOP)).toEqual({ address: SHOP, name: '' });
  });
});

describe('chooseThread', () => {
  const older = { threadId: 't-old', createdAt: '2026-10-01T00:00:00Z' };
  const newer = { threadId: 't-new', createdAt: '2026-10-05T00:00:00Z' };

  it('joins a header match', () => {
    expect(chooseThread({ headerMatches: [newer], reverseMatches: [], subjectMatch: 'x' })).toEqual({
      kind: 'join',
      threadId: 't-new',
      mergeThreadIds: [],
    });
  });

  it('joins a reverse match (reply stored before its parent)', () => {
    expect(chooseThread({ headerMatches: [], reverseMatches: [older], subjectMatch: null })).toEqual({
      kind: 'join',
      threadId: 't-old',
      mergeThreadIds: [],
    });
  });

  it('merges into the oldest when matches point at different threads', () => {
    expect(chooseThread({ headerMatches: [newer], reverseMatches: [older, newer], subjectMatch: null })).toEqual({
      kind: 'join',
      threadId: 't-old',
      mergeThreadIds: ['t-new'],
    });
  });

  it('uses the subject match only without header matches', () => {
    expect(chooseThread({ headerMatches: [], reverseMatches: [], subjectMatch: 't-subj' })).toEqual({
      kind: 'join',
      threadId: 't-subj',
      mergeThreadIds: [],
    });
  });

  it('starts a new thread otherwise', () => {
    expect(chooseThread({ headerMatches: [], reverseMatches: [], subjectMatch: null })).toEqual({ kind: 'new' });
  });
});

describe('isLookupSafeId / subjectFallbackSince', () => {
  it('rejects ids that would break a PostgREST filter', () => {
    expect(isLookupSafeId('abc@mail.gmail.com')).toBe(true);
    expect(isLookupSafeId('a,b@x')).toBe(false);
    expect(isLookupSafeId('a"b@x')).toBe(false);
    expect(isLookupSafeId('a{b}@x')).toBe(false);
    expect(isLookupSafeId('')).toBe(false);
  });

  it('is 60 days back', () => {
    expect(subjectFallbackSince(new Date('2026-10-21T00:00:00Z'))).toBe('2026-08-22T00:00:00.000Z');
  });
});
