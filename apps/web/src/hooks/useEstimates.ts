// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * TanStack Query hooks for the Estimates module.
 *
 * The list hook combines a status tab (waiting/confirmed/expired) with
 * a debounced search term. Create/update send measurements + option
 * IDs only — the Worker computes all money authoritatively and its
 * response becomes the cached detail. Send/confirm mutations refresh
 * both detail and list caches. `downloadEstimatePdf` streams the PDF
 * through the authenticated download helper and triggers a browser
 * save.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { apiFetch, apiDownload } from '../lib/api';
import { useDebouncedValue } from './useDebouncedValue';
import type { Estimate, DiscountType } from '../types';

/** API envelope: every estimates endpoint returns `{ data: T }`. */
interface Envelope<T> {
  data: T;
}

/** Status tabs shown on the estimate list page. */
export type EstimateTab = 'waiting' | 'confirmed' | 'expired';

/** Blind line item payload — measurements + option ids, no prices. */
export interface BlindItemInput {
  item_type: 'blind';
  room_name: string;
  blinds_type: string;
  panels: number[];
  height_cm: number;
  fabric_id: string;
  cassette_id: string;
  control_id: string;
  quantity: number;
}

/** Preset/custom line item payload. */
export interface FlatItemInput {
  item_type: 'preset' | 'custom';
  description: string;
  quantity: number;
  unit_price: number;
}

export type LineItemInput = BlindItemInput | FlatItemInput;

/** Payload for POST /api/estimates and PUT /api/estimates/:id. */
export interface EstimateInput {
  customer_id: string;
  estimate_date?: string;
  expiry_date?: string;
  discount_type: DiscountType;
  discount_value: number;
  line_items: LineItemInput[];
}

const LIST_KEY = ['estimates', 'list'] as const;

/** Estimate list filtered by status tab + debounced search term. */
export function useEstimateList(tab: EstimateTab, term: string): UseQueryResult<Estimate[]> {
  const q = useDebouncedValue(term.trim(), 300);
  return useQuery({
    queryKey: [...LIST_KEY, tab, q],
    queryFn: async () => {
      const params = new URLSearchParams({ status: tab });
      if (q) params.set('q', q);
      return (await apiFetch<Envelope<Estimate[]>>(`/api/estimates?${params}`)).data;
    },
    placeholderData: keepPreviousData,
  });
}

/** One estimate with line items + customer (disabled until id exists). */
export function useEstimate(id: string | undefined): UseQueryResult<Estimate> {
  return useQuery({
    queryKey: ['estimates', 'detail', id],
    queryFn: async () => (await apiFetch<Envelope<Estimate>>(`/api/estimates/${id}`)).data,
    enabled: Boolean(id),
  });
}

/** Shared onSuccess: cache the server's authoritative estimate. */
function useCacheEstimate() {
  const qc = useQueryClient();
  return (data: Estimate) => {
    qc.setQueryData(['estimates', 'detail', data.id], data);
    void qc.invalidateQueries({ queryKey: LIST_KEY });
  };
}

/** Creates an estimate; the Worker assigns order number + totals. */
export function useCreateEstimate(): UseMutationResult<Estimate, Error, EstimateInput> {
  const cache = useCacheEstimate();
  return useMutation({
    mutationFn: async (input) =>
      (
        await apiFetch<Envelope<Estimate>>('/api/estimates', {
          method: 'POST',
          body: JSON.stringify(input),
        })
      ).data,
    onSuccess: cache,
  });
}

/** Updates a draft/sent estimate with full server recalculation. */
export function useUpdateEstimate(): UseMutationResult<
  Estimate,
  Error,
  { id: string; input: EstimateInput }
> {
  const cache = useCacheEstimate();
  return useMutation({
    mutationFn: async ({ id, input }) =>
      (
        await apiFetch<Envelope<Estimate>>(`/api/estimates/${id}`, {
          method: 'PUT',
          body: JSON.stringify(input),
        })
      ).data,
    onSuccess: cache,
  });
}

/** Emails the estimate to the customer (status → sent on success). */
export function useSendEstimate(): UseMutationResult<Estimate, Error, string> {
  const cache = useCacheEstimate();
  return useMutation({
    mutationFn: async (id) =>
      (await apiFetch<Envelope<Estimate>>(`/api/estimates/${id}/send`, { method: 'POST' }))
        .data,
    onSuccess: cache,
  });
}

/** Consultant-side confirm (status → confirmed). */
export function useConfirmEstimate(): UseMutationResult<Estimate, Error, string> {
  const cache = useCacheEstimate();
  return useMutation({
    mutationFn: async (id) =>
      (await apiFetch<Envelope<Estimate>>(`/api/estimates/${id}/confirm`, { method: 'POST' }))
        .data,
    onSuccess: cache,
  });
}

/**
 * Downloads the estimate PDF and saves it as `{orderNumber}.pdf` via
 * a temporary object URL (works in iOS Safari and Android Chrome).
 */
export async function downloadEstimatePdf(id: string, orderNumber: string): Promise<void> {
  const blob = await apiDownload(`/api/estimates/${id}/pdf`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${orderNumber.replace(/[^\w-]/g, '_')}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
