// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * TanStack Query hooks for the Inbox (`/api/inbox`): the conversation
 * list per category tab, one conversation, triage updates, and the
 * Settings → Email Rules CRUD + sync status.
 *
 * Mail arrives from outside the app (the sync cron: every minute 8 AM–10 PM
 * Toronto, every 10 minutes overnight), so the list and
 * thread queries are always stale and the list also polls every minute
 * while open. Every mutation invalidates the whole `['inbox']` key space
 * it can affect, so tabs, counts and the open thread never disagree.
 * Imported directly by the pages (not via the hooks barrel), like
 * `useNotifications`.
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
import type {
  EmailCategory,
  EmailRule,
  EmailRuleInput,
  EmailThreadDetail,
  EmailThreadStatus,
  EmailThreadSummary,
  InboxSyncState,
  InboxUnreadCounts,
} from '../types';

/** Every inbox endpoint wraps its payload as `{ data }`. */
interface Envelope<T> {
  data: T;
}

/** `GET /api/inbox` — one page of conversations plus pager metadata. */
export interface PaginatedThreads {
  data: EmailThreadSummary[];
  page: number;
  /** Fixed at 15 by the Worker. */
  page_size: number;
  total: number;
  /** Never below 1. */
  total_pages: number;
}

/** Fields `PUT /api/inbox/:id` accepts; send only what changes. */
export interface ThreadUpdate {
  category?: EmailCategory;
  customer_id?: string | null;
  order_id?: string | null;
  status?: EmailThreadStatus;
}

const INBOX_KEY = ['inbox'] as const;
const RULES_KEY = ['inbox', 'rules'] as const;

/** One page of a category tab; keeps the previous page on screen while paging. */
export function useInboxThreads(
  category: EmailCategory,
  status: EmailThreadStatus,
  page: number
): UseQueryResult<PaginatedThreads> {
  return useQuery({
    queryKey: [...INBOX_KEY, 'threads', category, status, page],
    queryFn: () =>
      apiFetch<PaginatedThreads>(`/api/inbox?${new URLSearchParams({ category, status, page: String(page) })}`),
    staleTime: 0,
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
}

/** One conversation with all its messages; disabled until an id is known. */
export function useInboxThread(id: string | undefined): UseQueryResult<EmailThreadDetail> {
  return useQuery({
    queryKey: [...INBOX_KEY, 'thread', id],
    queryFn: async () => (await apiFetch<Envelope<EmailThreadDetail>>(`/api/inbox/${id}`)).data,
    enabled: Boolean(id),
    staleTime: 0,
    // An open conversation picks up a new reply without leaving the page.
    refetchInterval: 60_000,
  });
}

/**
 * Unread conversations per category + total, for the tab dots and the
 * sidebar dot. Polls every minute (matching the daytime sync) and is
 * invalidated with everything else under `['inbox']`.
 */
export function useInboxUnread(): UseQueryResult<InboxUnreadCounts> {
  return useQuery({
    queryKey: [...INBOX_KEY, 'unread'],
    queryFn: async () => (await apiFetch<Envelope<InboxUnreadCounts>>('/api/inbox/unread')).data,
    staleTime: 0,
    refetchInterval: 60_000,
  });
}

/**
 * Marks a conversation read (called when it is opened). Refreshes the
 * lists, the counts and the thread so every dot clears at once.
 */
export function useMarkInboxThreadRead(): UseMutationResult<{ id: string }, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id) =>
      (await apiFetch<Envelope<{ id: string }>>(`/api/inbox/${id}/read`, { method: 'POST' })).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: INBOX_KEY }),
  });
}

/** Category / customer / order / status change on one conversation. */
export function useUpdateInboxThread(): UseMutationResult<{ id: string }, Error, { id: string; update: ThreadUpdate }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, update }) =>
      (await apiFetch<Envelope<{ id: string }>>(`/api/inbox/${id}`, { method: 'PUT', body: JSON.stringify(update) })).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: INBOX_KEY }),
  });
}

/** All rules in first-match order. */
export function useEmailRules(): UseQueryResult<EmailRule[]> {
  return useQuery({
    queryKey: RULES_KEY,
    queryFn: async () => (await apiFetch<Envelope<EmailRule[]>>('/api/inbox/rules')).data,
  });
}

/** Per-folder sync health; refreshed every minute while Settings is open. */
export function useInboxStatus(): UseQueryResult<InboxSyncState[]> {
  return useQuery({
    queryKey: [...INBOX_KEY, 'status'],
    queryFn: async () => (await apiFetch<Envelope<InboxSyncState[]>>('/api/inbox/status')).data,
    staleTime: 0,
    refetchInterval: 60_000,
  });
}

/** Adds a rule at the end of the list. */
export function useCreateEmailRule(): UseMutationResult<EmailRule, Error, EmailRuleInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input) =>
      (await apiFetch<Envelope<EmailRule>>('/api/inbox/rules', { method: 'POST', body: JSON.stringify(input) })).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: RULES_KEY }),
  });
}

/** Edits one rule. */
export function useUpdateEmailRule(): UseMutationResult<EmailRule, Error, { id: string; input: Partial<EmailRuleInput> }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }) =>
      (await apiFetch<Envelope<EmailRule>>(`/api/inbox/rules/${id}`, { method: 'PUT', body: JSON.stringify(input) })).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: RULES_KEY }),
  });
}

/** Deletes one rule. */
export function useDeleteEmailRule(): UseMutationResult<{ id: string }, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id) =>
      (await apiFetch<Envelope<{ id: string }>>(`/api/inbox/rules/${id}`, { method: 'DELETE' })).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: RULES_KEY }),
  });
}

/** Saves the full rule order (ids, first rule first). */
export function useReorderEmailRules(): UseMutationResult<{ ok: true }, Error, string[]> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids) =>
      (await apiFetch<Envelope<{ ok: true }>>('/api/inbox/rules/reorder', { method: 'POST', body: JSON.stringify({ ids }) })).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: RULES_KEY }),
  });
}

/** Re-sorts every conversation not categorised by hand; returns how many moved. */
export function useReapplyEmailRules(): UseMutationResult<{ changed: number }, Error, void> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      (await apiFetch<Envelope<{ changed: number }>>('/api/inbox/rules/reapply', { method: 'POST' })).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: INBOX_KEY }),
  });
}
