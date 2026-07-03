// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * TanStack Query hooks for the Settings module.
 *
 * Covers the company settings singleton (read / partial update / logo
 * upload) and the four catalog entities (fabrics, cassette options,
 * control options, presets) through a shared hook factory.
 *
 * Update mutations apply optimistic cache patches with rollback on
 * error; create/delete simply invalidate — the lists hold at most a
 * few dozen rows, so a refetch is imperceptible and far less
 * error-prone than juggling temporary IDs.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import type { CompanySettings } from '../types';

/** API envelope: every settings endpoint returns `{ data: T }`. */
interface Envelope<T> {
  data: T;
}

/** Minimum shape shared by all catalog rows. */
export interface CatalogRow {
  id: string;
  name: string;
  active: boolean;
}

/** URL segments for the four catalog entities under /api/settings. */
export type CatalogPath = 'fabrics' | 'cassette-options' | 'control-options' | 'presets';

/* ------------------------------------------------------------------ */
/* Company settings                                                    */
/* ------------------------------------------------------------------ */

const COMPANY_KEY = ['settings', 'company'] as const;

/** Fetches the company settings singleton. */
export function useCompanySettings(): UseQueryResult<CompanySettings> {
  return useQuery({
    queryKey: COMPANY_KEY,
    queryFn: async () =>
      (await apiFetch<Envelope<CompanySettings>>('/api/settings/company')).data,
  });
}

/** Partially updates company settings with optimistic cache patch + rollback. */
export function useUpdateCompanySettings(): UseMutationResult<
  CompanySettings,
  Error,
  Partial<CompanySettings>,
  { previous?: CompanySettings }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch) =>
      (
        await apiFetch<Envelope<CompanySettings>>('/api/settings/company', {
          method: 'PUT',
          body: JSON.stringify(patch),
        })
      ).data,
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: COMPANY_KEY });
      const previous = qc.getQueryData<CompanySettings>(COMPANY_KEY);
      if (previous) qc.setQueryData(COMPANY_KEY, { ...previous, ...patch });
      return { previous };
    },
    onError: (_err, _patch, ctx) => {
      if (ctx?.previous) qc.setQueryData(COMPANY_KEY, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: COMPANY_KEY }),
  });
}

/** Uploads a logo image (≤2 MB) and returns the updated company row. */
export function useUploadLogo(): UseMutationResult<CompanySettings, Error, File> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file) => {
      const form = new FormData();
      form.append('file', file);
      return (
        await apiFetch<Envelope<CompanySettings>>('/api/settings/company/logo', {
          method: 'POST',
          body: form,
        })
      ).data;
    },
    onSuccess: (data) => qc.setQueryData(COMPANY_KEY, data),
  });
}

/* ------------------------------------------------------------------ */
/* Catalog entities                                                    */
/* ------------------------------------------------------------------ */

/** Query key for one catalog entity's list. */
function catalogKey(path: CatalogPath): readonly [string, CatalogPath] {
  return ['settings', path] as const;
}

/** Fetches the full list for one catalog entity. */
export function useCatalogList<T extends CatalogRow>(path: CatalogPath): UseQueryResult<T[]> {
  return useQuery({
    queryKey: catalogKey(path),
    queryFn: async () => (await apiFetch<Envelope<T[]>>(`/api/settings/${path}`)).data,
  });
}

/** Creates a catalog row, then refetches the list. */
export function useCreateCatalogItem<T extends CatalogRow>(
  path: CatalogPath
): UseMutationResult<T, Error, Partial<T>> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (item) =>
      (
        await apiFetch<Envelope<T>>(`/api/settings/${path}`, {
          method: 'POST',
          body: JSON.stringify(item),
        })
      ).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: catalogKey(path) }),
  });
}

/** Updates a catalog row with an optimistic list patch + rollback. */
export function useUpdateCatalogItem<T extends CatalogRow>(
  path: CatalogPath
): UseMutationResult<T, Error, { id: string; patch: Partial<T> }, { previous?: T[] }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }) =>
      (
        await apiFetch<Envelope<T>>(`/api/settings/${path}/${id}`, {
          method: 'PUT',
          body: JSON.stringify(patch),
        })
      ).data,
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: catalogKey(path) });
      const previous = qc.getQueryData<T[]>(catalogKey(path));
      if (previous) {
        qc.setQueryData(
          catalogKey(path),
          previous.map((row) => (row.id === id ? { ...row, ...patch } : row))
        );
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(catalogKey(path), ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: catalogKey(path) }),
  });
}

/** Deletes a catalog row, then refetches the list. */
export function useDeleteCatalogItem(
  path: CatalogPath
): UseMutationResult<{ id: string }, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id) =>
      (
        await apiFetch<Envelope<{ id: string }>>(`/api/settings/${path}/${id}`, {
          method: 'DELETE',
        })
      ).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: catalogKey(path) }),
  });
}
