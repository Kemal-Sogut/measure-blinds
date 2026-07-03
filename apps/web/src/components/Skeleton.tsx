// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Loading skeletons — pulsing placeholder blocks shown while list and
 * detail queries are in flight, so pages keep their shape instead of
 * collapsing to a "Loading…" line (important on slow field networks).
 *
 * `Skeleton` is one block; `ListSkeleton` renders a column of card-
 * sized blocks matching the customer/estimate card height.
 */

/** One pulsing placeholder block; size via className (h-*, w-*). */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-border-light ${className}`} aria-hidden="true" />;
}

/** A column of card-shaped skeletons for list pages. */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-20 w-full rounded-xl" />
      ))}
    </div>
  );
}
