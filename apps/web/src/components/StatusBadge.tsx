// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Order status chip. A thin binding of the semantic mapping in
 * `lib/statusStyles` to the `Pill` primitive — it holds no colour
 * knowledge of its own, so changing what a status looks like is a
 * one-file change in `statusStyles`, not a hunt through the surfaces
 * that render it (dashboard, orders list, desktop orders table, editor
 * header).
 *
 * Labels are title case rather than the previous uppercase: at 11px in
 * Plus Jakarta Sans, uppercase reads as noise beside the rounded chip
 * shape, and the labels are short enough not to need the extra
 * emphasis.
 */

import Pill from './ui/Pill';
import { statusLabel, statusPill } from '../lib/statusStyles';
import type { OrderStatus } from '../types';

export default function StatusBadge({
  status,
  size = 'sm',
}: {
  status: OrderStatus;
  /** `sm` for dense lists and tables, `md` for detail headers. */
  size?: 'sm' | 'md';
}) {
  const { tone, filled } = statusPill(status);
  return (
    <Pill tone={tone} filled={filled} size={size}>
      {statusLabel(status)}
    </Pill>
  );
}
