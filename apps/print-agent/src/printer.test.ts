// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Tests for print target strategy selection.
 *
 * Only the DECISION is tested. The byte write itself is I/O against a
 * physical printer; a mock of it would assert nothing real, and the
 * strategy choice is the part that can actually be wrong.
 */

import { describe, it, expect } from 'vitest';
import { strategyFor } from './printer';

describe('strategyFor', () => {
  it('treats a COM port as a direct serial write', () => {
    expect(strategyFor('COM5')).toBe('serial');
    expect(strategyFor('com12')).toBe('serial');
  });

  it('treats anything else as a Windows printer share', () => {
    expect(strategyFor('\\\\localhost\\LabelCreate')).toBe('spooler');
    expect(strategyFor('LabelCreate 2410BT')).toBe('spooler');
  });

  it('does not mistake a share whose name merely starts with COM', () => {
    expect(strategyFor('COMPANY-LABELS')).toBe('spooler');
  });
});
