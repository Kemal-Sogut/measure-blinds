// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * RowIconButton: the small gray quick-action icons at the right edge of a
 * list row (Leads cards and Inbox conversations): Handled (a tick in a
 * circle, green on hover), Delete (a bin, red on hover), and Propose visit
 * (a calendar, brand blue on hover).
 *
 * Gray at rest so a long list stays calm; the colour on hover/focus says
 * what the click will do before it happens. `active` paints the icon in its
 * tone permanently, used by Handled on a row that is already handled (the
 * click then moves it back to New), and sets `aria-pressed`.
 *
 * Icon-only, so `label` is required: it is the accessible name and the
 * native tooltip. The button is a fixed 36×36 px (never wider), which is
 * what lets it sit beside a row's `min-w-0 flex-1` text column without
 * squeezing it (AI_GUIDELINES §11). The caller keeps the icons in their own
 * `shrink-0` group OUTSIDE the row's main button, since a button cannot nest
 * inside another.
 */

import type { ReactNode } from 'react';

/** What the icon does, which decides its hover (and `active`) colour. */
export type RowIconTone = 'success' | 'danger' | 'brand';

const TONES: Record<RowIconTone, { hover: string; active: string }> = {
  success: { hover: 'hover:bg-success-tint hover:text-success focus-visible:text-success', active: 'text-success' },
  danger: { hover: 'hover:bg-danger-tint hover:text-danger focus-visible:text-danger', active: 'text-danger' },
  brand: { hover: 'hover:bg-brand-100 hover:text-brand-600 focus-visible:text-brand-600', active: 'text-brand-600' },
};

/** One icon action. `active` is only meaningful for toggles (Handled). */
export default function RowIconButton({
  label,
  tone,
  onClick,
  active,
  disabled,
  children,
}: {
  label: string;
  tone: RowIconTone;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  /** One of the icons below. */
  children: ReactNode;
}) {
  const t = TONES[tone];
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active === undefined ? undefined : active}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-40 ${
        active ? t.active : 'text-text-muted'
      } ${t.hover}`}
    >
      {children}
    </button>
  );
}

const SVG = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

/** A tick inside a circle: "handled". */
export function TickCircleIcon() {
  return (
    <svg {...SVG}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.2 2.4 2.4 4.6-4.9" />
    </svg>
  );
}

/** A lidded bin: "delete". */
export function BinIcon() {
  return (
    <svg {...SVG}>
      <path d="M4 7h16M10 3.5h4M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12M10 11v6M14 11v6" />
    </svg>
  );
}

/** A calendar page with a clock-like mark: "propose a visit time". */
export function CalendarIcon() {
  return (
    <svg {...SVG}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4M8.5 14h3M8.5 17h6" />
    </svg>
  );
}
