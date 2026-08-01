// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Rounded-full status chip — the redesign's atom of semantic colour.
 *
 * A pill never chooses its own meaning: callers pass a `tone` that came
 * from a semantic mapping (`lib/statusStyles` for orders, an explicit
 * literal elsewhere), so the same hue always means the same thing
 * across orders, appointments and payments. `filled` promotes a tinted
 * chip to a solid one; it exists so two states that legitimately share
 * a hue stay distinguishable without inventing a seventh colour.
 *
 * Sizing: `sm` is the dense list/table chip, `md` the detail-header
 * chip. Both are non-interactive, so neither is subject to the 44px tap
 * minimum — wrap the pill in a button if it must be clickable.
 */

import type { ReactNode } from 'react';
import type { PillTone } from '../../lib/statusStyles';

/** Tinted background + coloured ink, per tone. */
const TINTED: Record<PillTone, string> = {
  brand: 'bg-info-tint text-info',
  success: 'bg-success-tint text-success',
  warning: 'bg-warning-tint text-warning',
  danger: 'bg-danger-tint text-danger',
  scheduled: 'bg-scheduled-tint text-scheduled',
  neutral: 'bg-surface-sunken text-text-muted',
};

/** Solid background + white ink, per tone. */
const FILLED: Record<PillTone, string> = {
  brand: 'bg-brand-600 text-white',
  success: 'bg-success-strong text-white',
  warning: 'bg-warning text-white',
  danger: 'bg-danger text-white',
  scheduled: 'bg-scheduled text-white',
  neutral: 'bg-text-muted text-white',
};

const SIZES = {
  sm: 'px-2 py-0.5 text-[11px] leading-4',
  md: 'px-2.5 py-1 text-xs leading-4',
} as const;

export default function Pill({
  tone = 'neutral',
  filled = false,
  size = 'sm',
  children,
}: {
  tone?: PillTone;
  filled?: boolean;
  size?: keyof typeof SIZES;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-pill font-semibold tracking-[0.01em] ${
        SIZES[size]
      } ${filled ? FILLED[tone] : TINTED[tone]}`}
    >
      {children}
    </span>
  );
}
