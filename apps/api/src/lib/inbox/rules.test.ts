// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins rule evaluation: each field × match type against the
 * counterpart/subject/body, case-insensitivity and trimming, first match
 * by position, disabled rules skipped, `ignore`, and the `other` fallback.
 */

import { describe, expect, it } from 'vitest';
import { classify, ruleMatches, type EmailRule } from './rules';

const input = { counterpart: 'orders@AcmeBlinds.com', subject: 'Shipment for PO 1042', body: 'Your order has shipped.' };

function rule(over: Partial<EmailRule>): EmailRule {
  return { id: 'r', position: 0, field: 'domain', match_type: 'equals', value: 'acmeblinds.com', action: 'supplier', enabled: true, ...over };
}

describe('ruleMatches', () => {
  it.each<[Partial<EmailRule>, boolean]>([
    [{ field: 'address', match_type: 'equals', value: ' Orders@acmeblinds.com ' }, true],
    [{ field: 'address', match_type: 'contains', value: 'acme' }, true],
    [{ field: 'address', match_type: 'ends_with', value: '@acmeblinds.com' }, true],
    [{ field: 'domain', match_type: 'equals', value: 'acmeblinds.com' }, true],
    [{ field: 'domain', match_type: 'equals', value: 'blinds.com' }, false],
    [{ field: 'domain', match_type: 'ends_with', value: 'blinds.com' }, true],
    [{ field: 'subject', match_type: 'contains', value: 'shipment' }, true],
    [{ field: 'subject', match_type: 'equals', value: 'shipment' }, false],
    [{ field: 'body', match_type: 'contains', value: 'HAS SHIPPED' }, true],
    [{ field: 'body', match_type: 'contains', value: '   ' }, false],
  ])('%o → %s', (over, expected) => {
    expect(ruleMatches(rule(over), input)).toBe(expected);
  });
});

describe('classify', () => {
  it('returns the first enabled match by position', () => {
    const rules = [
      rule({ id: 'b', position: 2, field: 'subject', match_type: 'contains', value: 'shipment', action: 'other' }),
      rule({ id: 'a', position: 1, action: 'supplier' }),
    ];
    expect(classify(input, rules)).toEqual({ action: 'category', category: 'supplier' });
  });

  it('skips disabled rules', () => {
    expect(classify(input, [rule({ enabled: false })])).toEqual({ action: 'category', category: 'other' });
  });

  it('returns ignore', () => {
    expect(classify(input, [rule({ action: 'ignore' })])).toEqual({ action: 'ignore' });
  });

  it('falls back to other', () => {
    expect(classify(input, [])).toEqual({ action: 'category', category: 'other' });
  });
});
