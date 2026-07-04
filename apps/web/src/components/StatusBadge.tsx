// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Order status chip per the redesign: uppercase 11px label on a
 * status-tinted background with 2px corners. One source of truth for
 * status colors — used by the dashboard, orders list (cards and
 * desktop table), and the editor header.
 */

import type { OrderStatus } from '../types';

/** Tint + ink pairs straight from the design foundations strip. */
const STYLES: Record<OrderStatus, string> = {
  draft: 'bg-surface-sunken text-text-muted',
  sent: 'bg-brand-100 text-brand-600',
  awaiting_payment: 'bg-warning-tint text-warning',
  in_progress: 'bg-brand-100 text-brand-600',
  ready: 'bg-success-tint text-success',
  installed: 'bg-success-tint text-success',
  expired: 'bg-danger-tint text-danger',
};

/** Human-readable labels (statuses use snake_case in the DB). */
const LABELS: Record<OrderStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  awaiting_payment: 'Awaiting Payment',
  in_progress: 'In Progress',
  ready: 'Ready',
  installed: 'Installed',
  expired: 'Expired',
};

export default function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span
      className={`inline-block rounded-sm px-1.5 py-0.5 text-[11px] font-semibold uppercase leading-4 ${STYLES[status]}`}
    >
      {LABELS[status]}
    </span>
  );
}
