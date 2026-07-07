// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * TanStack Query hook for the Calendar tab's monthly grid.
 *
 * Follows `useOrders.ts`'s direct-import style deliberately: this file
 * is NOT re-exported from the `hooks/index.ts` barrel, matching the
 * existing convention where `useOrders` is imported directly by
 * consumers rather than centralized. Ready-order lookups for the
 * install wizard's step 3 reuse `useOrderList('ready', '')` from
 * `useOrders.ts` rather than a redundant wrapper here.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import type { CalendarEvent } from '../types';

/** API envelope: every orders endpoint returns `{ data: T }`. */
interface Envelope<T> {
  data: T;
}

/**
 * Fetches installation events whose `install_date` falls within the
 * inclusive `[fromIso, toIso]` range (both `YYYY-MM-DD`), for the
 * visible month (plus the leading/trailing days shown in the 6×7
 * grid). Disabled until both bounds are provided.
 */
export function useCalendarEvents(
  fromIso: string | undefined,
  toIso: string | undefined
): UseQueryResult<CalendarEvent[]> {
  return useQuery({
    queryKey: ['orders', 'calendar', fromIso, toIso],
    queryFn: async () => {
      const params = new URLSearchParams({ from: fromIso!, to: toIso! });
      return (await apiFetch<Envelope<CalendarEvent[]>>(`/api/orders/calendar?${params}`)).data;
    },
    enabled: Boolean(fromIso && toIso),
  });
}
