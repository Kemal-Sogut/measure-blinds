// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Tests for the nav rail's boot rule.
 *
 * Only the pure rule is covered. The store around it is a three-action
 * Zustand slice over `localStorage`, and this workspace has no DOM test
 * environment (vitest runs in node, with no jsdom or testing-library),
 * so exercising the store itself would mean adding a test stack for
 * three setters. The cases below are the ones the rule exists to
 * separate — in particular that a stored choice outranks the viewport
 * default in BOTH directions, which is the part a naive
 * "collapsed unless wide" implementation gets wrong.
 */

import { describe, it, expect } from 'vitest';
import { resolveInitialCollapsed } from './useSidebar';

describe('resolveInitialCollapsed', () => {
  it('defaults to expanded on a desktop-width viewport', () => {
    expect(resolveInitialCollapsed(null, true)).toBe(false);
  });

  it('defaults to collapsed on a tablet-width viewport', () => {
    expect(resolveInitialCollapsed(null, false)).toBe(true);
  });

  it('honours a stored collapse on a wide viewport', () => {
    // Without this the rail would spring back open on every boot for
    // anyone who deliberately collapsed it on a desktop.
    expect(resolveInitialCollapsed('true', true)).toBe(true);
  });

  it('honours a stored expansion on a narrow viewport', () => {
    // The mirror case: a consultant who expanded the rail on a tablet
    // must not have the viewport default re-collapse it.
    expect(resolveInitialCollapsed('false', false)).toBe(false);
  });

  it('ignores unrecognised stored values and falls back to width', () => {
    // A stale or hand-edited key must not wedge the rail into a state
    // the viewport rule would not have chosen.
    expect(resolveInitialCollapsed('', true)).toBe(false);
    expect(resolveInitialCollapsed('yes', false)).toBe(true);
  });
});
