// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Collapse state for one of the order page's two side panels (the left
 * section menu and the right pricing panel), remembered in localStorage.
 *
 * Deliberately local component state plus a write-through, not a Zustand
 * store like the app nav's `useSidebar`: only the order page reads these
 * flags, and nothing else needs to react when they change.
 *
 * Every storage access is wrapped — private-mode Safari throws on
 * `localStorage`, and a thrown read must never take the order page down.
 * When storage is unavailable the panel simply starts expanded and the
 * choice lasts for the visit.
 */

import { useCallback, useState } from 'react';
import { parseCollapsedFlag } from './orderSections';

/**
 * @param storageKey One of `PANEL_STORAGE_KEYS`.
 * @returns `[collapsed, toggle]` — the current flag and a function that
 *   flips it and persists the new value.
 */
export function useCollapsedPanel(storageKey: string): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return parseCollapsedFlag(window.localStorage.getItem(storageKey));
    } catch {
      return false;
    }
  });

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(storageKey, String(next));
      } catch {
        // Non-fatal: the choice just does not survive a reload.
      }
      return next;
    });
  }, [storageKey]);

  return [collapsed, toggle];
}
