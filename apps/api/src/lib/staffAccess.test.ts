// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Unit tests for the staff gate's cache: who is let through, for how
 * long a "yes" is trusted, and that neither a "no" nor a failed lookup
 * is ever remembered as access.
 */

import { describe, it, expect, vi } from 'vitest';
import { createStaffGate } from './staffAccess';

describe('createStaffGate', () => {
  it('allows a user the lookup accepts and reuses the answer inside the TTL', async () => {
    const lookup = vi.fn(async () => true);
    let clock = 0;
    const gate = createStaffGate(lookup, 1000, () => clock);

    expect(await gate('user-1')).toBe(true);
    clock = 999;
    expect(await gate('user-1')).toBe(true);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('asks again once the TTL has passed, so a removed profile loses access', async () => {
    const answers = [true, false];
    const lookup = vi.fn(async () => answers.shift() ?? false);
    let clock = 0;
    const gate = createStaffGate(lookup, 1000, () => clock);

    expect(await gate('user-1')).toBe(true);
    clock = 1000;
    expect(await gate('user-1')).toBe(false);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('never caches a refusal, so a newly added staff member works at once', async () => {
    const answers = [false, true];
    const lookup = vi.fn(async () => answers.shift() ?? false);
    const gate = createStaffGate(lookup, 1000, () => 0);

    expect(await gate('user-2')).toBe(false);
    expect(await gate('user-2')).toBe(true);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('keeps users apart', async () => {
    const lookup = vi.fn(async (id: string) => id === 'staff');
    const gate = createStaffGate(lookup, 1000, () => 0);

    expect(await gate('staff')).toBe(true);
    expect(await gate('stranger')).toBe(false);
  });

  it('lets a lookup failure propagate instead of guessing either way', async () => {
    const gate = createStaffGate(async () => {
      throw new Error('db down');
    });
    await expect(gate('user-1')).rejects.toThrow('db down');
  });
});
