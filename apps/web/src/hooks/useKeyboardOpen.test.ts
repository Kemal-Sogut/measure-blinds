// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Tests for the visual-viewport keyboard heuristic.
 *
 * Only the pure rule is covered: the hook around it is a thin
 * `visualViewport` subscription, and this workspace has no DOM test
 * environment (vitest runs in node, with no jsdom or testing-library),
 * so exercising the hook itself would mean adding a test stack for one
 * subscription. The cases below are the ones the threshold exists to
 * separate.
 */

import { describe, it, expect } from 'vitest';
import { isKeyboardOpen, KEYBOARD_MIN_SHRINK_PX } from './useKeyboardOpen';

describe('isKeyboardOpen', () => {
  it('reports open when the keyboard shrinks the visual viewport', () => {
    // iPhone 13: 844pt layout, ~336pt of keyboard.
    expect(isKeyboardOpen(844, 508)).toBe(true);
  });

  it('reports closed when the viewports match', () => {
    expect(isKeyboardOpen(844, 844)).toBe(false);
  });

  it("ignores Safari's collapsing URL toolbar", () => {
    // The toolbar moves the visual viewport by well under the threshold;
    // treating that as a keyboard would hide the action bar mid-scroll.
    expect(isKeyboardOpen(844, 844 - 90)).toBe(false);
  });

  it('treats exactly the threshold as open', () => {
    expect(isKeyboardOpen(844, 844 - KEYBOARD_MIN_SHRINK_PX)).toBe(true);
    expect(isKeyboardOpen(844, 844 - KEYBOARD_MIN_SHRINK_PX + 1)).toBe(false);
  });

  it('never reports open when the visual viewport is the taller one', () => {
    // Can happen transiently on Android when the layout viewport is the
    // one being resized.
    expect(isKeyboardOpen(508, 844)).toBe(false);
  });
});
