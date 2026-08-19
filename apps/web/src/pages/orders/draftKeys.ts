// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * The one shared draft-key sequence used everywhere a fresh, not-yet-saved
 * line-item draft needs a React list key.
 *
 * Originally a private, unexported function inside `OrderDetail.tsx`
 * (`nextKey`, backed by a module-local `draftSeq` counter), used there by
 * `toDrafts`, `addBlind`, `addPreset`, `addCustom`, and the duplicate-item
 * clone path. `bulkAdd.ts`'s `expandBulkSections` needed the exact same
 * generator — its signature is
 * fixed by this feature's spec to `(sections) => BlindDraft[]`, with no
 * parameter to inject a key generator through — so `nextKey` had to become
 * IMPORTABLE, and it had to stay the SAME counter every other call site
 * already draws from: two independently-seeded `d1, d2, …` sequences could
 * mint the same key for two different items once both land in one `items`
 * array, breaking React's list identity.
 *
 * Pulled out to its own module — neither folded into `lineItemDrafts.ts`
 * (already at the project's 800-line cap) nor left inside `bulkAdd.ts`
 * (whose ten OTHER call sites in `OrderDetail.tsx` have nothing to do with
 * bulk add — a page-wide id utility does not belong owned by one narrow
 * feature module). This file is a leaf: it imports nothing, so both
 * `OrderDetail.tsx` and `bulkAdd.ts` can depend on it without risking a
 * cycle between the two.
 */

/**
 * Backing counter for `nextKey`. Module-private and never reset within a
 * page load, so every id `nextKey` mints for the lifetime of the tab is
 * unique — the property every caller relies on for React list identity.
 */
let draftSeq = 0;

/**
 * Mints a unique React list key for a freshly created line-item draft
 * (`d1`, `d2`, …). Purely a render-time identity, distinct from a saved
 * item's `uid` (which the Worker mints on first save) — this is what lets
 * `<li key>` stay stable across re-renders for an item that has no server
 * identity yet.
 *
 * Every call advances the single shared sequence, so keys are unique
 * across every draft-creating call site in the app for the lifetime of the
 * tab, never just within one call site or one component.
 */
export function nextKey(): string {
  return `d${++draftSeq}`;
}
