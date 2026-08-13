// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pull-to-refresh gesture for the installed home-screen app.
 *
 * `display: "standalone"` (see `public/manifest.webmanifest`) buys the
 * app a full screen by taking the browser chrome away, and the reload
 * affordances go with it: an installed app has no address bar, no
 * reload button, and — the part that surprises people — no native
 * overscroll pull-to-refresh either. iOS has never offered the gesture
 * to standalone web apps, and Chrome suppresses its own spinner in
 * standalone and fullscreen display modes. A consultant who leaves the
 * app open between two appointments therefore has no way at all to ask
 * for fresh data. This hook puts the gesture back.
 *
 * What "refresh" means here is the caller's choice (`onRefresh`); the
 * shell passes a TanStack Query invalidation rather than
 * `location.reload()`, because a reload would re-run auth boot over a
 * field connection and discard a half-entered measurement.
 *
 * The gesture is deliberately NOT enabled in a normal browser tab —
 * see {@link isStandaloneDisplay}. There the native gesture already
 * exists, and claiming the same touch would replace a reload the user
 * knows with a refetch they did not ask for.
 *
 * Scope of the hook: it tracks the gesture and reports geometry. It
 * renders nothing and moves nothing — `components/PullToRefresh.tsx`
 * owns the indicator. Notably the page content is never transformed:
 * an ancestor `transform` re-bases every `position: fixed` descendant,
 * which would break the nav rail, the modal shells and OrderDetail's
 * fixed action bar all at once.
 */

import { useEffect, useRef, useState } from 'react';

/**
 * Finger travel (already damped, so ~2× this in raw pixels) that arms
 * the refresh. Below it a release just retracts the indicator.
 *
 * 64px is a deliberate compromise: far enough that a flick while
 * reading the top of the orders list does not trigger a refetch, short
 * enough to complete in one thumb stroke on a phone held one-handed.
 */
export const PULL_TRIGGER_PX = 64;

/** Hard cap on the indicator's travel, so a long drag cannot fling it down the screen. */
export const PULL_MAX_PX = 96;

/**
 * Damping applied to raw finger travel. Native pull-to-refresh on both
 * platforms drags the indicator slower than the finger; matching that
 * is what makes the gesture feel like the OS rather than like a
 * dragged element.
 */
export const PULL_RESISTANCE = 0.5;

/**
 * Floor on how long the spinner stays up once armed. A cached
 * invalidation can settle in ~30ms, which reads as a flicker and
 * leaves the user unsure anything happened.
 */
export const REFRESH_MIN_MS = 450;

/**
 * Damped indicator travel for a raw downward drag.
 *
 * @param rawDeltaPx - Finger travel since touch start, positive downward.
 * @returns Indicator offset in CSS pixels, clamped to
 *          `[0, PULL_MAX_PX]`. Upward travel yields 0 rather than a
 *          negative offset, so a scroll-up never lifts the indicator.
 */
export function pullDistance(rawDeltaPx: number): number {
  if (!(rawDeltaPx > 0)) return 0;
  return Math.min(PULL_MAX_PX, rawDeltaPx * PULL_RESISTANCE);
}

/**
 * Whether releasing at this distance should refresh.
 *
 * @param distance - Damped indicator offset from {@link pullDistance}.
 */
export function isPullArmed(distance: number): boolean {
  return distance >= PULL_TRIGGER_PX;
}

/**
 * Whether the app is running as an installed home-screen app rather
 * than in a browser tab.
 *
 * Both checks are needed. Chromium and modern iOS answer the
 * `display-mode` media query, but iOS only started doing so in 16.4 and
 * still exposes the legacy `navigator.standalone` flag, which is the
 * only signal on older iPads — devices this app is actually used on.
 *
 * @returns False in any non-browser environment (SSR, vitest's node
 *          runner), which disables the gesture rather than throwing.
 */
export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  const byMedia = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  const byLegacyIos = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return byMedia || byLegacyIos;
}

/** Geometry and phase of the gesture, for the indicator to render. */
export interface PullToRefreshState {
  /** Indicator offset in CSS pixels, `[0, PULL_MAX_PX]`. */
  distance: number;
  /** True once `distance` has passed {@link PULL_TRIGGER_PX}. */
  armed: boolean;
  /** True from release-while-armed until `onRefresh` settles. */
  refreshing: boolean;
  /** True while a finger is driving `distance`; suppresses the retract transition. */
  dragging: boolean;
}

/** Inputs to {@link usePullToRefresh}. */
export interface PullToRefreshOptions {
  /**
   * Work to run on an armed release. Awaited if it returns a promise,
   * so the spinner reflects the real fetch. Rejections are swallowed
   * (the indicator must still retract) — surface errors yourself.
   */
  onRefresh: () => Promise<unknown> | unknown;
  /**
   * Master switch, re-evaluated on every change. The shell drops it
   * while the phone menu overlay is open. Standalone detection is
   * applied on top of this, not instead of it.
   */
  enabled?: boolean;
}

/**
 * True while a modal has locked body scroll.
 *
 * `components/ui/Modal` locks by writing `overflow: hidden` onto
 * `document.body`, which also parks `window.scrollY` at 0 — exactly the
 * condition the gesture starts from. Without this check, a drag on a
 * modal's own body would refresh the page behind it.
 */
function isBodyScrollLocked(): boolean {
  return document.body.style.overflow === 'hidden';
}

/**
 * True when the touch began inside an inner scroller that is not at its
 * top (a modal body, the settings catalog panes). Those own the
 * gesture; the document does not.
 */
function startedInsideScrolledRegion(target: EventTarget | null): boolean {
  let node = target instanceof Element ? target : null;
  while (node && node !== document.body) {
    if (node.scrollTop > 0) return true;
    node = node.parentElement;
  }
  return false;
}

/**
 * Tracks a downward drag from the top of the document and runs
 * `onRefresh` when it is released past the threshold.
 *
 * Listeners live on `window` for the lifetime of the hook: the gesture
 * belongs to the app shell, not to any one scroll container, and the
 * document is the only scroller the pages use (`Layout` is
 * `min-h-screen`, not a fixed-height flex column).
 *
 * `touchmove` is registered NON-passively on purpose. Calling
 * `preventDefault` there is the only way to stop iOS rubber-banding the
 * whole page under the indicator, and a passive listener is forbidden
 * from calling it. The call is made only while actually pulling
 * downward at the top, so ordinary scrolling keeps the fast path.
 *
 * @returns Live {@link PullToRefreshState} for the indicator.
 */
export function usePullToRefresh({ onRefresh, enabled = true }: PullToRefreshOptions): PullToRefreshState {
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [dragging, setDragging] = useState(false);

  // Touch handlers are registered once per `enabled` flip and must read
  // current values without being torn down and rebuilt on every frame
  // of a drag, so everything they consult lives in a ref.
  const startYRef = useRef<number | null>(null);
  const distanceRef = useRef(0);
  const refreshingRef = useRef(false);
  const mountedRef = useRef(true);
  const onRefreshRef = useRef(onRefresh);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;
    if (!isStandaloneDisplay()) return;

    /** Sets both the rendered distance and the ref the handlers read. */
    const setPull = (next: number) => {
      distanceRef.current = next;
      setDistance(next);
    };

    /** Drops the gesture without refreshing (scrolled away, second finger, cancel). */
    const abandon = () => {
      startYRef.current = null;
      setDragging(false);
      setPull(0);
    };

    const handleStart = (e: TouchEvent) => {
      if (refreshingRef.current) return;
      if (e.touches.length !== 1) return;
      if (window.scrollY > 0) return;
      if (isBodyScrollLocked()) return;
      if (startedInsideScrolledRegion(e.target)) return;
      startYRef.current = e.touches[0].clientY;
    };

    const handleMove = (e: TouchEvent) => {
      const startY = startYRef.current;
      if (startY === null) return;
      if (e.touches.length !== 1) {
        abandon();
        return;
      }
      // The page scrolling under a tracked gesture means the user is
      // reading, not refreshing — a pinch or a momentum carry-over.
      if (window.scrollY > 0) {
        abandon();
        return;
      }

      const raw = e.touches[0].clientY - startY;
      if (raw <= 0) {
        // Upward: hand the touch straight back to the page, but keep
        // tracking. A pull that starts with a few pixels of jitter must
        // not be dead on arrival.
        if (distanceRef.current !== 0) setPull(0);
        setDragging(false);
        return;
      }

      if (e.cancelable) e.preventDefault();
      setDragging(true);
      setPull(pullDistance(raw));
    };

    const handleEnd = () => {
      if (startYRef.current === null) return;
      startYRef.current = null;
      setDragging(false);

      if (!isPullArmed(distanceRef.current)) {
        setPull(0);
        return;
      }

      refreshingRef.current = true;
      setRefreshing(true);
      // Park the indicator at the threshold while the work runs, so the
      // spinner does not sit wherever the finger happened to let go.
      setPull(PULL_TRIGGER_PX);

      void (async () => {
        try {
          await Promise.all([
            Promise.resolve(onRefreshRef.current()),
            new Promise((resolve) => setTimeout(resolve, REFRESH_MIN_MS)),
          ]);
        } catch {
          // Swallowed on purpose: a failed refetch is reported by the
          // queries themselves, and an indicator stuck open would be a
          // second, worse bug.
        } finally {
          refreshingRef.current = false;
          if (mountedRef.current) {
            setRefreshing(false);
            setPull(0);
          }
        }
      })();
    };

    window.addEventListener('touchstart', handleStart, { passive: true });
    window.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('touchend', handleEnd);
    window.addEventListener('touchcancel', abandon);
    return () => {
      window.removeEventListener('touchstart', handleStart);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleEnd);
      window.removeEventListener('touchcancel', abandon);
    };
  }, [enabled]);

  return { distance, armed: isPullArmed(distance), refreshing, dragging };
}
