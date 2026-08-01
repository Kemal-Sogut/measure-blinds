// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * The app's button. Four variants carrying four levels of commitment —
 * `primary` for the one action a screen exists to perform, `secondary`
 * for alternatives, `ghost` for low-stakes navigation, `danger` for
 * destructive confirmations — so a user can read intent from colour
 * alone before reading the label.
 *
 * Constraints baked in: every size clears the 44px tap minimum the base
 * layer enforces. `sm` is 44px tall despite its smaller type — "small"
 * means visually lighter, not physically smaller, because the app is
 * used with gloves on ladders. `loading` disables the button and shows
 * a spinner beside the label, which is kept visible so an action row
 * does not collapse mid-submit.
 *
 * Extends the native button element, so `type`, `onClick`, `disabled`,
 * `form` and ARIA attributes pass through unchanged.
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react';

const VARIANTS = {
  primary:
    'bg-brand-600 text-white shadow-sm hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-300',
  secondary:
    'bg-surface text-text-primary border border-border-input hover:bg-surface-sunken disabled:text-text-muted',
  ghost:
    'bg-transparent text-text-secondary hover:bg-surface-sunken disabled:text-text-muted',
  danger:
    'bg-danger text-white shadow-sm hover:brightness-95 active:brightness-90 disabled:opacity-50',
} as const;

const SIZES = {
  sm: 'min-h-11 px-3 text-[13px]',
  md: 'min-h-11 px-4 text-sm',
  lg: 'min-h-12 px-5 text-[15px]',
} as const;

export default function Button({
  variant = 'secondary',
  size = 'md',
  block = false,
  loading = false,
  disabled,
  children,
  className = '',
  ...rest
}: {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  /** Stretch to the container's full width — the mobile form default. */
  block?: boolean;
  /** Shows a spinner and disables the button; use for in-flight submits. */
  loading?: boolean;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-colors disabled:cursor-not-allowed ${
        VARIANTS[variant]
      } ${SIZES[size]} ${block ? 'w-full' : ''} ${className}`}
    >
      {loading && (
        <svg
          className="h-4 w-4 animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
          <path
            d="M21 12a9 9 0 0 0-9-9"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
      )}
      {children}
    </button>
  );
}
