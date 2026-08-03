// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Reports whether the on-screen keyboard is currently covering the
 * viewport, so `position: fixed` bottom bars can get out of its way.
 *
 * iOS Safari raises the VISUAL viewport when the keyboard opens but
 * leaves the LAYOUT viewport unchanged. A bar pinned with
 * `fixed bottom-0` is positioned against the layout viewport, so it stays
 * where the bottom of the screen used to be — which, with the keyboard
 * up, is on top of the field the user is typing into. Nothing in CSS
 * exposes this; `window.visualViewport` is the only signal, hence a hook.
 *
 * Consumers translate the bar off-screen while this is true (see the
 * mobile action bar in OrderDetail). Android Chrome usually resizes the
 * layout viewport instead and would not strictly need this, but it fires
 * the same events and the extra hide is harmless.
 *
 * Degrades to a constant `false` where `visualViewport` is unavailable,
 * so unsupported browsers keep the pre-existing always-visible bar rather
 * than losing it.
 */

import { useEffect, useState } from 'react';

/**
 * Shrink (in CSS pixels) of the visual viewport that counts as "the
 * keyboard is up".
 *
 * Sized to clear the noise, not the keyboard: Safari's collapsing URL
 * toolbar moves the visual viewport by roughly 60–90px during a scroll,
 * and treating that as a keyboard would make the bar flicker away while
 * the user is only scrolling. Every mobile keyboard is far taller than
 * this, so the threshold separates the two cases without needing to know
 * the keyboard's actual height.
 */
export const KEYBOARD_MIN_SHRINK_PX = 150;

/**
 * Pure decision rule behind the hook, exported for testing.
 *
 * @param layoutHeight - `window.innerHeight`, the layout viewport.
 * @param visualHeight - `window.visualViewport.height`.
 * @returns True when the visual viewport is shorter than the layout
 *          viewport by at least {@link KEYBOARD_MIN_SHRINK_PX}.
 */
export function isKeyboardOpen(layoutHeight: number, visualHeight: number): boolean {
  return layoutHeight - visualHeight >= KEYBOARD_MIN_SHRINK_PX;
}

/**
 * Subscribes to visual-viewport geometry and re-renders on change.
 *
 * @returns True while the keyboard is judged to be open.
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const sync = () => setOpen(isKeyboardOpen(window.innerHeight, vv.height));
    sync();

    // `resize` fires when the keyboard opens or closes; `scroll` fires
    // when iOS pans the visual viewport to keep a focused field visible,
    // which can change the offset without a resize.
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
    };
  }, []);

  return open;
}
