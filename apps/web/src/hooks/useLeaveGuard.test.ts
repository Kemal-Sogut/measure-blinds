// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/** Which link clicks the order page's leave guard intercepts. */

import { describe, it, expect } from 'vitest';
import { shouldGuardClick } from './useLeaveGuard';

const ORIGIN = 'https://app.example';
const click = (over = {}) => ({ defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...over });
const anchor = (href: string, over: { target?: string; download?: boolean } = {}) => ({
  href, target: over.target ?? '', origin: new URL(href).origin, hasAttribute: (n: string) => n === 'download' && Boolean(over.download),
});

describe('shouldGuardClick', () => {
  it('guards a plain same-origin navigation', () => {
    expect(shouldGuardClick(click(), anchor(`${ORIGIN}/orders`), `${ORIGIN}/c/F1`)).toBe(true);
  });
  it('ignores new-tab, modified, external, download and same-page clicks', () => {
    expect(shouldGuardClick(click({ metaKey: true }), anchor(`${ORIGIN}/orders`), `${ORIGIN}/x`)).toBe(false);
    expect(shouldGuardClick(click(), anchor(`${ORIGIN}/orders`, { target: '_blank' }), `${ORIGIN}/x`)).toBe(false);
    expect(shouldGuardClick(click(), anchor('https://other.example/'), `${ORIGIN}/x`)).toBe(false);
    expect(shouldGuardClick(click(), anchor(`${ORIGIN}/f.pdf`, { download: true }), `${ORIGIN}/x`)).toBe(false);
    expect(shouldGuardClick(click(), anchor(`${ORIGIN}/x`), `${ORIGIN}/x`)).toBe(false);
    expect(shouldGuardClick(click(), null, `${ORIGIN}/x`)).toBe(false);
  });
});
