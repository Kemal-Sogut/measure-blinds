// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Locks when the order header's eye appears and which colour state it
 * takes: hidden before sending, grey once sent, green once the customer
 * opened their page (even if a reversal later cleared `sent_at`).
 */

import { describe, expect, it } from 'vitest';
import { customerViewState, formatViewedAt } from './customerViewed';

describe('customerViewState', () => {
  it('is hidden for an unsaved order', () => {
    expect(customerViewState(undefined)).toEqual({ kind: 'hidden' });
    expect(customerViewState(null)).toEqual({ kind: 'hidden' });
  });

  it('is hidden for a never-sent, never-opened order', () => {
    expect(customerViewState({ sent_at: null, customer_viewed_at: null })).toEqual({ kind: 'hidden' });
  });

  it('is unopened (grey) once sent but not opened', () => {
    const s = customerViewState({ sent_at: '2026-10-20T14:00:00Z', customer_viewed_at: null });
    expect(s.kind).toBe('unopened');
  });

  it('is opened (green) with the moment once the customer opened it', () => {
    const viewed = '2026-10-21T19:14:00Z';
    const s = customerViewState({ sent_at: '2026-10-20T14:00:00Z', customer_viewed_at: viewed });
    expect(s).toEqual({
      kind: 'opened',
      viewedAt: viewed,
      label: `Customer opened the order page · ${formatViewedAt(viewed)}`,
    });
  });

  it('stays opened after a reversal cleared sent_at', () => {
    const s = customerViewState({ sent_at: null, customer_viewed_at: '2026-10-21T19:14:00Z' });
    expect(s.kind).toBe('opened');
  });
});
