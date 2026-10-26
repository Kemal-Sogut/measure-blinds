// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Context and hook behind the app's in-app confirmation dialog — the
 * replacement for `window.confirm`, whose browser-drawn box cannot be
 * styled, shows the site's origin as its heading, and on phones looks
 * nothing like the rest of the app.
 *
 * `useConfirm()` returns an async `confirm(options)` that resolves `true`
 * when the user presses the confirm button and `false` for every other
 * way out (Cancel, the close button, Escape, a backdrop tap), so a call
 * site migrates with one `await`:
 *
 *   if (!(await confirm({ title: 'Delete this payment?', tone: 'danger' }))) return;
 *
 * The dialog itself is rendered once, by `ConfirmProvider` at the app
 * root. This file holds no component so that file keeps React Fast
 * Refresh (a component file that also exports a hook loses it).
 */

import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

/** What one confirmation asks, and how its buttons read. */
export interface ConfirmOptions {
  /** The question itself, kept short — e.g. "Delete this customer?". */
  title: string;
  /** Optional detail under the title: the consequence, what is kept. */
  message?: ReactNode;
  /** Confirm button label; defaults to "Confirm". Name the action ("Delete", "Remove"). */
  confirmLabel?: string;
  /** Cancel button label; defaults to "Cancel". */
  cancelLabel?: string;
  /**
   * `danger` (red button) for deletes, discards and reversals; `primary`
   * (brand button, the default) for forward actions such as confirming
   * an order or marking it installed.
   */
  tone?: 'danger' | 'primary';
}

/** Opens the dialog; resolves `true` only on an explicit confirm. */
export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

/** Provided by `ConfirmProvider`; `null` outside it. */
export const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * Returns the app's `confirm(options)` function.
 *
 * Throws when called outside `ConfirmProvider`: a silent fallback that
 * always answered "yes" would turn every guarded delete into an
 * unguarded one.
 */
export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm must be used inside <ConfirmProvider>.');
  return confirm;
}
