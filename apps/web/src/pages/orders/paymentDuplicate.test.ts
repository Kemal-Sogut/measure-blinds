// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins the Record Payment sheet's "may already be recorded" question: the
 * Worker's reason code it reacts to, and the exact title, buttons and tone
 * staff see. The message is the Worker's own sentence, passed through.
 */

import { describe, it, expect } from 'vitest';
import { POSSIBLE_DUPLICATE_CODE, duplicatePaymentConfirm } from './paymentDuplicate';

describe('duplicatePaymentConfirm', () => {
  it('asks with the Worker sentence and names the action', () => {
    const message =
      'An e-Transfer of $250.00 dated November 20, 2026 is already recorded on this order. ' +
      'Record this payment as well only if the customer really paid twice.';
    expect(duplicatePaymentConfirm(message)).toEqual({
      title: 'This payment may already be recorded',
      message,
      confirmLabel: 'Record it anyway',
      cancelLabel: 'Cancel',
      tone: 'danger',
    });
  });

  it('reacts to the code the Worker sends', () => {
    expect(POSSIBLE_DUPLICATE_CODE).toBe('possible_duplicate');
  });
});
