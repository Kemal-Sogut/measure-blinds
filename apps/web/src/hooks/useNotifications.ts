// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * TanStack Query hook for the staff Alerts feed (`GET /api/notifications`),
 * which lists customer confirmations, customer edit requests and incoming
 * e-Transfers newest first, 15 per page.
 *
 * Imported directly by the Alerts page rather than through the
 * `hooks/index.ts` barrel, matching `useOrders` / `useCalendar`.
 */

import { useQuery, keepPreviousData, type UseQueryResult } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import type { AppNotification } from '../types';

/** Response shape of GET /api/notifications — alerts plus pager metadata. */
export interface PaginatedNotifications {
  data: AppNotification[];
  page: number;
  /** Fixed at 15 by the Worker. */
  page_size: number;
  total: number;
  /** Never below 1, even when there are no alerts. */
  total_pages: number;
}

/**
 * One page of alerts. The events arrive from outside the app (a customer
 * on their phone, the Gmail Apps Script), so no mutation here can
 * invalidate this query; instead it is always stale and refetches on
 * mount and window focus, so opening the page or returning to the tab
 * shows what arrived since. The previous page stays on screen while the
 * next loads so paging never flashes an empty list.
 */
export function useNotifications(page: number): UseQueryResult<PaginatedNotifications> {
  return useQuery({
    queryKey: ['notifications', page],
    queryFn: () =>
      apiFetch<PaginatedNotifications>(
        `/api/notifications?${new URLSearchParams({ page: String(page) })}`
      ),
    staleTime: 0,
    placeholderData: keepPreviousData,
  });
}
