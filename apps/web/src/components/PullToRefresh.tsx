// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * The pull-to-refresh indicator for the installed home-screen app.
 *
 * Mounted once by `Layout`, so every authenticated page gets the
 * gesture from one place. `usePullToRefresh` owns the touch tracking
 * and the standalone-only gate; this file owns what the user sees and
 * what "refresh" does.
 *
 * **Refresh means a data refetch, not `location.reload()`.**
 * `queryClient.invalidateQueries()` marks every query stale and
 * refetches the ones currently mounted, which is the whole visible
 * effect of a reload — without re-running auth boot and re-downloading
 * lazy chunks over a field connection, and without discarding a
 * half-entered measurement on `/orders/:id`. The trade is that a pull
 * does NOT pick up a newly deployed build; a cold launch does, since
 * there is no service worker caching the shell.
 *
 * The indicator is `position: fixed` and parked above the viewport at
 * rest, so it costs no layout and cannot be reached by a tap. Only the
 * indicator moves — pulling the page content down would mean a
 * `transform` on an ancestor of every `position: fixed` element in the
 * app (nav rail, modal shells, OrderDetail's action bar), which
 * re-bases them onto that ancestor and breaks all three.
 */

import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usePullToRefresh, PULL_TRIGGER_PX } from '../hooks/usePullToRefresh';
import { useSidebar } from '../hooks/useSidebar';

/**
 * Height of the parked indicator plus its breathing room. Subtracted
 * from the pull distance so the puck starts fully off-screen and
 * reaches a comfortable 12px below the top edge at the trigger point.
 */
const PARKED_OFFSET_PX = 52;

/** Circular-arrow glyph, same path the orders list uses for "in progress". */
const REFRESH_PATH =
  'M3 12a9 9 0 019-9 9 9 0 016.4 2.6L21 8 M21 3v5h-5 M21 12a9 9 0 01-9 9 9 9 0 01-6.4-2.6L3 16 M3 21v-5h5';

export default function PullToRefresh() {
  const queryClient = useQueryClient();
  const mobileOpen = useSidebar((s) => s.mobileOpen);

  // Stable identity so the hook's listener effect is not torn down and
  // rebuilt on every render of the shell.
  const refresh = useCallback(() => queryClient.invalidateQueries(), [queryClient]);

  const { distance, armed, refreshing, dragging } = usePullToRefresh({
    onRefresh: refresh,
    // The phone menu is a full-screen overlay; a pull there is a pull
    // on the menu, not on the page behind it.
    enabled: !mobileOpen,
  });

  const visible = distance > 0 || refreshing;
  // Fade in over the first third of the travel, so a stray few pixels
  // of drag do not flash a puck onto the screen.
  const opacity = refreshing ? 1 : Math.min(1, distance / (PULL_TRIGGER_PX / 3));

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center"
      style={{
        transform: `translate3d(0, ${distance - PARKED_OFFSET_PX}px, 0)`,
        // No transition while the finger is down — the puck must track
        // it frame for frame; the ease is only for the retract.
        transition: dragging ? 'none' : 'transform 220ms ease-out',
      }}
      aria-hidden={!visible}
    >
      <div
        className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface shadow-md"
        style={{ opacity }}
        role="status"
        aria-live="polite"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-5 w-5 ${armed || refreshing ? 'text-brand-600' : 'text-text-muted'} ${
            refreshing ? 'animate-spin' : ''
          }`}
          // While dragging, the glyph winds up with the pull: rotation
          // is the feedback that says how much further to go.
          style={
            refreshing
              ? undefined
              : {
                  transform: `rotate(${(distance / PULL_TRIGGER_PX) * 270}deg)`,
                  // Matches the puck's own retract, so the glyph unwinds
                  // as it leaves instead of snapping back at 0.
                  transition: dragging ? 'none' : 'transform 220ms ease-out',
                }
          }
        >
          <path d={REFRESH_PATH} />
        </svg>
        {/* Announced once per refresh. Deliberately empty while the
            finger is still down: a live region that narrates the drag
            would fire on every frame of it. */}
        <span className="sr-only">{refreshing ? 'Refreshing' : ''}</span>
      </div>
    </div>
  );
}
