// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Unit tests for `maintenanceMessage`, the rule that decides whether a
 * failed public request means "the shop is closed" or "something went
 * wrong". Both customer pages branch on it, so the two mistakes it must
 * never make are pinned here: calling a plain outage a maintenance
 * window, and showing a customer an empty maintenance card.
 */

import { describe, it, expect } from 'vitest';
import { maintenanceMessage } from './maintenance';

/** Builds a Response with the given status (body is read separately). */
function res(status: number): Response {
  return new Response(null, { status });
}

describe('maintenanceMessage', () => {
  it('returns the configured message for a flagged 503', () => {
    expect(
      maintenanceMessage(res(503), { maintenance: true, message: 'Back at 3pm.' })
    ).toBe('Back at 3pm.');
  });

  it('falls back to readable wording when the message is blank', () => {
    const text = maintenanceMessage(res(503), { maintenance: true, message: '   ' });
    expect(text).toBeTruthy();
    expect(text?.trim()).toBe(text);
  });

  it('ignores a 503 without the flag — an outage is not a maintenance window', () => {
    expect(maintenanceMessage(res(503), { error: 'Service Unavailable' })).toBeNull();
    expect(maintenanceMessage(res(503), null)).toBeNull();
  });

  it('ignores every other status, flagged or not', () => {
    expect(maintenanceMessage(res(404), { error: 'Estimate not found' })).toBeNull();
    expect(maintenanceMessage(res(200), { maintenance: true, message: 'x' })).toBeNull();
  });
});
