// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Tests for the pull-to-refresh geometry.
 *
 * Only the pure rules are covered — the damping curve and the arming
 * threshold. The hook around them is a `window` touch subscription and
 * this workspace runs vitest in node with no jsdom or testing-library
 * (same reasoning as `useKeyboardOpen.test.ts`), so exercising the
 * gesture itself would mean adding a DOM test stack for one listener
 * set. The cases below are the ones the constants exist to separate: an
 * accidental flick must not refetch, a deliberate stroke must, and no
 * drag length may push the indicator past its cap.
 */

import { describe, it, expect } from 'vitest';
import {
  pullDistance,
  isPullArmed,
  isStandaloneDisplay,
  PULL_TRIGGER_PX,
  PULL_MAX_PX,
  PULL_RESISTANCE,
} from './usePullToRefresh';

describe('pullDistance', () => {
  it('damps the finger travel rather than tracking it 1:1', () => {
    expect(pullDistance(100)).toBe(100 * PULL_RESISTANCE);
  });

  it('yields nothing for an upward drag', () => {
    // Scrolling up at the top of the page must not lift the indicator.
    expect(pullDistance(-40)).toBe(0);
    expect(pullDistance(0)).toBe(0);
  });

  it('caps a long drag at the indicator ceiling', () => {
    expect(pullDistance(2000)).toBe(PULL_MAX_PX);
    expect(pullDistance(PULL_MAX_PX / PULL_RESISTANCE)).toBe(PULL_MAX_PX);
  });

  it('never returns NaN for a NaN delta', () => {
    // `clientY - startY` is NaN if a touch point is ever missing; a NaN
    // offset would put the indicator at `translate3d(0, NaNpx, 0)` and
    // leave it stuck on screen.
    expect(pullDistance(Number.NaN)).toBe(0);
  });
});

describe('isPullArmed', () => {
  it('does not arm on a short flick', () => {
    // ~60px of finger travel while reading the top of the orders list.
    expect(isPullArmed(pullDistance(60))).toBe(false);
  });

  it('arms on a deliberate thumb stroke', () => {
    expect(isPullArmed(pullDistance(200))).toBe(true);
  });

  it('treats exactly the threshold as armed', () => {
    expect(isPullArmed(PULL_TRIGGER_PX)).toBe(true);
    expect(isPullArmed(PULL_TRIGGER_PX - 1)).toBe(false);
  });

  it('is reachable before the cap, so the gesture can complete', () => {
    // A trigger above the ceiling would be unreachable by any drag.
    expect(PULL_TRIGGER_PX).toBeLessThanOrEqual(PULL_MAX_PX);
  });
});

describe('isStandaloneDisplay', () => {
  it('reports false where there is no browser', () => {
    // vitest runs in node: no `window`, so the gesture stays off rather
    // than throwing during a server-side or test render.
    expect(isStandaloneDisplay()).toBe(false);
  });
});
