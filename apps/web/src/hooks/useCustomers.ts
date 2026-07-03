// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * TanStack Query hooks for the Customers module.
 *
 * `useCustomerSearch` is the shared search hook: it debounces the raw
 * term (300ms) and keeps previous results on screen while the next
 * page loads, so the list doesn't flicker during typing. It is used by
 * both the customer list page and (in Phase 7) the estimate editor's
 * customer selector.
 *
 * Mutations invalidate the search cache; the detail cache is updated
 * directly from server responses.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { useDebouncedValue } from './useDebouncedValue';
import type { Customer } from '../types';

/** API envelope: every customers endpoint returns `{ data: T }`. */
interface Envelope<T> {
  data: T;
}

/** Payload for create/update — the editable subset of Customer. */
export type CustomerInput = Partial<
  Omit<Customer, 'id' | 'deleted_at' | 'created_at' | 'updated_at'>
>;

const LIST_KEY = ['customers', 'list'] as const;

/** Debounced customer search; pass '' to list the most recent customers. */
export function useCustomerSearch(term: string): UseQueryResult<Customer[]> {
  const q = useDebouncedValue(term.trim(), 300);
  return useQuery({
    queryKey: [...LIST_KEY, q],
    queryFn: async () =>
      (
        await apiFetch<Envelope<Customer[]>>(
          `/api/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`
        )
      ).data,
    placeholderData: keepPreviousData,
  });
}

/** Fetches one customer by id (disabled until an id is provided). */
export function useCustomer(id: string | undefined): UseQueryResult<Customer> {
  return useQuery({
    queryKey: ['customers', 'detail', id],
    queryFn: async () => (await apiFetch<Envelope<Customer>>(`/api/customers/${id}`)).data,
    enabled: Boolean(id),
  });
}

/** Creates a customer and refreshes search results. */
export function useCreateCustomer(): UseMutationResult<Customer, Error, CustomerInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input) =>
      (
        await apiFetch<Envelope<Customer>>('/api/customers', {
          method: 'POST',
          body: JSON.stringify(input),
        })
      ).data,
    onSuccess: (data) => {
      qc.setQueryData(['customers', 'detail', data.id], data);
      void qc.invalidateQueries({ queryKey: LIST_KEY });
    },
  });
}

/** Updates a customer and refreshes both detail and search caches. */
export function useUpdateCustomer(): UseMutationResult<
  Customer,
  Error,
  { id: string; patch: CustomerInput }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }) =>
      (
        await apiFetch<Envelope<Customer>>(`/api/customers/${id}`, {
          method: 'PUT',
          body: JSON.stringify(patch),
        })
      ).data,
    onSuccess: (data) => {
      qc.setQueryData(['customers', 'detail', data.id], data);
      void qc.invalidateQueries({ queryKey: LIST_KEY });
    },
  });
}

/** Soft-deletes a customer and refreshes search results. */
export function useDeleteCustomer(): UseMutationResult<{ id: string }, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id) =>
      (
        await apiFetch<Envelope<{ id: string }>>(`/api/customers/${id}`, {
          method: 'DELETE',
        })
      ).data,
    onSuccess: (_data, id) => {
      qc.removeQueries({ queryKey: ['customers', 'detail', id] });
      void qc.invalidateQueries({ queryKey: LIST_KEY });
    },
  });
}
