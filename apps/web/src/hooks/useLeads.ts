// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * TanStack Query hooks for website leads (`/api/leads`): the paged list
 * behind the Leads page, the new-lead count behind the sidebar badge, the
 * status change (New / Handled), delete, and "Propose visit".
 *
 * Leads arrive from outside the app (a visitor on the WordPress site), so
 * no mutation here can announce them. The list and the count therefore
 * poll every minute and are always stale, so opening the page or
 * returning to the tab shows what came in. Everything lives under the
 * `['leads']` key, so one invalidation refreshes the list, its chips and
 * the sidebar together. Delete also refreshes `['notifications']` (the
 * lead's alert row cascades), and a proposal also refreshes
 * `['appointments']` (it books a visit on the calendar).
 *
 * Imported directly rather than through the `hooks/index.ts` barrel,
 * matching `useNotifications` / `useInbox`.
 */

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import type { Lead, LeadStatus } from '../types';

/** Root query key, shared by the list and the summary. */
const LEADS_KEY = ['leads'] as const;

/** The Leads page filter: one status, or everything. */
export type LeadFilter = LeadStatus | 'all';

/** Response of `GET /api/leads`: one page, the pager envelope, and the new-lead backlog. */
export interface PaginatedLeads {
  data: Lead[];
  page: number;
  /** Fixed at 20 by the Worker. */
  page_size: number;
  /** Rows matching the current filter. */
  total: number;
  /** Never below 1, even with no leads. */
  total_pages: number;
  /** Leads still in `new`, whatever the filter. */
  new_count: number;
}

/**
 * One page of leads for a filter. The previous page stays on screen while
 * the next one loads, so switching chips or pages never flashes an empty list.
 */
export function useLeads(status: LeadFilter, page: number): UseQueryResult<PaginatedLeads> {
  return useQuery({
    queryKey: [...LEADS_KEY, 'list', status, page],
    queryFn: () =>
      apiFetch<PaginatedLeads>(`/api/leads?${new URLSearchParams({ status, page: String(page) })}`),
    staleTime: 0,
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
}

/** How many leads nobody has handled yet. Drives the sidebar dot and count. */
export function useNewLeadCount(): UseQueryResult<number> {
  return useQuery({
    queryKey: [...LEADS_KEY, 'summary'],
    queryFn: async () => (await apiFetch<{ new_count: number }>('/api/leads/summary')).new_count,
    staleTime: 0,
    refetchInterval: 60_000,
  });
}

/**
 * Moves a lead to another status (`PUT /api/leads/:id`). On success, every
 * `['leads']` query refetches, so the lead leaves the current filter and the
 * counts update at once.
 */
export function useUpdateLeadStatus(): UseMutationResult<Lead, Error, { id: string; status: LeadStatus }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }) =>
      (await apiFetch<{ data: Lead }>(`/api/leads/${id}`, { method: 'PUT', body: JSON.stringify({ status }) })).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: LEADS_KEY }),
  });
}

/**
 * Deletes a lead (`DELETE /api/leads/:id`): spam, duplicates, tests. The
 * linked customer stays. The lead's "New website lead" alert is deleted
 * with it, so the Notifications feed refreshes too.
 */
export function useDeleteLead(): UseMutationResult<{ id: string }, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id) =>
      (await apiFetch<{ data: { id: string } }>(`/api/leads/${id}`, { method: 'DELETE' })).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: LEADS_KEY });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

/** What the Propose visit dialog sends: a day, a 30-minute start slot, and an optional note. */
export interface LeadProposalInput {
  /** YYYY-MM-DD. */
  appointment_date: string;
  /** HH:MM, 24-hour. */
  appointment_time: string;
  message?: string;
}

/**
 * Emails the visitor a thank-you with a proposed in-home estimate time and
 * books it as a `proposed` estimate visit (`POST /api/leads/:id/propose`).
 * The Worker marks the lead handled in the same request. Resolves with the
 * updated lead and the address the email went to; a failed send rejects
 * and nothing is booked.
 */
export function useProposeLeadVisit(): UseMutationResult<
  { lead: Lead; emailedTo: string },
  Error,
  { id: string; input: LeadProposalInput }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }) => {
      const res = await apiFetch<{ data: Lead; emailed_to: string }>(`/api/leads/${id}/propose`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
      return { lead: res.data, emailedTo: res.emailed_to };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: LEADS_KEY });
      void qc.invalidateQueries({ queryKey: ['appointments'] });
    },
  });
}
