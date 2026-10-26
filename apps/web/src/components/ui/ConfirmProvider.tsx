// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Renders the app's single confirmation dialog and provides the
 * `confirm(options)` function `useConfirm()` hands out (see
 * `confirmContext.ts` for the call-site contract).
 *
 * Built on `Modal`, so it is a bottom sheet on phones and a centered
 * dialog at `lg+`, with the same look, focus and scroll-lock behaviour
 * as every other dialog in the app.
 *
 * Stacking: a confirmation is often raised FROM another overlay (Discard
 * on the bulk-add sheet, which sits at z-40; `Modal` dialogs sit at
 * z-50), so it is wrapped in a z-60 layer to always land on top. Escape
 * is caught in the capture phase on `window` and stopped there, so it
 * dismisses only the confirmation and never also reaches the overlay
 * underneath (whose own Escape handler would close it, or re-ask).
 *
 * One request at a time: opening a new confirmation while one is still
 * showing answers the old one `false` before replacing it, so no
 * awaiting caller is ever left hanging.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Button from './Button';
import Modal from './Modal';
import { ConfirmContext, type ConfirmFn, type ConfirmOptions } from './confirmContext';

interface PendingConfirm {
  options: ConfirmOptions;
  resolve: (ok: boolean) => void;
}

/** Wrap the app once, near the root, inside nothing that unmounts on navigation. */
export default function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  // The live request, read by `settle` — kept in a ref so resolving never
  // happens inside a state updater (StrictMode runs those twice).
  const pendingRef = useRef<PendingConfirm | null>(null);

  const confirm = useCallback<ConfirmFn>(
    (options) =>
      new Promise<boolean>((resolve) => {
        pendingRef.current?.resolve(false);
        const next = { options, resolve };
        pendingRef.current = next;
        setPending(next);
      }),
    []
  );

  const settle = useCallback((ok: boolean) => {
    const current = pendingRef.current;
    if (!current) return;
    pendingRef.current = null;
    setPending(null);
    current.resolve(ok);
  }, []);

  useEffect(() => {
    if (!pending) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      settle(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [pending, settle]);

  const options = pending?.options;
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <div className="relative z-[60]">
        <Modal
          open={pending !== null}
          onClose={() => settle(false)}
          size="sm"
          title={options?.title ?? ''}
          footer={
            <>
              <Button variant="secondary" onClick={() => settle(false)}>
                {options?.cancelLabel ?? 'Cancel'}
              </Button>
              <Button
                variant={options?.tone === 'danger' ? 'danger' : 'primary'}
                onClick={() => settle(true)}
              >
                {options?.confirmLabel ?? 'Confirm'}
              </Button>
            </>
          }
        >
          {options?.message && (
            <p className="text-[14px] text-text-secondary">{options.message}</p>
          )}
        </Modal>
      </div>
    </ConfirmContext.Provider>
  );
}
