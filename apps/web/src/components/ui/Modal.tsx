// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Overlay dialog with two presentations from one API: a bottom sheet
 * below `lg`, a centered dialog at `lg+`.
 *
 * The split is ergonomic, not decorative — a centered dialog on a phone
 * puts its controls under the user's palm and its close affordance out
 * of thumb reach, while a sheet rises into the thumb zone and reads as
 * dismissible by its drag handle. Both share the same content, so pages
 * write one markup tree.
 *
 * Accessibility is handled here so callers cannot forget it: Escape
 * closes, the backdrop closes on click while content clicks do not
 * bubble, body scroll locks while open, focus moves into the panel on
 * open, and the panel is a labelled `role="dialog"` with `aria-modal`.
 * Rendering is conditional rather than CSS-hidden, so a closed dialog
 * holds no focusable nodes.
 *
 * Callers that migrate onto this MUST delete their own backdrop,
 * Escape-key and scroll-lock handling — duplicates would double-fire
 * the close handler.
 *
 * Height is capped in `dvh`, not `vh`: iOS Safari resolves `vh` against
 * the LARGE viewport (toolbar hidden), so a `90vh` sheet is taller than
 * what is actually on screen and its last rows sit behind the toolbar.
 * `dvh` tracks the toolbar as it collapses. The bottom safe-area inset
 * is carried by the footer when there is one and by the scroll body when
 * there is not, so no presentation leaves content under the home
 * indicator.
 */

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

const SIZES = {
  sm: 'lg:max-w-sm',
  md: 'lg:max-w-lg',
  lg: 'lg:max-w-2xl',
} as const;

export default function Modal({
  open,
  onClose,
  title,
  subtitle,
  footer,
  size = 'md',
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** Action row; typically two Buttons. Omit for a content-only dialog. */
  footer?: ReactNode;
  /** Desktop width only — the mobile sheet is always full width. */
  size?: keyof typeof SIZES;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    panelRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-text-primary/40 lg:items-center"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={`flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-surface shadow-lg outline-none lg:rounded-2xl ${SIZES[size]}`}
      >
        <div
          aria-hidden="true"
          className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-pill bg-border-input lg:hidden"
        />

        <header className="flex items-start gap-3 px-4 pb-3 pt-4 lg:px-5">
          <div className="min-w-0 flex-1">
            <h2 className="break-words text-[17px] font-bold text-text-primary">{title}</h2>
            {subtitle && <p className="break-words text-[13px] text-text-muted">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-sunken"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M18 6L6 18M6 6l12 12"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        <div
          className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 lg:px-5 ${
            footer ? 'pb-4' : 'pb-[calc(1rem+env(safe-area-inset-bottom))] lg:pb-4'
          }`}
        >
          {children}
        </div>

        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-border-light px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:px-5 lg:pb-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
