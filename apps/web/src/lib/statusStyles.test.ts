// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Verifies the single source of truth for order-status appearance: that
 * every OrderStatus maps to a label and a pill tone, that the semantic
 * hue rule holds (money-owed states are warning, terminal-good states
 * are success, dead states are danger), and that `installed` is
 * distinguished from `ready` by fill rather than by hue.
 */

import { describe, expect, it } from 'vitest';
import { statusLabel, statusPill } from './statusStyles';
import type { OrderStatus } from '../types';

const ALL: OrderStatus[] = [
  'draft',
  'sent',
  'awaiting_payment',
  'in_progress',
  'ready',
  'installed',
  'expired',
];

describe('statusLabel', () => {
  it('gives every status a human-readable label', () => {
    for (const s of ALL) {
      expect(statusLabel(s)).toMatch(/^[A-Z]/);
    }
  });

  it('expands snake_case database values into words', () => {
    expect(statusLabel('awaiting_payment')).toBe('Awaiting Payment');
    expect(statusLabel('in_progress')).toBe('In Progress');
  });
});

describe('statusPill', () => {
  it('assigns every status a tone', () => {
    for (const s of ALL) {
      expect(statusPill(s).tone).toBeTruthy();
    }
  });

  it('encodes money owed as warning', () => {
    expect(statusPill('awaiting_payment').tone).toBe('warning');
  });

  it('encodes good terminal states as success', () => {
    expect(statusPill('ready').tone).toBe('success');
    expect(statusPill('installed').tone).toBe('success');
  });

  it('distinguishes installed from ready by fill, not hue', () => {
    expect(statusPill('installed').filled).toBe(true);
    expect(statusPill('ready').filled).toBe(false);
  });

  it('encodes expired as danger and draft as neutral', () => {
    expect(statusPill('expired').tone).toBe('danger');
    expect(statusPill('draft').tone).toBe('neutral');
  });

  it('encodes in-flight work as scheduled and announcement as brand', () => {
    expect(statusPill('in_progress').tone).toBe('scheduled');
    expect(statusPill('sent').tone).toBe('brand');
  });
});
