// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * TanStack Query hooks for the Calendar tab and the standalone
 * appointments API (`/api/appointments`): the monthly event feed plus
 * the create / re-propose / delete mutations used by the wizard and the
 * under-grid section lists.
 *
 * Follows `useOrders.ts`'s direct-import style deliberately: this file
 * is NOT re-exported from the `hooks/index.ts` barrel, matching the
 * existing convention where `useOrders` is imported directly by
 * consumers rather than centralized.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import type { Appointment, CalendarEvent } from '../types';

/** API envelope: every appointments endpoint returns `{ data: T }`. */
interface Envelope<T> {
  data: T;
}

const CALENDAR_KEY = ['appointments', 'calendar'] as const;

/**
 * Fetches appointments (both kinds) whose date falls within the
 * inclusive `[fromIso, toIso]` range (both `YYYY-MM-DD`), for the
 * visible month (plus the leading/trailing days shown in the 6×7
 * grid). Disabled until both bounds are provided.
 */
export function useCalendarEvents(
  fromIso: string | undefined,
  toIso: string | undefined
): UseQueryResult<CalendarEvent[]> {
  return useQuery({
    queryKey: [...CALENDAR_KEY, fromIso, toIso],
    queryFn: async () => {
      const params = new URLSearchParams({ from: fromIso!, to: toIso! });
      return (await apiFetch<Envelope<CalendarEvent[]>>(`/api/appointments/calendar?${params}`))
        .data;
    },
    enabled: Boolean(fromIso && toIso),
  });
}

/** Shared onSuccess: any appointment mutation refreshes the calendar. */
function useInvalidateCalendar() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: CALENDAR_KEY });
}

/**
 * Payload for POST /api/appointments — an estimate visit targets a
 * customer; an installation targets a ready order.
 */
export interface AppointmentCreateInput {
  kind: 'estimate' | 'installation';
  customer_id?: string;
  order_id?: string;
  appointment_date: string;
  appointment_time: string;
  /** Optional personal note included in the customer email. */
  message?: string;
}

/** Books a visit and emails the proposal to the customer. */
export function useCreateAppointment(): UseMutationResult<
  Appointment,
  Error,
  AppointmentCreateInput
> {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: async (input) =>
      (
        await apiFetch<Envelope<Appointment>>('/api/appointments', {
          method: 'POST',
          body: JSON.stringify(input),
        })
      ).data,
    onSuccess: invalidate,
  });
}

/** Payload for POST /api/appointments/:id/propose — a new time. */
export interface AppointmentReproposeInput {
  appointment_date: string;
  appointment_time: string;
  message?: string;
}

/** Re-proposes a new time for an existing visit (re-emails). */
export function useReproposeAppointment(): UseMutationResult<
  Appointment,
  Error,
  { id: string; input: AppointmentReproposeInput }
> {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: async ({ id, input }) =>
      (
        await apiFetch<Envelope<Appointment>>(`/api/appointments/${id}/propose`, {
          method: 'POST',
          body: JSON.stringify(input),
        })
      ).data,
    onSuccess: invalidate,
  });
}

/** Removes a visit from the schedule entirely. */
export function useDeleteAppointment(): UseMutationResult<{ id: string }, Error, string> {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: async (id) =>
      (
        await apiFetch<Envelope<{ id: string }>>(`/api/appointments/${id}`, {
          method: 'DELETE',
        })
      ).data,
    onSuccess: invalidate,
  });
}
