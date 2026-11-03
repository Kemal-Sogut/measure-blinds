// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Asks before the user leaves a page with unsaved edits (spec
 * 2026-11-02 — leaving the order editor used to lose everything typed).
 *
 * The app runs on `<BrowserRouter>`, not a data router, so React
 * Router's `useBlocker` is unavailable and moving routers is out of
 * scope. Instead, while `active`:
 *   - `beforeunload` → the browser's own prompt on tab close/refresh;
 *   - a capture-phase `click` listener on `document` intercepts plain
 *     same-origin `<a href>` navigations (sidebar, breadcrumbs, rows)
 *     and asks with `window.confirm`; cancel → `preventDefault`.
 * Known, accepted limit: the browser Back button is not intercepted.
 * Programmatic `navigate()` calls are never intercepted, so the app's
 * own save-then-navigate flows (Present, a new order's first save) do
 * not prompt.
 */

import { useEffect } from 'react';

/** The prompt shown on an in-app link click. */
export const LEAVE_GUARD_MESSAGE = 'You have unsaved changes. Leave without saving?';

/**
 * Whether a click on `anchor` is an in-app navigation the guard should
 * ask about: primary button, no modifier, same origin, same tab, not a
 * download, and actually going somewhere else. Pure, for tests.
 */
export function shouldGuardClick(
  event: Pick<MouseEvent, 'defaultPrevented' | 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>,
  anchor: Pick<HTMLAnchorElement, 'href' | 'target' | 'origin' | 'hasAttribute'> | null,
  currentHref: string
): boolean {
  if (!anchor || !anchor.href) return false;
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (anchor.target && anchor.target !== '_self') return false;
  if (anchor.hasAttribute('download')) return false;
  if (anchor.origin !== new URL(currentHref).origin) return false;
  return anchor.href !== currentHref;
}

/**
 * Installs the guard while `active` is true and removes it otherwise.
 * `message` overrides {@link LEAVE_GUARD_MESSAGE} for the link prompt;
 * browsers show their own fixed text on unload.
 */
export function useLeaveGuard(active: boolean, message: string = LEAVE_GUARD_MESSAGE): void {
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Legacy browsers need a returnValue to show the prompt.
      e.returnValue = '';
    };
    const onClick = (e: MouseEvent) => {
      const anchor = (e.target as Element | null)?.closest?.('a') ?? null;
      if (!shouldGuardClick(e, anchor, window.location.href)) return;
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [active, message]);
}
