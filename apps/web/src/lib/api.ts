// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * API client module — a typed fetch wrapper for all Worker API calls.
 *
 * Asks the Supabase auth client for the current access token on every
 * request (supabase-js transparently refreshes expired tokens), so no
 * token is ever manually persisted by this module. Handles JSON
 * serialization, error parsing, and exposes one generic `apiFetch`
 * used by all TanStack Query hooks.
 *
 * All data operations go through the Cloudflare Worker — the frontend
 * never calls Supabase directly for data access.
 */

import { supabase } from './supabaseClient';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787';

/**
 * An API failure. `status` is the HTTP status; `code` is the optional
 * machine-readable reason the Worker adds to some errors (for example
 * `version_conflict`), so callers branch on a stable value instead of
 * matching the human message.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Returns the current access token, or null when signed out.
 * supabase-js refreshes the token automatically if it has expired.
 */
async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * Generic fetch wrapper that attaches auth headers and handles errors.
 *
 * @param path - API path relative to the Worker base URL (e.g., '/api/customers')
 * @param options - Standard fetch RequestInit options
 * @returns Parsed JSON response body
 * @throws ApiError with status and message from the API if the response is not OK
 */
export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();

  // FormData bodies must NOT get a manual Content-Type — the browser
  // sets multipart/form-data with the correct boundary itself.
  const isFormData = options.body instanceof FormData;

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Request failed' }));
    const failure = body as { error?: string; code?: string };
    throw new ApiError(failure.error || `API error: ${response.status}`, response.status, failure.code);
  }

  return response.json();
}

/**
 * Fetches a binary endpoint (e.g. the estimate PDF) with auth and
 * returns the response Blob. Errors are parsed the same way as
 * `apiFetch` so callers get readable messages.
 *
 * @param path - API path relative to the Worker base URL
 * @returns The binary response body
 * @throws ApiError on non-2xx responses
 */
export async function apiDownload(path: string): Promise<Blob> {
  const token = await getAccessToken();
  const response = await fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Download failed' }));
    const failure = body as { error?: string; code?: string };
    throw new ApiError(failure.error || `API error: ${response.status}`, response.status, failure.code);
  }
  return response.blob();
}
