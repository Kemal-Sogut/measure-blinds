// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * TanStack Query hooks for the Settings module.
 *
 * Covers the company settings singleton (read / partial update / logo
 * upload) and the catalog entities (materials, cassette options,
 * bottom rail options, control options, pleat types, installation
 * options, presets, blind types) through a shared hook factory.
 * Materials additionally carry `blind_type_ids`, passed straight through
 * the generic create/update mutations to the Materials API.
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
import type { BlindTypeDefaults, CompanySettings } from '../types';

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

/** URL segments for the catalog entities managed under /api/settings. */
export type CatalogPath =
  | 'materials'
  | 'cassette-options'
  | 'bottom-rail-options'
  | 'control-options'
  | 'pleat-types'
  | 'installation-options'
  | 'presets'
  | 'blind-types';

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

/* ------------------------------------------------------------------ */
/* Blind-type defaults                                                 */
/* ------------------------------------------------------------------ */

/**
 * Blind-type defaults are deliberately NOT a `CatalogPath`: they are a
 * one-row-per-blind-type upsert table, not a create/list/delete
 * collection, so they get their own query key and hooks rather than
 * being squeezed through `useCatalogList`/`useCreateCatalogItem`/etc.
 */
const DEFAULTS_KEY = ['settings', 'blind-type-defaults'] as const;

/**
 * Fetches all saved per-blind-type default option rows in one call. A
 * blind type absent from the result has never had defaults saved — see
 * `BlindTypeDefaults` for how callers are expected to treat that the
 * same as an all-null row. No optimistic patching: the settings page
 * that edits this list is a later task and can add it if the plain
 * invalidate-and-refetch in `useUpdateBlindTypeDefaults` proves too slow.
 */
export function useBlindTypeDefaults(): UseQueryResult<BlindTypeDefaults[]> {
  return useQuery({
    queryKey: DEFAULTS_KEY,
    queryFn: async () =>
      (await apiFetch<Envelope<BlindTypeDefaults[]>>('/api/settings/blind-type-defaults')).data,
  });
}

/**
 * Upserts one blind type's defaults, then invalidates the list so every
 * consumer (the settings editor, the order form's `Catalogs.defaults`)
 * refetches. `patch` omits `blind_type_id` — it is supplied via the URL,
 * matching the Worker's `PUT /api/settings/blind-type-defaults/:blindTypeId`
 * route, which validates every non-null id server-side before writing.
 * No optimistic update: a rejected id (inactive or unlinked) is common
 * enough on this endpoint that showing the change before the Worker
 * confirms it would routinely have to be rolled back.
 */
export function useUpdateBlindTypeDefaults(): UseMutationResult<
  BlindTypeDefaults,
  Error,
  { blindTypeId: string; patch: Omit<BlindTypeDefaults, 'blind_type_id'> }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ blindTypeId, patch }) =>
      (
        await apiFetch<Envelope<BlindTypeDefaults>>(
          `/api/settings/blind-type-defaults/${blindTypeId}`,
          { method: 'PUT', body: JSON.stringify(patch) }
        )
      ).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: DEFAULTS_KEY }),
  });
}
