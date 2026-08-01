// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Single source of truth for how an order status looks anywhere in the
 * app: its human-readable label and its semantic pill appearance.
 *
 * The redesign's colour rule is that hue encodes state, never
 * decoration — so this module, not the components that render it, owns
 * the mapping. Keeping it free of JSX makes it unit-testable under the
 * project's pure-logic Vitest setup and lets the orders list, the
 * orders table, the dashboard tiles and the editor header stay in
 * agreement without importing each other.
 *
 * Consumers: `components/ui/Pill.tsx` (renders a tone) and
 * `components/StatusBadge.tsx` (the order-status wrapper around it).
 */

import type { OrderStatus } from '../types';

/**
 * The semantic hues a pill may take. Each maps to a token pair defined
 * in `index.css`: `brand`→blue, `success`→emerald, `warning`→amber,
 * `danger`→rose, `scheduled`→violet, `neutral`→slate/sunken.
 */
export type PillTone =
  | 'brand'
  | 'success'
  | 'warning'
  | 'danger'
  | 'scheduled'
  | 'neutral';

/**
 * How a status renders as a chip.
 *
 * `filled` promotes the chip from a tinted background with coloured ink
 * to a solid coloured background with white ink. It is reserved for
 * terminal states that share a hue with a non-terminal one — `installed`
 * versus `ready` — so the two stay distinguishable without spending a
 * second hue on a meaning users already read as "good".
 */
export interface PillAppearance {
  tone: PillTone;
  filled: boolean;
}

const LABELS: Record<OrderStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  awaiting_payment: 'Awaiting Payment',
  in_progress: 'In Progress',
  ready: 'Ready',
  installed: 'Installed',
  expired: 'Expired',
};

const APPEARANCE: Record<OrderStatus, PillAppearance> = {
  draft: { tone: 'neutral', filled: false },
  sent: { tone: 'brand', filled: false },
  awaiting_payment: { tone: 'warning', filled: false },
  in_progress: { tone: 'scheduled', filled: false },
  ready: { tone: 'success', filled: false },
  installed: { tone: 'success', filled: true },
  expired: { tone: 'danger', filled: false },
};

/**
 * Human-readable label for a status. Database values are snake_case;
 * this expands them to title-case words for display.
 */
export function statusLabel(status: OrderStatus): string {
  return LABELS[status];
}

/**
 * Semantic chip appearance for a status. Returns both the hue and
 * whether the chip is filled — see {@link PillAppearance}.
 */
export function statusPill(status: OrderStatus): PillAppearance {
  return APPEARANCE[status];
}
