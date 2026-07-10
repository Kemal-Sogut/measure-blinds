// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * TanStack Query hooks for the Calendar tab and the standalone
 * appointments API (`/api/appointments`): the monthly event feed, the
 * per-order installation lookup used by the order page's Installation
 * panel, plus the create / re-propose / staff-confirm / delete
 * mutations used by the wizard, the under-grid section lists, and the
 * order page.
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

/**
 * The installation appointment attached to one order (or null when the
 * order has nothing scheduled) — drives the Installation panel on the
 * order page. Disabled until the order id is known.
 */
export function useOrderAppointment(
  orderId: string | undefined
): UseQueryResult<Appointment | null> {
  return useQuery({
    queryKey: ['appointments', 'order', orderId],
    queryFn: async () =>
      (await apiFetch<Envelope<Appointment | null>>(`/api/appointments/order/${orderId}`)).data,
    enabled: Boolean(orderId),
  });
}

/**
 * Shared onSuccess: any appointment mutation refreshes every
 * appointment read (calendar feed + per-order lookups) and the order
 * activity logs (installation mutations append log entries).
 */
function useInvalidateAppointments() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['appointments'] });
    void qc.invalidateQueries({ queryKey: ['orders', 'logs'] });
  };
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
  const invalidate = useInvalidateAppointments();
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
  const invalidate = useInvalidateAppointments();
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

/**
 * Staff-side confirm — records that the customer agreed to the time
 * through another channel (phone, text, in person). No email is sent.
 */
export function useConfirmAppointment(): UseMutationResult<Appointment, Error, string> {
  const invalidate = useInvalidateAppointments();
  return useMutation({
    mutationFn: async (id) =>
      (
        await apiFetch<Envelope<Appointment>>(`/api/appointments/${id}/confirm`, {
          method: 'POST',
        })
      ).data,
    onSuccess: invalidate,
  });
}

/** Removes a visit from the schedule entirely. */
export function useDeleteAppointment(): UseMutationResult<{ id: string }, Error, string> {
  const invalidate = useInvalidateAppointments();
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
