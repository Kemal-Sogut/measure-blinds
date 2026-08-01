// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Form field chrome: label, control slot, and either a hint or an error
 * beneath it.
 *
 * Two exports, because this codebase has forms of both shapes. `Field`
 * wraps a control and owns its label and description — use it for new
 * markup. `inputClass` is the same visual treatment as a bare class
 * string, so the many existing pages that render an input inside their
 * own grid can adopt the new look without being restructured, which
 * would be a refactor this redesign does not authorize.
 *
 * Error state replaces the hint rather than stacking below it, and
 * recolours the control's border through a descendant selector on the
 * wrapper — so a page passes `error` in one place and both the message
 * and the control respond.
 */

import type { ReactNode } from 'react';

/**
 * Shared control treatment: 10px radius, input-stroke border, 15px
 * text. The base layer supplies the focus ring and the 44px minimum
 * height, so neither is repeated here.
 */
export const inputClass =
  'w-full rounded-md border border-border-input bg-surface px-3 text-[15px] text-text-primary placeholder:text-text-muted';

export default function Field({
  label,
  hint,
  error,
  htmlFor,
  required = false,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  /** Id of the control this label points at. Omit for a grouping. */
  htmlFor?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={
        error ? '[&_input]:border-danger [&_select]:border-danger [&_textarea]:border-danger' : ''
      }
    >
      <label
        htmlFor={htmlFor}
        className="mb-1.5 block text-xs font-semibold text-text-secondary"
      >
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </label>
      {children}
      {error ? (
        <p className="mt-1.5 text-[13px] text-danger">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-[13px] text-text-muted">{hint}</p>
      ) : null}
    </div>
  );
}
