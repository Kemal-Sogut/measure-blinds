// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Navigation shell state (Zustand).
 *
 * The app shell has exactly two independent pieces of nav state, and
 * they belong to different breakpoints:
 *
 * - `collapsed` — tablet/desktop (`md+`) only. The rail is always on
 *   screen there; `collapsed` chooses between the 248px labelled rail
 *   and the 72px icon rail. It is PERSISTED, because a consultant who
 *   collapses the rail to gain width on a tablet expects it to stay
 *   collapsed on the next order, not to spring back on every route.
 * - `mobileOpen` — phones (`<md`) only. The rail is off screen there
 *   and the hamburger opens it as a full-screen overlay. Deliberately
 *   NOT persisted: an app that boots with a menu covering the screen
 *   reads as broken.
 *
 * The two never apply at the same breakpoint, so they are kept as two
 * booleans rather than one tri-state — a single enum would force every
 * consumer to re-derive "which mode am I in" from a media query it does
 * not otherwise care about.
 *
 * `collapsed` is the ONLY input to `--sidebar-w` (see the App Shell
 * block in `index.css`), which in turn is the only thing that offsets
 * page content. Sidebar width therefore exists as one number in one
 * place; there is no second copy to drift out of sync.
 */

import { create } from 'zustand';

/** localStorage key holding the persisted `collapsed` flag. */
const STORAGE_KEY = 'bn.sidebar.collapsed';

/**
 * Viewport at which the rail defaults to expanded. Below it (tablets,
 * 768–1279px) horizontal room is scarce enough that the icon rail is
 * the better first impression; at/above it there is room for labels.
 * Matches Tailwind's `xl`, which is also where the order screen gains
 * its summary rail — one decision, one number.
 */
const EXPAND_BY_DEFAULT_PX = 1280;

/**
 * The boot rule for `collapsed`, as a pure function so it can be tested
 * without a DOM (this workspace runs vitest in node, with no jsdom).
 *
 * An explicit stored choice always wins, including the "expanded" one —
 * a consultant who expanded the rail on a tablet must not have it
 * re-collapsed by the viewport default on the next boot. Only when
 * there is no stored choice at all does width decide.
 *
 * @param stored raw `localStorage` value: 'true' | 'false' | null
 * @param wideViewport whether the viewport is at least
 *   `EXPAND_BY_DEFAULT_PX` wide
 */
export function resolveInitialCollapsed(
  stored: string | null,
  wideViewport: boolean
): boolean {
  if (stored === 'true') return true;
  if (stored === 'false') return false;
  return !wideViewport;
}

/**
 * Reads the boot value from the browser. Falls back to collapsed when
 * neither `localStorage` nor `matchMedia` is available (non-browser
 * environments), which is the safe direction — a too-narrow rail is
 * recoverable by one tap; a rail overlapping content is not.
 */
function initialCollapsed(): boolean {
  if (typeof window === 'undefined') return true;
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private-mode Safari throws on localStorage access; fall through
    // to the viewport default rather than failing the whole boot.
  }
  const wide = window.matchMedia(`(min-width: ${EXPAND_BY_DEFAULT_PX}px)`).matches;
  return resolveInitialCollapsed(stored, wide);
}

/** Writes `collapsed` through to localStorage, ignoring quota/privacy errors. */
function persistCollapsed(value: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    // Non-fatal: the choice simply does not survive a reload.
  }
}

/** Shape of the nav shell store. */
interface SidebarState {
  /** `md+` rail is showing icons only (true) or icons + labels (false) */
  collapsed: boolean;
  /** `<md` full-screen menu overlay is open */
  mobileOpen: boolean;
  /** Flips the `md+` rail between icon and labelled widths, and persists it */
  toggleCollapsed: () => void;
  /** Opens the phone full-screen menu */
  openMobile: () => void;
  /** Closes the phone full-screen menu (navigation, Esc, backdrop, close button) */
  closeMobile: () => void;
}

export const useSidebar = create<SidebarState>((set) => ({
  collapsed: initialCollapsed(),
  mobileOpen: false,
  toggleCollapsed: () =>
    set((s) => {
      const collapsed = !s.collapsed;
      persistCollapsed(collapsed);
      return { collapsed };
    }),
  openMobile: () => set({ mobileOpen: true }),
  closeMobile: () => set({ mobileOpen: false }),
}));
