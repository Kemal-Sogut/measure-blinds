// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins the Alerts-feed wording and the link rule: order events link to
 * their order, e-Transfer alerts never link, and blank snapshot fields
 * degrade to readable sentences.
 */

import { describe, it, expect } from 'vitest';
import type { AppNotification } from '../../types';
import { NOTIFICATION_TITLES, notificationDetail, notificationHref } from './notificationText';

/** A fully populated order-confirmed alert; tests override fields. */
function alert(over: Partial<AppNotification> = {}): AppNotification {
  return {
    id: 'n1',
    kind: 'order_confirmed',
    order_id: 'o1',
    order_number: 'F0916-126',
    customer_name: 'Jane Doe',
    amount: null,
    email_thread_id: null,
    subject: '',
    created_at: '2026-09-16T12:00:00.000Z',
    ...over,
  };
}

describe('notificationHref', () => {
  it('links an order confirmation to its order page', () => {
    expect(notificationHref(alert())).toBe('/orders/o1');
  });

  it('links an edit request to its order page', () => {
    expect(notificationHref(alert({ kind: 'edit_request' }))).toBe('/orders/o1');
  });

  it('never links an e-Transfer alert, even one carrying an order id', () => {
    expect(notificationHref(alert({ kind: 'etransfer_received', amount: 50 }))).toBeNull();
  });

  it('does not link an order event with no order id', () => {
    expect(notificationHref(alert({ order_id: null }))).toBeNull();
  });
});

describe('email alerts', () => {
  const email = (over: Partial<AppNotification> = {}) =>
    alert({ kind: 'email_received', order_id: null, order_number: '', email_thread_id: 't1', subject: 'Quote for kitchen', ...over });

  it('opens the Inbox conversation', () => {
    expect(notificationHref(email())).toBe('/inbox/t1');
  });

  it('does not link when the conversation id is missing', () => {
    expect(notificationHref(email({ email_thread_id: null }))).toBeNull();
  });

  it('names the sender and the subject', () => {
    expect(NOTIFICATION_TITLES.email_received).toBe('New email');
    expect(notificationDetail(email())).toBe('Jane Doe: Quote for kitchen');
  });

  it('falls back when sender or subject is blank', () => {
    expect(notificationDetail(email({ customer_name: '', subject: '' }))).toBe('Someone: (no subject)');
  });
});

describe('notificationDetail', () => {
  it('names the customer and order', () => {
    expect(notificationDetail(alert())).toBe('Jane Doe confirmed F0916-126.');
    expect(notificationDetail(alert({ kind: 'edit_request' }))).toBe(
      'Jane Doe asked for changes to F0916-126.'
    );
  });

  it('falls back when the snapshots are blank', () => {
    expect(notificationDetail(alert({ customer_name: '', order_number: '' }))).toBe(
      'The customer confirmed their estimate.'
    );
  });

  it('describes an applied e-Transfer', () => {
    const n = alert({ kind: 'etransfer_received', order_id: null, amount: 250.5 });
    expect(notificationDetail(n)).toBe('$250.50 from Jane Doe — applied to F0916-126.');
  });

  it('describes an unmatched e-Transfer with no sender', () => {
    const n = alert({
      kind: 'etransfer_received',
      order_id: null,
      order_number: '',
      customer_name: '',
      amount: 100,
    });
    expect(notificationDetail(n)).toBe('$100.00 — waiting to be assigned to an order.');
  });
});
